// Pulls a model through Ollama's own API (POST /api/pull), with progress,
// retry and resume. Ollama keeps the partial files of an interrupted pull, so
// asking again continues where it stopped; this module just asks again, a few
// times, with a pause. Everything outside is injected (fetch, clock, sleep), so
// tests drive it with a fake server and no network.

export type PullPhase =
  "preparing" | "downloading" | "verifying" | "done" | "error" | "cancelled";

export interface PullProgress {
  phase: PullPhase;
  model: string;
  /** 0-100 while sizes are known, else null. */
  percent: number | null;
  completedBytes: number;
  totalBytes: number;
  bytesPerSecond: number | null;
  etaSeconds: number | null;
  /** Plain-language line for the screen. */
  message: string;
  /** 1-based attempt number (a retry after a dropped connection is attempt 2). */
  attempt: number;
  error?: string;
}

interface PullEvent {
  status?: string;
  digest?: string;
  total?: number;
  completed?: number;
  error?: string;
}

export function parsePullLine(line: string): PullEvent | null {
  const text = line.trim();
  if (!text) return null;
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as PullEvent)
      : null;
  } catch {
    return null;
  }
}

/** Folds the stream of events into one progress value. Layers (blobs) announce
 *  their own totals as they start, so the overall total grows during the first
 *  moments and the percentage can step back a little; it never exceeds 100. */
export class PullTracker {
  private layers = new Map<string, { total: number; completed: number }>();
  private startedAt: number;
  private sample: { at: number; bytes: number } | null = null;
  private speed: number | null = null;
  private phase: PullPhase = "preparing";
  private message = "Contacting the model library…";
  private readonly model: string;
  private readonly now: () => number;
  private attempt: number;

  constructor(model: string, now: () => number, attempt = 1) {
    this.model = model;
    this.now = now;
    this.attempt = attempt;
    this.startedAt = now();
  }

  setAttempt(attempt: number) {
    this.attempt = attempt;
  }

  update(event: PullEvent): PullProgress {
    const status = (event.status ?? "").toLowerCase();
    if (event.digest && typeof event.total === "number" && event.total > 0) {
      const completed = Math.min(event.completed ?? 0, event.total);
      this.layers.set(event.digest, { total: event.total, completed });
      this.phase = "downloading";
      this.message = "Downloading the model…";
      this.measure();
    } else if (status.includes("verifying")) {
      this.phase = "verifying";
      this.message = "Checking the download…";
    } else if (status.includes("writing manifest") || status.includes("removing")) {
      this.phase = "verifying";
      this.message = "Finishing up…";
    } else if (status === "success") {
      this.phase = "done";
      this.message = "The model is ready.";
    } else if (status.includes("manifest")) {
      this.phase = "preparing";
      this.message = "Contacting the model library…";
    }
    return this.snapshot();
  }

  private measure() {
    const { completed } = this.totals();
    const at = this.now();
    if (this.sample && at > this.sample.at) {
      const rate = ((completed - this.sample.bytes) / (at - this.sample.at)) * 1000;
      if (rate >= 0)
        this.speed = this.speed === null ? rate : this.speed * 0.8 + rate * 0.2;
    }
    if (!this.sample || at - this.sample.at >= 1000)
      this.sample = { at, bytes: completed };
  }

  private totals() {
    let total = 0;
    let completed = 0;
    for (const layer of this.layers.values()) {
      total += layer.total;
      completed += layer.completed;
    }
    return { total, completed };
  }

  snapshot(): PullProgress {
    const { total, completed } = this.totals();
    const percent =
      total > 0 ? Math.min(100, Math.floor((completed / total) * 1000) / 10) : null;
    const eta =
      this.speed && this.speed > 0 && total > completed
        ? Math.round((total - completed) / this.speed)
        : null;
    return {
      phase: this.phase,
      model: this.model,
      percent: this.phase === "done" ? 100 : percent,
      completedBytes: completed,
      totalBytes: total,
      bytesPerSecond: this.speed === null ? null : Math.round(this.speed),
      etaSeconds: this.phase === "downloading" ? eta : null,
      message: this.message,
      attempt: this.attempt,
    };
  }

  elapsedMs(): number {
    return this.now() - this.startedAt;
  }
}

export interface PullDeps {
  fetchImpl: typeof fetch;
  baseUrl: string;
  model: string;
  signal?: AbortSignal;
  onProgress: (progress: PullProgress) => void;
  /** Make sure the Ollama server answers (start it if allowed). */
  ensureServer: () => Promise<boolean>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  maxAttempts?: number;
  /** Pause before attempt 2, 3, ...; the last entry repeats. */
  backoffMs?: number[];
}

export type PullOutcome =
  { ok: true } | { ok: false; cancelled: boolean; message: string };

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Errors a retry cannot fix. */
function isPermanent(message: string): boolean {
  return /not found|does not exist|file does not exist|invalid model|unauthorized|no space left|disk is full/i.test(
    message,
  );
}

function friendly(message: string): string {
  if (/no space left|disk is full/i.test(message)) {
    return "The disk filled up while downloading. Free up space and try again.";
  }
  if (/not found|does not exist/i.test(message)) {
    return "The model library does not have that model.";
  }
  return message;
}

class PullFailure extends Error {
  readonly permanent: boolean;

  constructor(message: string, permanent: boolean) {
    super(message);
    this.permanent = permanent;
  }
}

async function runOnce(deps: PullDeps, tracker: PullTracker): Promise<void> {
  const { fetchImpl, baseUrl, model, signal, onProgress } = deps;
  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, stream: true }),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new PullFailure("Could not reach the local AI service.", false);
  }
  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    throw new PullFailure(
      text.trim() ||
        `The local AI service refused the download (HTTP ${response.status}).`,
      isPermanent(text),
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let succeeded = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const event = parsePullLine(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        if (!event) continue;
        if (event.error) throw new PullFailure(event.error, isPermanent(event.error));
        const progress = tracker.update(event);
        if (progress.phase === "done") succeeded = true;
        onProgress(progress);
      }
    }
    const last = parsePullLine(buffer);
    if (last?.error) throw new PullFailure(last.error, isPermanent(last.error));
    if (last && tracker.update(last).phase === "done") succeeded = true;
  } catch (error) {
    if (error instanceof PullFailure) throw error;
    if (signal?.aborted) throw error;
    throw new PullFailure("The download was interrupted.", false);
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // a read was still pending after an abort; the stream is dropped anyway
    }
  }
  if (!succeeded)
    throw new PullFailure("The download ended before the model was complete.", false);
}

export async function pullModel(deps: PullDeps): Promise<PullOutcome> {
  const {
    model,
    signal,
    onProgress,
    sleep = defaultSleep,
    now = Date.now,
    maxAttempts = 5,
    backoffMs = [2_000, 5_000, 15_000],
  } = deps;
  const tracker = new PullTracker(model, now);
  const report = (partial: Partial<PullProgress>) =>
    onProgress({ ...tracker.snapshot(), ...partial });

  report({ phase: "preparing", message: "Starting the local AI service…" });
  if (!(await deps.ensureServer())) {
    const message =
      "The local AI service (Ollama) could not be started. Check that Ollama is installed, then try again.";
    report({ phase: "error", message, error: message });
    return { ok: false, cancelled: false, message };
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    tracker.setAttempt(attempt);
    if (signal?.aborted) break;
    try {
      await runOnce(deps, tracker);
      return { ok: true };
    } catch (error) {
      if (signal?.aborted) break;
      const failure =
        error instanceof PullFailure ? error : new PullFailure(String(error), false);
      if (failure.permanent || attempt === maxAttempts) {
        const message = friendly(failure.message);
        report({ phase: "error", message, error: message });
        return { ok: false, cancelled: false, message };
      }
      const wait = backoffMs[Math.min(attempt - 1, backoffMs.length - 1)] ?? 0;
      report({
        phase: "preparing",
        attempt: attempt + 1,
        message: `${failure.message} Trying again in ${Math.ceil(wait / 1000)} seconds (the download continues where it stopped)…`,
      });
      await sleep(wait);
    }
  }
  report({
    phase: "cancelled",
    message:
      "The download was cancelled. Partial files are kept, so it resumes next time.",
  });
  return { ok: false, cancelled: true, message: "cancelled" };
}
