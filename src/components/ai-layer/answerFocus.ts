/**
 * Where keyboard focus goes when the command bar stops being busy. The input is disabled
 * while a question is answered, which makes the browser drop focus to the page body; without
 * this the next keystroke goes nowhere.
 *
 * - "leave": focus already sits on something real (the person clicked elsewhere): do nothing.
 * - "previous": focus was on another element of the page when they asked and it is still there.
 * - "bar": otherwise, back into the command bar input.
 */
export type FocusAfterAnswer = "leave" | "previous" | "bar";

export function focusAfterAnswer(input: {
  /** Focus is on the page body or nowhere (what a disabled input leaves behind). */
  focusLost: boolean;
  /** The element focused at submit time was the command bar (its input or a chip). */
  previousWasBar: boolean;
  /** The element focused at submit time exists, is still on the page and can take focus. */
  previousUsable: boolean;
}): FocusAfterAnswer {
  if (!input.focusLost) return "leave";
  if (!input.previousWasBar && input.previousUsable) return "previous";
  return "bar";
}
