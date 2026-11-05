/** For a dialog's onOpenAutoFocus: put focus on the dialog itself instead of its first button, so pressing
 *  Enter right after it opens cannot start a run by accident. Tab then moves into the dialog as usual. */
export function focusDialogItself(event: Event): void {
  event.preventDefault();
  const target = event.currentTarget;
  if (target instanceof HTMLElement) target.focus();
}
