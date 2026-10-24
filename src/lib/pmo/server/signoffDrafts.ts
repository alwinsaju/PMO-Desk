// "Improve with AI" for a sign-off request: asks the LOCAL model for a short,
// professional request to the approver, as text for a person to review, edit and
// copy. The deterministic template (signoffRequest.ts) is what the dialog shows
// first and needs no model; this is the optional upgrade. THIS APP NEVER SENDS
// IT, and generating a draft changes nothing on the to-do: only "Mark as
// requested" (server/signoff.ts) does.
//
// Same shape as chaserDrafts.ts: jobs live in memory, one per to-do, a drafting
// job is shared (a second click does not queue a second model call), and the
// model call goes through the same single-concurrency local runtime queue.
import {
  cleanSignoffText,
  buildSignoffSystemPrompt,
  buildSignoffUserPrompt,
  defaultSignoffSubject,
  SIGNOFF_PROMPT_VERSION,
} from "../signoffRequest.ts";
import { prepareForModel } from "../preprocess.ts";
import { approverEmail } from "../signoff.ts";
import { addressForWaitingOn } from "../thread.ts";
import { newId } from "../todoLogic.ts";
import type { ChaserJob } from "../types.ts";
import { chaserFailureMessage } from "./chaserDrafts.ts";
import type { Store } from "./store.ts";
import { classify, type Generator } from "./structure.ts";

type StartResult = { ok: true; job: ChaserJob } | { ok: false; reason: string };

/** A finished job is dropped after this long (the draft is stale by then). */
const KEEP_MS = 12 * 60 * 60 * 1000;

export interface SignoffDraftsOptions {
  store: Store;
  generator: Generator;
  now?: () => number;
}

export class SignoffDrafts {
  private readonly store: Store;
  private readonly generator: Generator;
  private readonly now: () => number;
  private readonly jobs = new Map<string, ChaserJob>();
  private readonly pending = new Set<Promise<void>>();

  constructor(options: SignoffDraftsOptions) {
    this.store = options.store;
    this.generator = options.generator;
    this.now = options.now ?? Date.now;
  }

  /** The jobs worth showing, by to-do id (stale finished ones are dropped). */
  snapshot(): Record<string, ChaserJob> {
    const cutoff = this.now() - KEEP_MS;
    for (const [todoId, job] of this.jobs) {
      if (
        job.status !== "drafting" &&
        Date.parse(job.finishedAt ?? job.startedAt) < cutoff
      ) {
        this.jobs.delete(todoId);
      }
    }
    return Object.fromEntries(this.jobs);
  }

  discard(todoId: string): void {
    const job = this.jobs.get(todoId);
    // A drafting job is left to finish (it is already in the model's queue).
    if (job && job.status !== "drafting") this.jobs.delete(todoId);
  }

  /** Resolves once the drafting has begun (the model call is NOT awaited). */
  async start(todoId: string, approverInput: string | null): Promise<StartResult> {
    const todo = await this.store.getTodo(todoId);
    if (!todo) return { ok: false, reason: "That to-do no longer exists." };
    if (todo.status !== "open") {
      return { ok: false, reason: "Only an open to-do can be sent for sign-off." };
    }
    if (!todo.checkpoints.some((c) => c.kind === "approval")) {
      return { ok: false, reason: "This to-do has no sign-off step." };
    }
    const existing = this.jobs.get(todoId);
    if (existing?.status === "drafting") return { ok: true, job: existing };

    const config = await this.store.loadConfig();
    const nowDate = new Date(this.now());
    const saved = todo.checkpoints.find(
      (c) => c.kind === "approval" && c.signoff?.approver,
    )?.signoff?.approver;
    const approver = approverInput?.trim() || saved || null;
    const raw = todo.source.intakeId
      ? await this.store.readRaw(todo.source.intakeId)
      : null;
    const to =
      approverEmail(approver) ??
      (raw && approver
        ? addressForWaitingOn(
            approver,
            [raw.intake.sender, ...raw.intake.recipients],
            config.me.emails,
          )
        : null);

    const system = buildSignoffSystemPrompt(config.me);
    const prompt = buildSignoffUserPrompt({
      todo,
      approver,
      excerpt: raw ? prepareForModel(raw.intake) : null,
      nowIso: nowDate.toISOString(),
    });
    const job: ChaserJob = {
      id: newId("so"),
      todoId,
      status: "drafting",
      startedAt: nowDate.toISOString(),
      finishedAt: null,
      text: null,
      subject: defaultSignoffSubject(todo),
      to,
      error: null,
      model: null,
    };
    this.jobs.set(todoId, job);
    const task: Promise<void> = this.run(job, system, prompt, todo.title).finally(() =>
      this.pending.delete(task),
    );
    this.pending.add(task);
    return { ok: true, job };
  }

  /** Resolves when every draft in flight has finished (for tests). */
  async settled(): Promise<void> {
    while (this.pending.size > 0) await Promise.allSettled([...this.pending]);
  }

  private async run(
    job: ChaserJob,
    system: string,
    prompt: string,
    label: string,
  ): Promise<void> {
    const started = this.now();
    const bytes = Buffer.byteLength(system) + Buffer.byteLength(prompt);
    const finish = (patch: Partial<ChaserJob>) => {
      // A newer job for the same to-do replaced this one: leave it alone.
      if (this.jobs.get(job.todoId)?.id !== job.id) return;
      this.jobs.set(job.todoId, {
        ...job,
        ...patch,
        finishedAt: new Date(this.now()).toISOString(),
      });
    };
    try {
      const reply = await this.generator.draftSignoffRequest({ system, prompt, label });
      const cleaned = cleanSignoffText(reply);
      if (!cleaned.text) {
        const error = new Error("The model returned an empty draft.");
        error.name = "AiRuntimeError";
        (error as Error & { code: string }).code = "invalid-output";
        throw error;
      }
      await this.store.logAiCall({
        task: "signoff-request",
        todoId: job.todoId,
        model: this.generator.model(),
        bytes,
        promptVersion: SIGNOFF_PROMPT_VERSION,
        durationMs: this.now() - started,
        outcome: "ok",
      });
      finish({
        status: "ready",
        text: cleaned.text,
        subject: cleaned.subject ?? job.subject,
        model: this.generator.model(),
      });
    } catch (error) {
      const { kind, message } = classify(error);
      await this.store.logAiCall({
        task: "signoff-request",
        todoId: job.todoId,
        model: this.generator.model(),
        bytes,
        promptVersion: SIGNOFF_PROMPT_VERSION,
        durationMs: this.now() - started,
        outcome: kind,
      });
      finish({
        status: "failed",
        error: chaserFailureMessage(kind, message),
        model: this.generator.model(),
      });
    }
  }
}
