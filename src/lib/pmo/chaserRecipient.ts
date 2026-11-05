// The To address of a chaser when the person being waited on is in the Staff
// directory. Pure: the dialog passes the directory in.
import { addressForWaitingOn } from "./thread.ts";

interface Person {
  firstName: string;
  lastName: string;
  deloitteEmail: string;
}

/** The work email of the one staff member `waitingOn` names, else null (nobody found, or
 *  more than one person fits). Your own addresses are never offered. */
export function staffAddressForWaitingOn(
  waitingOn: string | null | undefined,
  staff: readonly Person[],
  mine: readonly string[] = [],
): string | null {
  return addressForWaitingOn(
    waitingOn,
    staff.map((p) => ({
      name: `${p.firstName} ${p.lastName}`.trim(),
      address: p.deloitteEmail,
    })),
    mine,
  );
}
