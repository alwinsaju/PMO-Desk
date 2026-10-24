// Turns pending proposals into drafts by running each message through the
// local model, one at a time. The model call is injected (`Generator`) so
// tests and the PMO_AI_STUB switch never need Ollama; the real one is wired
// in service.ts. Failures here are local state only: nothing is sent anywhere.
import { prepareForModel, displayText } from "../preprocess.ts";
import { groundQuote } from "../quote.ts";
import { PROMPT_VERSION, buildSystemPrompt, buildUserPrompt } from "../structurePrompt.ts";
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
import type { Store } from "./store.ts";

export interface ModelRequest {
  system: string;
  prompt: string;
}

export interface Generator {
  /** Name of the model that answers (for the log and the review UI). */
  model(): string;
  /** Message -> to-do proposal. */
  generate(request: ModelRequest): Promise<AiStructured>;
  /** New message + existing to-do -> what changed (thread-aware intake). */
  generateUpdate(request: ModelRequest): Promise<AiUpdate>;
  /** A follow-up message to review and copy. Plain text, untrusted. */
  draftChaser(request: ModelRequest): Promise<string>;
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
      for (const proposal of await this.store.listProposals()) {
        if (proposal.status === "structuring") {
          await this.store.putProposal({ ...proposal, status: "pending" });
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
    const bodyText = prepareForModel(intake);

    // Thread-aware branch: the message belongs to an open to-do.
    if (claimed.update) {
      const todo = await this.store.getTodo(claimed.update.todoId);
      if (!todo || todo.status !== "open") {
        // The to-do closed or went away since ingest: an ordinary proposal.
        await this.toNormalProposal(id, "to-do no longer open");
        return "requeue";
      }
      const system = buildUpdateSystemPrompt(config.me);
      const prompt = buildUpdateUserPrompt(todo, intake, bodyText);
      return this.attempts<AiUpdate>({
        id,
        claimed,
        bytes: Buffer.byteLength(system) + Buffer.byteLength(prompt),
        promptVersion: UPDATE_PROMPT_VERSION,
        task: "update",
        call: () => this.generator.generateUpdate({ system, prompt }),
        onOk: async (output, durationMs, attempts) => {
          if (output.kind === "unrelated") {
            await this.toNormalProposal(id, "the model says it is about something else");
            return "requeue";
          }
          const grounded = groundQuote(displayText(intake), output.quote);
          await this.setStatus(id, ["structuring"], (p) => ({
            ...p,
            status: "ready",
            update: p.update
              ? { ...p.update, result: { ...output, quote: grounded.quote } }
              : p.update,
            isActionable: output.kind !== "nothing",
            quoteVerified: grounded.verified,
            ai: { model: this.generator.model(), durationMs, attempts, error: null },
          }));
          return "done";
        },
      });
    }

    const system = buildSystemPrompt(config.me);
    const prompt = buildUserPrompt(intake, bodyText);
    return this.attempts<AiStructured>({
      id,
      claimed,
      bytes: Buffer.byteLength(system) + Buffer.byteLength(prompt),
      promptVersion: PROMPT_VERSION,
      task: "structure",
      call: () => this.generator.generate({ system, prompt }),
      onOk: async (output, durationMs, attempts) => {
        // Keep only the part of the quote that is really in the message.
        const grounded = groundQuote(displayText(intake), output.quote);
        const draft = { ...output, quote: grounded.quote };
        await this.setStatus(id, ["structuring"], (p) => ({
          ...p,
          status: "ready",
          draft,
          isActionable: output.isActionable,
          confidence: output.confidence,
          quoteVerified: grounded.verified,
          ai: { model: this.generator.model(), durationMs, attempts, error: null },
        }));
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
    task: "structure" | "update";
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
      try {
        const output = await job.call();
        const durationMs = this.now() - started;
        attempts++;
        await this.store.logAiCall({
          intakeId: claimed.intakeId,
          model: this.generator.model(),
          bytes: job.bytes,
          promptVersion: job.promptVersion,
          task: job.task,
          durationMs,
          outcome: "ok",
        });
        this.paused = null;
        return await job.onOk(output, durationMs, attempts);
      } catch (error) {
        const durationMs = this.now() - started;
        const { kind, message } = classify(error);
        await this.store.logAiCall({
          intakeId: claimed.intakeId,
          model: this.generator.model(),
          bytes: job.bytes,
          promptVersion: job.promptVersion,
          task: job.task,
          durationMs,
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
        await this.fail(id, attempts, message, durationMs);
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
      isActionable: null,
      quoteVerified: null,
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
      isActionable: null,
      quoteVerified: null,
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
