// Turns what was found on this computer into the plain-language report the
// first-run setup screen shows: for each thing AI OS needs, whether it is fine,
// what is wrong in words a person can act on, and which button fixes it.
// Pure: `buildReport(facts)` has no I/O, so every sentence is covered by tests.
import { FALLBACK_MODEL, formatBytes, preflight, sameModel } from "./models.ts";
import { inboxSuggestions, type OneDriveFacts } from "./inbox.ts";
import type { OutlookFacts } from "./outlook.ts";

/** ok = fine; attention = works, but read this; missing = needs action;
 *  unknown = could not tell (or not checked yet). */
export type CheckState = "ok" | "attention" | "missing" | "unknown";

export type SetupActionId =
  | "install-ollama"
  | "pull-model"
  | "pull-fallback-model"
  | "choose-inbox"
  | "run-selftest";

export type CheckId = "ollama" | "model" | "pmo-inbox" | "outlook" | "engine";

export interface SetupCheck {
  id: CheckId;
  title: string;
  /** A required check that is `missing` keeps the setup screen open at launch. */
  required: boolean;
  state: CheckState;
  /** One plain sentence. */
  summary: string;
  /** What to do, in plain steps (empty when nothing is needed). */
  steps: string[];
  /** Facts worth showing small: paths, versions. */
  details: string[];
  actions: SetupActionId[];
  /** For `pmo-inbox`: folders worth offering as one-click choices. */
  suggestions?: string[];
}

export interface SetupReport {
  checks: SetupCheck[];
  /** Every required check is ok or attention. */
  ready: boolean;
  generatedAt: string;
}

export interface SelfTestFacts {
  ok: boolean;
  python: string;
  checks: { id: string; title: string; ok: boolean; detail: string }[];
}

export interface SetupFacts {
  platform: string;
  ollama: {
    exe: string | null;
    running: boolean;
    version: string | null;
    /** Model names installed in Ollama, or null if it could not be asked. */
    installedModels: string[] | null;
    defaultModel: string;
  };
  hardware: { totalRamBytes: number; freeDiskBytes: number | null };
  inbox: {
    path: string;
    /** Set by AI_OS_PMO_INBOX_DIR, so the screen cannot change it. */
    fromEnvironment: boolean;
    exists: boolean;
    oneDrive: OneDriveFacts;
    isDirectory: (path: string) => boolean;
  };
  outlook: OutlookFacts;
  engine: {
    python: string | null;
    /** null = not run yet; "running" while it is. */
    selfTest: SelfTestFacts | "running" | null;
  };
}

function ollamaCheck(facts: SetupFacts): SetupCheck {
  const { exe, running, version } = facts.ollama;
  const base = { id: "ollama" as const, title: "Local AI (Ollama)", required: true };
  if (!exe && !running) {
    return {
      ...base,
      state: "missing",
      summary: "Ollama, the program that runs the AI on this computer, is not installed.",
      steps: [
        "Press Install Ollama. AI OS downloads the official installer from ollama.com and runs it for you (no administrator rights needed).",
        "If the download is blocked on your network, AI OS shows how to install it by hand.",
      ],
      details: [],
      actions: ["install-ollama"],
    };
  }
  const details = [
    exe ? `Found at ${exe}` : "Answering on its local address",
    version ? `Version ${version}` : "",
  ].filter(Boolean);
  if (!running) {
    return {
      ...base,
      state: "attention",
      summary:
        "Ollama is installed but is not running right now. AI OS starts it when it is needed.",
      steps: [],
      details,
      actions: [],
    };
  }
  return {
    ...base,
    state: "ok",
    summary: version
      ? `Ollama ${version} is installed and running.`
      : "Ollama is installed and running.",
    steps: [],
    details,
    actions: [],
  };
}

function modelCheck(facts: SetupFacts): SetupCheck {
  const { installedModels, defaultModel, running, exe } = facts.ollama;
  const base = { id: "model" as const, title: "AI model", required: true };
  if (!exe && !running) {
    return {
      ...base,
      state: "missing",
      summary: "The AI model cannot be downloaded until Ollama is installed.",
      steps: ["Install Ollama first (see above), then come back here."],
      details: [],
      actions: [],
    };
  }
  if (installedModels === null) {
    return {
      ...base,
      state: "unknown",
      summary:
        "Ollama is not answering, so AI OS cannot tell which models are installed.",
      steps: [
        "Press Download model: AI OS starts Ollama first, then downloads the model.",
      ],
      details: [`Needs ${defaultModel}`],
      actions: ["pull-model"],
    };
  }
  const hasDefault = installedModels.some((m) => sameModel(m, defaultModel));
  const hasFallback = installedModels.some((m) => sameModel(m, FALLBACK_MODEL));
  if (hasDefault) {
    return {
      ...base,
      state: "ok",
      summary: `The AI model ${defaultModel} is installed.`,
      steps: [],
      details: [],
      actions: [],
    };
  }
  const pre = preflight({
    model: defaultModel,
    freeDiskBytes: facts.hardware.freeDiskBytes,
    totalRamBytes: facts.hardware.totalRamBytes,
  });
  const details = [
    facts.hardware.freeDiskBytes === null
      ? ""
      : `${formatBytes(facts.hardware.freeDiskBytes)} free on the model drive`,
    `${Math.round(facts.hardware.totalRamBytes / 1024 ** 3)} GB of memory`,
    ...pre.warnings,
  ].filter(Boolean);
  const steps = [
    `Press Download model. It is a large download (about ${formatBytes(12_000_000_000)} for ${defaultModel}); if the connection drops it carries on where it stopped.`,
  ];
  if (hasFallback) {
    return {
      ...base,
      state: "attention",
      summary: `${FALLBACK_MODEL} is installed, but AI OS is set up for ${defaultModel}, so AI features will not find their model.`,
      steps,
      details,
      actions: ["pull-model"],
    };
  }
  if (pre.blocked) {
    return {
      ...base,
      state: "missing",
      summary: pre.blocked,
      steps: [`Free up disk space, or download the smaller ${FALLBACK_MODEL} instead.`],
      details,
      actions: ["pull-model", "pull-fallback-model"],
    };
  }
  return {
    ...base,
    state: "missing",
    summary: `The AI model ${defaultModel} is not downloaded yet.`,
    steps: pre.warnings.length
      ? [
          ...steps,
          `If it is too heavy for this computer, ${FALLBACK_MODEL} is the smaller choice.`,
        ]
      : steps,
    details,
    actions: pre.warnings.length ? ["pull-model", "pull-fallback-model"] : ["pull-model"],
  };
}

function inboxCheck(facts: SetupFacts): SetupCheck {
  const { path, fromEnvironment, exists, oneDrive, isDirectory } = facts.inbox;
  const base = { id: "pmo-inbox" as const, title: "PMO inbox folder", required: true };
  const suggestions = inboxSuggestions(oneDrive, path, isDirectory);
  const details = [
    `Folder: ${path}`,
    fromEnvironment ? "Set by the AI_OS_PMO_INBOX_DIR setting." : "",
  ].filter(Boolean);
  if (exists) {
    return {
      ...base,
      state: oneDrive.signedIn || fromEnvironment ? "ok" : "attention",
      summary: oneDrive.signedIn
        ? "The PMO inbox folder is there and OneDrive is signed in."
        : fromEnvironment
          ? "The PMO inbox folder is there (it is fixed by a setting, so OneDrive is not checked)."
          : "The PMO inbox folder is there, but OneDrive does not look signed in, so new messages may not arrive.",
      steps:
        oneDrive.signedIn || fromEnvironment
          ? []
          : [
              "Sign in to OneDrive (the cloud icon in the taskbar) so Power Automate's files sync to this computer.",
            ],
      details,
      actions: fromEnvironment ? [] : ["choose-inbox"],
      suggestions,
    };
  }
  if (!oneDrive.signedIn) {
    return {
      ...base,
      state: "missing",
      summary:
        "OneDrive is not signed in on this computer, and the PMO inbox folder cannot be found.",
      steps: [
        "Sign in to OneDrive with your work account (open OneDrive from the Start menu).",
        "Wait for the PMO-Inbox folder to appear, then press Check again.",
        ...(fromEnvironment ? [] : ["Or choose a different folder below."]),
      ],
      details,
      actions: fromEnvironment ? [] : ["choose-inbox"],
      suggestions,
    };
  }
  return {
    ...base,
    state: "missing",
    summary: "OneDrive is signed in, but the PMO inbox folder does not exist yet.",
    steps: [
      suggestions.length
        ? "Pick the folder below that Power Automate saves messages to, or choose another."
        : "Create the PMO-Inbox folder in OneDrive (or choose another folder).",
    ],
    details,
    actions: fromEnvironment ? [] : ["choose-inbox"],
    suggestions,
  };
}

function outlookCheck(facts: SetupFacts): SetupCheck {
  const { comRegistered, classicInstalled, newOutlook } = facts.outlook;
  const base = { id: "outlook" as const, title: "Classic Outlook", required: false };
  if (facts.platform !== "win32") {
    return {
      ...base,
      state: "unknown",
      summary: "Outlook can only be checked on Windows.",
      steps: [],
      details: [],
      actions: [],
    };
  }
  if (comRegistered) {
    return {
      ...base,
      state: "ok",
      summary: "Classic Outlook is available for the mail tasks.",
      steps: [],
      details: classicInstalled ? ["OUTLOOK.EXE is installed"] : [],
      actions: [],
    };
  }
  if (comRegistered === null && classicInstalled === null) {
    return {
      ...base,
      state: "unknown",
      summary: "Could not check for classic Outlook.",
      steps: [],
      details: [],
      actions: [],
    };
  }
  return {
    ...base,
    state: "attention",
    summary: newOutlook
      ? "Only the new Outlook is installed. The mail tasks (backlog report, aging report, deployment mailer, monthly deck) need classic Outlook."
      : "Classic Outlook was not found. The mail tasks (backlog report, aging report, deployment mailer, monthly deck) need it; everything else works without.",
    steps: [
      newOutlook
        ? "To use the mail tasks, switch Outlook back to the classic version (the 'New Outlook' toggle in Outlook's top right)."
        : "To use the mail tasks, install the desktop version of Outlook (Microsoft 365 apps).",
      "AI OS only reads this setting; it never opens your mailbox or sends anything while checking.",
    ],
    details: [],
    actions: [],
  };
}

function engineCheck(facts: SetupFacts): SetupCheck {
  const { python, selfTest } = facts.engine;
  const base = { id: "engine" as const, title: "Tasks engine", required: true };
  if (!python) {
    return {
      ...base,
      state: "missing",
      summary: "The Python that runs the tasks was not found.",
      steps: [
        "Reinstall AI OS; the installer includes it. If you are running from source, set up tasks-engine/.venv (see tasks-engine/README.md).",
      ],
      details: [],
      actions: [],
    };
  }
  if (selfTest === null) {
    return {
      ...base,
      state: "unknown",
      summary: "The self-test has not been run yet.",
      steps: [],
      details: [`Python: ${python}`],
      actions: ["run-selftest"],
    };
  }
  if (selfTest === "running") {
    return {
      ...base,
      state: "unknown",
      summary: "Running the self-test…",
      steps: [],
      details: [`Python: ${python}`],
      actions: [],
    };
  }
  const failed = selfTest.checks.filter((c) => !c.ok);
  const details = [
    `Python ${selfTest.python}`,
    ...selfTest.checks.map(
      (c) => `${c.ok ? "OK" : "FAILED"}: ${c.title}${c.detail ? ` - ${c.detail}` : ""}`,
    ),
  ];
  if (selfTest.ok) {
    return {
      ...base,
      state: "ok",
      summary:
        "The Tasks engine passed its self-test on sample data. No email was touched.",
      steps: [],
      details,
      actions: ["run-selftest"],
    };
  }
  return {
    ...base,
    state: "missing",
    summary: `The self-test failed: ${failed.map((c) => c.title).join(", ")}.`,
    steps: [
      "Run it again; if it keeps failing, reinstall AI OS and send the details below to whoever supports it.",
    ],
    details,
    actions: ["run-selftest"],
  };
}

export function buildReport(
  facts: SetupFacts,
  now: () => Date = () => new Date(),
): SetupReport {
  const checks = [
    ollamaCheck(facts),
    modelCheck(facts),
    inboxCheck(facts),
    engineCheck(facts),
    outlookCheck(facts),
  ];
  const ready = checks.every(
    (c) => !c.required || c.state === "ok" || c.state === "attention",
  );
  return { checks, ready, generatedAt: now().toISOString() };
}

/** The required checks that still need action, used to decide whether to open
 *  the screen at launch and whether the person has already seen this exact list. */
export function missingRequired(report: SetupReport): CheckId[] {
  return report.checks
    .filter((c) => c.required && (c.state === "missing" || c.state === "unknown"))
    .map((c) => c.id)
    .sort();
}
