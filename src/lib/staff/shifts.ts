// Pure shift-roster logic: reading times and cell text, resolving an assignment to
// what is shown, building the team sections from the roster and the directory.
// No React, no I/O.
import { addDays, weekDates } from "./dates.ts";
import { displayName } from "./employees.ts";
import { locationOf } from "./holidays.ts";
import {
  CUSTOM_REF,
  GROUP_ALIASES,
  STATUS_DEFS,
  STATUS_PREFIX,
  slugify,
  statusRef,
  type Hue,
  type StatusDef,
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
  TimeOffType,
} from "./types.ts";

export type { Hue };

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

/** "08:00","17:00" -> "8 AM – 5 PM"; minutes are kept only when there are some. */
export const compactHours = (start: string, end: string): string =>
  formatHours(start, end).replaceAll(":00", "");

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

/** When a shift starts, in four bands. Only used to colour a shift that has no
 *  colour of its own (a name other than Shift-1 ... Shift-5, NS, US-CST, US-PST). */
export function bandOf(start: string): Band {
  const m = toMinutes(start);
  if (m >= 19 * 60 || m < 5 * 60) return "night";
  if (m >= 16 * 60) return "evening";
  if (m >= 12 * 60) return "afternoon";
  return "day";
}

const BAND_HUE: Record<Band, Hue> = {
  day: "s1",
  afternoon: "s3",
  evening: "s4",
  night: "ns",
};

const NAMED_HUES: readonly (readonly [RegExp, Hue])[] = [
  [/^shift-?1$/, "s1"],
  [/^shift-?2$/, "s2"],
  [/^shift-?3$/, "s3"],
  [/^shift-?4$/, "s4"],
  [/^shift-?5$/, "s5"],
  [/^ns$/, "ns"],
  [/^(us-?)?cst$/, "cst"],
  [/^(us-?)?pst$/, "pst"],
  [/^weekend/, "wk"],
];

/** The colour of a shift: by its name, the way the team's workbook paints it
 *  (Shift-1 green, Shift-2 yellow, Shift-3 blue ...), so a shift looks the same in
 *  every team; the hours differ per team and are in each team's legend. */
export function hueOfShift(def: Pick<ShiftDef, "id" | "label" | "start">): Hue {
  const names = [def.id, def.label].map((n) => n.toLowerCase().replace(/[\s_]+/g, "-"));
  for (const [pattern, hue] of NAMED_HUES) {
    if (names.some((n) => pattern.test(n))) return hue;
  }
  return BAND_HUE[bandOf(def.start)];
}

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
  hue: Hue;
  /** When the shift starts and ends (HH:MM, IST); null for a day type or unreadable hours. */
  range: { start: string; end: string } | null;
  /** Drawn with a dashed outline: a day type rather than a shift. */
  dashed: boolean;
  /** Counts towards "on shift". */
  working: boolean;
  swap: boolean;
  note: string;
  /** Where the day comes from: typed in the roster, approved Time off, or a
   *  holiday of the person's location. */
  source: "entry" | "leave" | "holiday";
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
    range: null as CellView["range"],
    source: "entry" as const,
  };
  // A swapped day is painted like the workbook's Shift-swap cells.
  const hueFor = (hue: Hue): Hue => (a.swap ? "swap" : hue);
  if (a.ref === CUSTOM_REF) {
    const text = a.text ?? "";
    const range = parseTimeRange(text);
    return {
      ...base,
      kind: "custom",
      short: range ? shortHours(range.start, range.end) : text.slice(0, 5) || "?",
      label: "Custom hours",
      hours: text,
      hue: hueFor("custom"),
      range,
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
      hue: def?.hue ?? "off",
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
      hue: "off",
      dashed: true,
      working: true,
    };
  }
  return {
    ...base,
    kind: "shift",
    short: shortLabel(def.label),
    label: def.label,
    hours: formatHours(def.start, def.end),
    days: formatDays(def.days),
    schedule: schedule.name,
    hue: hueFor(hueOfShift(def)),
    range: { start: def.start, end: def.end },
    dashed: false,
    working: true,
  };
}

// ---------------------------------------------------------------------------
// Days that are not typed into the roster: approved Time off and holidays
// ---------------------------------------------------------------------------

const LEAVE_STATUS: Record<TimeOffType, string> = {
  pto: "pto",
  sick: "sick",
  "public-holiday": "holiday",
  "comp-off": "comp",
  parental: "pto",
  other: "pto",
};

const derived = (
  status: StatusDef,
  label: string,
  source: "leave" | "holiday",
): CellView => ({
  kind: "status",
  short: status.short,
  label,
  hours: "",
  days: "",
  schedule: "",
  hue: status.hue,
  range: null,
  dashed: true,
  working: false,
  swap: false,
  note: "",
  source,
});

const leaveViews = new Map<string, CellView>();

/** What approved Time off looks like in the roster: PTO, sick leave, comp off ... */
export function leaveView(type: TimeOffType, typeLabel: string): CellView {
  let view = leaveViews.get(type);
  if (!view) {
    view = derived(
      statusDef(LEAVE_STATUS[type]) ?? STATUS_DEFS[1],
      `${typeLabel} (approved in Time off)`,
      "leave",
    );
    leaveViews.set(type, view);
  }
  return view;
}

const holidayViews = new Map<string, CellView>();

/** The HOL of a holiday the person's location observes, when nothing else is entered. */
export function holidayView(name: string): CellView {
  let view = holidayViews.get(name);
  if (!view) {
    view = derived(STATUS_DEFS[0], name, "holiday");
    holidayViews.set(name, view);
  }
  return view;
}

export interface DayCell {
  cell: CellView | null;
  /** What was typed in for the day when approved Time off covers it instead. */
  covered: string;
}

/**
 * What a person's day shows. A day typed into the roster wins, except that
 * approved Time off replaces a working shift (leave beats the plan, while
 * holidays, weekly offs and on-call stay as entered). With nothing entered, on a day
 * the person would normally work, approved leave shows, then a holiday of the
 * person's location.
 */
export function dayCell(
  entry: CellView | null,
  leave: { type: TimeOffType; label: string } | null,
  holiday: string | null,
  /** Whether the person would normally work this day (see `usuallyWorks`). */
  works: boolean,
): DayCell {
  if (entry) {
    if (leave && (entry.kind === "shift" || entry.kind === "custom") && entry.working) {
      return {
        cell: leaveView(leave.type, leave.label),
        covered: `${entry.label}${entry.hours ? ` ${entry.hours}` : ""}`,
      };
    }
    return { cell: entry, covered: "" };
  }
  if (!works) return { cell: null, covered: "" };
  if (leave) return { cell: leaveView(leave.type, leave.label), covered: "" };
  if (holiday) return { cell: holidayView(holiday), covered: "" };
  return { cell: null, covered: "" };
}

/**
 * Whether a person normally works this weekday, read from their own entries around it:
 * the same weekday a week or two either side (anything but a day off counts), or, when
 * they have none, whether they have entries on nearby days at all (then this is a weekly
 * off). Null when nothing nearby says, so the caller falls back to "weekdays".
 */
export function usuallyWorks(
  index: ReadonlyMap<string, ShiftAssignment>,
  memberId: string,
  date: string,
): boolean | null {
  for (const offset of [-7, 7, -14, 14]) {
    const a = index.get(assignmentId(memberId, addDays(date, offset)));
    if (a && a.ref !== statusRef("off")) return true;
  }
  for (const offset of [-3, -2, -1, 1, 2, 3, -7, 7]) {
    if (index.has(assignmentId(memberId, addDays(date, offset)))) return false;
  }
  return null;
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
  /** The roster member; null for a directory person who has no shifts entered yet. */
  member: RosterMember | null;
  employee: Employee | null;
  name: string;
  subtitle: string;
  /** Where they work, for holidays ("" when unknown). */
  location: string;
}

export interface RosterSection {
  id: string;
  /** null = directory people whose profile names no team. */
  group: RosterGroup | null;
  /** The team exists only because a directory profile names it; it is saved with the
   *  roster the first time something is entered or changed for it. */
  virtual: boolean;
  hidden: boolean;
  schedule: ShiftSchedule | undefined;
  rows: RosterRow[];
}

/** One team in the teams list, whether it is shown or not. */
export interface TeamInfo {
  id: string;
  name: string;
  hidden: boolean;
  virtual: boolean;
  scheduleId: string;
  count: number;
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
    location: locationOf(member, employee),
  };
}

export interface SectionsResult {
  sections: RosterSection[];
  /** Every team (shown or hidden, with or without people). */
  teams: TeamInfo[];
  /** Directory people left out because their profile is excluded from the shift roster. */
  excluded: number;
  /** Everyone shown, across sections. */
  total: number;
  /** People in hidden teams. */
  hiddenPeople: number;
}

/** The stored team a directory "Team" value names (same words, or a known alias). */
export function matchGroup(
  groups: readonly RosterGroup[],
  team: string,
): RosterGroup | undefined {
  const slug = slugify(team);
  if (!slug) return undefined;
  const alias = GROUP_ALIASES[team.trim().toLowerCase().replace(/\s+/g, " ")];
  return groups.find((g) => g.id === slug || slugify(g.name) === slug || g.id === alias);
}

/** Adds a team that only the directory names to the roster's teams (a no-op for a stored one). */
export function withGroup(config: RosterConfig, group: RosterGroup): RosterConfig {
  return config.groups.some((g) => g.id === group.id)
    ? config
    : { ...config, groups: [...config.groups, group] };
}

/**
 * The people of the shift roster, by team. The teams come from the directory: a
 * person's team is the "Team" on their profile, and a team nobody has stored yet
 * appears as soon as a profile names it. Roster entries that are not linked to a
 * profile (imported from the workbook) stay in the team they were put in. Profiles
 * excluded from the shift roster are left out; hidden teams are not listed.
 */
export function buildSections(
  config: RosterConfig,
  employees: readonly Employee[],
  {
    query = "",
    groupId = "",
    showHidden = false,
  }: { query?: string; groupId?: string; showHidden?: boolean } = {},
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
      row.location,
      row.employee?.deloitteEmail,
      row.employee?.level,
      row.employee?.op,
      row.employee?.team,
    ]
      .join(" ")
      .toLowerCase();
    return terms.every((t) => haystack.includes(t));
  };

  const defaultSchedule = config.schedules[0]?.id ?? "main";
  const scheduleOf = (id: string) => config.schedules.find((s) => s.id === id);
  const sections: RosterSection[] = config.groups.map((group) => ({
    id: group.id,
    group,
    virtual: false,
    hidden: group.hidden === true,
    schedule: scheduleOf(group.scheduleId),
    rows: [],
  }));
  const sectionOf = new Map(sections.map((s) => [s.id, s]));

  /** The section for a directory team name; a team no stored group matches gets a new one. */
  const sectionForTeam = (team: string): RosterSection | null => {
    const name = team.trim();
    if (!name) return null;
    const stored = matchGroup(config.groups, name);
    if (stored) return sectionOf.get(stored.id) ?? null;
    const id = slugify(name) || "team";
    let section = sectionOf.get(id);
    if (!section) {
      const group: RosterGroup = { id, name, scheduleId: defaultSchedule };
      section = {
        id,
        group,
        virtual: true,
        hidden: false,
        schedule: scheduleOf(defaultSchedule),
        rows: [],
      };
      sectionOf.set(id, section);
      sections.push(section);
    }
    return section;
  };

  const linked = new Set<string>();
  for (const member of config.members) {
    const employee = member.employeeId ? (byId.get(member.employeeId) ?? null) : null;
    if (employee) linked.add(employee.id);
    if (employee?.excludeFromShiftRoster) continue;
    const section =
      (employee && sectionForTeam(employee.team)) ?? sectionOf.get(member.groupId);
    section?.rows.push(rowFor(member, employee));
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
      location: locationOf(null, employee),
    };
    const section = sectionForTeam(employee.team);
    if (section) section.rows.push(row);
    else waiting.push(row);
  }

  // Teams only the directory names come after the stored ones, in alphabetical order.
  const storedCount = config.groups.length;
  const named = sections.slice(storedCount).sort((a, b) => a.id.localeCompare(b.id));
  sections.splice(storedCount, named.length, ...named);
  if (waiting.length) {
    sections.push({
      id: UNASSIGNED_ID,
      group: null,
      virtual: false,
      hidden: false,
      schedule: undefined,
      rows: waiting,
    });
  }

  const teams: TeamInfo[] = sections.flatMap((s) =>
    s.group
      ? [
          {
            id: s.id,
            name: s.group.name,
            hidden: s.hidden,
            virtual: s.virtual,
            scheduleId: s.group.scheduleId,
            count: s.rows.length,
          },
        ]
      : [],
  );

  const shown = sections
    .filter((s) => showHidden || !s.hidden)
    .map((s) => ({ ...s, rows: s.rows.filter(matches) }))
    .filter(
      (s) =>
        s.rows.length > 0 && (!groupId || s.id === groupId || s.group?.name === groupId),
    );
  return {
    sections: shown,
    teams,
    excluded: employees.filter((e) => e.excludeFromShiftRoster).length,
    total: shown.reduce((n, s) => n + s.rows.length, 0),
    hiddenPeople: sections.filter((s) => s.hidden).reduce((n, s) => n + s.rows.length, 0),
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
// The Today view: a shift as a stretch of the 24-hour day
// ---------------------------------------------------------------------------

export interface DaySpan {
  /** Minutes after midnight. */
  from: number;
  to: number;
  /** Today's shift that runs on past midnight, or last night's shift still running. */
  open: boolean;
}

/**
 * The part of a shift that falls on one day. `today`: the shift that starts that day
 * (an overnight shift is cut at midnight). `yesterday`: the tail of last night's
 * overnight shift that is still running early that day; null for a daytime shift.
 */
export function daySpan(
  range: { start: string; end: string },
  which: "today" | "yesterday",
): DaySpan | null {
  const start = toMinutes(range.start);
  const end = toMinutes(range.end);
  const overnight = end <= start;
  if (which === "today") {
    return overnight
      ? { from: start, to: 1440, open: true }
      : { from: start, to: end, open: false };
  }
  return overnight ? { from: 0, to: end, open: true } : null;
}

export const spanActiveAt = (span: DaySpan, minute: number): boolean =>
  span.from <= minute && minute < span.to;

/** Minutes after midnight on the machine's clock. */
export const minutesNow = (now: Date = new Date()): number =>
  now.getHours() * 60 + now.getMinutes();

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
