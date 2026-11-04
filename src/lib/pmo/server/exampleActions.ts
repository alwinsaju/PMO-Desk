// The saved-examples actions behind /api/pmo/examples and
// /api/pmo/queue/[id]/example: save the draft the person is reviewing as an
// example, list, delete, and the "Use my saved examples in prompts" switch.
// Same { ok, reason? } envelope as actions.ts. The examples never leave this
// machine and none of their text goes to a log or the audit trail.
import { z } from "zod";
import { prepareForModelDetailed } from "../preprocess.ts";
import {
  EXAMPLE_LIMITS,
  MAX_SAVED_EXAMPLES,
  type SavedExample,
} from "../savedExamples.ts";
import { TodoDraftSchema } from "../types.ts";
import type { Pmo } from "./actions.ts";
import { isSafeId } from "./paths.ts";
import {
  deleteExample,
  loadSavedExamples,
  saveExample,
  setExamplesEnabled,
} from "./savedExamples.ts";

type Fail = { ok: false; reason: string };
const fail = (reason: string): Fail => ({ ok: false, reason });

/** What the list and the switch show. */
export interface ExamplesReply {
  enabled: boolean;
  examples: SavedExample[];
  max: number;
}

const reply = (file: { enabled: boolean; examples: SavedExample[] }): ExamplesReply => ({
  enabled: file.enabled,
  examples: file.examples,
  max: MAX_SAVED_EXAMPLES,
});

export async function listSavedExamples(pmo: Pmo): Promise<{ ok: true } & ExamplesReply> {
  return { ok: true, ...reply(await loadSavedExamples(pmo.store.root)) };
}

/** Save the draft being reviewed (with the reviewer's edits so far) as an
 *  example, together with the message text the model was shown. Only a to-do
 *  proposal the model has answered can be saved: not an update to an existing
 *  to-do, and not one still being structured. */
export async function saveProposalExample(
  pmo: Pmo,
  id: string,
  body: unknown,
): Promise<({ ok: true; replaced: boolean; count: number } & { max: number }) | Fail> {
  const input = z.object({ draft: z.unknown() }).safeParse(body);
  if (!input.success) return fail("Missing to-do draft.");
  const parsed = TodoDraftSchema.safeParse(input.data.draft);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail(
      `Invalid to-do: ${issue.path.join(".")}${issue.path.length ? ": " : ""}${issue.message}`,
    );
  }
  if (!isSafeId(id)) return fail("That item is no longer in the queue.");
  const proposal = await pmo.store.getProposal(id);
  if (!proposal) return fail("That item is no longer in the queue.");
  if (proposal.update) {
    return fail("An update to an existing to-do cannot be saved as an example.");
  }
  if (proposal.status !== "ready" && proposal.status !== "approved") {
    return fail(
      "Only an item the model has finished structuring can be saved as an example.",
    );
  }
  const raw = await pmo.store.readRaw(proposal.intakeId);
  if (!raw)
    return fail("The saved message text was already deleted, so it cannot be saved.");
  const { text } = prepareForModelDetailed(raw.intake);
  if (text.trim() === "") return fail("The message has no text to save.");
  const saved = await saveExample(pmo.store, {
    subject: raw.intake.subject.slice(0, EXAMPLE_LIMITS.subject),
    message: text,
    draft: parsed.data,
    now: pmo.now(),
  });
  if (!saved.ok) return saved;
  return {
    ok: true,
    replaced: saved.replaced,
    count: saved.count,
    max: MAX_SAVED_EXAMPLES,
  };
}

export async function removeSavedExample(
  pmo: Pmo,
  id: string,
): Promise<({ ok: true } & ExamplesReply) | Fail> {
  const done = await deleteExample(pmo.store, id);
  return done.ok ? { ok: true, ...reply(done.file) } : done;
}

const SwitchBody = z.object({ enabled: z.boolean() });

export async function setSavedExamplesSwitch(
  pmo: Pmo,
  body: unknown,
): Promise<({ ok: true } & ExamplesReply) | Fail> {
  const input = SwitchBody.safeParse(body);
  if (!input.success) return fail("Send { enabled: true } or { enabled: false }.");
  const done = await setExamplesEnabled(pmo.store, input.data.enabled);
  return done.ok ? { ok: true, ...reply(done.file) } : done;
}
