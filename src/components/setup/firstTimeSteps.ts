// The steps of the first-time setup page and how each one is judged, from the same
// report the Setup dialog uses. Pure: no React, no I/O; covered by tests.
import type { CheckId, SetupCheck, SetupReport } from "../../lib/setup/report.ts";

export type BrandId =
  | "aios"
  | "ollama"
  | "gemma"
  | "python"
  | "onedrive"
  | "powerautomate"
  | "outlook"
  | "teams";

export type StepId =
  "welcome" | "ollama" | "model" | "engine" | "outlook" | "folders" | "flows" | "finish";

export interface StepDef {
  id: StepId;
  /** Short name for the progress bar. */
  label: string;
  title: string;
  /** One plain sentence under the title. */
  blurb: string;
  /** The Setup report check that decides this step; null for steps with nothing to check. */
  check: CheckId | null;
  brands: BrandId[];
  /** Moves on by itself a moment after it is done. */
  auto: boolean;
  /** Can be left for later without breaking AI OS. */
  optional: boolean;
}

export const STEPS: readonly StepDef[] = [
  {
    id: "welcome",
    label: "Welcome",
    title: "Welcome to AI OS",
    blurb:
      "A few quick steps get this computer ready. Everything runs on your computer; nothing about your work leaves it.",
    check: null,
    brands: ["aios"],
    auto: false,
    optional: false,
  },
  {
    id: "ollama",
    label: "Local AI",
    title: "The local AI",
    blurb: "Ollama runs the AI model on this computer, so your mail and notes stay here.",
    check: "ollama",
    brands: ["ollama"],
    auto: true,
    optional: false,
  },
  {
    id: "model",
    label: "AI model",
    title: "The AI model",
    blurb:
      "The model reads your messages, drafts and PTO emails. It is a one-time download.",
    check: "model",
    brands: ["gemma"],
    auto: true,
    optional: false,
  },
  {
    id: "engine",
    label: "Tasks engine",
    title: "The tasks engine",
    blurb: "A short self-test on sample data confirms the reports and rosters will run.",
    check: "engine",
    brands: ["python"],
    auto: true,
    optional: false,
  },
  {
    id: "outlook",
    label: "Outlook",
    title: "Classic Outlook",
    blurb:
      "Only the mail tasks (reports, mailers) need it. AI OS looks; it never opens your mailbox.",
    check: "outlook",
    brands: ["outlook"],
    auto: true,
    optional: true,
  },
  {
    id: "folders",
    label: "OneDrive",
    title: "Your OneDrive folders",
    blurb:
      "One AI-OS folder in OneDrive is where Power Automate and AI OS pass files to each other.",
    check: "folders",
    brands: ["onedrive"],
    auto: true,
    optional: true,
  },
  {
    id: "flows",
    label: "Flows",
    title: "Build the Power Automate flows",
    blurb:
      "Three small flows bring in profiles, PTO emails and flagged mail. Follow along, step by step.",
    check: null,
    brands: ["powerautomate"],
    auto: false,
    optional: true,
  },
  {
    id: "finish",
    label: "Ready",
    title: "AI OS is ready",
    blurb: "Here is how this computer looks.",
    check: "flows",
    brands: ["aios"],
    auto: false,
    optional: false,
  },
];

export const stepIndex = (id: StepId): number => STEPS.findIndex((s) => s.id === id);

/** What a step is doing right now. */
export type StepPhase =
  /** Waiting for the first answer. */
  | "checking"
  /** Something is running (a download, the self-test). */
  | "working"
  /** Fine: the page moves on. */
  | "done"
  /** Needs a button press (install, download, create). */
  | "action"
  /** Works, but read this (or optional and not set up). */
  | "attention"
  /** A step with nothing to check: the person moves on with a button. */
  | "manual";

export interface JobsFacts {
  install: { running: boolean };
  pull: { running: boolean };
}

const find = (report: SetupReport, id: CheckId | null): SetupCheck | undefined =>
  id ? report.checks.find((c) => c.id === id) : undefined;

export function stepPhase(
  step: StepDef,
  report: SetupReport | null | undefined,
  jobs: JobsFacts | null | undefined,
): StepPhase {
  if (step.check === null) return "manual";
  if (step.id === "finish") return "manual";
  if (!report) return "checking";
  if (step.id === "ollama" && jobs?.install.running) return "working";
  if (step.id === "model" && jobs?.pull.running) return "working";
  const check = find(report, step.check);
  // A check that does not exist (an older server) cannot hold the page up.
  if (!check) return "done";
  if (step.id === "engine" && check.summary === "Running the self-test…")
    return "working";
  if (check.state === "ok") return "done";
  if (check.state === "unknown") {
    if (check.actions.includes("run-selftest")) return "checking";
    return step.optional ? "attention" : "checking";
  }
  if (check.state === "attention") {
    // Installed but not running right now is fine; a wrong model or an optional gap is not "done".
    if (step.id === "ollama") return "done";
    return check.actions.length > 0 ? "action" : "attention";
  }
  return "action";
}

/** Whether the page should move on by itself from this step. */
export function shouldAutoAdvance(
  step: StepDef,
  phase: StepPhase,
  held: boolean,
): boolean {
  return step.auto && phase === "done" && !held;
}

export type StepOutcome = "ok" | "open" | "skipped";

/** How each step ended, for the last page. */
export function outcomes(
  report: SetupReport | null | undefined,
  jobs: JobsFacts | null | undefined,
  skipped: ReadonlySet<StepId>,
): { step: StepDef; outcome: StepOutcome; note: string }[] {
  return STEPS.filter((s) => s.id !== "welcome" && s.id !== "finish").map((step) => {
    if (step.id === "flows") {
      const flows = find(
        report ?? { checks: [], ready: false, generatedAt: "" },
        "flows",
      );
      return {
        step,
        outcome: flows?.state === "ok" ? "ok" : "open",
        note:
          flows?.state === "ok"
            ? "A flow has delivered mail."
            : "Nothing has arrived yet. Build the flows whenever you like (Settings > Setup and health check).",
      } as const;
    }
    const phase = stepPhase(step, report, jobs);
    const check = find(
      report ?? { checks: [], ready: false, generatedAt: "" },
      step.check,
    );
    if (phase === "done")
      return { step, outcome: "ok", note: check?.summary ?? "Ready." } as const;
    return {
      step,
      outcome: skipped.has(step.id) ? "skipped" : "open",
      note: check?.summary ?? "Not checked.",
    } as const;
  });
}

/** The first step at or after `from` that is not yet done and not skipped, or the last step. */
export function firstOpenStep(
  report: SetupReport | null | undefined,
  jobs: JobsFacts | null | undefined,
  from = 1,
): StepId {
  for (let i = from; i < STEPS.length - 1; i++) {
    const s = STEPS[i];
    if (s.check && s.id !== "flows" && stepPhase(s, report, jobs) !== "done") return s.id;
  }
  return "flows";
}

/** Plain button text for each action the report offers. */
export const ACTION_TEXT: Record<string, string> = {
  "install-ollama": "Install Ollama",
  "pull-model": "Download the AI model",
  "pull-fallback-model": "Download the smaller model",
  "create-folders": "Create the folders",
  "run-selftest": "Run the self-test",
};
