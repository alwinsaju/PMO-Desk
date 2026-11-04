// Pure logic for the Toolkit tiles' plus button: which tools can be added to straight from
// their tile, and what the button is called. See toolkitQuickAdd.test.mjs.

/** Tools that are not register lists: they have their own screen and no Add dialog to open. */
export const NO_QUICK_ADD: readonly string[] = ["timesheets"];

/** True when the tool is a register list (so it has an Add dialog) and so gets a plus button.
 *  `registerIds` are the ids of the register-backed tools. */
export function supportsQuickAdd(id: string, registerIds: readonly string[]): boolean {
  return registerIds.includes(id) && !NO_QUICK_ADD.includes(id);
}

/** The accessible name of a tile's plus button. */
export function quickAddLabel(toolTitle: string): string {
  return `Add a ${toolTitle}`;
}
