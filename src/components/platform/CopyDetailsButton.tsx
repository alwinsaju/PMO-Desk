"use client";

import { useState } from "react";
import { toast } from "@/lib/notifications/toastStore";
import { detailsText, type FriendlyError } from "@/lib/platform/friendlyError";
import { appVersionKnown } from "@/lib/platform/reportError";

/** "Copy details": puts the version, time, place and cleaned technical text on the clipboard for support. */
export function CopyDetailsButton({
  message,
  detail,
  where,
}: {
  message: string;
  detail: string;
  where?: string;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const error: FriendlyError = { kind: "unknown", message, detail };
    try {
      await navigator.clipboard.writeText(
        detailsText(error, { appVersion: appVersionKnown(), where }),
      );
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      toast({ tone: "danger", message: "Could not copy to the clipboard." });
    }
  };
  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="text-ink-soft hover:text-ink ml-2 text-[12px] font-semibold underline underline-offset-2"
    >
      {copied ? "Copied" : "Copy details"}
    </button>
  );
}
