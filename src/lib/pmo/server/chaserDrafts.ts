// "Draft a chaser": asks the LOCAL model for a short follow-up to the person a
// to-do is waiting on. The result is text for a human to review, edit and copy;
// this module (and the app) never sends it anywhere. Jobs live in memory, one
// per to-do: a drafting job is shared (a second click does not queue a second
// model call), a finished or failed one stays until replaced or discarded, and
// a restart simply forgets them (a failure is local and retryable).
//
// The model call goes through the same single-concurrency local runtime as
// structuring, so a draft can wait behind a message that is being read.
import { istStamp } from "../time.ts";
import {
  CHASER_PROMPT_VERSION,
  buildChaserSystemPrompt,
  buildChaserUserPrompt,
  cleanChaserText,
  defaultChaserSubject,
} from "../chaser.ts";
import { waitingState } from "../due.ts";
import { prepareForModel } from "../preprocess.ts";
import { addressForWaitingOn } from "../thread.ts";
import { appendHistory, historyEntry, newId } from "../todoLogic.ts";
import type { ChaserJob } from "../types.ts";
import type { Store } from "./store.ts";
import { classify, type Generator } from "./structure.ts";

type StartResult = { ok: true; job: ChaserJob } | { ok: false; reason: string };

/** A finished job is dropped after this long (the draft is stale by then). */
const KEEP_MS = 12 * 60 * 60 * 1000;

/** What the person sees when a draft fails. Local and retryable. */
export function chaserFailureMessage(kind: ReturnType<typeof classify>["kind"], raw: string) {
  switch (kind) {
    case "runtime-down":
      return "The local model is not running. Start it (or wait a moment) and try again.";
    case "model-missing":
      return raw;
    case "timeout":
      return "The local model took too long to answer. Try again.";
    case "invalid-output":
      return "The local model did not return a usable draft. Try again.";
    default:
      return `Could not draft a message: ${raw}`;
  }
}

export interface ChaserDraftsOptions {
  store: Store;
  generator: Generator;
  now?: () => number;
}

export class ChaserDrafts {
  private readonly store: Store;
  private readonly generator: Generator;
  private readonly now: () => number;
  private readonly jobs = new Map<string, ChaserJob>();
  private readonly pending = new Set<Promise<void>>();

  constructor(options: ChaserDraftsOptions) {
    this.store = options.store;
    this.generator = options.generator;
    this.now = options.now ?? Date.now;
  }

  /** The jobs worth showing, by to-do id (stale finished ones are dropped). */
  snapshot(): Record<string, ChaserJob> {
    const cutoff = this.now() - KEEP_MS;
    for (const [todoId, job] of this.jobs) {
      if (job.status !== "drafting" && Date.parse(job.finishedAt ?? job.startedAt) < cutoff) {
        this.jobs.delete(todoId);
      }
    }
    return Object.fromEntries(this.jobs);
  }

  discard(todoId: string): void {
    const job = this.jobs.get(todoId);
    // A drafting job is left to finish (it is already in the model's queue);
    // dropping it here would only hide the result.
    if (job && job.status !== "drafting") this.jobs.delete(todoId);
  }

  /** Resolves once the drafting has begun (the model call is NOT awaited);
   *  poll the state, or use `settled()` in tests. */
  async start(todoId: string): Promise<StartResult> {
    const todo = await this.store.getTodo(todoId);
    if (!todo) return { ok: false, reason: "That to-do no longer exists." };
    if (todo.status !== "open") {
      return { ok: false, reason: "Only an open to-do can be chased." };
    }
    const waitingOn = todo.waitingOn?.trim();
    if (!waitingOn) {
      return {
        ok: false,
        reason: "Mark the to-do as waiting on someone first, then draft the chaser.",
      };
    }
    const existing = this.jobs.get(todoId);
    if (existing?.status === "drafting") return { ok: true, job: existing };

    const config = await this.store.loadConfig();
    const nowDate = new Date(this.now());
    const waited = waitingState(todo, nowDate, config.reminders);
    const raw = todo.source.intakeId ? await this.store.readRaw(todo.source.intakeId) : null;
    const to = raw
      ? addressForWaitingOn(
          waitingOn,
          [raw.intake.sender, ...raw.intake.recipients],
          config.me.emails,
        )
      : null;

    const system = buildChaserSystemPrompt(config.me);
    const prompt = buildChaserUserPrompt({
      todo,
      excerpt: raw ? prepareForModel(raw.intake) : null,
      waitedCalendarDays: waited?.calendarDays ?? 0,
      waitedQuietDays: waited?.quietDays ?? 0,
      sinceStamp: istStamp(todo.waitingSince ?? todo.updatedAt),
      nowIso: nowDate.toISOString(),
      recipient: to,
    });

    const job: ChaserJob = {
      id: newId("ch"),
      todoId,
      status: "drafting",
      startedAt: nowDate.toISOString(),
      finishedAt: null,
      text: null,
      subject: defaultChaserSubject(todo),
      to,
      error: null,
      model: null,
    };
    this.jobs.set(todoId, job);
    const task: Promise<void> = this.run(
      job,
      system,
      prompt,
      waitingOn,
      todo.title,
    ).finally(() => this.pending.delete(task));
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
    waitingOn: string,
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
      const reply = await this.generator.draftChaser({ system, prompt, label });
      const cleaned = cleanChaserText(reply);
      if (!cleaned.text) {
        const error = new Error("The model returned an empty draft.");
        error.name = "AiRuntimeError";
        (error as Error & { code: string }).code = "invalid-output";
        throw error;
      }
      await this.store.logAiCall({
        task: "chaser",
        todoId: job.todoId,
        model: this.generator.model(),
        bytes,
        promptVersion: CHASER_PROMPT_VERSION,
        durationMs: this.now() - started,
        outcome: "ok",
      });
      finish({
        status: "ready",
        text: cleaned.text,
        subject: cleaned.subject ?? job.subject,
        model: this.generator.model(),
      });
      await this.noteInHistory(job.todoId, waitingOn);
    } catch (error) {
      const { kind, message } = classify(error);
      await this.store.logAiCall({
        task: "chaser",
        todoId: job.todoId,
        model: this.generator.model(),
        bytes,
        promptVersion: CHASER_PROMPT_VERSION,
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

  /** One timeline line, without touching `updatedAt` (a legacy to-do's chaser
   *  clock runs from it). Never stores the draft itself. */
  private async noteInHistory(todoId: string, waitingOn: string): Promise<void> {
    try {
      await this.store.withLock(async () => {
        const todo = await this.store.getTodo(todoId);
        if (!todo) return;
        await this.store.putTodo({
          ...todo,
          history: appendHistory(
            todo.history,
            historyEntry(
              "chaser",
              `Drafted a chaser to ${waitingOn} (a draft to copy; this app does not send it).`,
              new Date(this.now()).toISOString(),
            ),
          ),
        });
      });
      await this.store.audit("chaser-draft", { todoId });
    } catch {
      // The draft is already shown; a missing timeline line is not worth failing.
    }
  }
}
