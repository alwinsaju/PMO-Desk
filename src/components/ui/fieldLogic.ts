// Pure rules for FormField (see fieldLogic.test.mjs): when an error may be
// shown and which element ids describe the control.

export interface ShowErrorInput {
  error: string | null | undefined;
  /** The user has been in the field and left it. */
  touched: boolean;
  /** Set by the form after a submit attempt: show errors on untouched fields too. */
  showErrorNow?: boolean;
}

export function shouldShowError({
  error,
  touched,
  showErrorNow,
}: ShowErrorInput): boolean {
  return Boolean(error) && (touched || Boolean(showErrorNow));
}

export const hintId = (id: string) => `${id}-hint`;
export const errorId = (id: string) => `${id}-error`;

export function describedBy(
  id: string,
  { hasHint, showError }: { hasHint: boolean; showError: boolean },
): string | undefined {
  if (showError) return errorId(id);
  return hasHint ? hintId(id) : undefined;
}
