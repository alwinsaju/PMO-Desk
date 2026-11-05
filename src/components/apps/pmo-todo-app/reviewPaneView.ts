// What the two-pane Review Queue needs to decide: which layout fits the window,
// what a row says, and which row is selected after one is approved or rejected.
// Pure, so it is tested under plain Node (reviewPaneView.test.mjs).
import type { Proposal } from "../../../lib/pmo/types.ts";
import { partLabel, relativeTime, structuringFellBack } from "./queueView.ts";

/** Wider than this the queue is a list beside the review pane; at or below it the
 *  review opens in a dialog, as before. */
export const REVIEW_PANE_MIN_WIDTH = 900;

export type ReviewLayout = "pane" | "dialog";

/** `width` is the window's width in px (0 while it is not measured yet). */
export function reviewLayout(width: number): ReviewLayout {
  return width > REVIEW_PANE_MIN_WIDTH ? "pane" : "dialog";
}

const SUMMARY_MAX = 140;

/** The first line of `text`, whitespace collapsed and cut at a word. */
export function oneLine(text: string | null | undefined, max = SUMMARY_MAX): string {
  const line = (text ?? "").replace(/\s+/g, " ").trim();
  if (line.length <= max) return line;
  const cut = line.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export interface ReviewRowView {
  title: string;
  /** One line about what the message asks for. */
  summary: string;
  sender: string;
  /** "5 min ago". */
  when: string;
  /** "Task 2 of 3" or null. */
  part: string | null;
  /** The AI's draft was unusable and the app's own title was put in. */
  fellBack: boolean;
  checkOriginal: boolean;
  replyBelowQuote: boolean;
  /** The model read the start and the end of a very long message only. */
  longMessage: boolean;
  duplicate: boolean;
  /** Show the status badge: only for a row that is not simply "ready". */
  showStatus: boolean;
}

export function reviewRowView(proposal: Proposal, nowMs: number): ReviewRowView {
  const { summary, draft } = proposal;
  const ready = proposal.status === "ready";
  const described = ready ? oneLine(draft?.description) : "";
  const fallbackSummary =
    proposal.status === "failed"
      ? "The model could not structure this message."
      : proposal.status === "ready"
        ? ""
        : "Waiting for the model to read this message.";
  return {
    title: summary.subject.trim() || draft?.title || "(no subject)",
    summary: described || fallbackSummary,
    sender: summary.senderName ?? summary.senderAddress ?? "Unknown sender",
    when: relativeTime(summary.receivedAt, nowMs),
    part: partLabel(proposal),
    fellBack: structuringFellBack(proposal) && proposal.isActionable !== false,
    checkOriginal: ready && proposal.quoteVerified === false,
    replyBelowQuote: ready && !!proposal.replyBelowQuote,
    longMessage: ready && !!proposal.modelReadPartOnly,
    duplicate: !!proposal.possibleDuplicateOf,
    showStatus: !(ready && proposal.isActionable !== false),
  };
}

/** The row that is selected. Nothing chosen yet gives the first row; when the
 *  chosen row has gone (approved, rejected, filtered), the row that took its
 *  place at `lastIndex` is next, or the last one. */
export function resolveSelection(
  order: readonly string[],
  selectedId: string | null,
  lastIndex: number,
): string | null {
  if (order.length === 0) return null;
  if (selectedId !== null && order.includes(selectedId)) return selectedId;
  if (selectedId === null) return order[0];
  return order[Math.min(Math.max(lastIndex, 0), order.length - 1)];
}
