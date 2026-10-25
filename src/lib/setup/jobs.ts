// One background job per kind (Ollama install, model download, self-test), kept
// in memory for the life of the server so the setup screen can start one, close,
// reopen and still see where it is. A second start while one runs just returns
// the running one.

export type JobKind = "install-ollama" | "pull-model" | "selftest";

export interface JobSnapshot<P> {
  running: boolean;
  /** The latest progress the job reported; null before the first start. */
  progress: P | null;
  startedAt: number | null;
}

export class Job<P> {
  private progress: P | null = null;
  private controller: AbortController | null = null;
  private startedAt: number | null = null;
  private current: Promise<void> | null = null;
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  get running(): boolean {
    return this.current !== null;
  }

  snapshot(): JobSnapshot<P> {
    return { running: this.running, progress: this.progress, startedAt: this.startedAt };
  }

  /** Starts `run` unless one is already running. Resolves when it finishes. */
  start(
    run: (update: (progress: P) => void, signal: AbortSignal) => Promise<void>,
  ): Promise<void> {
    if (this.current) return this.current;
    const controller = new AbortController();
    this.controller = controller;
    this.startedAt = this.now();
    this.progress = null;
    const finished = (async () => {
      try {
        await run((progress) => {
          this.progress = progress;
        }, controller.signal);
      } finally {
        this.current = null;
        this.controller = null;
      }
    })();
    this.current = finished;
    return finished;
  }

  cancel(): boolean {
    if (!this.controller) return false;
    this.controller.abort();
    return true;
  }
}

export class JobRegistry {
  private jobs = new Map<JobKind, Job<unknown>>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  job<P>(kind: JobKind): Job<P> {
    let job = this.jobs.get(kind);
    if (!job) {
      job = new Job<unknown>(this.now);
      this.jobs.set(kind, job);
    }
    return job as Job<P>;
  }
}
