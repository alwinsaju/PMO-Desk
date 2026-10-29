// Turns what was found on this computer into the plain-language report the
// first-run setup screen shows: for each thing AI OS needs, whether it is fine,
// what is wrong in words a person can act on, and which button fixes it.
// Pure: `buildReport(facts)` has no I/O, so every sentence is covered by tests.
import { FALLBACK_MODEL, downloadSizeText, preflight, sameModel } from "./models.ts";
import { MODEL_SIZE, formatBytes } from "../format.ts";
import type { OutlookFacts } from "./outlook.ts";

/** ok = fine; attention = works, but read this; missing = needs action;
 *  unknown = could not tell (or not checked yet). */
export type CheckState = "ok" | "attention" | "missing" | "unknown";

export type SetupActionId =
  | "install-ollama"
  | "pull-model"
  | "pull-fallback-model"
  | "create-folders"
  | "run-selftest";

export type CheckId = "ollama" | "model" | "folders" | "flows" | "outlook" | "engine";

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
  /** For checks made of several parts (the OneDrive folders, the flows): how each part is. */
  items?: { id: string; label: string; ok: boolean; note: string }[];
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
    /** The model AI OS uses (saved choice, or the only one installed). */
    defaultModel: string;
    /** Why it is not the one originally asked for, when it is not. */
    modelNote?: string;
  };
  hardware: { totalRamBytes: number; freeDiskBytes: number | null };
  outlook: OutlookFacts;
  engine: {
    python: string | null;
    /** null = not run yet; "running" while it is. */
    selfTest: SelfTestFacts | "running" | null;
  };
  /** The AI-OS folder in OneDrive. Left out by callers that do not look (old tests). */
  folders?: FolderFacts;
  /** What the Power Automate flows have delivered so far. */
  flows?: FlowFacts;
}

export interface FolderFacts {
  signedIn: boolean;
  /** The OneDrive folder the AI-OS folder is in (work account first), or null. */
  oneDriveRoot: string | null;
  aiOsRoot: string | null;
  found: { pmoInbox: boolean; staffExchange: boolean; ptoInbox: boolean };
  /** PMO-Inbox or Staff-Exchange still sit directly in OneDrive (an install from before AI-OS). */
  older?: boolean;
}

export interface FlowFacts {
  pto: {
    /** When the newest PTO email was received, or null when none has arrived. */
    lastReceivedAt: string | null;
    waiting: number;
    setAside: number;
  };
  staff: {
    /** People waiting for their M365 profile. */
    waiting: number;
    /** How long the longest-waiting one has waited, in minutes (null: nobody waits). */
    oldestMinutes: number | null;
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
      details: facts.ollama.modelNote ? [facts.ollama.modelNote] : [],
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
      : `${formatBytes(facts.hardware.freeDiskBytes, MODEL_SIZE)} free on the model drive`,
    `${Math.round(facts.hardware.totalRamBytes / 1024 ** 3)} GB of memory`,
    ...pre.warnings,
  ].filter(Boolean);
  const steps = [
    `Press Download model. It is a large download (${downloadSizeText(defaultModel)} for ${defaultModel}); if the connection drops it carries on where it stopped.`,
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

const FOLDER_LABEL: Record<keyof FolderFacts["found"], string> = {
  pmoInbox: "PMO-Inbox",
  staffExchange: "Staff-Exchange",
  ptoInbox: "PTO-Inbox",
};

const FOLDER_PURPOSE: Record<keyof FolderFacts["found"], string> = {
  pmoInbox: "Flagged emails for the PMO To-Do",
  staffExchange: "M365 profiles for Staff Management",
  ptoInbox: "PTO emails for the shift roster",
};

/** The AI-OS folder in OneDrive that Power Automate and AI OS share. */
function foldersCheck(facts: SetupFacts): SetupCheck | null {
  const folders = facts.folders;
  if (!folders) return null;
  const base = {
    id: "folders" as const,
    title: "OneDrive folders (AI-OS)",
    required: false,
  };
  if (!folders.signedIn || !folders.oneDriveRoot) {
    return {
      ...base,
      state: "attention",
      summary:
        "OneDrive is not signed in, so the AI-OS folder for the Power Automate flows cannot be set up yet.",
      steps: [
        "Sign in to OneDrive with your work account (open OneDrive from the Start menu), then press Check again.",
      ],
      details: [],
      actions: [],
    };
  }
  const missing = (Object.keys(folders.found) as (keyof FolderFacts["found"])[]).filter(
    (key) => !folders.found[key],
  );
  const details = [
    `OneDrive: ${folders.oneDriveRoot}`,
    folders.aiOsRoot ? `AI-OS folder: ${folders.aiOsRoot}` : "",
    folders.older
      ? "PMO-Inbox or Staff-Exchange are still directly in OneDrive (the older place). They keep working. To tidy up, MOVE them into the AI-OS folder in File Explorer (do not copy): OneDrive keeps each folder's identity, so your flows keep running."
      : "",
  ].filter(Boolean);
  const items = (Object.keys(folders.found) as (keyof FolderFacts["found"])[]).map(
    (key) => ({
      id: key,
      label: FOLDER_LABEL[key],
      ok: folders.found[key],
      note: FOLDER_PURPOSE[key],
    }),
  );
  if (missing.length === 0) {
    return {
      ...base,
      state: "ok",
      summary:
        "The AI-OS folder is in OneDrive with PMO-Inbox, Staff-Exchange and PTO-Inbox inside.",
      steps: [],
      details,
      actions: [],
      items,
    };
  }
  return {
    ...base,
    state: "attention",
    summary: `${missing.map((key) => FOLDER_LABEL[key]).join(", ")} ${missing.length === 1 ? "is" : "are"} not in the AI-OS folder yet.`,
    steps: ["Press Create the folders. Nothing that is already there is touched."],
    details,
    actions: ["create-folders"],
    items,
  };
}

const ago = (minutes: number): string =>
  minutes < 90
    ? `${Math.max(1, Math.round(minutes))} minutes`
    : `${Math.round(minutes / 60)} hours`;

/** What the flows have delivered: the only way to tell a flow works is that its files arrive. */
function flowsCheck(facts: SetupFacts): SetupCheck | null {
  const flows = facts.flows;
  if (!flows) return null;
  const base = { id: "flows" as const, title: "Power Automate flows", required: false };
  const details: string[] = [];
  const notes: string[] = [];
  const { pto, staff } = flows;
  details.push(
    pto.lastReceivedAt
      ? `PTO emails: last received ${pto.lastReceivedAt.slice(0, 10)}`
      : "PTO emails: none received yet",
  );
  if (pto.waiting > 0)
    details.push(`${pto.waiting} PTO email file(s) waiting to be read`);
  if (staff.waiting > 0 && staff.oldestMinutes !== null) {
    details.push(
      `${staff.waiting} profile request(s) waiting, the oldest for ${ago(staff.oldestMinutes)}`,
    );
  }
  if (staff.oldestMinutes !== null && staff.oldestMinutes >= 15) {
    notes.push(
      `A profile request has waited ${ago(staff.oldestMinutes)}: the M365 profile flow may be off or built with the wrong folder.`,
    );
  }
  if (pto.setAside > 0) {
    notes.push(
      `${pto.setAside} PTO ${pto.setAside === 1 ? "email was" : "emails were"} set aside because ${pto.setAside === 1 ? "it" : "they"} could not be filed as time off (the files and the reasons are in PTO-Inbox\\rejected).`,
    );
  }
  const items = [
    {
      id: "pto",
      label: "PTO emails",
      ok: pto.lastReceivedAt !== null,
      note: pto.lastReceivedAt
        ? `Last email received ${pto.lastReceivedAt.slice(0, 10)}`
        : "No email has arrived yet",
    },
    {
      id: "staff",
      label: "M365 profiles",
      ok: staff.oldestMinutes === null || staff.oldestMinutes < 15,
      note:
        staff.waiting === 0
          ? "No request is waiting"
          : `${staff.waiting} waiting, the oldest for ${ago(staff.oldestMinutes ?? 0)}`,
    },
  ];
  if (notes.length > 0) {
    return {
      ...base,
      state: "attention",
      summary: notes[0],
      steps: notes.slice(1),
      details,
      actions: [],
      items,
    };
  }
  return {
    ...base,
    state: pto.lastReceivedAt ? "ok" : "unknown",
    summary: pto.lastReceivedAt
      ? "The PTO email flow has delivered mail, and no request is stuck."
      : "No flow has delivered anything yet. The first-time setup shows how to build each flow; you can use AI OS without them.",
    steps: [],
    details,
    actions: [],
    items,
  };
}

export function buildReport(
  facts: SetupFacts,
  now: () => Date = () => new Date(),
): SetupReport {
  const checks = [
    ollamaCheck(facts),
    modelCheck(facts),
    foldersCheck(facts),
    flowsCheck(facts),
    engineCheck(facts),
    outlookCheck(facts),
  ].filter((c): c is SetupCheck => c !== null);
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
