// Tells the dock badge that a to-do changed, so it refreshes at once instead of at the next
// 60 s reminder poll. api.ts (the one client for /api/pmo) fires it after a successful write;
// usePmoReminders listens. A plain window event: the app has no other cross-store channel
// for this and both ends live in the same page.

export const PMO_CHANGED_EVENT = "pmo-todo-changed";

/** Whether a finished request changed to-do data. The reminder routes (claim, acknowledge)
 *  write too, but only bookkeeping, and refreshing on them would loop. */
export function changesTodos(method: string, path: string, ok: boolean): boolean {
  return ok && method !== "GET" && !path.startsWith("/due");
}

export function announcePmoChanged(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(PMO_CHANGED_EVENT));
}
