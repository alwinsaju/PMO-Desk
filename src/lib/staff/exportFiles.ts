/** Spreadsheet-friendly (CSV) and calendar (ICS) exports of the roster and time off. Pure. */
import { addDays, inclusiveDays } from "./dates.ts";
import { holidayAt, locationOf } from "./holidays.ts";
import { TIME_OFF_META } from "./timeoff.ts";
import { assignmentId, indexAssignments, leaveOn, resolveAssignment } from "./shifts.ts";
import type { Employee, RosterConfig, ShiftAssignment, TimeOffRequest } from "./types.ts";

const quote = (cell: string): string =>
  /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;

/** A CSV that Excel opens directly (with a BOM so accents survive). */
export function toCsv(rows: readonly (readonly string[])[]): string {
  return "\uFEFF" + rows.map((r) => r.map(quote).join(",")).join("\r\n") + "\r\n";
}

const nameOf = (
  e: Pick<Employee, "firstName" | "lastName"> | undefined,
  fallback: string,
) => (e ? `${e.firstName} ${e.lastName}`.trim() || fallback : fallback);

/** One row per roster member and one column per day: the shift (with hours), approved leave or a holiday. */
export function rosterRows(input: {
  from: string;
  days: number;
  config: RosterConfig;
  employees: readonly Employee[];
  assignments: readonly ShiftAssignment[];
  timeOff: readonly TimeOffRequest[];
}): string[][] {
  const { from, days, config } = input;
  const index = indexAssignments(input.assignments);
  const dates = Array.from({ length: Math.min(days, 92) }, (_, i) => addDays(from, i));
  const rows: string[][] = [["Team", "Name", ...dates]];
  const groups = config.groups.filter((g) => !g.hidden);
  for (const group of groups) {
    for (const member of config.members.filter((m) => m.groupId === group.id)) {
      const employee = input.employees.find((e) => e.id === member.employeeId);
      const where = locationOf(member, employee ?? null);
      const cells = dates.map((day) => {
        const a = index.get(assignmentId(member.id, day));
        if (a) {
          const view = resolveAssignment(a, config.schedules);
          const away =
            employee && view.working
              ? leaveOn(input.timeOff, employee.id, day)
              : undefined;
          if (away) return TIME_OFF_META[away.type].label;
          return view.hours ? `${view.label} ${view.hours}` : view.label;
        }
        const leave = employee ? leaveOn(input.timeOff, employee.id, day) : undefined;
        if (leave) return TIME_OFF_META[leave.type].label;
        const holiday = holidayAt(
          config.events.filter((e) => e.date <= day && day <= e.endDate),
          where,
        );
        return holiday ? holiday.label : "";
      });
      rows.push([group.name, nameOf(employee, member.name), ...cells]);
    }
  }
  return rows;
}

export function timeOffRows(
  requests: readonly TimeOffRequest[],
  employees: readonly Employee[],
): string[][] {
  const rows: string[][] = [["Name", "Type", "From", "To", "Days", "Status", "Reason"]];
  for (const r of [...requests].sort((a, b) => a.startDate.localeCompare(b.startDate))) {
    const e = employees.find((x) => x.id === r.employeeId);
    rows.push([
      nameOf(e, "Unknown"),
      TIME_OFF_META[r.type].label,
      r.startDate,
      r.endDate,
      String(inclusiveDays(r.startDate, r.endDate)),
      r.status,
      r.reason,
    ]);
  }
  return rows;
}

export interface IcsEvent {
  uid: string;
  /** First day, yyyy-mm-dd. */
  date: string;
  /** Last day, inclusive. */
  endDate: string;
  summary: string;
  description?: string;
}

const icsText = (s: string) =>
  s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
const compact = (iso: string) => iso.replace(/-/g, "");

/** An all-day calendar file (DTEND is the day after the last day, as the format requires). */
export function buildIcs(
  name: string,
  events: readonly IcsEvent[],
  stamp: string,
): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//AI OS//Staff//EN",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${icsText(name)}`,
  ];
  for (const e of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}@ai-os`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compact(e.date)}`,
      `DTEND;VALUE=DATE:${compact(addDays(e.endDate, 1))}`,
      `SUMMARY:${icsText(e.summary)}`,
    );
    if (e.description) lines.push(`DESCRIPTION:${icsText(e.description)}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

export function timeOffIcs(
  requests: readonly TimeOffRequest[],
  employees: readonly Employee[],
  stamp: string,
): string {
  const events = requests
    .filter((r) => r.status === "approved")
    .map((r) => {
      const e = employees.find((x) => x.id === r.employeeId);
      return {
        uid: r.id,
        date: r.startDate,
        endDate: r.endDate,
        summary: `${nameOf(e, "Unknown")}: ${TIME_OFF_META[r.type].label}`,
        description: r.reason,
      };
    });
  return buildIcs("Time off", events, stamp);
}
