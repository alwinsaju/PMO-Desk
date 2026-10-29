// What the AI widget tells the person about leave: the pending requests the local AI filed
// from PTO emails, and whether it is still reading some. Pure (the route feeds it the
// stored lists), so `pnpm test` covers it without a server.
import { displayName } from "./employees.ts";
import type { Employee, TimeOffRequest, TimeOffType } from "./types.ts";

export interface PtoAlertItem {
  id: string;
  name: string;
  type: TimeOffType;
  startDate: string;
  endDate: string;
}

export interface PtoAlert {
  /** Pending requests that came from a PTO email, oldest first. */
  pending: PtoAlertItem[];
  /** The model is reading an email right now. */
  reading: boolean;
  /** Emails still in the inbox folder, not read yet. */
  waiting: number;
}

const MAX_LISTED = 20;

export function buildPtoAlert(input: {
  timeOff: readonly TimeOffRequest[];
  employees: readonly Pick<Employee, "id" | "firstName" | "lastName" | "deloitteEmail">[];
  reading: boolean;
  waiting: number;
}): PtoAlert {
  const people = new Map(input.employees.map((e) => [e.id, e]));
  const pending = input.timeOff
    .filter((r) => r.status === "pending" && r.source === "email")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(0, MAX_LISTED)
    .map((r) => {
      const person = people.get(r.employeeId);
      return {
        id: r.id,
        name: person ? displayName(person) : "Someone",
        type: r.type,
        startDate: r.startDate,
        endDate: r.endDate,
      };
    });
  return { pending, reading: input.reading, waiting: input.waiting };
}
