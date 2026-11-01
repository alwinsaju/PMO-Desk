// Wording and rules for installing from the App Store, kept pure for tests.
import type { ToastInput } from "../../lib/notifications/toasts.ts";
import type { AppListing } from "./types.ts";

/** How long a card shows "Installing" before the install completes. */
export const INSTALLING_MS = 900;

type AppRef = Pick<AppListing, "id" | "name" | "url">;

/** Entries without a url are fictional samples: they have no window to open. */
export function isDemoApp(app: Pick<AppListing, "url">): boolean {
  return !app.url;
}

export function installedToast(app: AppRef, open: () => void): ToastInput {
  const demo = isDemoApp(app);
  return {
    title: `${app.name} installed`,
    message: demo ? "Added to the dock. This is a demo app." : "Added to the dock.",
    tone: "success",
    key: `app-install:${app.id}`,
    action: demo ? undefined : { label: "Open", run: open },
  };
}

/** Opening an installed demo app removes it (there is nothing to open), so say so. */
export function removedToast(app: AppRef, undo: () => void): ToastInput {
  return {
    title: `${app.name} removed`,
    message: "It was a demo app with nothing to open.",
    tone: "info",
    key: `app-install:${app.id}`,
    action: { label: "Undo", run: undo },
  };
}
