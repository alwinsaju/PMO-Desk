// Leave as the Time off cards and the shift roster draw it: who else is out on the
// same days, and which days carry a request that still waits for a decision. Pure.
import { displayName } from "./employees.ts";
import type { Employee, TimeOffRequest, TimeOffStatus } from "./types.ts";

export interface LeavePeer {
  requestId: string;
  employeeId: string;
  name: string;
  status: Exclude<TimeOffStatus, "rejected">;
  /** The days this person is out that fall inside the request being looked at. */
  start: string;
  end: string;
}

/**
 * The other people whose approved or pending leave overlaps `request`, clipped to
 * its dates, soonest first. Rejected leave and people no longer on the roster are left out.
 */
export function overlappingLeave(
  request: Pick<TimeOffRequest, "id" | "employeeId" | "startDate" | "endDate">,
  all: readonly TimeOffRequest[],
  employees: ReadonlyMap<
    string,
    Pick<Employee, "firstName" | "lastName" | "deloitteEmail">
  >,
): LeavePeer[] {
  const peers: LeavePeer[] = [];
  for (const other of all) {
    if (other.id === request.id || other.employeeId === request.employeeId) continue;
    if (other.status === "rejected") continue;
    if (other.startDate > request.endDate || request.startDate > other.endDate) continue;
    const person = employees.get(other.employeeId);
    if (!person) continue;
    peers.push({
      requestId: other.id,
      employeeId: other.employeeId,
      name: displayName(person),
      status: other.status,
      start: other.startDate > request.startDate ? other.startDate : request.startDate,
      end: other.endDate < request.endDate ? other.endDate : request.endDate,
    });
  }
  return peers.sort(
    (a, b) => a.start.localeCompare(b.start) || a.name.localeCompare(b.name),
  );
}

/** The leave waiting for approval that covers this person on this day, if any. */
export function pendingLeaveOn(
  requests: readonly TimeOffRequest[],
  employeeId: string,
  date: string,
): TimeOffRequest | undefined {
  return requests.find(
    (r) =>
      r.employeeId === employeeId &&
      r.status === "pending" &&
      r.startDate <= date &&
      date <= r.endDate,
  );
}
