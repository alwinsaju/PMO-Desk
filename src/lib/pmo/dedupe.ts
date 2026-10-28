// Dedupe key for an intake: source + ':' + sha256(sourceId). When the producer
// gave no usable sourceId, the id is derived from the content (deriveSourceId:
// source|sender|subject|receivedAt|first 500 normalised body characters).
// Server-side only (node:crypto).
import { createHash } from "node:crypto";
import type { Intake } from "./types.ts";

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** Lower-cased, whitespace-collapsed text; same normalisation everywhere. */
export function normaliseText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

type IdentityFields = Pick<
  Intake,
  "source" | "sourceId" | "sender" | "receivedAt" | "body"
> & { subject?: string };

/** The stable id for an intake whose producer left sourceId blank: a sha256 of
 *  sender, subject, receivedAt and the start of the body, so the same message
 *  dropped twice is one item. */
export function deriveSourceId(intake: Omit<IdentityFields, "sourceId">): string {
  const sender = normaliseText(intake.sender.address ?? intake.sender.name ?? "");
  const subject = normaliseText(intake.subject ?? "");
  const body = normaliseText(intake.body.text).slice(0, 500);
  return `derived-${sha256(`${intake.source}|${sender}|${subject}|${intake.receivedAt}|${body}`).slice(0, 32)}`;
}

export function dedupeKey(intake: IdentityFields): string {
  const sourceId = intake.sourceId?.trim() || deriveSourceId(intake);
  return `${intake.source}:${sha256(sourceId)}`;
}

/** Deterministic ids derived from the key, so a crash between two writes of
 *  one ingest and the retry that follows overwrite instead of duplicating. */
export function idsForKey(key: string): { intakeId: string; proposalId: string } {
  const hash = sha256(key).slice(0, 20);
  return { intakeId: `in_${hash}`, proposalId: `pr_${hash}` };
}

/** Id of the n-th (2-based) extra proposal made from the same message when it
 *  holds several tasks. Derived from the first proposal's id, so a re-run never
 *  duplicates; plain `pr_<hex>` like every other proposal id (isSafeId). */
export function siblingProposalId(proposalId: string, n: number): string {
  return `pr_${sha256(`${proposalId}#${n}`).slice(0, 20)}`;
}

/** Id of the to-do made from a proposal, derived from the proposal's id so that
 *  approving again after a crash between the two writes finds the to-do it
 *  already made instead of creating a second one. Plain `td_<hex>` (isSafeId). */
export function todoIdForProposal(proposalId: string): string {
  return `td_${sha256(`todo:${proposalId}`).slice(0, 20)}`;
}
