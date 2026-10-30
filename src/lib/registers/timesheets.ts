// The timesheet chaser's logic: who is expected, who has filed, who is on leave and the one
// chaser to send. Pure. Records use the "timesheets" register definition.
import { addDays, formatDayMonth, weekDates } from "../staff/dates.ts";
import type { FieldValue } from "./types.ts";

export interface Person {
  name: string;
  email: string;
  id: string;
}

export interface LeaveSpan {
  employeeId: string;
  startDate: string;
  endDate: string;
}

/** Monday to Friday of the week starting `monday`. */
export const workDays = (monday: string): string[] => weekDates(monday).slice(0, 5);

/** True when approved leave covers every working day of the week. */
export function onLeaveAllWeek(
  employeeId: string,
  monday: string,
  leave: readonly LeaveSpan[],
): boolean {
  return workDays(monday).every((day) =>
    leave.some(
      (l) => l.employeeId === employeeId && l.startDate <= day && day <= l.endDate,
    ),
  );
}

/** The values for each person's row when a week is started: leave takes them out of the chase. */
export function seedWeek(
  monday: string,
  people: readonly Person[],
  leave: readonly LeaveSpan[],
): Record<string, FieldValue>[] {
  return people.map((p) => ({
    week: monday,
    person: p.name,
    email: p.email,
    status: onLeaveAllWeek(p.id, monday, leave) ? "On leave" : "Missing",
    chasedOn: "",
    note: "",
  }));
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export interface SubmittedMatch {
  matched: string[];
  /** Lines that matched nobody, so the person can fix a name. */
  unmatched: string[];
}

/** Which people a pasted list names: by full name (first last or last, first) or by email. */
export function matchSubmitted(
  text: string,
  people: readonly { name: string; email: string }[],
): SubmittedMatch {
  const matched = new Set<string>();
  const unmatched: string[] = [];
  for (const raw of text.split(/\r?\n|;/)) {
    const line = norm(raw);
    if (!line) continue;
    const hit = people.find((p) => {
      const name = norm(p.name);
      const [first = "", ...rest] = name.split(" ");
      const flipped = rest.length ? `${rest.join(" ")}, ${first}` : name;
      return (
        line.includes(name) ||
        line.includes(flipped) ||
        (p.email !== "" && line.includes(p.email.toLowerCase()))
      );
    });
    if (hit) matched.add(hit.name);
    else unmatched.push(raw.trim());
  }
  return { matched: [...matched], unmatched };
}

export interface Chaser {
  subject: string;
  body: string;
  /** Semicolon-separated, ready to paste into To. */
  to: string;
  names: string[];
  withoutEmail: string[];
}

export function timesheetChaser(
  monday: string,
  missing: readonly { person: string; email: string }[],
  me: string,
): Chaser {
  const names = missing.map((m) => m.person);
  const first = (n: string) => n.split(" ")[0] ?? n;
  const body = [
    `Hi ${names.length === 1 ? first(names[0]!) : "all"},`,
    "",
    `Our records show no timesheet yet for the week of ${formatDayMonth(monday)} to ${formatDayMonth(addDays(monday, 4))}.`,
    "Could you please file it today, or let me know if it is not needed (for example, you were on leave)?",
    "",
    "Thanks,",
    me || "",
  ].join("\n");
  return {
    subject: `Timesheet reminder: week of ${formatDayMonth(monday)}`,
    body: body.trimEnd(),
    to: missing
      .map((m) => m.email)
      .filter(Boolean)
      .join("; "),
    names,
    withoutEmail: missing.filter((m) => !m.email).map((m) => m.person),
  };
}
