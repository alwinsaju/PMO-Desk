// Wording and rules for installing from the App Store, kept pure for tests.
import type { ToastInput } from "../../lib/notifications/toasts.ts";
import type { AppListing } from "./types.ts";

/** How long a card shows "Installing" before the install completes. */
export const INSTALLING_MS = 900;

/** The Install / Installing… / Open label shared by the card and the detail sheet. An installed demo app
 *  has nothing to open, so its button says Remove: Open never takes an app away. */
export function installLabel(
  installing: boolean,
  installed: boolean,
  demo = false,
): string {
  if (installing) return "Installing…";
  if (!installed) return "Install";
  return demo ? "Remove" : "Open";
}

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

/** Removing a demo app (its dock icon goes too); Undo puts it back. */
export function removedToast(app: AppRef, undo: () => void): ToastInput {
  return {
    title: `${app.name} removed`,
    message: "Taken off the dock. It was a demo app.",
    tone: "info",
    key: `app-install:${app.id}`,
    action: { label: "Undo", run: undo },
  };
}

/** Using an installed demo app from the dock or the App Menu: say why nothing opens (it is not removed). */
export function demoOpenToast(app: AppRef): ToastInput {
  return {
    title: `${app.name} is a demo app`,
    message:
      "It has nothing to open. To take it off the dock, use Remove in the App Store.",
    tone: "info",
    key: `app-open:${app.id}`,
  };
}
