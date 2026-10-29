import type { SetupReport } from "@/lib/setup/report";
import type { InstallProgress } from "@/lib/setup/ollamaInstall";
import type { JobSnapshot } from "@/lib/setup/jobs";
import type { PullProgress } from "@/lib/setup/pull";

export interface SetupStatus {
  report: SetupReport;
  jobs: {
    install: JobSnapshot<InstallProgress>;
    pull: JobSnapshot<PullProgress>;
  };
}

export type SetupAction = {
  action:
    | "install-ollama"
    | "cancel-install"
    | "pull-model"
    | "pull-fallback-model"
    | "cancel-pull"
    | "run-selftest"
    | "create-folders";
};

const TIMEOUT_MS = 20_000;

/** The current report and job progress, or null when the server cannot say.
 *  `launch` is the passive check at app start; `true` re-reads the slow facts. */
export async function fetchSetupStatus(
  fresh: boolean | "launch" = false,
): Promise<SetupStatus | null> {
  try {
    const query = fresh === "launch" ? "?launch=1" : fresh ? "?fresh=1" : "";
    const res = await fetch(`/api/setup${query}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = (await res.json()) as { ok: boolean } & Partial<SetupStatus>;
    return body.ok && body.report && body.jobs
      ? { report: body.report, jobs: body.jobs }
      : null;
  } catch {
    return null;
  }
}

/** Starts an action; never throws. `ok: false` carries a sentence for the screen. */
export async function postSetupAction(
  action: SetupAction,
): Promise<{ ok: boolean; reason?: string }> {
  try {
    const res = await fetch("/api/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(action),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return (await res.json()) as { ok: boolean; reason?: string };
  } catch {
    return { ok: false, reason: "Could not reach AI OS. Try again in a moment." };
  }
}
