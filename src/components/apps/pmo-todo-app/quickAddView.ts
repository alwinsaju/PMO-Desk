// The words around quick-add (pure; see quickAddView.test.mjs).
import type { QuickAdd } from "../../../lib/pmo/quickAdd.ts";
import { formatDay } from "./queueView.ts";

/** The note after a due date that a holiday moved: the live "Due ..." line, the command bar
 *  and the quick-add toast all say it the same way. */
export const SKIPPED_HOLIDAY_NOTE = "(skipped a holiday)";

/** The toast after a quick-add: `Added "Send deck", due Mon 9 Nov (skipped a holiday).` */
export function quickAddToast(parsed: QuickAdd, today: string): string {
  if (!parsed.dueAt) return `Added "${parsed.title}".`;
  const moved = parsed.movedFrom ? ` ${SKIPPED_HOLIDAY_NOTE}` : "";
  return `Added "${parsed.title}", due ${formatDay(parsed.dueAt, today)}${moved}.`;
}
