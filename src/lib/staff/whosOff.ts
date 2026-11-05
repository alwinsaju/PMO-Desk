// Who is away, from the two places the Staff app records it: approved time off
// and the days the shift roster marks as leave. Pure (no node imports), so the
// Dashboard, the command bar and the tests all answer the same way.
import { addDays, daysBetween, isIsoDate, isWeekend } from "./dates.ts";
import { displayName } from "./employees.ts";
import { STATUS_DEFS, statusRef } from "./rosterCatalog.ts";
import { TIME_OFF_META } from "./timeoff.ts";
import type {
  Employee,
  RosterEvent,
  RosterMember,
  ShiftAssignment,
  TimeOffRequest,
} from "./types.ts";

/** Roster day types that mean the person is away (not a holiday, a weekly off or on-call). */
const LEAVE_STATUS_IDS = ["pto", "temp-pto", "comp", "sick"] as const;
const LEAVE_REFS: ReadonlyMap<string, string> = new Map(
  LEAVE_STATUS_IDS.map((id) => [
    statusRef(id),
    STATUS_DEFS.find((def) => def.id === id)?.label ?? id,
  ]),
);

export interface AwayEntry {
  /** Stable per person and period, for React keys. */
  key: string;
  name: string;
  employeeId: string | null;
  /** "PTO", "Sick leave", "Comp off", ... */
  label: string;
  /** The first and last away day inside the range asked for (inclusive). */
  start: string;
  end: string;
  source: "time-off" | "roster";
  /** A request that is waiting for approval (only when asked for). */
  pending: boolean;
}

export interface WhosOff {
  from: string;
  to: string;
  /** Soonest first, then by name. */
  entries: AwayEntry[];
  /** Holidays in the range (everyone, or the locations they list). */
  holidays: RosterEvent[];
}

export interface WhosOffInput {
  /** Inclusive yyyy-mm-dd. */
  from: string;
  to: string;
  employees: readonly Employee[];
  timeOff: readonly TimeOffRequest[];
  shifts: readonly ShiftAssignment[];
  members: readonly Pick<RosterMember, "id" | "name" | "employeeId">[];
  events?: readonly RosterEvent[];
  /** Also list requests still waiting for approval (marked `pending`). */
  includePending?: boolean;
}

const MAX_RANGE_DAYS = 62;

/** Is there only weekend between `earlier` and `later` (the next day, or the Monday after a Friday)? */
function continues(earlier: string, later: string): boolean {
  for (let day = addDays(earlier, 1); day < later; day = addDays(day, 1)) {
    if (!isWeekend(day)) return false;
  }
  return daysBetween(earlier, later) > 0;
}

/** True when every day from `start` to `end` is a Saturday or Sunday. */
function isWeekendOnly(start: string, end: string): boolean {
  if (!isIsoDate(start) || !isIsoDate(end) || end < start) return false;
  for (let day = start; day <= end; day = addDays(day, 1)) {
    if (!isWeekend(day)) return false;
  }
  return true;
}

export function whosOff(input: WhosOffInput): WhosOff {
  const { from, to } = input;
  if (
    !isIsoDate(from) ||
    !isIsoDate(to) ||
    to < from ||
    daysBetween(from, to) > MAX_RANGE_DAYS
  ) {
    return { from, to, entries: [], holidays: [] };
  }
  const people = new Map(input.employees.map((e) => [e.id, e]));
  const entries: AwayEntry[] = [];

  // Approved time off (and, if asked, pending), clipped to the range.
  const covered = new Map<string, Set<string>>();
  for (const request of input.timeOff) {
    const wanted =
      request.status === "approved" ||
      (input.includePending && request.status === "pending");
    const person = people.get(request.employeeId);
    if (!wanted || !person || request.endDate < from || request.startDate > to) continue;
    // A request that only covers a weekend takes no working day off: it is not "off".
    if (isWeekendOnly(request.startDate, request.endDate)) continue;
    const start = request.startDate < from ? from : request.startDate;
    const end = request.endDate > to ? to : request.endDate;
    const days = covered.get(person.id) ?? new Set<string>();
    for (let day = start; day <= end; day = addDays(day, 1)) days.add(day);
    covered.set(person.id, days);
    entries.push({
      key: `time-off:${request.id}`,
      name: displayName(person),
      employeeId: person.id,
      label: TIME_OFF_META[request.type]?.label ?? "Time off",
      start,
      end,
      source: "time-off",
      pending: request.status === "pending",
    });
  }

  // Leave days marked on the shift roster, joined into runs, skipping a day the
  // person's time off already covers.
  const members = new Map(input.members.map((m) => [m.id, m]));
  const byRun = new Map<string, string[]>();
  for (const a of input.shifts) {
    const label = LEAVE_REFS.get(a.ref);
    const member = members.get(a.memberId);
    if (!label || !member || a.date < from || a.date > to) continue;
    if (member.employeeId && covered.get(member.employeeId)?.has(a.date)) continue;
    const key = `${a.memberId}|${label}`;
    byRun.set(key, [...(byRun.get(key) ?? []), a.date]);
  }
  for (const [key, dates] of byRun) {
    const [memberId, label] = key.split("|");
    const member = members.get(memberId)!;
    const person = member.employeeId ? people.get(member.employeeId) : undefined;
    const name = person ? displayName(person) : member.name;
    const push = (start: string, end: string) =>
      entries.push({
        key: `roster:${memberId}:${label}:${start}`,
        name,
        employeeId: person?.id ?? null,
        label,
        start,
        end,
        source: "roster",
        pending: false,
      });
    const [first, ...rest] = [...new Set(dates)].sort();
    let runStart = first;
    let previous = first;
    for (const day of rest) {
      if (!continues(previous, day)) {
        push(runStart, previous);
        runStart = day;
      }
      previous = day;
    }
    push(runStart, previous);
  }

  entries.sort(
    (a, b) =>
      a.start.localeCompare(b.start) ||
      a.name.localeCompare(b.name) ||
      a.key.localeCompare(b.key),
  );
  const holidays = (input.events ?? [])
    .filter(
      (event) => event.kind === "holiday" && event.endDate >= from && event.date <= to,
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label));
  return { from, to, entries, holidays };
}

/** The distinct people away at any point in the range. */
export function peopleAway(result: Pick<WhosOff, "entries">): string[] {
  return [...new Set(result.entries.map((entry) => entry.name))];
}
