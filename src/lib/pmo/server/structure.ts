// Turns pending proposals into drafts by running each message through the
// local model, one at a time. The model call is injected (`Generator`) so
// tests and the PMO_AI_STUB switch never need Ollama; the real one is wired
// in service.ts. Failures here are local state only: nothing is sent anywhere.
import { prepareForModelDetailed, displayText } from "../preprocess.ts";
import { siblingProposalId } from "../dedupe.ts";
import { groundQuote } from "../quote.ts";
import { sanitizeDraft } from "../sanitizeDraft.ts";
import { asTaskList, selectTasks } from "../splitTasks.ts";
import { awaitingSignoff, looksLikeInjection, readSignoff } from "../signoff.ts";
import type { AiNarrative } from "../reportNarrative.ts";
import {
  PROMPT_VERSION,
  buildSystemPrompt,
  buildUserPrompt,
} from "../structurePrompt.ts";
import {
  UPDATE_PROMPT_VERSION,
  buildUpdateSystemPrompt,
  buildUpdateUserPrompt,
} from "../updatePrompt.ts";
import {
  MAX_AI_ATTEMPTS,
  type AiStructured,
  type AiUpdate,
  type Proposal,
} from "../types.ts";
import { examplesForPrompt } from "./savedExamples.ts";
import type { Store } from "./store.ts";

export interface ModelRequest {
  system: string;
  prompt: string;
  /** SHORT human label for the local model log (a message subject, a to-do
   *  title). Shown in memory only; never persisted by the logging feature. */
  label?: string;
}

/** An update request; `signoff` asks for the sign-off classification too (the
 *  to-do is awaiting a sign-off), which changes the schema the model answers. */
export interface UpdateRequest extends ModelRequest {
  signoff?: boolean;
}

export interface Generator {
  /** Name of the model that answers (for the log and the review UI). */
  model(): string;
  /** Message -> to-do proposal(s): one entry per independently completable task
   *  in the message. A single object is a message with one task. */
  generate(request: ModelRequest): Promise<AiStructured | AiStructured[]>;
  /** New message + existing to-do -> what changed (thread-aware intake). */
  generateUpdate(request: UpdateRequest): Promise<AiUpdate>;
  /** A follow-up message to review and copy. Plain text, untrusted. */
  draftChaser(request: ModelRequest): Promise<string>;
  /** A sign-off request to review and copy (the optional "improve with AI"; the
   *  deterministic template needs no model). Plain text, untrusted. */
  draftSignoffRequest(request: ModelRequest): Promise<string>;
  /** The weekly report's highlights, risks and next-week focus, from the report's
   *  own data only. Untrusted: the caller verifies it before anyone sees it. */
  draftNarrative(request: ModelRequest): Promise<AiNarrative>;
}

/** Why the queue stopped; shown as a banner until the next scan retries. */
export interface PauseState {
  code: "runtime-down" | "model-missing";
  message: string;
  since: string;
}

export interface StructuringState {
  /** Proposal being structured right now. */
  active: string | null;
  /** 1-based position of the active item in the current burst of work. */
  position: number;
  total: number;
  waiting: number;
  paused: PauseState | null;
}

export type ErrorKind =
  "runtime-down" | "model-missing" | "timeout" | "invalid-output" | "error";

/** Duck-typed (see isAiRuntimeError): the error may come from another copy of
 *  the module in Next's separate bundles. */
export function classify(error: unknown): { kind: ErrorKind; message: string } {
  const e = error as { name?: string; code?: string; message?: string };
  const message = e?.message ?? String(error);
  if (e?.name === "AiRuntimeError") {
    if (
      e.code === "runtime-down" ||
      e.code === "model-missing" ||
      e.code === "timeout" ||
      e.code === "invalid-output"
    ) {
      return { kind: e.code, message };
    }
  }
  return { kind: "error", message };
}

export interface WorkerOptions {
  store: Store;
  generator: Generator;
  /** Reads config each job so an edit to `me` applies without a restart. */
  now?: () => number;
}

export class StructuringWorker {
  private readonly store: Store;
  private readonly generator: Generator;
  private readonly now: () => number;
  private queue: string[] = [];
  private running: Promise<void> | null = null;
  private active: string | null = null;
  private done = 0;
  private total = 0;
  /** The most recent runtime failure, kept visible until a call succeeds. */
  private paused: PauseState | null = null;
  /** Stops the loop after a runtime failure until the next kick(). */
  private halted = false;

  constructor(options: WorkerOptions) {
    this.store = options.store;
    this.generator = options.generator;
    this.now = options.now ?? Date.now;
  }

  state(): StructuringState {
    return {
      active: this.active,
      position: Math.min(this.done + 1, this.total),
      total: this.total,
      waiting: this.queue.length,
      paused: this.paused,
    };
  }

  /** Resolves when the queue has drained or paused. */
  idle(): Promise<void> {
    return this.running ?? Promise.resolve();
  }

  /**
   * Call on server start: a proposal left 'structuring' by a stopped server
   * goes back to 'pending', then everything pending is queued.
   */
  async start(): Promise<void> {
    await this.store.withLock(async () => {
      const all = await this.store.listProposals();
      for (const proposal of all) {
        if (proposal.status === "structuring") {
          await this.store.putProposal({ ...proposal, status: "pending" });
        }
      }
      // A crash while publishing a multi-task split can leave hidden cards. They
      // are published only once the message's first card ("1 of N") is itself
      // published; while it is still to be structured (or failed) the re-run
      // rewrites them, so "2 of 3" never shows without its first card.
      const firstPublished = new Set(
        all
          .filter(
            (p) =>
              p.part?.index === 1 &&
              !["pending", "structuring", "failed", "splitting"].includes(p.status),
          )
          .map((p) => p.intakeId),
      );
      for (const proposal of all) {
        if (proposal.status === "splitting" && firstPublished.has(proposal.intakeId)) {
          await this.store.putProposal({
            ...proposal,
            status: "ready",
            updatedAt: new Date(this.now()).toISOString(),
          });
        }
      }
    });
    await this.kick();
  }

  /**
   * Queue every pending proposal that isn't queued yet, and clear a pause so
   * the model is tried again. Cheap to call often: ingest calls it after every
   * scan, which is also what retries a runtime that was down.
   */
  async kick(): Promise<void> {
    this.halted = false;
    const pending = (await this.store.listProposals()).filter(
      (p) => p.status === "pending",
    );
    // Nothing waiting on the model: an old "model not running" notice is stale.
    if (pending.length === 0) this.paused = null;
    for (const proposal of pending) this.enqueue(proposal.id);
    this.pump();
  }

  enqueue(id: string): void {
    if (this.active === id || this.queue.includes(id)) return;
    this.queue.push(id);
    this.total++;
  }

  private pump(): void {
    if (this.running || this.halted || this.queue.length === 0) return;
    this.running = this.loop().finally(() => {
      this.running = null;
      this.active = null;
      if (this.halted) {
        // Whatever is still queued stays 'pending' in the store; the next
        // kick() rebuilds the queue from there.
        this.queue = [];
      }
      if (this.queue.length === 0) {
        this.done = 0;
        this.total = 0;
      } else if (!this.halted) {
        this.pump();
      }
    });
  }

  private async loop(): Promise<void> {
    while (this.queue.length > 0 && !this.halted) {
      const id = this.queue.shift() as string;
      this.active = id;
      let again = false;
      try {
        again = (await this.process(id)) === "requeue";
      } catch (error) {
        // A storage failure on one item must not kill the queue.
        console.error(`[pmo] structuring ${id} failed unexpectedly:`, error);
      }
      this.done++;
      // An update that turned out to be about something else is a normal
      // proposal now: structure it next, as a new to-do proposal.
      if (again && !this.queue.includes(id)) {
        this.queue.push(id);
        this.total++;
      }
    }
  }

  private async setStatus(
    id: string,
    from: Proposal["status"][],
    update: (p: Proposal) => Proposal,
  ): Promise<Proposal | null> {
    return this.store.withLock(async () => {
      const current = await this.store.getProposal(id);
      if (!current || !from.includes(current.status)) return null;
      const next = { ...update(current), updatedAt: new Date(this.now()).toISOString() };
      await this.store.putProposal(next);
      return next;
    });
  }

  private async process(id: string): Promise<"done" | "requeue"> {
    const claimed = await this.setStatus(id, ["pending"], (p) => ({
      ...p,
      status: "structuring",
    }));
    if (!claimed) return "done"; // rejected, approved or already handled meanwhile

    const raw = await this.store.readRaw(claimed.intakeId);
    if (!raw) {
      await this.fail(id, claimed.ai.attempts, "The stored message could not be found.");
      return "done";
    }
    const config = await this.store.loadConfig();
    const intake = raw.intake;
    const {
      text: bodyText,
      replyBelowQuote,
      truncated,
    } = prepareForModelDetailed(intake);

    // Thread-aware branch: the message belongs to an open to-do.
    if (claimed.update) {
      const todo = await this.store.getTodo(claimed.update.todoId);
      if (!todo || todo.status !== "open") {
        // The to-do closed or went away since ingest: an ordinary proposal.
        await this.toNormalProposal(id, "to-do no longer open");
        return "requeue";
      }
      // A to-do that is awaiting a sign-off also gets the reply classified.
      const signoff = awaitingSignoff(todo) !== null;
      const system = buildUpdateSystemPrompt(config.me, { signoff });
      const prompt = buildUpdateUserPrompt(
        todo,
        intake,
        bodyText,
        config.reminders.timeZone,
      );
      return this.attempts<AiUpdate>({
        id,
        claimed,
        bytes: Buffer.byteLength(system) + Buffer.byteLength(prompt),
        promptVersion: UPDATE_PROMPT_VERSION,
        task: signoff ? "update-signoff" : "update",
        call: () =>
          this.generator.generateUpdate({
            system,
            prompt,
            signoff,
            label: intake.subject,
          }),
        onOk: async (output, durationMs, attempts) => {
          if (output.kind === "unrelated") {
            await this.toNormalProposal(id, "the model says it is about something else");
            return "requeue";
          }
          const grounded = groundQuote(displayText(intake), output.quote);
          let result: AiUpdate = {
            ...output,
            quote: grounded.quote,
            suspicious: looksLikeInjection(`${intake.subject}\n${bodyText}`),
          };
          if (signoff) {
            // The sign-off quote is checked against what the model was shown (the
            // reply without its quoted chain), so a sentence of OUR earlier request
            // can never pass as the approver's answer; and a reply that carries
            // wording aimed at the assistant is lowered to "unclear".
            result = {
              ...result,
              ...readSignoff(output, bodyText, intake.subject),
              // The text under the quote may be our own earlier request, so a
              // sign-off read from it is never pre-ticked.
              ...(replyBelowQuote ? { signoffQuoteVerified: false } : {}),
            };
          } else {
            result = {
              ...result,
              signoff: undefined,
              signoffQuote: undefined,
              signoffReason: undefined,
            };
          }
          await this.setStatus(id, ["structuring"], (p) => ({
            ...p,
            status: "ready",
            update: p.update ? { ...p.update, result } : p.update,
            isActionable: output.kind !== "nothing",
            quoteVerified: grounded.verified,
            replyBelowQuote: replyBelowQuote || undefined,
            ai: { model: this.generator.model(), durationMs, attempts, error: null },
          }));
          return "done";
        },
      });
    }

    // The user's saved examples (off unless they turned the switch on): at most
    // two, chosen by word overlap with this message. Never throws; the model
    // log only ever sees how many were used.
    const savedExamples = await examplesForPrompt(
      this.store.root,
      `${intake.subject}\n${bodyText}`,
    );
    const system = buildSystemPrompt(config.me, config.reminders.timeZone, savedExamples);
    const prompt = buildUserPrompt(
      intake,
      bodyText,
      this.now(),
      config.reminders.timeZone,
    );
    return this.attempts<AiStructured | AiStructured[]>({
      id,
      claimed,
      bytes: Buffer.byteLength(system) + Buffer.byteLength(prompt),
      promptVersion: PROMPT_VERSION,
      logExtra: savedExamples.length > 0 ? { savedExamples: savedExamples.length } : {},
      task: "structure",
      call: () => this.generator.generate({ system, prompt, label: intake.subject }),
      onOk: async (output, durationMs, attempts) => {
        const cleaned = asTaskList(output).map((task) => {
          // Keep only the part of the quote that is really in the message.
          const grounded = groundQuote(displayText(intake), task.quote);
          const rawDraft = { ...task, quote: grounded.quote };
          // The app's own clean-up of the model's usual mistakes (past dates,
          // over-assigned priority, duplicate steps, a misread "waiting on").
          // The review form starts from `draft`; `rawDraft` keeps what the
          // model said.
          const { draft, adjustments, fallback } = sanitizeDraft(rawDraft, {
            now: this.now(),
            timeZone: config.reminders.timeZone,
            text: `${intake.subject}
${bodyText}`,
            me: config.me,
            subject: intake.subject,
            bodyText,
            sender: { name: intake.sender.name, address: intake.sender.address },
            attachmentCount: intake.attachments.length,
          });
          return { task, grounded, rawDraft, draft, adjustments, fallback };
        });
        // One message can hold several independent tasks: drop duplicates,
        // FYIs and over-split sub-steps, cap the count.
        const { kept, notes, possibleDuplicateOf } = selectTasks(cleaned, (c) => c.draft);
        const total = kept.length;
        const idOf = (i: number) => (i === 0 ? id : siblingProposalId(id, i + 1));
        const fill = (p: Proposal, c: (typeof kept)[number], index: number): Proposal => {
          const twin = possibleDuplicateOf[index - 1];
          return {
            ...p,
            status: "ready",
            draft: c.draft,
            rawDraft: c.rawDraft,
            isActionable: c.task.isActionable,
            confidence: c.task.confidence,
            structuring: c.fallback ? "fallback" : "ok",
            quoteVerified: c.grounded.verified,
            replyBelowQuote: replyBelowQuote || undefined,
            modelReadPartOnly: truncated || undefined,
            part: total > 1 ? { index, total } : null,
            possibleDuplicateOf: twin == null ? null : idOf(twin),
            ai: {
              model: this.generator.model(),
              durationMs,
              attempts,
              error: null,
              adjustments: [
                ...c.adjustments,
                ...notes,
                ...(twin == null
                  ? []
                  : [
                      `Looks like "${kept[twin].draft.title}" from the same message, but is not identical: check it is not a duplicate.`,
                    ]),
              ],
            },
          };
        };
        if (total < 2) {
          await this.setStatus(id, ["structuring"], (p) => fill(p, kept[0], 1));
          return "done";
        }
        // Several tasks: write every extra card first, hidden ("splitting"), and
        // only then publish them all together with card 1, so a crash can never
        // leave "1 of 3" visible with its siblings missing. A leftover hidden
        // card is published (or rewritten) by start(). A sibling that is already
        // live or decided is never overwritten.
        const published = await this.store.withLock(async () => {
          const current = await this.store.getProposal(id);
          if (!current || current.status !== "structuring") return false;
          const stamp = () => new Date(this.now()).toISOString();
          const hidden: Proposal[] = [];
          for (let i = 1; i < total; i++) {
            const siblingId = idOf(i);
            const existing = await this.store.getProposal(siblingId);
            if (existing && existing.status !== "splitting") continue;
            const base: Proposal = {
              ...current,
              id: siblingId,
              edits: null,
              todoId: null,
              update: null,
            };
            const sibling: Proposal = {
              ...fill(base, kept[i], i + 1),
              status: "splitting",
              updatedAt: stamp(),
            };
            await this.store.putProposal(sibling);
            hidden.push(sibling);
          }
          // Hidden cards of an earlier, larger split of this message are closed.
          const wanted = new Set(Array.from({ length: total }, (_, i) => idOf(i)));
          for (const other of await this.store.listProposals()) {
            if (
              other.intakeId === current.intakeId &&
              other.status === "splitting" &&
              !wanted.has(other.id)
            ) {
              await this.store.putProposal({
                ...other,
                status: "rejected",
                updatedAt: stamp(),
              });
            }
          }
          await this.store.putProposal({
            ...fill(current, kept[0], 1),
            updatedAt: stamp(),
          });
          for (const sibling of hidden) {
            await this.store.putProposal({ ...sibling, status: "ready" });
          }
          return true;
        });
        if (published) await this.store.audit("split", { proposalId: id, tasks: total });
        return "done";
      },
    });
  }

  /** The shared call / classify / retry loop for both model tasks. */
  private async attempts<T>(job: {
    id: string;
    claimed: Proposal;
    bytes: number;
    promptVersion: number;
    /** Extra counts for the call log (numbers only, never prompt text). */
    logExtra?: Record<string, number>;
    task: "structure" | "update" | "update-signoff";
    call: () => Promise<T>;
    onOk: (
      output: T,
      durationMs: number,
      attempts: number,
    ) => Promise<"done" | "requeue">;
  }): Promise<"done" | "requeue"> {
    const { id, claimed } = job;
    let attempts = claimed.ai.attempts;
    let retriedTimeout = false;
    for (;;) {
      const started = this.now();
      let output: T;
      let durationMs: number;
      try {
        output = await job.call();
        durationMs = this.now() - started;
        attempts++;
        await this.store.logAiCall({
          intakeId: claimed.intakeId,
          model: this.generator.model(),
          bytes: job.bytes,
          promptVersion: job.promptVersion,
          ...job.logExtra,
          task: job.task,
          durationMs,
          outcome: "ok",
        });
        this.paused = null;
      } catch (error) {
        const failedAfter = this.now() - started;
        const { kind, message } = classify(error);
        await this.store.logAiCall({
          intakeId: claimed.intakeId,
          model: this.generator.model(),
          bytes: job.bytes,
          promptVersion: job.promptVersion,
          ...job.logExtra,
          task: job.task,
          durationMs: failedAfter,
          outcome: kind,
        });

        if (kind === "runtime-down" || kind === "model-missing") {
          // Not the message's fault: leave it pending (attempt not counted),
          // pause the queue and let the next scan try again.
          await this.setStatus(id, ["structuring"], (p) => ({
            ...p,
            status: "pending",
            ai: { ...p.ai, error: message },
          }));
          this.paused = {
            code: kind,
            message,
            since: new Date(this.now()).toISOString(),
          };
          this.halted = true;
          return "done";
        }

        attempts++;
        if (kind === "timeout" && !retriedTimeout && attempts < MAX_AI_ATTEMPTS) {
          retriedTimeout = true; // one automatic retry, then it is 'failed'
          continue;
        }
        await this.fail(id, attempts, message, failedAfter);
        return "done";
      }
      // The model answered. A failure from here on is ours (storage), not the
      // model's: no second log line, no attempt used, and a message that says so.
      try {
        return await job.onOk(output, durationMs, attempts);
      } catch (error) {
        console.error(`[pmo] saving the model's answer for ${id} failed:`, error);
        await this.fail(
          id,
          claimed.ai.attempts,
          `The model answered, but its answer could not be saved (${(error as Error).message}). Retry, or create the to-do by hand.`,
          durationMs,
        );
        return "done";
      }
    }
  }

  /** Drop the thread link: this becomes an ordinary to-do proposal, structured
   *  next (used when the model says "unrelated" or the matched to-do is gone). */
  private async toNormalProposal(id: string, why: string): Promise<void> {
    const next = await this.setStatus(id, ["structuring", "pending"], (p) => ({
      ...p,
      status: "pending",
      update: null,
      draft: null,
      rawDraft: null,
      isActionable: null,
      quoteVerified: null,
      structuring: undefined,
      ai: { model: null, durationMs: null, attempts: 0, error: null },
    }));
    if (next) await this.store.audit("update-separate", { proposalId: id, why });
  }

  private async fail(id: string, attempts: number, message: string, durationMs?: number) {
    await this.setStatus(id, ["structuring", "pending"], (p) => ({
      ...p,
      status: "failed",
      ai: {
        model: this.generator.model(),
        durationMs: durationMs ?? p.ai.durationMs,
        attempts,
        error: message,
      },
    }));
  }

  /** "Create as separate to-do instead": an update card becomes an ordinary
   *  proposal and goes through normal structuring. */
  async separate(id: string): Promise<{ ok: true } | { ok: false; reason: string }> {
    const current = await this.store.getProposal(id);
    if (!current?.update) {
      return { ok: false, reason: "That item is not an update to an existing to-do." };
    }
    if (current.status === "approved" || current.status === "rejected") {
      return { ok: false, reason: "That item has already been decided." };
    }
    if (current.status === "structuring") {
      return {
        ok: false,
        reason: "The model is still working on it. Try again in a moment.",
      };
    }
    const next = await this.setStatus(id, ["pending", "ready", "failed"], (p) => ({
      ...p,
      status: "pending",
      update: null,
      draft: null,
      rawDraft: null,
      isActionable: null,
      quoteVerified: null,
      structuring: undefined,
      ai: { model: null, durationMs: null, attempts: 0, error: null },
    }));
    if (!next) return { ok: false, reason: "That item changed. Try again." };
    await this.store.audit("update-separate", { proposalId: id, why: "chosen" });
    await this.kick();
    return { ok: true };
  }

  /** Back to the queue after the user clicks Retry. Returns false if the item
   *  isn't failed or has used up its attempts. */
  async retry(id: string): Promise<{ ok: true } | { ok: false; reason: string }> {
    const next = await this.setStatus(id, ["failed"], (p) =>
      p.ai.attempts >= MAX_AI_ATTEMPTS
        ? p
        : { ...p, status: "pending", ai: { ...p.ai, error: null } },
    );
    if (!next) return { ok: false, reason: "Only a failed item can be retried." };
    if (next.status !== "pending") {
      return {
        ok: false,
        reason: `The model has already tried ${MAX_AI_ATTEMPTS} times; create it manually from the original instead.`,
      };
    }
    await this.kick();
    return { ok: true };
  }
}
