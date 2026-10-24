// "Write highlights with AI" for the weekly report: asks the LOCAL model for a
// short narrative (highlights, risks, next week focus) from the report's own
// data, then verifies it (reportNarrative.ts) before anyone sees it. The result
// is text for a person to review and add to the report; this module (and the app)
// never sends it anywhere. Jobs live in memory, one per period: a drafting job is
// shared (a second click does not queue a second model call), a finished or
// failed one stays until replaced, and a restart simply forgets them (a failure
// is local and retryable).
//
// The model call goes through the same single-concurrency local runtime as
// structuring and chaser drafts, so it can wait behind them.
import {
  REPORT_PROMPT_VERSION,
  buildNarrativeFacts,
  buildNarrativeSystemPrompt,
  buildNarrativeUserPrompt,
  verifyNarrative,
  type Vocabulary,
} from "../reportNarrative.ts";
import { periodKey, type ReportData } from "../report.ts";
import { newId } from "../todoLogic.ts";
import type { ReportNarrativeJob } from "../types.ts";
import type { Store } from "./store.ts";
import { classify, type Generator } from "./structure.ts";

/** A finished job is dropped after this long (the data is stale by then). */
const KEEP_MS = 12 * 60 * 60 * 1000;

/** What the person sees when drafting fails. Local and retryable. */
export function narrativeFailureMessage(
  kind: ReturnType<typeof classify>["kind"],
  raw: string,
) {
  switch (kind) {
    case "runtime-down":
      return "The local model is not running. Start it (or wait a moment) and try again. The report itself is complete without it.";
    case "model-missing":
      return raw;
    case "timeout":
      return "The local model took too long to answer. Try again. The report itself is complete without it.";
    case "invalid-output":
      return "The local model did not return usable highlights. Try again. The report itself is complete without it.";
    default:
      return `Could not write the highlights: ${raw}`;
  }
}

export interface ReportDraftsOptions {
  store: Store;
  generator: Generator;
  now?: () => number;
}

export class ReportDrafts {
  private readonly store: Store;
  private readonly generator: Generator;
  private readonly now: () => number;
  private readonly jobs = new Map<string, ReportNarrativeJob>();
  private readonly pending = new Set<Promise<void>>();

  constructor(options: ReportDraftsOptions) {
    this.store = options.store;
    this.generator = options.generator;
    this.now = options.now ?? Date.now;
  }

  /** The job for a period (`<start>_<end>`), if there is a fresh one. */
  get(key: string): ReportNarrativeJob | null {
    const job = this.jobs.get(key);
    if (!job) return null;
    if (
      job.status !== "drafting" &&
      Date.parse(job.finishedAt ?? job.startedAt) < this.now() - KEEP_MS
    ) {
      this.jobs.delete(key);
      return null;
    }
    return job;
  }

  /** Starts drafting for this report's data and returns at once (the model call
   *  is NOT awaited); poll `get()`, or use `settled()` in tests. A drafting job
   *  for the same period is shared. */
  start(data: ReportData): ReportNarrativeJob {
    const key = periodKey(data.period);
    const existing = this.jobs.get(key);
    if (existing?.status === "drafting") return existing;

    const facts = buildNarrativeFacts(data);
    const system = buildNarrativeSystemPrompt();
    const prompt = buildNarrativeUserPrompt(facts);
    const job: ReportNarrativeJob = {
      id: newId("rn"),
      key,
      status: "drafting",
      startedAt: new Date(this.now()).toISOString(),
      finishedAt: null,
      narrative: null,
      removed: [],
      error: null,
      model: null,
      promptVersion: REPORT_PROMPT_VERSION,
    };
    this.jobs.set(key, job);
    const task: Promise<void> = this.run(job, system, prompt, facts.vocabulary).finally(
      () => this.pending.delete(task),
    );
    this.pending.add(task);
    return job;
  }

  /** Resolves when every draft in flight has finished (for tests). */
  async settled(): Promise<void> {
    while (this.pending.size > 0) await Promise.allSettled([...this.pending]);
  }

  private async run(
    job: ReportNarrativeJob,
    system: string,
    prompt: string,
    vocabulary: Vocabulary,
  ): Promise<void> {
    const started = this.now();
    const bytes = Buffer.byteLength(system) + Buffer.byteLength(prompt);
    const finish = (patch: Partial<ReportNarrativeJob>) => {
      // A newer job for the same period replaced this one: leave it alone.
      if (this.jobs.get(job.key)?.id !== job.id) return;
      this.jobs.set(job.key, {
        ...job,
        ...patch,
        finishedAt: new Date(this.now()).toISOString(),
      });
    };
    const log = (outcome: string) =>
      this.store.logAiCall({
        task: "report-narrative",
        period: job.key,
        model: this.generator.model(),
        bytes,
        promptVersion: REPORT_PROMPT_VERSION,
        durationMs: this.now() - started,
        outcome,
      });
    try {
      const answer = await this.generator.draftNarrative({ system, prompt });
      const verified = verifyNarrative(answer, vocabulary);
      await log("ok");
      finish({
        status: "ready",
        narrative: verified.narrative,
        removed: verified.removed,
        model: this.generator.model(),
      });
      await this.store.audit("report-narrative", {
        period: job.key,
        model: this.generator.model(),
        removedLines: verified.removed.length,
      });
    } catch (error) {
      const { kind, message } = classify(error);
      await log(kind);
      finish({
        status: "failed",
        error: narrativeFailureMessage(kind, message),
        model: this.generator.model(),
      });
    }
  }
}
