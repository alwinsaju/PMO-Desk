// The only code that creates or changes to-dos. Every function takes the
// parsed-from-unknown request body, validates it, and returns the
// { ok, reason? } envelope the routes send back (HTTP 200 either way, the
// repo convention). Approve is the one door into todos/: nothing else ever
// builds a Todo from a proposal.
import {
  applyTodoPatch,
  buildTodo,
  todoLimitProblem,
  TodoPatchSchema,
} from "../todoLogic.ts";
import {
  PmoConfigPatchSchema,
  TodoDraftSchema,
  type PmoConfig,
  type Proposal,
  type Todo,
  type TodoDraft,
  type TodoSource,
} from "../types.ts";
import { syncDesktopPrefs } from "./desktopPrefs.ts";
import type { Ingestor } from "./ingest.ts";
import { osUser, type Store } from "./store.ts";
import type { StructuringWorker } from "./structure.ts";
import { z } from "zod";

export interface Pmo {
  store: Store;
  ingestor: Ingestor;
  worker: StructuringWorker;
  now: () => Date;
  /** The inbox folder for a config (env override applied). */
  inboxDir: (config: PmoConfig) => string;
}

export type ActionResult<T extends object = object> =
  ({ ok: true } & T) | { ok: false; reason: string };

const fail = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });

function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  const where = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
  return `${where}${issue.message}`;
}

function parseDraft(input: unknown): { draft: TodoDraft } | { reason: string } {
  const parsed = TodoDraftSchema.safeParse(input);
  if (!parsed.success) return { reason: `Invalid to-do: ${firstIssue(parsed.error)}` };
  const draft = parsed.data;
  return {
    draft: {
      ...draft,
      description: draft.description.trim(),
      actionItems: draft.actionItems.filter((item) => item.text.trim() !== ""),
      tags: draft.tags.map((tag) => tag.trim()).filter(Boolean),
    },
  };
}

function sourceOf(proposal: Proposal): TodoSource {
  const { summary } = proposal;
  return {
    intakeId: proposal.intakeId,
    source: summary.source,
    link: summary.link,
    subject: summary.subject,
    sender: summary.senderName ?? summary.senderAddress,
    receivedAt: summary.receivedAt,
  };
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------------------
// Proposals
// ---------------------------------------------------------------------------

/** Create the to-do from the reviewed draft. Idempotent: a second approve of
 *  the same proposal returns the to-do the first one made. */
export function approveProposal(
  pmo: Pmo,
  id: string,
  body: unknown,
): Promise<ActionResult<{ todo: Todo }>> {
  const input = z.object({ draft: z.unknown() }).safeParse(body);
  if (!input.success) return Promise.resolve(fail("Missing to-do draft."));
  const parsed = parseDraft(input.data.draft);
  if ("reason" in parsed) return Promise.resolve(fail(parsed.reason));
  const { draft } = parsed;

  return pmo.store.withLock(async () => {
    const proposal = await pmo.store.getProposal(id);
    if (!proposal) return fail("That item is no longer in the queue.");
    if (proposal.status === "approved" && proposal.todoId) {
      const existing = await pmo.store.getTodo(proposal.todoId);
      if (existing) return { ok: true as const, todo: existing };
    }
    if (proposal.status !== "ready") {
      return fail(
        proposal.status === "rejected"
          ? "That item was rejected."
          : "Only an item the model has finished structuring can be approved.",
      );
    }

    const now = pmo.now().toISOString();
    const todo = buildTodo(draft, {
      now,
      approvedBy: osUser(),
      source: sourceOf(proposal),
    });
    await pmo.store.putTodo(todo);
    await pmo.store.putProposal({
      ...proposal,
      status: "approved",
      edits: draft,
      todoId: todo.id,
      updatedAt: now,
    });
    await pmo.store.audit("approve", {
      proposalId: proposal.id,
      todoId: todo.id,
      edited: !proposal.draft || !sameJson(draftSnapshot(proposal), draft),
    });
    return { ok: true as const, todo };
  });
}

/** The AI draft as the review form would have started out, for "was it edited". */
function draftSnapshot(proposal: Proposal): TodoDraft | null {
  if (!proposal.draft) return null;
  const ai = proposal.draft;
  return {
    title: ai.title,
    description: ai.description,
    owner: ai.owner,
    requester: ai.requester,
    dueAt: ai.dueBasis === "none" ? null : ai.dueAt,
    priority: ai.priority,
    actionItems: ai.actionItems,
    checkpointTemplate: ai.checkpointTemplate,
    waitingOn: ai.waitingOn,
    tags: ai.tags,
  };
}

export function rejectProposal(pmo: Pmo, id: string): Promise<ActionResult> {
  return pmo.store.withLock(async () => {
    const proposal = await pmo.store.getProposal(id);
    if (!proposal) return fail("That item is no longer in the queue.");
    if (proposal.status === "rejected") return { ok: true as const };
    if (proposal.status === "approved") return fail("That item was already approved.");
    await pmo.store.putProposal({
      ...proposal,
      status: "rejected",
      updatedAt: pmo.now().toISOString(),
    });
    await pmo.store.audit("reject", { proposalId: proposal.id });
    return { ok: true as const };
  });
}

export async function retryProposal(pmo: Pmo, id: string): Promise<ActionResult> {
  const result = await pmo.worker.retry(id);
  if (result.ok) await pmo.store.audit("retry", { proposalId: id });
  return result;
}

/** Save the user's in-progress edits to a queue item (never touches `draft`). */
export function stageEdits(pmo: Pmo, id: string, body: unknown): Promise<ActionResult> {
  const input = z.object({ draft: z.unknown() }).safeParse(body);
  if (!input.success) return Promise.resolve(fail("Missing to-do draft."));
  const parsed = parseDraft(input.data.draft);
  if ("reason" in parsed) return Promise.resolve(fail(parsed.reason));

  return pmo.store.withLock(async () => {
    const proposal = await pmo.store.getProposal(id);
    if (!proposal) return fail("That item is no longer in the queue.");
    if (proposal.status === "approved" || proposal.status === "rejected") {
      return fail("That item has already been decided.");
    }
    await pmo.store.putProposal({
      ...proposal,
      edits: parsed.draft,
      updatedAt: pmo.now().toISOString(),
    });
    await pmo.store.audit("edit", { proposalId: proposal.id, stage: "proposal" });
    return { ok: true as const };
  });
}

// ---------------------------------------------------------------------------
// Todos
// ---------------------------------------------------------------------------

/** A to-do typed in by hand, optionally standing in for a proposal the model
 *  could not structure (`proposalId`), which counts as the human's approval. */
export function createManualTodo(
  pmo: Pmo,
  body: unknown,
): Promise<ActionResult<{ todo: Todo }>> {
  const input = z
    .object({ draft: z.unknown(), proposalId: z.string().optional() })
    .safeParse(body);
  if (!input.success) return Promise.resolve(fail("Missing to-do draft."));
  const parsed = parseDraft(input.data.draft);
  if ("reason" in parsed) return Promise.resolve(fail(parsed.reason));
  const { draft } = parsed;

  return pmo.store.withLock(async () => {
    const now = pmo.now().toISOString();
    let proposal: Proposal | null = null;
    if (input.data.proposalId) {
      proposal = await pmo.store.getProposal(input.data.proposalId);
      if (!proposal) return fail("That item is no longer in the queue.");
      if (proposal.status === "approved" || proposal.status === "rejected") {
        return fail("That item has already been decided.");
      }
    }
    const todo = buildTodo(draft, {
      now,
      approvedBy: osUser(),
      source: proposal
        ? sourceOf(proposal)
        : {
            intakeId: null,
            source: "manual",
            link: null,
            subject: draft.title,
            sender: null,
            receivedAt: null,
          },
    });
    await pmo.store.putTodo(todo);
    if (proposal) {
      await pmo.store.putProposal({
        ...proposal,
        status: "approved",
        edits: draft,
        todoId: todo.id,
        updatedAt: now,
      });
    }
    await pmo.store.audit("create-manual", {
      todoId: todo.id,
      proposalId: proposal?.id ?? null,
    });
    return { ok: true as const, todo };
  });
}

export function patchTodo(
  pmo: Pmo,
  id: string,
  body: unknown,
): Promise<ActionResult<{ todo: Todo; offerDone: boolean }>> {
  const parsed = TodoPatchSchema.safeParse(body);
  if (!parsed.success)
    return Promise.resolve(fail(`Invalid change: ${firstIssue(parsed.error)}`));

  return pmo.store.withLock(async () => {
    const todo = await pmo.store.getTodo(id);
    if (!todo) return fail("That to-do no longer exists.");
    const {
      todo: next,
      offerDone,
      kinds,
    } = applyTodoPatch(todo, parsed.data, pmo.now().toISOString());
    const tooMuch = todoLimitProblem(next);
    if (tooMuch) return fail(tooMuch);
    await pmo.store.putTodo(next);
    for (const kind of kinds) {
      // Ticking boxes is progress, not an edit worth an audit line.
      if (kind !== "progress") await pmo.store.audit(kind, { todoId: id });
    }
    return { ok: true as const, todo: next, offerDone };
  });
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const cleanList = (values: string[], lower = true) => [
  ...new Set(
    values.map((v) => (lower ? v.trim().toLowerCase() : v.trim())).filter(Boolean),
  ),
];

export function updateConfig(
  pmo: Pmo,
  body: unknown,
): Promise<ActionResult<{ config: PmoConfig }>> {
  const parsed = PmoConfigPatchSchema.safeParse(body);
  if (!parsed.success)
    return Promise.resolve(fail(`Invalid config: ${firstIssue(parsed.error)}`));
  const patch = parsed.data;

  return pmo.store.withLock(async () => {
    const current = await pmo.store.loadConfig();
    const next: PmoConfig = {
      ...current,
      allowedTenantIds: patch.allowedTenantIds
        ? cleanList(patch.allowedTenantIds)
        : current.allowedTenantIds,
      teamsChatAllowlist: patch.teamsChatAllowlist
        ? cleanList(patch.teamsChatAllowlist, false)
        : current.teamsChatAllowlist,
      allowedSenderDomains: patch.allowedSenderDomains
        ? cleanList(patch.allowedSenderDomains)
        : current.allowedSenderDomains,
      blockedDomains: patch.blockedDomains
        ? cleanList(patch.blockedDomains)
        : current.blockedDomains,
      blockedTerms: patch.blockedTerms
        ? cleanList(patch.blockedTerms, false)
        : current.blockedTerms,
      me: patch.me
        ? { names: cleanList(patch.me.names, false), emails: cleanList(patch.me.emails) }
        : current.me,
      retentionDays: patch.retentionDays ?? current.retentionDays,
      reminders: patch.reminders
        ? { ...patch.reminders, timeZone: patch.reminders.timeZone.trim() }
        : current.reminders,
    };
    if (next.me.names.length === 0)
      return fail("Invalid config: me.names: Add at least one name.");
    await pmo.store.saveConfig(next);
    if (patch.reminders) await syncDesktopPrefs(next);
    await pmo.store.audit("config", { changed: Object.keys(patch) });
    return { ok: true as const, config: next };
  });
}
