// Answers about one person ("when is Ana back?", "what's Ben's shift tomorrow?") and about
// what changed since a day. Facts only: every name and date comes from the data passed in.
// Pure; pmoAnswers.ts feeds it the live Staff and PMO data.
import { localParts } from "../pmo/due.ts";
import type { Todo } from "../pmo/types.ts";
import { addDays, dayName, formatDate, isWeekend } from "../staff/dates.ts";
import { displayName } from "../staff/employees.ts";
import { STATUS_DEFS, statusRef } from "../staff/rosterCatalog.ts";
import type {
  Employee,
  RosterMember,
  ShiftAssignment,
  ShiftSchedule,
  TimeOffRequest,
} from "../staff/types.ts";
import { TIME_OFF_META } from "../staff/timeoff.ts";
import { whosOff, type AwayEntry, type WhosOffInput } from "../staff/whosOff.ts";
import { resolveWhen } from "./whenPhrase.ts";

const dayLabel = (day: string) => `${dayName(day)} ${formatDate(day)}`;
const norm = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

export interface Person {
  name: string;
  employeeId: string | null;
  memberIds: string[];
}

/** People matching what was typed: every typed word must start a word of the name. An exact full name wins. */
export function findPeople(
  query: string,
  employees: readonly Employee[],
  members: readonly Pick<RosterMember, "id" | "name" | "employeeId">[],
): Person[] {
  const words = norm(query).split(" ").filter(Boolean);
  if (words.length === 0) return [];
  const people: Person[] = employees.map((e) => ({
    name: displayName(e),
    employeeId: e.id,
    memberIds: members.filter((m) => m.employeeId === e.id).map((m) => m.id),
  }));
  for (const m of members) {
    if (!m.employeeId || !employees.some((e) => e.id === m.employeeId)) {
      people.push({ name: m.name, employeeId: null, memberIds: [m.id] });
    }
  }
  const matches = people.filter((p) => {
    const parts = norm(p.name).split(" ");
    return words.every((w) => parts.some((part) => part.startsWith(w)));
  });
  const exact = matches.filter((p) => norm(p.name) === words.join(" "));
  return exact.length > 0 ? exact : matches;
}

export const noPersonReply = (query: string): string =>
  `I couldn't find anyone called "${query}" in Staff.`;

export const severalPeopleReply = (query: string, people: readonly Person[]): string =>
  `More than one person matches "${query}": ${people
    .slice(0, 5)
    .map((p) => p.name)
    .join(", ")}${people.length > 5 ? ", ..." : ""}. Ask again with the full name.`;

/** The next day that is not a weekend. */
function nextWorkday(day: string): string {
  let next = addDays(day, 1);
  while (isWeekend(next)) next = addDays(next, 1);
  return next;
}

const isThem = (entry: AwayEntry, person: Person) =>
  entry.employeeId ? entry.employeeId === person.employeeId : entry.name === person.name;

/** Runs of away days for one person, with back-to-back entries (across a weekend) joined. */
function awayRuns(entries: readonly AwayEntry[]) {
  const runs: { start: string; end: string; label: string; pending: boolean }[] = [];
  for (const e of [...entries].sort((a, b) => a.start.localeCompare(b.start))) {
    const last = runs.at(-1);
    if (last && e.start <= nextWorkday(last.end)) {
      if (e.end > last.end) last.end = e.end;
    } else {
      runs.push({ start: e.start, end: e.end, label: e.label, pending: e.pending });
    }
  }
  return runs;
}

const LOOKAHEAD_DAYS = 60;

export function personBackReply(
  person: Person,
  today: string,
  staff: Omit<WhosOffInput, "from" | "to" | "includePending">,
): string {
  const to = addDays(today, LOOKAHEAD_DAYS);
  const result = whosOff({ ...staff, from: today, to, includePending: true });
  const runs = awayRuns(result.entries.filter((e) => isThem(e, person)));
  const now = runs.find((r) => r.start <= today && today <= r.end);
  const waiting = (r: { pending: boolean }) =>
    r.pending ? " (still waiting for approval)" : "";
  if (now) {
    return now.end >= to
      ? `${person.name} is off today (${now.label}) and is away for at least the next ${LOOKAHEAD_DAYS} days.`
      : `${person.name} is off today (${now.label}) and is back on ${dayLabel(nextWorkday(now.end))}${waiting(now)}.`;
  }
  const next = runs[0];
  return next
    ? `${person.name} is not off today. Next time off: ${next.label}, ${dayLabel(next.start)}${next.end > next.start ? ` to ${dayLabel(next.end)}` : ""}${waiting(next)}.`
    : `${person.name} is not off today and has no time off in the next ${LOOKAHEAD_DAYS} days.`;
}

export function shiftLabel(
  assignment: Pick<ShiftAssignment, "ref" | "text">,
  schedules: readonly ShiftSchedule[],
): string {
  if (assignment.ref === "custom") return assignment.text?.trim() || "custom hours";
  const status = STATUS_DEFS.find((d) => statusRef(d.id) === assignment.ref);
  if (status) return status.label;
  const [scheduleId, shiftId] = assignment.ref.split(":");
  const shift = schedules
    .find((s) => s.id === scheduleId)
    ?.shifts.find((s) => s.id === shiftId);
  return shift ? `${shift.label} (${shift.start} to ${shift.end} IST)` : assignment.ref;
}

export function personShiftReply(
  person: Person,
  when: string,
  today: string,
  data: {
    shifts: readonly ShiftAssignment[];
    schedules: readonly ShiftSchedule[];
  },
): string {
  const range = resolveWhen(when, today);
  if (!range || range.from !== range.to) {
    return `I can read one day for a shift, like "tomorrow" or "next Monday". I couldn't tell which day "${when}" means.`;
  }
  const found = data.shifts.find(
    (s) => person.memberIds.includes(s.memberId) && s.date === range.from,
  );
  if (person.memberIds.length === 0) {
    return `${person.name} is not on the shift roster.`;
  }
  return found
    ? `${person.name} on ${range.label}: ${shiftLabel(found, data.schedules)}${found.swap ? " (swapped)" : ""}.`
    : `${person.name} has nothing on the shift roster for ${range.label}.`;
}

// --- what changed ------------------------------------------------------------------------

/** The first day to count for "since ...": a named day, "yesterday", "last week", "3 days ago". */
export function sinceDay(phrase: string, today: string): string | null {
  const text = phrase.trim().toLowerCase();
  if (text === "" || text === "yesterday") return addDays(today, -1);
  if (text === "today" || text === "this morning") return today;
  if (/^(?:last|a) week(?: ago)?$/.test(text) || text === "last monday") {
    return addDays(today, -7);
  }
  const ago = /^(\d{1,2}) days? ago$/.exec(text);
  if (ago) return addDays(today, -Number(ago[1]));
  const range = resolveWhen(text, today);
  return range && range.from === range.to ? range.from : null;
}

export interface ChangesInput {
  since: string;
  today: string;
  timeZone: string;
  todos: readonly Pick<Todo, "title" | "status" | "createdAt" | "completedAt">[];
  timeOff: readonly Pick<
    TimeOffRequest,
    "employeeId" | "type" | "startDate" | "endDate" | "status" | "createdAt" | "decidedAt"
  >[];
  employees: readonly Employee[];
}

const MAX_LINES = 5;

export function changesReply(input: ChangesInput): string {
  const day = (iso: string) =>
    iso && !Number.isNaN(Date.parse(iso))
      ? localParts(new Date(iso), input.timeZone).day
      : "";
  const since = input.since;
  const after = (iso: string) => day(iso) >= since && day(iso) !== "";
  const name = (id: string) => {
    const e = input.employees.find((x) => x.id === id);
    return e ? displayName(e) : "Someone";
  };
  const span = (r: { startDate: string; endDate: string }) =>
    r.startDate === r.endDate
      ? dayLabel(r.startDate)
      : `${dayLabel(r.startDate)} to ${dayLabel(r.endDate)}`;

  const created = input.todos.filter((t) => after(t.createdAt));
  const closed = input.todos.filter(
    (t) => t.status === "done" && after(t.completedAt ?? ""),
  );
  const requested = input.timeOff.filter((r) => after(r.createdAt));
  const decided = input.timeOff.filter(
    (r) => r.status !== "pending" && after(r.decidedAt) && !requested.includes(r),
  );

  const block = (title: string, lines: string[]) =>
    lines.length === 0
      ? []
      : [
          `${title} (${lines.length}):`,
          ...lines.slice(0, MAX_LINES).map((l) => `• ${l}`),
          ...(lines.length > MAX_LINES ? [`+${lines.length - MAX_LINES} more`] : []),
        ];
  const parts = [
    ...block(
      "New to-dos",
      created.map((t) => t.title),
    ),
    ...block(
      "Closed to-dos",
      closed.map((t) => t.title),
    ),
    ...block(
      "New time-off requests",
      requested.map(
        (r) =>
          `${name(r.employeeId)}: ${TIME_OFF_META[r.type]?.label ?? "Time off"}, ${span(r)}`,
      ),
    ),
    ...block(
      "Time off decided",
      decided.map((r) => `${name(r.employeeId)}: ${r.status}, ${span(r)}`),
    ),
  ];
  const header = `Since ${dayLabel(since)}:`;
  return parts.length === 0
    ? `Nothing in to-dos or time off has changed since ${dayLabel(since)}.`
    : [header, ...parts].join("\n");
}

export const unknownSinceReply = (phrase: string): string =>
  `I couldn't tell which day "${phrase}" means. Try "since yesterday", "since last week" or "since Monday".`;
