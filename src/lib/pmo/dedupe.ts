// Dedupe key for an intake: source + ':' + sha256(sourceId), falling back to a
// hash of source|sender|receivedAt|first 500 normalised body characters when
// the producer gave no usable sourceId. Server-side only (node:crypto).
import { createHash } from "node:crypto";
import type { Intake } from "./types.ts";

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** Lower-cased, whitespace-collapsed text; same normalisation everywhere. */
export function normaliseText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

export function dedupeKey(
  intake: Pick<Intake, "source" | "sourceId" | "sender" | "receivedAt" | "body">,
): string {
  const sourceId = intake.sourceId?.trim();
  if (sourceId) return `${intake.source}:${sha256(sourceId)}`;
  const sender = normaliseText(intake.sender.address ?? intake.sender.name ?? "");
  const body = normaliseText(intake.body.text).slice(0, 500);
  return `${intake.source}:${sha256(`${intake.source}|${sender}|${intake.receivedAt}|${body}`)}`;
}

/** Deterministic ids derived from the key, so a crash between two writes of
 *  one ingest and the retry that follows overwrite instead of duplicating. */
export function idsForKey(key: string): { intakeId: string; proposalId: string } {
  const hash = sha256(key).slice(0, 20);
  return { intakeId: `in_${hash}`, proposalId: `pr_${hash}` };
}
