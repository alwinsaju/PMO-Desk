"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckCircleIcon,
  CircleNotchIcon,
  QuestionIcon,
  WarningCircleIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Progress,
} from "@/components/ui";
import type { SetupActionId, SetupCheck } from "@/lib/setup/report";
import { FALLBACK_MODEL, downloadSizeText } from "@/lib/setup/models";
import { fetchSetupStatus, postSetupAction, type SetupStatus } from "./setupApi";
import { useSetupUi } from "./setupStore";
import { useFirstTimeUi } from "./firstTimeStore";
import {
  SKIP_STORAGE_KEY,
  pullDetail,
  shouldAutoOpen,
  skipSignature,
  stateLabel,
  stateTone,
} from "./setupView";

const POLL_BUSY_MS = 1_200;
const POLL_IDLE_MS = 6_000;
const UNLOCK_KEY = "ai-os:unlocked";

function readStorage(storage: "local" | "session", key: string): string | null {
  try {
    return (storage === "local" ? localStorage : sessionStorage).getItem(key);
  } catch {
    return null;
  }
}

function writeSkip(signature: string) {
  try {
    localStorage.setItem(SKIP_STORAGE_KEY, signature);
  } catch {
    // Storage blocked: the screen simply opens again next launch.
  }
}

/**
 * First-run setup: a plain-language report of what this computer has and what
 * is missing (the local AI, its model, the OneDrive folders, classic Outlook,
 * the Tasks engine), with a button for each thing that can be fixed from here.
 * It opens by itself at launch while something required is missing (unless the
 * person chose "Not now" for exactly that list) and from Settings at any time.
 * The Outlook check only reads; nothing here opens a mailbox or sends anything.
 */
export function FirstRunSetup() {
  const open = useSetupUi((s) => s.open);
  const openSetup = useSetupUi((s) => s.openSetup);
  const openGuides = useFirstTimeUi((s) => s.openGuides);
  const closeSetup = useSetupUi((s) => s.closeSetup);
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const selfTestRequested = useRef(false);

  const refresh = useCallback(async (fresh = false) => {
    const next = await fetchSetupStatus(fresh);
    setLoadFailed(next === null);
    if (next) setStatus(next);
    return next;
  }, []);

  // Launch check: wait for the lock screen to go, look once, open if needed.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      while (!cancelled && readStorage("session", UNLOCK_KEY) !== "true") {
        await new Promise((resolve) => setTimeout(resolve, 600));
      }
      if (cancelled) return;
      let next = await fetchSetupStatus("launch");
      // The engine self-test is part of "required"; run it before judging.
      if (
        next?.report.checks.some(
          (c) =>
            c.id === "engine" &&
            c.actions.includes("run-selftest") &&
            c.state === "unknown",
        )
      ) {
        selfTestRequested.current = true;
        await postSetupAction({ action: "run-selftest" });
        for (let i = 0; i < 90 && !cancelled; i++) {
          await new Promise((resolve) => setTimeout(resolve, 1_000));
          next = await fetchSetupStatus("launch");
          const engine = next?.report.checks.find((c) => c.id === "engine");
          if (engine && engine.summary !== "Running the self-test…") break;
        }
      }
      if (cancelled || !next) return;
      setStatus(next);
      // On a fresh install the first-time page does the whole health check itself.
      const firstTime = await fetch("/api/setup/first-time", { cache: "no-store" })
        .then((r) => r.json() as Promise<{ pending?: boolean }>)
        .catch(() => ({ pending: false }));
      if (cancelled || firstTime.pending) return;
      if (shouldAutoOpen(next.report, readStorage("local", SKIP_STORAGE_KEY)))
        openSetup();
    })();
    return () => {
      cancelled = true;
    };
  }, [openSetup]);

  // While open: keep the report and the job progress current.
  useEffect(() => {
    if (!open) {
      selfTestRequested.current = false;
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let first = true;
    const tick = async () => {
      // Opening Setup is when the slow Outlook check runs; later polls reuse it.
      const next = await refresh(first);
      first = false;
      if (cancelled) return;
      const busy =
        next?.jobs.install.running ||
        next?.jobs.pull.running ||
        next?.report.checks.some((c) => c.summary === "Running the self-test…");
      timer = setTimeout(tick, busy ? POLL_BUSY_MS : POLL_IDLE_MS);
    };
    void tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, refresh]);

  // The self-test is quick and unattended: run it the first time the screen shows it as not run.
  useEffect(() => {
    if (!open || selfTestRequested.current || !status) return;
    const engine = status.report.checks.find((c) => c.id === "engine");
    if (engine?.state === "unknown" && engine.actions.includes("run-selftest")) {
      selfTestRequested.current = true;
      void postSetupAction({ action: "run-selftest" }).then(() => refresh());
    }
  }, [open, status, refresh]);

  const run = useCallback(
    async (action: Parameters<typeof postSetupAction>[0]) => {
      setNotice(null);
      const result = await postSetupAction(action);
      if (!result.ok) setNotice(result.reason ?? "That did not work.");
      await refresh();
    },
    [refresh],
  );

  const report = status?.report;
  const notNow = () => {
    if (report) writeSkip(skipSignature(report));
    closeSetup();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) =>
        next ? openSetup() : report && !report.ready ? notNow() : closeSetup()
      }
    >
      <DialogContent
        className="max-h-[88vh] max-w-2xl overflow-y-auto"
        aria-describedby="setup-intro"
      >
        <DialogTitle>
          {report?.ready ? "PMO Desk is ready" : "Set up PMO Desk"}
        </DialogTitle>
        <DialogDescription id="setup-intro">
          A quick check that this computer has what PMO Desk needs. Nothing about your
          work leaves the computer; the only downloads are Ollama and the AI model, from
          their own websites.
        </DialogDescription>

        {!report && (
          <p
            className="text-ink-muted mt-6 flex items-center gap-2 text-sm"
            role="status"
          >
            {loadFailed ? (
              "Could not check this computer yet. Press Check again."
            ) : (
              <>
                <CircleNotchIcon size={16} className="animate-spin" aria-hidden />{" "}
                Checking this computer…
              </>
            )}
          </p>
        )}

        {report && (
          <ul className="mt-5 flex flex-col gap-3" aria-label="Setup checks">
            {report.checks.map((check) => (
              <CheckCard
                key={check.id}
                check={check}
                status={status}
                busyWith={
                  status?.jobs.install.running
                    ? "install"
                    : status?.jobs.pull.running
                      ? "pull"
                      : null
                }
                onAction={run}
              />
            ))}
          </ul>
        )}

        {notice && (
          <p
            className="text-red bg-red-soft rounded-control mt-4 px-3.5 py-2.5 text-[13px]"
            role="alert"
          >
            {notice}
          </p>
        )}

        {/* -bottom-7 cancels the dialog's p-7: a sticky offset is measured from the
            padding edge, so `bottom-0` left a 28px strip of cards showing below it. */}
        <div className="bg-surface border-line sticky -bottom-7 z-10 -mx-7 mt-6 -mb-7 flex items-center justify-between gap-3 border-t px-7 py-4">
          <div className="flex items-center gap-1">
            <Button variant="ghost" onClick={() => void refresh(true)}>
              Check again
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                closeSetup();
                openGuides();
              }}
            >
              Power Automate guides
            </Button>
          </div>
          <div className="flex items-center gap-2">
            {report && !report.ready && (
              <Button variant="outline" onClick={notNow}>
                Not now
              </Button>
            )}
            <Button onClick={closeSetup}>{report?.ready ? "Done" : "Close"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const ACTION_LABEL: Record<SetupActionId, string> = {
  "install-ollama": "Install Ollama",
  "pull-model": "Download model",
  "pull-fallback-model": `Download the smaller model (${downloadSizeText(FALLBACK_MODEL)})`,
  "create-folders": "Create the folders",
  "run-selftest": "Run self-test again",
};

function StateGlyph({ state }: { state: SetupCheck["state"] }) {
  const common = { size: 22, weight: "fill" as const, "aria-hidden": true };
  if (state === "ok") return <CheckCircleIcon {...common} className="text-success" />;
  if (state === "attention")
    return <WarningCircleIcon {...common} className="text-amber" />;
  if (state === "missing") return <XCircleIcon {...common} className="text-red" />;
  return <QuestionIcon {...common} className="text-ink-muted" />;
}

function CheckCard({
  check,
  status,
  busyWith,
  onAction,
}: {
  check: SetupCheck;
  status: SetupStatus | null;
  busyWith: "install" | "pull" | null;
  onAction: (action: Parameters<typeof postSetupAction>[0]) => Promise<void>;
}) {
  const install = status?.jobs.install;
  const pull = status?.jobs.pull;
  const showInstall =
    check.id === "ollama" &&
    install?.progress &&
    (install.running || install.progress.phase === "error");
  const showPull =
    check.id === "model" &&
    pull?.progress &&
    (pull.running ||
      pull.progress.phase === "error" ||
      pull.progress.phase === "cancelled");

  return (
    <li
      className="rounded-card border-line bg-card flex gap-3 border px-4 py-3.5"
      aria-label={check.title}
    >
      <div className="pt-0.5">
        <StateGlyph state={check.state} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-ink text-[15px] font-semibold">{check.title}</h3>
          <Badge variant={stateTone(check.state)} dot>
            {stateLabel(check.state)}
          </Badge>
          {!check.required && <span className="text-ink-faint text-xs">optional</span>}
        </div>
        <p className="text-ink-soft mt-1 text-[13.5px]">{check.summary}</p>

        {check.steps.length > 0 && (
          <ol className="text-ink-muted mt-2 list-decimal space-y-1 pl-5 text-[13px]">
            {check.steps.map((step, index) => (
              <li key={index}>{step}</li>
            ))}
          </ol>
        )}

        {showInstall && install?.progress && (
          <JobBlock
            running={install.running}
            label={install.progress.message}
            percent={install.progress.percent}
            error={install.progress.error}
            manualSteps={install.progress.manualSteps}
            onCancel={() => onAction({ action: "cancel-install" })}
          />
        )}
        {showPull && pull?.progress && (
          <JobBlock
            running={pull.running}
            label={pull.progress.message}
            percent={pull.progress.percent}
            detail={pull.progress.totalBytes > 0 ? pullDetail(pull.progress) : undefined}
            error={pull.progress.error}
            note={
              pull.progress.attempt > 1 ? `Attempt ${pull.progress.attempt}` : undefined
            }
            onCancel={() => onAction({ action: "cancel-pull" })}
          />
        )}

        {check.actions.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {check.actions.map((action, index) => (
              <Button
                key={action}
                size="sm"
                variant={index === 0 && check.state !== "ok" ? "solid" : "outline"}
                disabled={
                  (action === "install-ollama" && busyWith === "install") ||
                  ((action === "pull-model" || action === "pull-fallback-model") &&
                    busyWith === "pull") ||
                  (action === "run-selftest" &&
                    check.summary === "Running the self-test…")
                }
                onClick={() =>
                  void onAction({ action } as Parameters<typeof postSetupAction>[0])
                }
              >
                {ACTION_LABEL[action]}
              </Button>
            ))}
          </div>
        )}

        {check.details.length > 0 && (
          <details className="mt-2.5">
            <summary className="text-ink-muted cursor-pointer text-xs select-none">
              Details
            </summary>
            <ul className="text-ink-muted mt-1.5 space-y-0.5 font-mono text-[11.5px] break-words">
              {check.details.map((detail, index) => (
                <li key={index}>{detail}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </li>
  );
}

function JobBlock({
  running,
  label,
  percent,
  detail,
  note,
  error,
  manualSteps,
  onCancel,
}: {
  running: boolean;
  label: string;
  percent: number | null;
  detail?: string;
  note?: string;
  error?: string;
  manualSteps?: string[];
  onCancel: () => void;
}) {
  return (
    <div className="mt-3 flex flex-col gap-2" aria-live="polite">
      {running && (
        <>
          <Progress
            value={percent ?? 0}
            state={error ? "err" : "run"}
            label={label}
            showPercent={percent !== null}
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-ink-muted text-xs">
              {[detail, note].filter(Boolean).join(" · ")}
            </span>
            <Button size="sm" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </>
      )}
      {!running && error && (
        <div
          className="rounded-control bg-red-soft text-red px-3.5 py-2.5 text-[13px]"
          role="alert"
        >
          {error}
        </div>
      )}
      {!running && error && manualSteps && manualSteps.length > 0 && (
        <div className="rounded-control bg-chip px-3.5 py-2.5">
          <p className="text-ink text-[13px] font-medium">Do it by hand</p>
          <ol className="text-ink-muted mt-1 list-decimal space-y-1 pl-5 text-[13px]">
            {manualSteps.map((step, index) => (
              <li key={index}>{step}</li>
            ))}
          </ol>
        </div>
      )}
      {!running && !error && <p className="text-ink-muted text-[13px]">{label}</p>}
    </div>
  );
}
