// What the Browser app tells the user when a page cannot be shown, and what the
// address bar's lock icon means. Pure so the wording is unit-tested.

import type { EmbedFailureCode } from "../../../lib/browser/embeddableCheck.ts";

export type { EmbedFailureCode };

export interface EmbedFailureInput {
  host: string;
  code?: EmbedFailureCode;
  /** The check's own explanation, shown when the code is not specific. */
  reason?: string;
  /** `navigator.onLine`; false means the device itself has no connection. */
  online?: boolean;
}

export interface EmbedFailureText {
  title: string;
  /** One paragraph (cause and next step together), for the plain blocked card. */
  message: string;
  /** For the shared ErrorState: what probably went wrong, and what to do. */
  cause: string;
  nextStep: string;
  /** False when trying again would only be refused again. */
  retryable: boolean;
}

export function describeEmbedFailure({
  host,
  code,
  reason,
  online,
}: EmbedFailureInput): EmbedFailureText {
  if (online === false && (code === "unreachable" || code === "not-found")) {
    return {
      title: "You appear to be offline",
      message: `Can't load ${host} without an internet connection. Reconnect, then press Reload.`,
      cause: "This computer has no internet connection.",
      nextStep: "Reconnect, then retry.",
      retryable: true,
    };
  }
  switch (code) {
    case "framing":
      return {
        title: `${host} doesn't allow being shown inside AI OS`,
        message:
          "The site's own security settings stop other apps from displaying it. Nothing is wrong on your side. Open it in your regular browser instead.",
        cause:
          "The site's own security settings stop other apps from displaying it. Nothing is wrong on your side.",
        nextStep: "Open it in your default browser.",
        retryable: false,
      };
    case "unreachable":
      return {
        title: `Can't reach ${host}`,
        message:
          "The site did not answer. Check your internet connection, then press Reload.",
        cause: "The site did not answer.",
        nextStep: "Check your internet connection, then retry.",
        retryable: true,
      };
    case "not-found":
      return {
        title: `Can't find ${host}`,
        message: "That address does not exist. Check the spelling and try again.",
        cause: "That address does not exist.",
        nextStep: "Check the spelling in the address bar, then retry.",
        retryable: true,
      };
    default: {
      const message = reason ?? "This page could not be shown inside AI OS.";
      return {
        title: `Can't show ${host} here`,
        message,
        cause: message,
        nextStep: "Retry, or open it in your default browser.",
        retryable: true,
      };
    }
  }
}

/** Chromium's net error text (from a webview's did-fail-load) as a failure code. */
export function classifyWebviewError(
  description: string | undefined,
): EmbedFailureCode | undefined {
  if (!description) return undefined;
  if (/ERR_NAME_NOT_RESOLVED/i.test(description)) return "not-found";
  if (/ERR_BLOCKED_BY_RESPONSE/i.test(description)) return "framing";
  if (
    /ERR_(INTERNET_DISCONNECTED|NETWORK_CHANGED|CONNECTION_|TIMED_OUT|ADDRESS_UNREACHABLE)/i.test(
      description,
    )
  ) {
    return "unreachable";
  }
  return undefined;
}

export type AddressSecurity = "secure" | "insecure" | "internal";

/** The host part of a url for display, or the input when it does not parse. */
export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

/** Padlock only for https; `pathfinder://` pages are the app's own, not a secure site. */
export function addressSecurity(url: string): AddressSecurity {
  if (/^https:\/\//i.test(url)) return "secure";
  if (/^http:\/\//i.test(url)) return "insecure";
  return "internal";
}
