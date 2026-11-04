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

/** Fills the "Toolkit timesheet chaser" template (the assigned one) with the values made by code, or
 *  returns the built-in wording when no template is set. The Templates app's `useTemplateText(...).fill`
 *  has exactly this shape. */
export type FillText = (
  values: Record<string, string>,
  fallback: { subject: string; body: string },
) => { subject: string; body: string };

/** The pieces the timesheet chaser template can use, by the names in targets.ts. */
export function chaserValues(
  monday: string,
  names: readonly string[],
  me: string,
): Record<string, string> {
  const first = (n: string) => n.split(" ")[0] ?? n;
  return {
    greeting: `Hi ${names.length === 1 ? first(names[0]!) : "all"},`,
    week_start: formatDayMonth(monday),
    week_end: formatDayMonth(addDays(monday, 4)),
    people: names.join(", "),
    count: String(names.length),
    my_name: me || "",
  };
}

/** The chaser for the people given. With `fill` (an assigned template), its wording is used; without
 *  one, or when the template renders empty, the built-in wording below. Text only; nothing is sent. */
export function timesheetChaser(
  monday: string,
  missing: readonly { person: string; email: string }[],
  me: string,
  fill?: FillText,
): Chaser {
  const names = missing.map((m) => m.person);
  const values = chaserValues(monday, names, me);
  const builtIn = {
    subject: `Timesheet reminder: week of ${values.week_start}`,
    body: [
      values.greeting,
      "",
      `Our records show no timesheet yet for the week of ${values.week_start} to ${values.week_end}.`,
      "Could you please file it today, or let me know if it is not needed (for example, you were on leave)?",
      "",
      "Thanks,",
      values.my_name,
    ]
      .join("\n")
      .trimEnd(),
  };
  const text = fill ? fill(values, builtIn) : builtIn;
  return {
    subject: text.subject,
    body: text.body,
    to: missing
      .map((m) => m.email)
      .filter(Boolean)
      .join("; "),
    names,
    withoutEmail: missing.filter((m) => !m.email).map((m) => m.person),
  };
}

export interface PersonChaser {
  person: string;
  /** Empty when there is no email on file. */
  email: string;
  subject: string;
  body: string;
}

/** One chaser per person who is missing a timesheet: the same wording, addressed to them alone
 *  (a person is listed once, in the order given). Text only; nothing here sends it. */
export function personChasers(
  monday: string,
  missing: readonly { person: string; email: string }[],
  me: string,
  fill?: FillText,
): PersonChaser[] {
  const seen = new Set<string>();
  const out: PersonChaser[] = [];
  for (const m of missing) {
    const key = m.person.toLowerCase().trim();
    if (seen.has(key)) continue;
    seen.add(key);
    const one = timesheetChaser(monday, [m], me, fill);
    out.push({
      person: m.person,
      email: m.email.trim(),
      subject: one.subject,
      body: one.body,
    });
  }
  return out;
}
