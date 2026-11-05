// Pure logic for the Toolkit tiles' plus button: which tools can be added to straight from
// their tile, and what the button is called. See toolkitQuickAdd.test.mjs.
import { registerById } from "../../../lib/registers/defs.ts";

/** Tools that are not register lists: they have their own screen and no Add dialog to open. */
export const NO_QUICK_ADD: readonly string[] = ["timesheets"];

/** True when the tool is a register list (so it has an Add dialog) and so gets a plus button.
 *  `registerIds` are the ids of the register-backed tools. */
export function supportsQuickAdd(id: string, registerIds: readonly string[]): boolean {
  return registerIds.includes(id) && !NO_QUICK_ADD.includes(id);
}

/** Acronyms said letter by letter, so the article follows the first letter's name ("an SLA", not "a SLA"). Words like RAID, said as a word, are not listed. */
const SPELLED_OUT: readonly string[] = ["SLA"];

/** "a" or "an" for the noun phrase, by how it is said: "an invoice", "an SLA", "a change request", "a RAID item". */
export function articleFor(phrase: string): "a" | "an" {
  const first = phrase.trim().split(/\s+/)[0] ?? "";
  if (SPELLED_OUT.includes(first)) return /^[AEFHILMNORSX]/.test(first) ? "an" : "a";
  return /^[aeiou]/i.test(first) ? "an" : "a";
}

/**
 * The accessible name of a tile's plus button: "Add a change request". It uses the register's
 * own wording for one record (`quickAddNoun`, else `noun`, the same word the Add dialog uses), not
 * the tool's name. `toolTitle` is only a fallback for an id that is not a register.
 */
export function quickAddLabel(toolId: string, toolTitle: string = toolId): string {
  const def = registerById(toolId);
  const noun = def ? (def.quickAddNoun ?? def.noun) : toolTitle;
  return `Add ${articleFor(noun)} ${noun}`;
}
