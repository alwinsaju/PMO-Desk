// Sample data so a new person can try every app without real records. The records are
// ordinary to-dos and people, marked so they can be found and removed again:
// to-dos carry the tag "sample"; people use an @example.com address (a domain that
// can never belong to a real person). Pure builders; the page saves them through the
// same routes as everything else.
import type { Employee, TimeOffRequest } from "../staff/types.ts";

export const SAMPLE_TAG = "sample";
export const SAMPLE_DOMAIN = "example.com";

export interface SampleTodo {
  title: string;
  description: string;
  owner: string | null;
  waitingOn: string | null;
  priority: "low" | "normal" | "high";
  /** Days from today (negative = overdue). */
  dueInDays: number | null;
}

export const SAMPLE_TODOS: readonly SampleTodo[] = [
  {
    title: "Send the release plan to the steering group",
    description: "Sample to-do. Overdue, so it shows first in Today.",
    owner: null,
    waitingOn: null,
    priority: "high",
    dueInDays: -2,
  },
  {
    title: "Confirm the vendor invoice",
    description: "Sample to-do. Waiting on someone, so a chaser becomes due.",
    owner: null,
    waitingOn: "Sam Rivera",
    priority: "normal",
    dueInDays: 1,
  },
  {
    title: "Book the quarterly review room",
    description: "Sample to-do. Due today.",
    owner: null,
    waitingOn: null,
    priority: "normal",
    dueInDays: 0,
  },
  {
    title: "Draft the month-end status note",
    description: "Sample to-do. Due next week.",
    owner: null,
    waitingOn: null,
    priority: "low",
    dueInDays: 6,
  },
];

export const SAMPLE_PEOPLE: readonly {
  firstName: string;
  lastName: string;
  team: string;
  level: string;
  skills: string[];
}[] = [
  {
    firstName: "Sam",
    lastName: "Rivera",
    team: "Operations",
    level: "Manager",
    skills: ["Reporting", "Vendors"],
  },
  {
    firstName: "Ana",
    lastName: "Lopez",
    team: "Operations",
    level: "Analyst",
    skills: ["Excel", "Reporting"],
  },
  {
    firstName: "Ben",
    lastName: "Okafor",
    team: "Delivery",
    level: "Consultant",
    skills: ["Planning"],
  },
  {
    firstName: "Mia",
    lastName: "Chen",
    team: "Delivery",
    level: "Analyst",
    skills: ["Testing", "Excel"],
  },
];

const pad = (n: number) => String(n).padStart(2, "0");

/** Add days to a yyyy-mm-dd day, in UTC so daylight saving cannot move it. */
export function addDaysTo(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d! + days));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export const sampleEmail = (first: string, last: string): string =>
  `${first}.${last}@${SAMPLE_DOMAIN}`.toLowerCase();

export const isSampleTodo = (todo: { tags?: readonly string[] }): boolean =>
  (todo.tags ?? []).includes(SAMPLE_TAG);

export const isSampleEmployee = (e: Pick<Employee, "deloitteEmail">): boolean =>
  e.deloitteEmail.toLowerCase().endsWith(`@${SAMPLE_DOMAIN}`);

/** Partial employees for createEmployee(). */
export function sampleEmployeeInputs(): Partial<Employee>[] {
  return SAMPLE_PEOPLE.map((p) => ({
    firstName: p.firstName,
    lastName: p.lastName,
    deloitteEmail: sampleEmail(p.firstName, p.lastName),
    team: p.team,
    level: p.level,
    skills: [...p.skills],
  }));
}

/** One approved and one waiting time-off request for the first two people, near `today`. */
export function sampleTimeOff(
  employeeIds: readonly string[],
  today: string,
): Pick<
  TimeOffRequest,
  "employeeId" | "startDate" | "endDate" | "status" | "type" | "reason"
>[] {
  const [first, second] = employeeIds;
  const out: ReturnType<typeof sampleTimeOff> = [];
  if (second) {
    out.push({
      employeeId: second,
      type: "pto",
      startDate: addDaysTo(today, 2),
      endDate: addDaysTo(today, 4),
      status: "approved",
      reason: "Sample time off",
    });
  }
  if (first) {
    out.push({
      employeeId: first,
      type: "pto",
      startDate: addDaysTo(today, 8),
      endDate: addDaysTo(today, 9),
      status: "pending",
      reason: "Sample request waiting for approval",
    });
  }
  return out;
}
