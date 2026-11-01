// Reads the team's shift roster workbook (the "Resource" grid: a banner row of
// holidays, a row of dates, then one row per person under their team's heading)
// and turns it into roster members, assignments and events. Pure: the sheet rows
// come in, a plan comes out, nothing is saved here.
import { addDays, isIsoDate } from "./dates.ts";
import { parseDateCell } from "./employees.ts";
import { locationHint } from "./holidays.ts";
import {
  GROUP_ALIASES,
  workbookGroups,
  workbookSchedules,
  slugify,
} from "./rosterCatalog.ts";
import { interpretCell, makeAssignment, newId, suggestLinks } from "./shifts.ts";
import type {
  Employee,
  RosterConfig,
  RosterEvent,
  RosterGroup,
  RosterMember,
  ShiftAssignment,
} from "./types.ts";

export interface ParsedMember {
  name: string;
  city: string;
  role: string;
  /** The team heading it sits under, as written in the workbook. */
  section: string;
  cells: { date: string; text: string }[];
}

export interface ParsedRoster {
  startDate: string;
  endDate: string;
  members: ParsedMember[];
  banners: { date: string; label: string }[];
}

type Cell = unknown;

const text = (value: Cell): string =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";

/** The sheet that holds the roster grid: the first one with "Resource" in column A. */
export function findRosterSheet<T extends { data: unknown[][] }>(
  sheets: readonly T[],
): T | null {
  return (
    sheets.find((s) =>
      s.data.some((row) => text(row?.[0]).toLowerCase() === "resource"),
    ) ?? null
  );
}

export const MAX_CELL_TEXT = 40;

export function parseRosterSheet(
  rows: readonly (readonly Cell[])[],
): ParsedRoster | null {
  const headerAt = rows.findIndex((row) => text(row?.[0]).toLowerCase() === "resource");
  if (headerAt < 0) return null;
  const dateRow = rows[headerAt + 1] ?? [];
  let startCol = -1;
  let startDate = "";
  for (let c = 1; c < dateRow.length; c++) {
    const iso = parseDateCell(dateRow[c]);
    if (iso) {
      startCol = c;
      startDate = iso;
      break;
    }
  }
  if (startCol < 0) return null;
  const width = Math.max(
    ...[headerAt, headerAt + 1, headerAt + 2].map((i) => rows[i]?.length ?? 0),
  );
  const dayCount = Math.max(1, width - startCol);
  const dates = Array.from({ length: dayCount }, (_, i) => addDays(startDate, i));

  const banners: ParsedRoster["banners"] = [];
  const bannerRow = rows[headerAt] ?? [];
  for (let c = startCol; c < bannerRow.length && c - startCol < dayCount; c++) {
    const label = text(bannerRow[c]);
    if (label) banners.push({ date: dates[c - startCol], label });
  }

  const members: ParsedMember[] = [];
  let section = "";
  for (let i = headerAt + 3; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const a = text(row[0]);
    const b = text(row[1]);
    if (a === "#") {
      section = b || section;
      continue;
    }
    if (!b && a && !/^[\d=]/.test(a)) {
      section = a;
      continue;
    }
    // A legend line (the hours of a shift), not a person.
    if (!b || /\d/.test(b)) continue;
    if (!section) continue;
    const cells: ParsedMember["cells"] = [];
    for (let k = 0; k < dayCount; k++) {
      const raw = row[startCol + k];
      const t = text(raw);
      if (t) cells.push({ date: dates[k], text: t });
    }
    members.push({ name: b, city: text(row[2]), role: text(row[3]), section, cells });
  }
  return { startDate, endDate: dates[dates.length - 1], members, banners };
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export interface ImportWarning {
  text: string;
  count: number;
  reason: string;
}

export interface RosterImportPlan {
  config: RosterConfig;
  upsert: ShiftAssignment[];
  stats: {
    membersAdded: number;
    membersUpdated: number;
    /** People in the file who are already on the roster exactly as written. */
    membersUnchanged: number;
    membersLinked: number;
    groupsAdded: number;
    /** Days to save: the new ones and the changed ones. */
    assignments: number;
    assignmentsAdded: number;
    assignmentsChanged: number;
    /** Days in the file that are already on the roster as they are; not saved again. */
    assignmentsUnchanged: number;
    events: number;
  };
  warnings: ImportWarning[];
}

const nameKey = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");

function eventKind(label: string): RosterEvent["kind"] {
  if (/swap/i.test(label)) return "swap";
  if (/lean shift|disconnect/i.test(label)) return "note";
  return "holiday";
}

const sameDay = (a: ShiftAssignment, b: ShiftAssignment): boolean =>
  a.ref === b.ref && (a.text ?? "") === (b.text ?? "") && !!a.swap === !!b.swap;

const eventKey = (date: string, label: string): string =>
  `${date}|${label.toLowerCase().replace(/\s+/g, " ").trim()}`;

/** Merges a parsed workbook into the existing roster: people are matched by name
 *  (existing ones keep their id and directory link), teams and schedules that are
 *  missing are added from the defaults, and every readable cell becomes an assignment.
 *  Only what differs from the roster (`shifts` is what is on it now) is planned: a day
 *  that is already as written is counted, not saved again, so a workbook that was
 *  downloaded, added to and uploaded changes just the additions. */
export function planRosterImport(
  parsed: ParsedRoster,
  existing: RosterConfig,
  employees: readonly Employee[],
  shifts: readonly ShiftAssignment[] = [],
): RosterImportPlan {
  const current = new Map(shifts.map((a) => [a.id, a]));
  const schedules = [...existing.schedules];
  for (const d of workbookSchedules()) {
    if (!schedules.some((s) => s.id === d.id)) schedules.push(d);
  }
  const groups: RosterGroup[] = [...existing.groups];
  let groupsAdded = 0;
  // A team the file names but the roster lacks is only added once someone is saved in it.
  const unregistered = new Map<string, RosterGroup>();
  const keepGroup = (group: RosterGroup) => {
    if (!unregistered.delete(group.id)) return;
    groups.push(group);
    groupsAdded++;
  };
  const resolveGroup = (name: string): RosterGroup => {
    const lower = name.toLowerCase().trim();
    const aliased = GROUP_ALIASES[lower];
    const found =
      groups.find((g) => g.id === aliased) ??
      groups.find((g) => g.name.toLowerCase() === lower || g.id === slugify(name));
    if (found) return found;
    const known = workbookGroups().find(
      (g) => g.id === aliased || g.id === slugify(name),
    );
    const group: RosterGroup = known ?? {
      id: slugify(name) || newId("grp"),
      name: name.trim(),
      scheduleId: "main",
    };
    const waiting = unregistered.get(group.id);
    if (waiting) return waiting;
    unregistered.set(group.id, group);
    return group;
  };

  const members: RosterMember[] = [...existing.members];
  const byKey = new Map(members.map((m, i) => [nameKey(m.name), i]));
  const linkedIds = new Set(
    members.map((m) => m.employeeId).filter((id): id is string => !!id),
  );
  const stats: RosterImportPlan["stats"] = {
    membersAdded: 0,
    membersUpdated: 0,
    membersUnchanged: 0,
    membersLinked: 0,
    groupsAdded: 0,
    assignments: 0,
    assignmentsAdded: 0,
    assignmentsChanged: 0,
    assignmentsUnchanged: 0,
    events: 0,
  };
  const upsert = new Map<string, ShiftAssignment>();
  const loose = new Map<string, ImportWarning>();
  const warn = (value: string, reason: string) => {
    const key = `${reason}|${value}`;
    const entry = loose.get(key);
    if (entry) entry.count++;
    else loose.set(key, { text: value, count: 1, reason });
  };

  for (const person of parsed.members) {
    const group = resolveGroup(person.section);
    const schedule = schedules.find((s) => s.id === group.scheduleId);
    const key = nameKey(person.name);
    let at = byKey.get(key);
    if (at === undefined) {
      const found = suggestLinks(person.name, employees, linkedIds);
      // A directory person with nothing entered is on the roster already (through their
      // profile); a member is only made once there is something to keep.
      if (found.length === 1 && person.cells.length === 0) {
        stats.membersUnchanged++;
        continue;
      }
      const member: RosterMember = {
        id: newId("mem"),
        name: person.name,
        employeeId: found.length === 1 ? found[0].id : null,
        groupId: group.id,
        city: person.city,
        role: person.role,
      };
      if (member.employeeId) {
        linkedIds.add(member.employeeId);
        stats.membersLinked++;
      }
      keepGroup(group);
      members.push(member);
      at = members.length - 1;
      byKey.set(key, at);
      stats.membersAdded++;
    } else {
      const before = members[at];
      if (
        before.groupId === group.id &&
        before.city === person.city &&
        before.role === person.role
      ) {
        stats.membersUnchanged++;
      } else {
        keepGroup(group);
        members[at] = {
          ...before,
          groupId: group.id,
          city: person.city,
          role: person.role,
        };
        stats.membersUpdated++;
      }
    }
    const memberId = members[at].id;
    for (const cell of person.cells) {
      if (cell.text.length > MAX_CELL_TEXT) {
        warn(`${cell.text.slice(0, 24)}…`, "Too long to be a shift");
        continue;
      }
      const read = interpretCell(cell.text, schedule, schedules);
      if (!read) continue;
      if (read.loose) warn(cell.text, "Not a known shift; kept as typed");
      const extra = { text: read.text, swap: read.swap };
      const a = makeAssignment(memberId, cell.date, read.ref, extra);
      const before = current.get(a.id);
      if (before && sameDay(before, a)) stats.assignmentsUnchanged++;
      else {
        if (before) stats.assignmentsChanged++;
        else stats.assignmentsAdded++;
        upsert.set(a.id, a);
      }
    }
  }
  stats.groupsAdded = groupsAdded;
  stats.assignments = upsert.size;

  // A banner is a single day, except the last one, which runs to the end of the sheet
  // (the winter disconnect spans several days at the end of the year).
  const events = [...existing.events];
  const eventKeys = new Set(events.map((e) => e.id));
  const eventSeen = new Set(events.map((e) => eventKey(e.date, e.label)));
  parsed.banners.forEach((banner, i) => {
    const label = banner.label.replace(/\s*\n\s*/g, " ").trim();
    const id = `ev_${banner.date}_${slugify(label)}`.slice(0, 80);
    if (eventKeys.has(id) || eventSeen.has(eventKey(banner.date, label))) return;
    const kind = eventKind(label);
    const last = i === parsed.banners.length - 1 && kind === "note";
    // The banner often says where it applies ("Holi (Except Gur)", "HYD Only", "KOL HOL").
    const hint = kind === "holiday" ? locationHint(label) : undefined;
    events.push({
      id,
      date: banner.date,
      endDate: last && isIsoDate(parsed.endDate) ? parsed.endDate : banner.date,
      label,
      kind,
      ...(hint ? { locations: hint } : {}),
    });
    eventKeys.add(id);
    eventSeen.add(eventKey(banner.date, label));
    stats.events++;
  });

  return {
    config: { schedules, groups, members, events },
    upsert: [...upsert.values()],
    stats,
    warnings: [...loose.values()].sort((a, b) => b.count - a.count),
  };
}
