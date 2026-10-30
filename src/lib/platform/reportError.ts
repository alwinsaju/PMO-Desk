"use client";

// Showing an error the plain way from anywhere in the app: one calm sentence, with a
// "Copy details" action that puts the cleaned technical text on the clipboard.
import { toast } from "@/lib/notifications/toastStore";
import { detailsText, explainError } from "./friendlyError";

let knownVersion = "unknown version";

/** PlatformBackground tells us the version once it has read it. */
export const setAppVersionKnown = (version: string): void => {
  knownVersion = version;
};
export const appVersionKnown = (): string => knownVersion;

/** Show a failure as a toast in plain words, with "Copy details" for support. Returns the plain message. */
export function reportError(
  input: unknown,
  options: { status?: number; where?: string } = {},
): string {
  const error = explainError(input, { status: options.status });
  toast({
    tone: "danger",
    message: error.message,
    action: {
      label: "Copy details",
      run: () => {
        void navigator.clipboard
          .writeText(
            detailsText(error, { appVersion: knownVersion, where: options.where }),
          )
          .then(
            () => toast({ tone: "success", message: "Details copied." }),
            () => toast({ tone: "danger", message: "Could not copy to the clipboard." }),
          );
      },
    },
  });
  return error.message;
}
