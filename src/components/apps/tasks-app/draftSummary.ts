/**
 * Turns the engine's draft-summary reply into the lines the Confirm & send
 * dialog shows (QA SEC-8). Pure: no React, no network.
 */
import type { DraftSummary, DraftSummaryPayload, Reply } from "./types";

export const RECIPIENTS_UNREADABLE =
  "Recipients could not be read - check the draft in Outlook before sending.";
export const RECIPIENTS_LOADING = "Reading the draft's recipients…";

const MAX_ITEMS = 50;
const MAX_TEXT = 300;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, MAX_TEXT) : "";
}

function list(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(text).filter(Boolean).slice(0, MAX_ITEMS);
}

/** The summary from a reply, or null when it failed, is empty or has no recipients. */
export function parseDraftSummary(
  reply: Reply<DraftSummaryPayload> | null | undefined,
): DraftSummary | null {
  const raw: unknown = reply && reply.ok === true ? reply.summary : null;
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  const to = list(source.to);
  const cc = list(source.cc);
  if (to.length === 0 && cc.length === 0) return null;
  return { to, cc, subject: text(source.subject), attachments: list(source.attachments) };
}

/** Dialog lines: To / Cc / Subject / Attachments, or the single "check Outlook" warning. */
export function draftSummaryLines(summary: DraftSummary | null): string[] {
  if (!summary) return [RECIPIENTS_UNREADABLE];
  const lines = [`To: ${summary.to.join("; ") || "(none)"}`];
  if (summary.cc.length > 0) lines.push(`Cc: ${summary.cc.join("; ")}`);
  lines.push(`Subject: ${summary.subject || "(none)"}`);
  if (summary.attachments.length > 0) {
    lines.push(`Attachments: ${summary.attachments.join(", ")}`);
  }
  return lines;
}
