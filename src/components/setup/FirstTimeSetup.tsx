"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ArrowRightIcon,
  CaretLeftIcon,
  CheckCircleIcon,
  CheckIcon,
  FolderIcon,
  FolderOpenIcon,
  MinusCircleIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { easeEntrance, easeStandard } from "@/lib/motion";
import { useFx } from "@/lib/useFx";
import type { SetupCheck } from "@/lib/setup/report";
import { BrandMark, BrandTile } from "./BrandMark";
import { FlowGuideView } from "./FlowGuideView";
import { GUIDES, type FlowGuide } from "./flowGuides";
import {
  ACTION_TEXT,
  STEPS,
  outcomes,
  shouldAutoAdvance,
  stepIndex,
  stepPhase,
  type BrandId,
  type StepDef,
  type StepId,
  type StepPhase,
} from "./firstTimeSteps";
import { useFirstTimeUi } from "./firstTimeStore";
import {
  fetchSetupStatus,
  postSetupAction,
  type SetupAction,
  type SetupStatus,
} from "./setupApi";
import { pullDetail } from "./setupView";

const BRAND_NAME: Record<BrandId, string> = {
  aios: "PMO Desk",
  ollama: "Ollama",
  gemma: "Gemma",
  python: "Python",
  onedrive: "OneDrive",
  powerautomate: "Power Automate",
  outlook: "Outlook",
  teams: "Microsoft Teams",
};

// ---------------------------------------------------------------------------
// Live status
// ---------------------------------------------------------------------------

function useSetupStatus(active: boolean) {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const selfTest = useRef(false);

  const refresh = useCallback(async (fresh = false) => {
    const next = await fetchSetupStatus(fresh);
    if (next) setStatus(next);
    return next;
  }, []);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let first = true;
    const tick = async () => {
      const next = await refresh(first);
      first = false;
      if (cancelled) return;
      const engine = next?.report.checks.find((c) => c.id === "engine");
      // The self-test is quick and unattended: start it as soon as it shows as not run.
      if (
        engine?.state === "unknown" &&
        engine.actions.includes("run-selftest") &&
        !selfTest.current
      ) {
        selfTest.current = true;
        await postSetupAction({ action: "run-selftest" });
      }
      const busy =
        next?.jobs.install.running ||
        next?.jobs.pull.running ||
        engine?.summary === "Running the self-test…";
      timer = setTimeout(() => void tick(), busy ? 900 : 2_400);
    };
    void tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, refresh]);

  return { status, refresh };
}

// ---------------------------------------------------------------------------
// Small animated pieces
// ---------------------------------------------------------------------------

const RING_TONE: Record<StepPhase, string> = {
  checking: "var(--color-ink-faint)",
  working: "var(--color-accent)",
  done: "var(--color-success-dot, #2fbf8e)",
  action: "var(--color-amber)",
  attention: "var(--color-amber)",
  manual: "var(--color-accent)",
};

/** The ring round a step's logo: spins while checking, fills while a job runs, draws a tick when done. */
function StatusRing({
  phase,
  percent,
  size,
  children,
}: {
  phase: StepPhase;
  percent: number | null;
  size: number;
  children: ReactNode;
}) {
  const reduce = useReducedMotion() === true;
  const r = size / 2 - 5;
  const c = 2 * Math.PI * r;
  const progress =
    phase === "done" ? 1 : phase === "working" ? Math.max(0.04, (percent ?? 0) / 100) : 1;
  return (
    <div
      className="relative grid place-items-center"
      style={{ width: size, height: size }}
    >
      <motion.svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="absolute inset-0"
        aria-hidden
        animate={phase === "checking" && !reduce ? { rotate: 360 } : { rotate: -90 }}
        transition={
          phase === "checking" && !reduce
            ? { repeat: Infinity, ease: "linear", duration: 1.4 }
            : { duration: 0 }
        }
        style={{ originX: 0.5, originY: 0.5 }}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--color-line)"
          strokeWidth="3"
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeDasharray={c}
          style={{ stroke: RING_TONE[phase], transition: "stroke 0.5s ease" }}
          initial={{ strokeDashoffset: c }}
          animate={{
            strokeDashoffset: c * (1 - (phase === "checking" ? 0.25 : progress)),
          }}
          transition={{ duration: reduce ? 0 : 0.7, ease: easeEntrance }}
        />
      </motion.svg>
      <motion.div
        animate={phase === "working" && !reduce ? { scale: [1, 1.05, 1] } : { scale: 1 }}
        transition={
          phase === "working"
            ? { repeat: Infinity, duration: 2.2, ease: easeStandard }
            : { duration: 0.2 }
        }
      >
        {children}
      </motion.div>
      <AnimatePresence>
        {phase === "done" && (
          <motion.span
            key="tick"
            initial={reduce ? false : { scale: 0, rotate: -40 }}
            animate={{ scale: 1, rotate: 0 }}
            exit={{ scale: 0 }}
            transition={{
              type: "spring",
              stiffness: 420,
              damping: 18,
              delay: reduce ? 0 : 0.35,
            }}
            className="bg-success-soft absolute -right-1 -bottom-1 grid h-8 w-8 place-items-center rounded-full border-2"
            style={{ borderColor: "var(--color-surface)" }}
          >
            <CheckCircleIcon size={26} weight="fill" className="text-success" />
          </motion.span>
        )}
        {(phase === "action" || phase === "attention") && (
          <motion.span
            key="warn"
            initial={reduce ? false : { scale: 0 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0 }}
            transition={{ type: "spring", stiffness: 420, damping: 20 }}
            className="absolute -right-1 -bottom-1 grid h-8 w-8 place-items-center rounded-full"
            style={{ background: "var(--color-surface)" }}
          >
            <WarningCircleIcon size={26} weight="fill" className="text-amber" />
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}

function Bar({
  percent,
  label,
  detail,
}: {
  percent: number | null;
  label: string;
  detail?: string;
}) {
  const reduce = useReducedMotion() === true;
  return (
    <div className="w-full" aria-live="polite">
      <div className="bg-chip h-2.5 w-full overflow-hidden rounded-full">
        <motion.div
          className="bg-accent relative h-full rounded-full"
          initial={{ width: "4%" }}
          animate={{ width: `${Math.max(4, percent ?? 4)}%` }}
          transition={{ duration: reduce ? 0 : 0.6, ease: easeEntrance }}
        >
          {!reduce && (
            <motion.span
              aria-hidden
              className="absolute inset-y-0 w-16 bg-gradient-to-r from-transparent via-white/40 to-transparent"
              animate={{ x: ["-100%", "400%"] }}
              transition={{ repeat: Infinity, duration: 1.6, ease: "linear" }}
            />
          )}
        </motion.div>
      </div>
      <div className="text-ink-muted mt-2 flex flex-wrap items-center justify-between gap-2 text-[12.5px]">
        <span>{label}</span>
        <span>
          {[percent !== null ? `${Math.round(percent)}%` : null, detail]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </div>
    </div>
  );
}

const Dots = () => (
  <span aria-hidden className="inline-flex gap-1 align-middle">
    {[0, 1, 2].map((i) => (
      <motion.i
        key={i}
        className="bg-ink-muted h-1.5 w-1.5 rounded-full"
        animate={{ opacity: [0.25, 1, 0.25] }}
        transition={{ repeat: Infinity, duration: 1.1, delay: i * 0.18 }}
      />
    ))}
  </span>
);

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

interface StepProps {
  step: StepDef;
  phase: StepPhase;
  check: SetupCheck | undefined;
  status: SetupStatus | null;
  run: (action: SetupAction) => Promise<void>;
  refresh: (fresh?: boolean) => Promise<unknown>;
  notice: string | null;
}

function Hero({
  step,
  phase,
  percent,
}: {
  step: StepDef;
  phase: StepPhase;
  percent: number | null;
}) {
  return (
    <StatusRing phase={phase} percent={percent} size={132}>
      <BrandMark brand={step.brands[0]} size={64} />
    </StatusRing>
  );
}

function StepText({ title, blurb }: { title: string; blurb: string }) {
  return (
    <div className="text-center">
      <h2 className="text-ink text-[26px] leading-tight font-bold tracking-[-0.01em]">
        {title}
      </h2>
      <p className="text-ink-muted mx-auto mt-2 max-w-[520px] text-[14.5px] leading-relaxed">
        {blurb}
      </p>
    </div>
  );
}

function ActionButtons({
  check,
  status,
  run,
}: Pick<StepProps, "check" | "status" | "run">) {
  const actions = (check?.actions ?? []).filter(
    (a) => ACTION_TEXT[a] && a !== "run-selftest",
  );
  const busy = status?.jobs.install.running || status?.jobs.pull.running;
  if (actions.length === 0) return null;
  return (
    <div className="flex flex-wrap justify-center gap-2.5">
      {actions.map((action, i) => (
        <Button
          key={action}
          variant={i === 0 ? "solid" : "outline"}
          disabled={busy}
          onClick={() => void run({ action } as SetupAction)}
        >
          {ACTION_TEXT[action]}
        </Button>
      ))}
    </div>
  );
}

function Stack({ children }: { children: ReactNode }) {
  return <div className="flex flex-col items-center gap-6">{children}</div>;
}

/** Ollama, the AI model, the tasks engine and Outlook: one logo, one verdict, one button. */
function CheckStep({ step, phase, check, status, run, notice }: StepProps) {
  const install = status?.jobs.install;
  const pull = status?.jobs.pull;
  const job = step.id === "ollama" ? install : step.id === "model" ? pull : null;
  const progress = job?.progress;
  const percent = progress && "percent" in progress ? (progress.percent ?? null) : null;
  const jobError =
    progress && "error" in progress && !job?.running
      ? (progress.error as string | undefined)
      : undefined;
  const manual =
    step.id === "ollama" && install?.progress && "manualSteps" in install.progress
      ? install.progress.manualSteps
      : undefined;

  return (
    <Stack>
      <Hero step={step} phase={phase} percent={percent} />
      <StepText title={step.title} blurb={step.blurb} />
      <div className="flex w-full max-w-[520px] flex-col items-center gap-4 text-center">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={phase}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.24, ease: easeEntrance }}
            className="flex w-full flex-col items-center gap-4"
          >
            {phase === "checking" && (
              <p className="text-ink-muted text-[14px]">
                Checking this computer <Dots />
              </p>
            )}
            {phase === "working" && progress && (
              <Bar
                percent={percent}
                label={"message" in progress ? progress.message : "Working…"}
                detail={
                  step.id === "model" && pull?.progress && pull.progress.totalBytes > 0
                    ? pullDetail(pull.progress)
                    : undefined
                }
              />
            )}
            {phase === "working" && !progress && (
              <p className="text-ink-muted text-[14px]">
                Running the self-test on sample data <Dots />
              </p>
            )}
            {(phase === "done" || phase === "action" || phase === "attention") &&
              check && (
                <p
                  className={cn(
                    "text-[14px]",
                    phase === "done" ? "text-success font-medium" : "text-ink-soft",
                  )}
                >
                  {check.summary}
                </p>
              )}
            {(phase === "action" || phase === "attention") &&
              check &&
              check.steps.length > 0 && (
                <ol className="text-ink-muted w-full list-decimal space-y-1 pl-5 text-left text-[13px]">
                  {check.steps.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ol>
              )}
            {jobError && (
              <p
                role="alert"
                className="text-red bg-red-soft rounded-control w-full px-3.5 py-2.5 text-left text-[13px]"
              >
                {jobError}
                {manual && manual.length > 0 && (
                  <span className="mt-1.5 block">
                    {manual.map((m, i) => (
                      <span key={i} className="block">
                        {i + 1}. {m}
                      </span>
                    ))}
                  </span>
                )}
              </p>
            )}
            {phase === "working" && job?.running && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  void run({
                    action: step.id === "ollama" ? "cancel-install" : "cancel-pull",
                  })
                }
              >
                Cancel
              </Button>
            )}
            {(phase === "action" || phase === "attention") && (
              <ActionButtons check={check} status={status} run={run} />
            )}
            {step.id === "engine" && phase === "action" && (
              <Button onClick={() => void run({ action: "run-selftest" })}>
                Run the self-test again
              </Button>
            )}
          </motion.div>
        </AnimatePresence>
        {check &&
          check.details.length > 0 &&
          (phase === "action" || phase === "attention") && (
            <details className="w-full text-left">
              <summary className="text-ink-muted cursor-pointer text-center text-xs select-none">
                Details
              </summary>
              <ul className="text-ink-muted mt-1.5 space-y-0.5 font-mono text-[11.5px] break-words">
                {check.details.map((detail, i) => (
                  <li key={i}>{detail}</li>
                ))}
              </ul>
            </details>
          )}
        {notice && (
          <p role="alert" className="text-red text-[13px]">
            {notice}
          </p>
        )}
      </div>
    </Stack>
  );
}

const DEFAULT_FOLDERS = [
  {
    id: "pmoInbox",
    label: "PMO-Inbox",
    ok: false,
    note: "Flagged emails for the PMO To-Do",
  },
  {
    id: "staffExchange",
    label: "Staff-Exchange",
    ok: false,
    note: "M365 profiles for Staff Management",
  },
  {
    id: "ptoInbox",
    label: "PTO-Inbox",
    ok: false,
    note: "PTO emails for the shift roster",
  },
];

function FoldersStep({ step, phase, check, status, run, refresh, notice }: StepProps) {
  const items = check?.items ?? DEFAULT_FOLDERS;
  const reduce = useReducedMotion() === true;
  const where = check?.details.find(
    (d) => d.startsWith("AI-OS folder:") || d.startsWith("OneDrive:"),
  );
  return (
    <Stack>
      <Hero step={step} phase={phase} percent={null} />
      <StepText title={step.title} blurb={step.blurb} />
      <div className="w-full max-w-[520px]">
        <div className="bg-card border-line rounded-card border p-4">
          <div className="flex items-center gap-2.5">
            <motion.span
              initial={reduce ? false : { scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 380, damping: 20 }}
            >
              <FolderOpenIcon size={24} weight="fill" className="text-amber" />
            </motion.span>
            <div className="min-w-0">
              <p className="text-ink text-[14px] font-bold">AI-OS</p>
              {where && (
                <p className="text-ink-muted truncate text-[11.5px]">
                  {where.replace(/^[^:]+: /, "")}
                </p>
              )}
            </div>
          </div>
          <ul className="border-line mt-3 ml-3 flex flex-col gap-2 border-l pl-5">
            {items.map((item, i) => (
              <motion.li
                key={item.id}
                initial={reduce ? false : { opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.15 + i * 0.12, duration: 0.3, ease: easeEntrance }}
                className="flex items-center gap-3"
              >
                <FolderIcon
                  size={20}
                  weight="fill"
                  className={item.ok ? "text-amber" : "text-ink-faint"}
                />
                <span className="min-w-0 flex-1">
                  <span className="text-ink block text-[13.5px] font-semibold">
                    {item.label}
                  </span>
                  <span className="text-ink-muted block text-[12px]">{item.note}</span>
                </span>
                <AnimatePresence mode="wait" initial={false}>
                  {item.ok ? (
                    <motion.span
                      key="ok"
                      initial={reduce ? false : { scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ type: "spring", stiffness: 400, damping: 16 }}
                      className="text-success"
                    >
                      <CheckCircleIcon size={22} weight="fill" />
                    </motion.span>
                  ) : (
                    <motion.span key="no" className="text-ink-faint" exit={{ scale: 0 }}>
                      <MinusCircleIcon size={22} />
                    </motion.span>
                  )}
                </AnimatePresence>
              </motion.li>
            ))}
          </ul>
        </div>
        <p className="text-ink-muted mt-3 text-center text-[13px]">
          {phase === "done"
            ? "These are in place, and PMO Desk is already pointed at them. Nothing to map."
            : (check?.summary ?? (
                <>
                  Looking in OneDrive <Dots />
                </>
              ))}
        </p>
        {check && check.details.some((d) => d.startsWith("PMO-Inbox or")) && (
          <p className="text-ink-muted bg-chip/70 mt-3 rounded-md px-3 py-2 text-[12.5px] leading-snug">
            {check.details.find((d) => d.startsWith("PMO-Inbox or"))}
          </p>
        )}
        {phase !== "done" && check && check.steps.length > 0 && (
          <ol className="text-ink-muted mx-auto mt-2 w-fit max-w-full list-decimal space-y-1 pl-5 text-[13px]">
            {check.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        )}
        {phase !== "done" && (
          <div className="mt-4 flex flex-wrap justify-center gap-2.5">
            <ActionButtons check={check} status={status} run={run} />
            {!check?.actions.includes("create-folders") && (
              <Button variant="outline" onClick={() => void refresh(true)}>
                Check again
              </Button>
            )}
          </div>
        )}
        {notice && (
          <p role="alert" className="text-red mt-3 text-center text-[13px]">
            {notice}
          </p>
        )}
      </div>
    </Stack>
  );
}

function FlowsStep({
  guides,
  onGuideDone,
  built,
  check,
  compact,
}: {
  guides: readonly FlowGuide[];
  onGuideDone: (id: FlowGuide["id"]) => void;
  built: ReadonlySet<string>;
  check: SetupCheck | undefined;
  compact: boolean;
}) {
  const [selected, setSelected] = useState<FlowGuide["id"]>(guides[0].id);
  const guide = guides.find((g) => g.id === selected) ?? guides[0];
  return (
    <div className="flex flex-col gap-5">
      {!compact && (
        <div className="flex flex-col items-center gap-3">
          <BrandTile brand="powerautomate" size={64} />
          <StepText
            title="Build the Power Automate flows"
            blurb="Each flow is a few cards in Power Automate. Pick one and follow the picture, step by step. They are optional: PMO Desk works without them."
          />
        </div>
      )}
      <div
        role="tablist"
        aria-label="Flows"
        className="flex flex-wrap justify-center gap-2"
      >
        {guides.map((g) => {
          const on = g.id === selected;
          return (
            <button
              key={g.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setSelected(g.id)}
              className={cn(
                "rounded-chip transition-ui flex items-center gap-2 border px-3.5 py-1.5 text-[13px] font-semibold",
                on
                  ? "bg-accent-soft text-accent-ink border-transparent"
                  : "border-line text-ink-muted hover:bg-chip",
              )}
            >
              <BrandMark brand={g.brand} size={18} />
              {g.name}
              {built.has(g.id) && (
                <CheckIcon size={13} weight="bold" className="text-success" />
              )}
            </button>
          );
        })}
      </div>
      <p className="text-ink-muted -mt-2 text-center text-[12.5px]">
        {guide.purpose} Files go to{" "}
        <span className="text-ink font-semibold">{guide.folder}</span> in OneDrive.
      </p>
      {check?.items && (
        <ul
          className="flex flex-wrap justify-center gap-x-5 gap-y-1 text-[12px]"
          aria-label="What has arrived"
        >
          {check.items.map((it) => (
            <li key={it.id} className="text-ink-muted flex items-center gap-1.5">
              {it.ok ? (
                <CheckCircleIcon size={14} weight="fill" className="text-success" />
              ) : (
                <MinusCircleIcon size={14} className="text-ink-faint" />
              )}
              {it.label}: {it.note}
            </li>
          ))}
        </ul>
      )}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={guide.id}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.28, ease: easeEntrance }}
        >
          <FlowGuideView guide={guide} onFinished={() => onGuideDone(guide.id)} />
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function WelcomeStep({ step }: { step: StepDef }) {
  const reduce = useReducedMotion() === true;
  const tools: BrandId[] = [
    "ollama",
    "gemma",
    "python",
    "outlook",
    "onedrive",
    "powerautomate",
  ];
  return (
    <Stack>
      <motion.div
        initial={reduce ? false : { scale: 0.7, opacity: 0, rotate: -8 }}
        animate={{ scale: 1, opacity: 1, rotate: 0 }}
        transition={{ type: "spring", stiffness: 220, damping: 16 }}
      >
        <BrandMark brand="aios" size={104} />
      </motion.div>
      <StepText title={step.title} blurb={step.blurb} />
      <div className="w-full max-w-[560px]">
        <p className="text-ink-faint mb-3 text-center text-[11.5px] font-bold tracking-[0.08em] uppercase">
          What we will set up
        </p>
        <ul className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          {tools.map((brand, i) => (
            <motion.li
              key={brand}
              initial={reduce ? false : { opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 + i * 0.08, duration: 0.35, ease: easeEntrance }}
              className="flex flex-col items-center gap-2"
            >
              <BrandTile brand={brand} size={56} />
              <span className="text-ink-muted text-center text-[11.5px] leading-tight font-medium">
                {BRAND_NAME[brand]}
              </span>
            </motion.li>
          ))}
        </ul>
      </div>
    </Stack>
  );
}

function FinishStep({
  status,
  skipped,
  guidesBuilt,
}: {
  status: SetupStatus | null;
  skipped: ReadonlySet<StepId>;
  guidesBuilt: ReadonlySet<string>;
}) {
  const reduce = useReducedMotion() === true;
  const rows = useMemo(
    () => outcomes(status?.report, status?.jobs, skipped),
    [status, skipped],
  );
  const open = rows.filter((r) => r.outcome !== "ok").length;
  return (
    <Stack>
      <StatusRing phase={open === 0 ? "done" : "attention"} percent={null} size={132}>
        <BrandMark brand="aios" size={64} />
      </StatusRing>
      <StepText
        title={open === 0 ? "PMO Desk is ready" : "PMO Desk is ready to use"}
        blurb={
          open === 0
            ? "Everything is in place. You can open the Setup and health check from Settings at any time."
            : `${open} ${open === 1 ? "thing is" : "things are"} still open. None of them stops you; finish them whenever you like from Settings > Setup and health check.`
        }
      />
      <ul
        className="bg-card border-line w-full max-w-[560px] divide-y rounded-2xl border"
        style={{ borderColor: "var(--color-line)" }}
      >
        {rows.map(({ step, outcome, note }, i) => (
          <motion.li
            key={step.id}
            initial={reduce ? false : { opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 + i * 0.09, duration: 0.3, ease: easeEntrance }}
            className="border-line flex items-center gap-3 px-4 py-2.5 first:border-t-0"
          >
            <BrandMark brand={step.brands[0]} size={28} />
            <span className="min-w-0 flex-1">
              <span className="text-ink block text-[13.5px] font-semibold">
                {step.title}
              </span>
              <span className="text-ink-muted block truncate text-[12px]" title={note}>
                {step.id === "flows" && guidesBuilt.size > 0
                  ? `${guidesBuilt.size} of ${GUIDES.length} flows walked through. ${note}`
                  : note}
              </span>
            </span>
            {outcome === "ok" ? (
              <CheckCircleIcon
                size={22}
                weight="fill"
                className="text-success shrink-0"
              />
            ) : (
              <WarningCircleIcon
                size={22}
                weight="fill"
                className="text-amber shrink-0"
              />
            )}
          </motion.li>
        ))}
      </ul>
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

// No `filter` here: a blur on the page wrapper is re-rasterised on the CPU in the default
// (software) mode and leaves `filter: blur(0px)` on the wrapper, which then repaints
// everything inside it (the flow guides' scrolling canvas) on every scroll.
const variants = {
  enter: (d: number) => ({ opacity: 0, x: d * 56 }),
  center: { opacity: 1, x: 0 },
  exit: (d: number) => ({ opacity: 0, x: -d * 56 }),
};
const plain = {
  enter: { opacity: 0 },
  center: { opacity: 1 },
  exit: { opacity: 0 },
};

/** Soft colour pools behind the page. Radial gradients, not blurred discs: a live
 *  `blur(110px)` on a 500px element costs a CPU blur per frame without a GPU. They drift
 *  only in the rich (GPU) mode. */
function Backdrop() {
  const reduce = useReducedMotion() === true;
  const { fx } = useFx();
  const drift = !reduce && fx === "rich";
  const blobs = [
    {
      cls: "[--blob:var(--color-accent-soft)]",
      pos: "-top-40 -left-32 h-[520px] w-[520px]",
      move: { x: [0, 80, 0], y: [0, 60, 0] },
      dur: 22,
    },
    {
      cls: "[--blob:var(--color-info-soft)]",
      pos: "-right-40 top-1/3 h-[560px] w-[560px]",
      move: { x: [0, -70, 0], y: [0, 50, 0] },
      dur: 26,
    },
    {
      cls: "[--blob:var(--color-amber-soft)]",
      pos: "-bottom-48 left-1/3 h-[480px] w-[480px]",
      move: { x: [0, 60, 0], y: [0, -50, 0] },
      dur: 30,
    },
  ];
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {blobs.map((b) => (
        <motion.div
          key={b.pos}
          className={cn(
            "absolute rounded-full bg-[radial-gradient(closest-side,var(--blob),transparent)]",
            b.cls,
            b.pos,
          )}
          animate={drift ? b.move : undefined}
          transition={{ repeat: Infinity, duration: b.dur, ease: "easeInOut" }}
        />
      ))}
    </div>
  );
}

function Stepper({ index }: { index: number }) {
  const reduce = useReducedMotion() === true;
  return (
    <ol
      className="mx-auto flex w-full max-w-[860px] items-center px-6"
      aria-label="Setup progress"
    >
      {STEPS.map((s, i) => {
        const done = i < index;
        const current = i === index;
        return (
          <li
            key={s.id}
            className={cn("flex items-center", i < STEPS.length - 1 && "flex-1")}
          >
            <div className="flex flex-col items-center gap-1.5">
              <motion.span
                aria-current={current ? "step" : undefined}
                className={cn(
                  "grid h-7 w-7 place-items-center rounded-full border text-[11px] font-bold",
                  done && "bg-accent text-accent-contrast border-transparent",
                  current && "border-accent text-accent-ink bg-accent-soft",
                  !done && !current && "border-line text-ink-faint bg-card",
                )}
                animate={current && !reduce ? { scale: [1, 1.12, 1] } : { scale: 1 }}
                transition={{ duration: 0.5 }}
              >
                {done ? <CheckIcon size={13} weight="bold" /> : i + 1}
              </motion.span>
              <span
                className={cn(
                  "hidden text-[11px] whitespace-nowrap md:block",
                  current ? "text-ink font-semibold" : "text-ink-faint",
                )}
              >
                {s.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <span className="bg-line relative mx-1.5 mb-5 h-0.5 flex-1 overflow-hidden rounded-full md:mb-5">
                <motion.span
                  className="bg-accent absolute inset-0 origin-left"
                  initial={false}
                  animate={{ scaleX: done ? 1 : 0 }}
                  transition={{ duration: reduce ? 0 : 0.5, ease: easeEntrance }}
                />
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The first-time setup page. It opens once after a fresh install, before the home screen,
 * and walks through the health check one step at a time: each step shows what it is,
 * checks it, fixes what it can, and moves on by itself when done. The OneDrive folders are
 * already made by the installer, so that step only confirms them and the Power Automate
 * step shows how to build the flows. Opened from Settings in `guides` mode it shows only
 * the flow walkthrough.
 */
export function FirstTimeSetup() {
  const open = useFirstTimeUi((s) => s.open);
  const mode = useFirstTimeUi((s) => s.mode);
  const startAt = useFirstTimeUi((s) => s.startAt);
  const openFirstTime = useFirstTimeUi((s) => s.openFirstTime);
  const close = useFirstTimeUi((s) => s.close);
  const reduce = useReducedMotion() === true;

  // Once per launch: did the installer leave the marker?
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/setup/first-time", { cache: "no-store" })
      .then((r) => r.json() as Promise<{ pending?: boolean }>)
      .then((body) => {
        if (!cancelled && body.pending) openFirstTime();
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [openFirstTime]);

  return (
    <AnimatePresence>
      {open && (
        <Page
          key={`${mode}`}
          guidesOnly={mode === "guides"}
          startAt={startAt}
          reduce={reduce}
          onClose={close}
        />
      )}
    </AnimatePresence>
  );
}

function Page({
  guidesOnly,
  startAt,
  reduce,
  onClose,
}: {
  guidesOnly: boolean;
  startAt: StepId;
  reduce: boolean;
  onClose: () => void;
}) {
  const { status, refresh } = useSetupStatus(true);
  const [index, setIndex] = useState(stepIndex(startAt));
  const [dir, setDir] = useState(1);
  const [held, setHeld] = useState<StepId | null>(null);
  const [skipped, setSkipped] = useState<ReadonlySet<StepId>>(new Set());
  const [built, setBuilt] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const heading = useRef<HTMLDivElement>(null);

  const step = STEPS[index];
  const report = status?.report ?? null;
  const phase = stepPhase(step, report, status?.jobs);
  const check = step.check ? report?.checks.find((c) => c.id === step.check) : undefined;

  const go = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(STEPS.length - 1, next));
      setDir(clamped > index ? 1 : -1);
      setHeld(null);
      setNotice(null);
      setIndex(clamped);
    },
    [index],
  );

  // Move on by itself a moment after a step is done (long enough to see the tick).
  useEffect(() => {
    if (guidesOnly || !shouldAutoAdvance(step, phase, held === step.id)) return;
    const timer = setTimeout(() => go(index + 1), reduce ? 400 : 1500);
    return () => clearTimeout(timer);
  }, [guidesOnly, step, phase, held, index, go, reduce]);

  // Keyboard and screen-reader users land on the new step.
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [index]);

  const run = useCallback(
    async (action: SetupAction) => {
      setNotice(null);
      const result = await postSetupAction(action);
      if (!result.ok) setNotice(result.reason ?? "That did not work.");
      await refresh();
    },
    [refresh],
  );

  async function finish() {
    setFinishing(true);
    if (!guidesOnly) {
      await fetch("/api/setup/first-time", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "complete" }),
      }).catch(() => undefined);
    }
    onClose();
  }

  function skip() {
    setSkipped((s) => new Set(s).add(step.id));
    go(index + 1);
  }

  function back() {
    const target = index - 1;
    if (target < 1) return;
    go(target);
    setHeld(STEPS[target].id);
  }

  const props: StepProps = { step, phase, check, status, run, refresh, notice };
  const canContinue =
    step.id !== "welcome" &&
    step.id !== "finish" &&
    (phase === "done" || phase === "attention" || phase === "manual");
  const wide = step.id === "flows" || guidesOnly;
  const flowsCheck = report?.checks.find((c) => c.id === "flows");
  const flowsStep = (
    <FlowsStep
      guides={GUIDES}
      built={built}
      check={flowsCheck}
      compact={guidesOnly}
      onGuideDone={(id) => setBuilt((b) => new Set(b).add(id))}
    />
  );

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label={guidesOnly ? "Power Automate flow guides" : "First-time setup"}
      initial={reduce ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={reduce ? undefined : { opacity: 0, scale: 1.03 }}
      transition={{ duration: 0.5, ease: easeEntrance }}
      className="bg-surface text-ink fixed inset-0 z-[calc(var(--z-overlay)+2)] flex flex-col overflow-hidden"
    >
      <Backdrop />

      <header className="relative z-10 flex flex-col gap-4 pt-6 pb-2">
        {guidesOnly ? (
          <div className="mx-auto flex w-full max-w-[1040px] items-center justify-between px-6">
            <div className="flex items-center gap-2.5">
              <BrandMark brand="powerautomate" size={26} />
              <h1 className="text-[16px] font-bold">Power Automate flow guides</h1>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void finish()}
              aria-label="Close the guides"
            >
              <XIcon size={14} weight="bold" />
              Close
            </Button>
          </div>
        ) : (
          <Stepper index={index} />
        )}
      </header>

      <main className="relative z-10 flex min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <div className={cn("m-auto w-full", wide ? "max-w-[1040px]" : "max-w-[640px]")}>
          <AnimatePresence mode="wait" custom={dir} initial={false}>
            <motion.div
              key={guidesOnly ? "guides" : step.id}
              custom={dir}
              variants={reduce ? plain : variants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: reduce ? 0.15 : 0.42, ease: easeEntrance }}
            >
              <div
                ref={heading}
                tabIndex={-1}
                className="outline-none"
                aria-label={step.title}
              />
              {guidesOnly ? (
                flowsStep
              ) : step.id === "welcome" ? (
                <WelcomeStep step={step} />
              ) : step.id === "folders" ? (
                <FoldersStep {...props} />
              ) : step.id === "flows" ? (
                flowsStep
              ) : step.id === "finish" ? (
                <FinishStep status={status} skipped={skipped} guidesBuilt={built} />
              ) : (
                <CheckStep {...props} />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      {!guidesOnly && (
        <footer className="relative z-10 mx-auto flex w-full max-w-[860px] items-center justify-between gap-3 px-6 pt-2 pb-6">
          <div className="min-w-[96px]">
            {index > 1 && step.id !== "finish" && (
              <Button variant="ghost" onClick={back}>
                <CaretLeftIcon size={15} weight="bold" />
                Back
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2.5">
            {step.id === "welcome" && (
              <Button size="lg" onClick={() => go(1)}>
                Get started
                <ArrowRightIcon size={16} weight="bold" />
              </Button>
            )}
            {step.id !== "welcome" &&
              step.id !== "finish" &&
              step.id !== "flows" &&
              phase !== "done" && (
                <Button variant="ghost" onClick={skip}>
                  Skip for now
                </Button>
              )}
            {canContinue && (
              <Button onClick={() => go(index + 1)}>
                {step.id === "flows"
                  ? built.size > 0
                    ? "Continue"
                    : "I'll do this later"
                  : "Continue"}
                <ArrowRightIcon size={15} weight="bold" />
              </Button>
            )}
            {step.id === "finish" && (
              <Button size="lg" disabled={finishing} onClick={() => void finish()}>
                Open PMO Desk
                <ArrowRightIcon size={16} weight="bold" />
              </Button>
            )}
          </div>
          <div className="min-w-[96px]" />
        </footer>
      )}
    </motion.div>
  );
}
