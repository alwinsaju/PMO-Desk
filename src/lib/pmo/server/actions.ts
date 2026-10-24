// The only code that creates or changes to-dos. Every function takes the
// parsed-from-unknown request body, validates it, and returns the
// { ok, reason? } envelope the routes send back (HTTP 200 either way, the
// repo convention). Approve is the one door into todos/: nothing else ever
// builds a Todo from a proposal.
import {
  PERIOD_KEY,
  PeriodRequestSchema,
  buildReport,
  isCapped,
  markdownToPlainText,
  renderMarkdown,
  type ReportData,
  type SavedReportSummary,
} from "../report.ts";
import {
  recordSignoff,
  signoffKeysInPatchBody,
  signoffPatchProblem,
} from "../signoff.ts";
import { threadKeyOf } from "../thread.ts";
import {
  appendHistory,
  applyTodoPatch,
  buildTodo,
  historyEntry,
  todoLimitProblem,
  TodoPatchSchema,
} from "../todoLogic.ts";
import {
  PmoConfigPatchSchema,
  TodoDraftSchema,
  type ChaserJob,
  type Intake,
  type PmoConfig,
  type Proposal,
  type ReportNarrativeJob,
  type Todo,
  type TodoDraft,
  type TodoSource,
} from "../types.ts";
import {
  defaultInclude,
  describeApplied,
  patchFromChanges,
  planUpdate,
} from "../updateLogic.ts";
import type { ChaserDrafts } from "./chaserDrafts.ts";
import type { SignoffDrafts } from "./signoffDrafts.ts";
import { syncDesktopPrefs } from "./desktopPrefs.ts";
import type { Ingestor } from "./ingest.ts";
import type { ReportDrafts } from "./reportDrafts.ts";
import {
  SaveReportBodySchema,
  listReports,
  newReportId,
  readReport,
  saveReport,
  type ReadResult,
  type SaveResult,
} from "./reports.ts";
import { osUser, type Store } from "./store.ts";
import type { StructuringWorker } from "./structure.ts";
import { z } from "zod";

export interface Pmo {
  store: Store;
  ingestor: Ingestor;
  worker: StructuringWorker;
  /** Local, copy-only follow-up drafts (nothing is ever sent). */
  chaser: ChaserDrafts;
  /** Local, copy-only "improve with AI" sign-off request texts (never sent). */
  signoffDrafts: SignoffDrafts;
  /** Local, verified weekly-report highlights (nothing is ever sent). */
  reportDrafts: ReportDrafts;
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

function sourceOf(proposal: Proposal, intake: Intake | null): TodoSource {
  const { summary } = proposal;
  return {
    intakeId: proposal.intakeId,
    source: summary.source,
    link: summary.link,
    subject: summary.subject,
    sender: summary.senderName ?? summary.senderAddress,
    receivedAt: summary.receivedAt,
    // What later messages in the same conversation are matched against.
    threadKey: intake ? threadKeyOf(intake) : null,
  };
}

const UPDATE_USE_APPLY =
  "That message continues an existing to-do. Apply the update, or choose \u201cCreate as separate to-do instead\u201d.";

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
    if (proposal.update) return fail(UPDATE_USE_APPLY);
    if (proposal.status !== "ready") {
      return fail(
        proposal.status === "rejected"
          ? "That item was rejected."
          : "Only an item the model has finished structuring can be approved.",
      );
    }

    const now = pmo.now().toISOString();
    const raw = await pmo.store.readRaw(proposal.intakeId);
    const todo = buildTodo(draft, {
      now,
      approvedBy: osUser(),
      source: sourceOf(proposal, raw?.intake ?? null),
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
    if (proposal.update) return fail(UPDATE_USE_APPLY);
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
// Updates to existing to-dos (thread-aware intake)
// ---------------------------------------------------------------------------

const ApplyUpdateBody = z.object({
  /** The change ids the reviewer left ticked (see planUpdate); omitted = the
   *  card's defaults. An empty list links the message and changes nothing. */
  include: z.array(z.string().max(40)).max(40).optional(),
});

/** Apply a reviewed "update to existing to-do": patch the to-do with the ticked
 *  changes, link the new message into its history, audit it. The only way an
 *  update touches a to-do; idempotent like approve. */
export function approveUpdate(
  pmo: Pmo,
  id: string,
  body: unknown,
): Promise<ActionResult<{ todo: Todo }>> {
  const input = ApplyUpdateBody.safeParse(body ?? {});
  if (!input.success) return Promise.resolve(fail("Invalid update request."));

  return pmo.store.withLock(async () => {
    const proposal = await pmo.store.getProposal(id);
    if (!proposal?.update) return fail("That update is no longer in the queue.");
    if (proposal.status === "approved" && proposal.todoId) {
      const existing = await pmo.store.getTodo(proposal.todoId);
      if (existing) return { ok: true as const, todo: existing };
    }
    const { update } = proposal;
    if (proposal.status === "rejected") return fail("That update was rejected.");
    if (proposal.status !== "ready" || !update.result) {
      return fail("Only an update the model has finished reading can be applied.");
    }
    const todo = await pmo.store.getTodo(update.todoId);
    if (!todo) {
      return fail(
        "That to-do no longer exists. Choose \u201cCreate as separate to-do instead\u201d.",
      );
    }
    if (todo.status !== "open") {
      return fail(
        "That to-do is closed. Reopen it first, or choose \u201cCreate as separate to-do instead\u201d.",
      );
    }

    const raw = await pmo.store.readRaw(proposal.intakeId);
    const sender = {
      name: raw?.intake.sender.name ?? proposal.summary.senderName,
      address: raw?.intake.sender.address ?? proposal.summary.senderAddress,
    };
    const plan = planUpdate(todo, update.result, {
      sender,
      receivedAt: proposal.summary.receivedAt,
    });
    const include = new Set(input.data.include ?? defaultInclude(plan.changes));
    const applied = plan.changes.filter((change) => include.has(change.id));
    const patch = TodoPatchSchema.safeParse(patchFromChanges(plan.changes, include));
    if (!patch.success) return fail(`Invalid change: ${firstIssue(patch.error)}`);

    const now = pmo.now().toISOString();
    const message = historyEntry(
      "message",
      describeApplied(
        update.result.summary,
        applied,
        plan.changes.length - applied.length,
      ),
      now,
      {
        intakeId: proposal.intakeId,
        from: sender.name ?? sender.address ?? null,
      },
    );
    const patched = applyTodoPatch(
      { ...todo, history: appendHistory(todo.history, message) },
      patch.data,
      now,
    );
    let next = patched.todo;
    const kinds = patched.kinds;
    // A ticked sign-off suggestion is recorded by the same logic as the record
    // endpoint: the identity is the OS user who is approving this card and the
    // time is the server's, never anything from the request; the evidence is
    // this very message. If it cannot be recorded (someone recorded or revoked
    // meanwhile) nothing at all is applied.
    const signoffChange = applied.find((change) => change.kind === "signoff");
    let signoffAudit: Record<string, unknown> | null = null;
    if (signoffChange?.signoff) {
      const { checkpointId, outcome, conditions, quote } = signoffChange.signoff;
      const who = sender.name ?? sender.address ?? "the sender";
      const recorded = recordSignoff(next, {
        checkpointId,
        outcome,
        conditions,
        evidence: {
          intakeId: proposal.intakeId,
          messageLink: raw?.intake.link ?? proposal.summary.link ?? null,
          note: `Reply from ${who}${quote ? `: "${quote}"` : ""}`.slice(0, 500),
        },
        now,
        by: osUser(),
        from: who,
      });
      if (!recorded.ok) return fail(recorded.reason);
      next = recorded.todo;
      signoffAudit = recorded.audit;
    }
    const tooMuch = todoLimitProblem(next);
    if (tooMuch) return fail(tooMuch);

    await pmo.store.putTodo(next);
    await pmo.store.putProposal({
      ...proposal,
      status: "approved",
      todoId: next.id,
      updatedAt: now,
    });
    await pmo.store.audit("update-apply", {
      proposalId: proposal.id,
      todoId: next.id,
      intakeId: proposal.intakeId,
      applied: applied.map((change) => change.id),
      kinds,
    });
    if (signoffAudit) {
      await pmo.store.audit("signoff-record", {
        todoId: next.id,
        via: "update-card",
        proposalId: proposal.id,
        ...signoffAudit,
      });
    }
    return { ok: true as const, todo: next };
  });
}

/** "Create as separate to-do instead": the update card falls back to an
 *  ordinary proposal (the model structures the message as a new to-do). */
export function separateUpdate(pmo: Pmo, id: string): Promise<ActionResult> {
  return pmo.worker.separate(id);
}

// ---------------------------------------------------------------------------
// Chaser drafts (local, copy-only)
// ---------------------------------------------------------------------------

export function startChaserDraft(
  pmo: Pmo,
  todoId: string,
): Promise<ActionResult<{ job: ChaserJob }>> {
  return pmo.chaser.start(todoId);
}

export function discardChaserDraft(pmo: Pmo, todoId: string): ActionResult {
  pmo.chaser.discard(todoId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Weekly report (local text; nothing is sent)
// ---------------------------------------------------------------------------

const PeriodBody = z.object({ period: PeriodRequestSchema });

/** The deterministic report for a period, as of now: no model involved, instant.
 *  Nothing is written until the person saves. */
export function generateReport(
  pmo: Pmo,
  body: unknown,
): Promise<
  ActionResult<{
    id: string;
    data: ReportData;
    markdown: string;
    text: string;
    capped: boolean;
  }>
> {
  const input = PeriodBody.safeParse(body);
  if (!input.success)
    return Promise.resolve(fail("Choose a valid period for the report."));
  return buildFor(pmo, input.data.period).then(async (built) => {
    if (!built.ok) return built;
    const { data } = built;
    const markdown = renderMarkdown(data);
    const id = newReportId();
    await pmo.store.audit("report-generate", {
      reportId: id,
      period: `${data.period.startDay}..${data.period.endDay}`,
      kind: data.period.kind,
      open: data.summary.open,
      closed: data.summary.closed,
    });
    return {
      ok: true as const,
      id,
      data,
      markdown,
      text: markdownToPlainText(markdown),
      capped: isCapped(data),
    };
  });
}

async function buildFor(
  pmo: Pmo,
  request: z.infer<typeof PeriodRequestSchema>,
): Promise<{ ok: true; data: ReportData } | { ok: false; reason: string }> {
  const [todos, config] = await Promise.all([
    pmo.store.listTodos(),
    pmo.store.loadConfig(),
  ]);
  return buildReport(todos, pmo.now(), request, config);
}

/** Ask the local model for highlights, risks and next week's focus. Returns at
 *  once with the job; poll `getReportNarrative`. */
export async function startReportNarrative(
  pmo: Pmo,
  body: unknown,
): Promise<ActionResult<{ job: ReportNarrativeJob }>> {
  const input = PeriodBody.safeParse(body);
  if (!input.success) return fail("Choose a valid period for the report.");
  const built = await buildFor(pmo, input.data.period);
  if (!built.ok) return built;
  return { ok: true, job: pmo.reportDrafts.start(built.data) };
}

export function getReportNarrative(
  pmo: Pmo,
  key: string | null,
): ActionResult<{ job: ReportNarrativeJob | null }> {
  if (!key || !PERIOD_KEY.test(key)) return fail("Missing or invalid period.");
  return { ok: true, job: pmo.reportDrafts.get(key) };
}

export async function listSavedReports(
  pmo: Pmo,
): Promise<ActionResult<{ reports: SavedReportSummary[] }>> {
  return { ok: true, reports: await listReports(pmo.store) };
}

export async function getSavedReport(
  pmo: Pmo,
  id: string,
  rev: number | undefined,
): Promise<ReadResult> {
  return readReport(pmo.store, id, rev);
}

/** Save the text as a new revision (the first save creates the report). */
export function saveReportText(pmo: Pmo, id: string, body: unknown): Promise<SaveResult> {
  const input = SaveReportBodySchema.safeParse(body);
  if (!input.success) return Promise.resolve(fail(firstIssue(input.error)));
  return saveReport(pmo.store, id, input.data, { now: pmo.now() });
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
      if (proposal.update) return fail(UPDATE_USE_APPLY);
    }
    const raw = proposal ? await pmo.store.readRaw(proposal.intakeId) : null;
    const todo = buildTodo(draft, {
      now,
      approvedBy: osUser(),
      source: proposal
        ? sourceOf(proposal, raw?.intake ?? null)
        : {
            intakeId: null,
            source: "manual",
            link: null,
            subject: draft.title,
            sender: null,
            receivedAt: null,
            threadKey: null,
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

export async function patchTodo(
  pmo: Pmo,
  id: string,
  body: unknown,
): Promise<ActionResult<{ todo: Todo; offerDone: boolean }>> {
  // The generic edit route can neither write a sign-off nor fake one: a body
  // that carries any sign-off field is refused outright (the schema below would
  // only drop it silently), and so is one that ticks a sign-off step as done.
  const forged = signoffKeysInPatchBody(body);
  if (forged.length > 0) {
    await pmo.store.audit("signoff-refused", {
      todoId: id,
      via: "patch",
      fields: forged,
    });
    return fail(
      `Sign-off details can only be recorded with the sign-off actions (Request sign-off / Record sign-off), not by editing the to-do. Remove: ${forged.join(", ")}.`,
    );
  }
  const parsed = TodoPatchSchema.safeParse(body);
  if (!parsed.success) return fail(`Invalid change: ${firstIssue(parsed.error)}`);

  return pmo.store.withLock(async () => {
    const todo = await pmo.store.getTodo(id);
    if (!todo) return fail("That to-do no longer exists.");
    const refused = signoffPatchProblem(todo, parsed.data);
    if (refused) {
      await pmo.store.audit("signoff-refused", { todoId: id, via: "patch", fields: [] });
      return fail(refused);
    }
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
      report: patch.report
        ? {
            title: patch.report.title.trim(),
            projectName: patch.report.projectName.trim(),
          }
        : current.report,
    };
    if (next.me.names.length === 0)
      return fail("Invalid config: me.names: Add at least one name.");
    await pmo.store.saveConfig(next);
    if (patch.reminders) await syncDesktopPrefs(next);
    await pmo.store.audit("config", { changed: Object.keys(patch) });
    return { ok: true as const, config: next };
  });
}
