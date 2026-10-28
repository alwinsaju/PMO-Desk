// Pure shift-roster logic: reading times and cell text, resolving an assignment to
// what is shown, building the team sections from the roster and the directory.
// No React, no I/O.
import { addDays, weekDates } from "./dates.ts";
import { displayName } from "./employees.ts";
import {
  CUSTOM_REF,
  STATUS_DEFS,
  STATUS_PREFIX,
  statusRef,
  type StatusDef,
  type Tone,
} from "./rosterCatalog.ts";
import type {
  Employee,
  RosterConfig,
  RosterGroup,
  RosterMember,
  ShiftAssignment,
  ShiftDef,
  ShiftSchedule,
  TimeOffRequest,
} from "./types.ts";

export type { Tone };

// ---------------------------------------------------------------------------
// Times
// ---------------------------------------------------------------------------

export const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

const clock = (minutes: number): string =>
  `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** "14:30" -> "2:30 PM". */
export function formatClock(hhmm: string): string {
  const total = toMinutes(hhmm);
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** "08:00","17:00" -> "8:00 AM – 5:00 PM". */
export const formatHours = (start: string, end: string): string =>
  `${formatClock(start)} – ${formatClock(end)}`;

/** Compact hours for a narrow cell: "8a–5p", "4:30p–1:30a". */
export function shortHours(start: string, end: string): string {
  const part = (hhmm: string) => {
    const total = toMinutes(hhmm);
    const h = Math.floor(total / 60) % 24;
    const m = total % 60;
    return `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "a" : "p"}`;
  };
  return `${part(start)}–${part(end)}`;
}

const DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** [0..4] -> "Mon–Fri", [2..6] -> "Wed–Sun", [5,6] -> "Sat, Sun", [0,2] -> "Mon, Wed". */
export function formatDays(days: readonly number[]): string {
  const list = [...new Set(days)].sort((a, b) => a - b);
  if (list.length === 0) return "";
  if (list.length === 7) return "Every day";
  const consecutive = list.every((d, i) => i === 0 || d === list[i - 1] + 1);
  if (consecutive && list.length > 2) {
    return `${DAY_SHORT[list[0]]}–${DAY_SHORT[list[list.length - 1]]}`;
  }
  return list.map((d) => DAY_SHORT[d]).join(", ");
}

/** The first "6:00PM-3:00AM" style range in a text. A time without am/pm takes
 *  whichever reading gives a shift closest to nine hours. */
export function parseTimeRange(text: string): { start: string; end: string } | null {
  const match =
    /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|–|—|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(
      text,
    );
  if (!match) return null;
  const read = (h: string, m: string | undefined, ap: string | undefined) => {
    const hour = Number(h);
    const minute = m ? Number(m) : 0;
    if (hour > 24 || minute > 59) return null;
    if (ap) return [(hour % 12) * 60 + minute + (ap.toLowerCase() === "pm" ? 720 : 0)];
    if (hour > 12) return [(hour % 24) * 60 + minute];
    return [(hour % 12) * 60 + minute, (hour % 12) * 60 + minute + 720];
  };
  const starts = read(match[1], match[2], match[3]);
  const ends = read(match[4], match[5], match[6]);
  if (!starts || !ends) return null;
  let best: { s: number; e: number; gap: number } | null = null;
  for (const s of starts) {
    for (const e of ends) {
      const length = (e - s + 1440) % 1440 || 1440;
      const gap = Math.abs(length - 540);
      if (!best || gap < best.gap) best = { s, e, gap };
    }
  }
  return best ? { start: clock(best.s), end: clock(best.e) } : null;
}

export type Band = "day" | "afternoon" | "evening" | "night";

/** When a shift starts, in four bands. Colours follow the band, not the shift's
 *  name, so equal hours look equal in every team's schedule. */
export function bandOf(start: string): Band {
  const m = toMinutes(start);
  if (m >= 19 * 60 || m < 5 * 60) return "night";
  if (m >= 16 * 60) return "evening";
  if (m >= 12 * 60) return "afternoon";
  return "day";
}

export const BAND_TONE: Record<Band, Tone> = {
  day: "accent",
  afternoon: "amber",
  evening: "info",
  night: "night",
};

export const BAND_LABEL: Record<Band, string> = {
  day: "Day",
  afternoon: "Afternoon",
  evening: "Evening",
  night: "Night",
};

/** "Shift-3" -> "S3", "US-CST" -> "CST", "Weekend (W)" -> "W". */
export function shortLabel(label: string): string {
  const shiftNo = /^shift[\s-]*(\d+)$/i.exec(label.trim());
  if (shiftNo) return `S${shiftNo[1]}`;
  const paren = /\(([^)]{1,3})\)\s*$/.exec(label);
  if (paren) return paren[1].toUpperCase();
  const clean = label.trim().replace(/^US-/i, "");
  return clean.length <= 4 ? clean : clean.slice(0, 3);
}

// ---------------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------------

export const assignmentId = (memberId: string, date: string): string =>
  `${memberId}|${date}`;

export function makeAssignment(
  memberId: string,
  date: string,
  ref: string,
  extra: { text?: string; swap?: boolean; note?: string } = {},
): ShiftAssignment {
  const out: ShiftAssignment = { id: assignmentId(memberId, date), memberId, date, ref };
  if (extra.text) out.text = extra.text;
  if (extra.swap) out.swap = true;
  if (extra.note) out.note = extra.note;
  return out;
}

export function indexAssignments(
  list: readonly ShiftAssignment[],
): Map<string, ShiftAssignment> {
  return new Map(list.map((a) => [a.id, a]));
}

export const shiftRef = (scheduleId: string, shiftId: string): string =>
  `${scheduleId}:${shiftId}`;

const statusById = new Map(STATUS_DEFS.map((s) => [s.id, s]));
export const statusDef = (id: string): StatusDef | undefined => statusById.get(id);

export interface CellView {
  kind: "shift" | "status" | "custom" | "unknown";
  /** Compact text for a narrow cell. */
  short: string;
  label: string;
  /** "8:00 AM – 5:00 PM" or the typed hours; "" for a status. */
  hours: string;
  /** Mon–Fri / Wed–Sun pattern of the shift, when it has one. */
  days: string;
  /** Name of the schedule the shift belongs to. */
  schedule: string;
  tone: Tone;
  band: Band | null;
  /** Drawn with a dashed outline: a day type rather than a shift. */
  dashed: boolean;
  /** Counts towards "on shift". */
  working: boolean;
  swap: boolean;
  note: string;
}

const NOT_WORKING_TEXT = /\b(off|leave|holiday|pto)\b/i;

export function resolveAssignment(
  a: ShiftAssignment,
  schedules: readonly ShiftSchedule[],
): CellView {
  const base = {
    swap: a.swap === true,
    note: a.note ?? "",
    days: "",
    schedule: "",
    band: null as Band | null,
  };
  if (a.ref === CUSTOM_REF) {
    const text = a.text ?? "";
    const range = parseTimeRange(text);
    return {
      ...base,
      kind: "custom",
      short: range ? shortHours(range.start, range.end) : text.slice(0, 5) || "?",
      label: "Custom hours",
      hours: text,
      tone: range ? BAND_TONE[bandOf(range.start)] : "neutral",
      band: range ? bandOf(range.start) : null,
      dashed: false,
      working: !NOT_WORKING_TEXT.test(text),
    };
  }
  const [head, tail = ""] = a.ref.split(":");
  if (head === STATUS_PREFIX) {
    const def = statusDef(tail);
    return {
      ...base,
      kind: def ? "status" : "unknown",
      short: def?.short ?? tail.toUpperCase().slice(0, 4),
      label: def?.label ?? tail,
      hours: "",
      tone: def?.tone ?? "neutral",
      dashed: true,
      working: tail === "on-call",
    };
  }
  const schedule = schedules.find((s) => s.id === head);
  const def = schedule?.shifts.find((s) => s.id === tail);
  if (!schedule || !def) {
    return {
      ...base,
      kind: "unknown",
      short: tail.toUpperCase().slice(0, 4) || "?",
      label: tail || a.ref,
      hours: "",
      tone: "neutral",
      dashed: true,
      working: true,
    };
  }
  const band = bandOf(def.start);
  return {
    ...base,
    kind: "shift",
    short: shortLabel(def.label),
    label: def.label,
    hours: formatHours(def.start, def.end),
    days: formatDays(def.days),
    schedule: schedule.name,
    tone: BAND_TONE[band],
    band,
    dashed: false,
    working: true,
  };
}

// ---------------------------------------------------------------------------
// Reading a cell's text (the way the workbook writes it)
// ---------------------------------------------------------------------------

export interface InterpretedCell {
  ref: string;
  text?: string;
  swap?: boolean;
  /** Kept as typed text because it is neither a known shift nor readable hours. */
  loose?: boolean;
}

const squash = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]/g, "");

const STATUS_PATTERNS: [RegExp, string][] = [
  [/^hol(iday)?$/, "holiday"],
  [/^(p|pto)$/, "pto"],
  [/^(t|temp pto)$/, "temp-pto"],
  [/^comp([\s-]?off)?$/, "comp"],
  [/^(oc|on[\s-]?call)$/, "on-call"],
  [/^(sl|sick( leave)?)$/, "sick"],
  [/^(off|weekly off|day off)$/, "off"],
];

/** Turns what a person typed in a roster cell into an assignment reference, using
 *  the shifts of the schedule their team works to. Empty text gives null. */
export function interpretCell(
  raw: string,
  schedule: ShiftSchedule | undefined,
  /** Every schedule: a shift the team's own schedule lacks (a swap onto the night
   *  shift) is still found when exactly one set of hours has that name. */
  all: readonly ShiftSchedule[] = [],
): InterpretedCell | null {
  let text = raw.replace(/\s+/g, " ").trim();
  if (!text) return null;
  let swap = false;
  const swapMatch = /shift[\s-]*swap/i.exec(text);
  if (swapMatch) {
    swap = true;
    text = text
      .replace(swapMatch[0], " ")
      .replace(/[()]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) return { ref: CUSTOM_REF, text: "Shift swap", swap, loose: true };
  }
  const flag = swap ? { swap } : {};
  const lower = text.toLowerCase();
  for (const [pattern, id] of STATUS_PATTERNS) {
    if (pattern.test(lower)) return { ref: statusRef(id), ...flag };
  }
  if (schedule) {
    const key = squash(text);
    const byName = schedule.shifts.find(
      (s) => squash(s.label) === key || squash(s.id) === key,
    );
    if (byName) return { ref: shiftRef(schedule.id, byName.id), ...flag };
    const range = parseTimeRange(text);
    if (range) {
      const byHours = schedule.shifts.find(
        (s) => s.start === range.start && s.end === range.end,
      );
      if (byHours) return { ref: shiftRef(schedule.id, byHours.id), ...flag };
    }
  }
  const elsewhere = new Map<string, string>();
  const key = squash(text);
  for (const s of all) {
    for (const def of s.shifts) {
      if (squash(def.label) === key || squash(def.id) === key) {
        const hours = `${def.start}-${def.end}`;
        if (!elsewhere.has(hours)) elsewhere.set(hours, shiftRef(s.id, def.id));
      }
    }
  }
  if (elsewhere.size === 1) return { ref: [...elsewhere.values()][0], ...flag };
  return { ref: CUSTOM_REF, text, ...flag, loose: !parseTimeRange(text) };
}

// ---------------------------------------------------------------------------
// Leave from the Time off tab
// ---------------------------------------------------------------------------

/** The approved leave covering this person on this day, if any. */
export function leaveOn(
  requests: readonly TimeOffRequest[],
  employeeId: string,
  date: string,
): TimeOffRequest | undefined {
  return requests.find(
    (r) =>
      r.employeeId === employeeId &&
      r.status === "approved" &&
      r.startDate <= date &&
      date <= r.endDate,
  );
}

// ---------------------------------------------------------------------------
// Rows and sections
// ---------------------------------------------------------------------------

export interface RosterRow {
  /** Stable key for React. */
  key: string;
  /** The roster member; null for a directory person not in any team yet. */
  member: RosterMember | null;
  employee: Employee | null;
  name: string;
  subtitle: string;
}

export interface RosterSection {
  id: string;
  /** null = directory people who are not in any team yet. */
  group: RosterGroup | null;
  schedule: ShiftSchedule | undefined;
  rows: RosterRow[];
}

export const UNASSIGNED_ID = "unassigned";

function rowFor(member: RosterMember, employee: Employee | null): RosterRow {
  return {
    key: member.id,
    member,
    employee,
    name: employee ? displayName(employee) : member.name,
    subtitle: employee
      ? [employee.level, employee.op].filter(Boolean).join(" · ")
      : [member.role, member.city].filter(Boolean).join(" · "),
  };
}

export interface SectionsResult {
  sections: RosterSection[];
  /** Directory people left out because their profile is excluded from the shift roster. */
  excluded: number;
  /** Everyone shown, across sections. */
  total: number;
}

/**
 * The people of the shift roster, by team. Roster members come from the roster
 * itself; a member linked to a directory profile takes the name from there and
 * disappears when that profile is excluded from the shift roster. Included
 * directory people who are in no team yet are listed last, waiting for one.
 */
export function buildSections(
  config: RosterConfig,
  employees: readonly Employee[],
  { query = "", groupId = "" }: { query?: string; groupId?: string } = {},
): SectionsResult {
  const byId = new Map(employees.map((e) => [e.id, e]));
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (row: RosterRow): boolean => {
    if (terms.length === 0) return true;
    const haystack = [
      row.name,
      row.member?.name,
      row.member?.city,
      row.member?.role,
      row.employee?.deloitteEmail,
      row.employee?.level,
      row.employee?.op,
      row.employee?.team,
    ]
      .join(" ")
      .toLowerCase();
    return terms.every((t) => haystack.includes(t));
  };

  const linked = new Set<string>();
  const sections: RosterSection[] = config.groups.map((group) => ({
    id: group.id,
    group,
    schedule: config.schedules.find((s) => s.id === group.scheduleId),
    rows: [],
  }));
  const sectionOf = new Map(sections.map((s) => [s.id, s]));

  for (const member of config.members) {
    const employee = member.employeeId ? (byId.get(member.employeeId) ?? null) : null;
    if (employee) linked.add(employee.id);
    if (employee?.excludeFromShiftRoster) continue;
    const section = sectionOf.get(member.groupId);
    if (!section) continue;
    const row = rowFor(member, employee);
    if (matches(row)) section.rows.push(row);
  }

  const waiting: RosterRow[] = [];
  for (const employee of employees) {
    if (employee.excludeFromShiftRoster || linked.has(employee.id)) continue;
    const row: RosterRow = {
      key: `emp:${employee.id}`,
      member: null,
      employee,
      name: displayName(employee),
      subtitle: [employee.level, employee.op].filter(Boolean).join(" · "),
    };
    if (matches(row)) waiting.push(row);
  }
  if (waiting.length) {
    sections.push({ id: UNASSIGNED_ID, group: null, schedule: undefined, rows: waiting });
  }

  const filtering = terms.length > 0 || groupId !== "";
  const shown = sections.filter(
    (s) => (!groupId || s.id === groupId) && (s.rows.length > 0 || !filtering),
  );
  return {
    sections: shown,
    excluded: employees.filter((e) => e.excludeFromShiftRoster).length,
    total: shown.reduce((n, s) => n + s.rows.length, 0),
  };
}

// ---------------------------------------------------------------------------
// Counting, copying, filling
// ---------------------------------------------------------------------------

/** How many of these rows are working on `date` (approved leave and days off do not count). */
export function coverageOn(
  date: string,
  rows: readonly RosterRow[],
  index: ReadonlyMap<string, ShiftAssignment>,
  schedules: readonly ShiftSchedule[],
  requests: readonly TimeOffRequest[],
): number {
  let count = 0;
  for (const row of rows) {
    if (!row.member) continue;
    const a = index.get(assignmentId(row.member.id, date));
    if (!a || !resolveAssignment(a, schedules).working) continue;
    if (row.employee && leaveOn(requests, row.employee.id, date)) continue;
    count++;
  }
  return count;
}

/** Copies the filled days of last week into the empty days of this week (the
 *  hours, not the swap flag or note). */
export function copyPreviousWeek(
  assignments: readonly ShiftAssignment[],
  monday: string,
  memberIds: readonly string[],
): ShiftAssignment[] {
  const index = indexAssignments(assignments);
  const copies: ShiftAssignment[] = [];
  for (const date of weekDates(monday)) {
    const source = addDays(date, -7);
    for (const memberId of memberIds) {
      const previous = index.get(assignmentId(memberId, source));
      if (!previous || index.has(assignmentId(memberId, date))) continue;
      copies.push(makeAssignment(memberId, date, previous.ref, { text: previous.text }));
    }
  }
  return copies;
}

/** The shift on each day of its usual pattern in the week of `monday`. */
export function fillWeek(
  monday: string,
  memberId: string,
  scheduleId: string,
  def: ShiftDef,
): ShiftAssignment[] {
  const dates = weekDates(monday);
  return def.days.map((d) =>
    makeAssignment(memberId, dates[d], shiftRef(scheduleId, def.id)),
  );
}

// ---------------------------------------------------------------------------
// Matching roster members to directory people
// ---------------------------------------------------------------------------

const nameTokens = (name: string): string[] =>
  name
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .sort();

/** Directory people whose name is the same words as `name` in any order
 *  ("Doe, Jane" = "Jane Doe"), and who are not linked to anyone yet. */
export function suggestLinks(
  name: string,
  employees: readonly Employee[],
  linkedIds: ReadonlySet<string>,
): Employee[] {
  const wanted = nameTokens(name).join(" ");
  if (!wanted) return [];
  return employees.filter(
    (e) => !linkedIds.has(e.id) && nameTokens(displayName(e)).join(" ") === wanted,
  );
}

/** Links every roster member with exactly one name match to that directory
 *  person (and no two members to the same person). Returns the changed members. */
export function autoLinkMembers(
  members: readonly RosterMember[],
  employees: readonly Employee[],
): RosterMember[] {
  const linkedIds = new Set(
    members.map((m) => m.employeeId).filter((id): id is string => !!id),
  );
  const changed: RosterMember[] = [];
  for (const member of members) {
    if (member.employeeId) continue;
    const found = suggestLinks(member.name, employees, linkedIds);
    if (found.length === 1) {
      linkedIds.add(found[0].id);
      changed.push({ ...member, employeeId: found[0].id });
    }
  }
  return changed;
}

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------

export function newId(prefix: string): string {
  const hex =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "")
      : Math.random().toString(16).slice(2).padEnd(12, "0");
  return `${prefix}_${hex.slice(0, 12)}`;
}

export const MEMBER_ID = /^mem_[0-9a-f]{8,32}$/;
