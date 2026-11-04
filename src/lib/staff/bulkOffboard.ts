// Removing several people from the roster at once (bulk "Remove from roster"). It is only ever
// an offboard, which Undo reverses; deleting people for good is never offered in bulk. Pure.
import type { Checklist } from "./checklists.ts";
import { progressOf } from "./checklists.ts";
import { displayName } from "./employees.ts";
import type { Employee } from "./types.ts";

/** At most this many names are listed in the confirmation; the rest are counted. */
export const LISTED_NAMES = 8;

/** The confirmation's description. Says what offboarding does and that Undo follows. */
export function offboardConfirmText(): string {
  return `They will move to the Offboarded tab, where you can still edit their profile, restore them or delete them for good. Their time-off requests are deleted, and their entry on the shift roster is kept with its shifts but no longer linked to their profile. Other apps will no longer see them. Undo in the message that follows puts it all back.`;
}

/** The names to list in the confirmation, and how many more there are. */
export function nameList(
  people: readonly Pick<Employee, "firstName" | "lastName" | "deloitteEmail">[],
): { names: string[]; more: number } {
  const names = people.slice(0, LISTED_NAMES).map((p) => displayName(p));
  return { names, more: Math.max(0, people.length - names.length) };
}

/** The dialog title. */
export function offboardTitle(count: number): string {
  return count === 1
    ? "Remove 1 person from the roster?"
    : `Remove ${count} people from the roster?`;
}

/** The toast after a bulk remove. */
export function removedMessage(count: number): string {
  return count === 1
    ? "1 person is on the Offboarded tab."
    : `${count} people are on the Offboarded tab.`;
}

/** The toast after a bulk Undo. */
export function restoredMessage(count: number): string {
  return count === 1
    ? "1 person is back on the roster."
    : `${count} people are back on the roster.`;
}

/** Offboarding starts a checklist for each person; undoing drops the ones nothing was ticked on. */
export function dropUntouchedOffboarding(
  checklists: readonly Checklist[],
  ids: readonly string[],
): Checklist[] {
  const gone = new Set(ids);
  return checklists.filter(
    (c) =>
      !(gone.has(c.employeeId) && c.kind === "offboarding" && progressOf(c).done === 0),
  );
}
