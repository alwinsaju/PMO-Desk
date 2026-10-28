// The real-world half of first-run setup: reads this computer, runs the install,
// the model download and the self-test as background jobs, and saves the PMO
// inbox choice. Import from route handlers only. Everything decided here is
// thin wiring; the logic lives in the pure modules next to this file, which the
// tests cover with fakes.
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  statfsSync,
  writeFileSync,
} from "node:fs";
import { mkdir, mkdtemp, open, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolvePython } from "@/app/api/tasks-engine/python";
import {
  ensureRuntime,
  getActiveModel,
  getAiRuntimeConfig,
  getRuntimeStatus,
} from "@/lib/ai-runtime";
import { resolveOllamaExe } from "@/lib/ai-runtime/core";
import { allowedModels, saveModelChoice } from "@/lib/ai-runtime/modelChoice";
import { withoutTlsOverride } from "@/lib/security/childEnv";
import { Store } from "@/lib/pmo/server/store";
import { resolveDataDir, resolveInboxDir } from "@/lib/pmo/server/paths";
import { ollamaStartDue, outlookProbeDue, type StatusContext } from "./background";
import { modelsOnDisk } from "./diskModels";
import { oneDriveFacts, saveInboxChoice } from "./inbox";
import { inboxSafetyFacts } from "./inboxFs";
import { JobRegistry, type JobKind, type JobSnapshot } from "./jobs";
import { FALLBACK_MODEL, isPullable, modelToPull, preflight } from "./models";
import { installOllama, type InstallProgress, type RunResult } from "./ollamaInstall";
import { probeOutlook, type OutlookFacts } from "./outlook";
import { pullModel, type PullProgress } from "./pull";
import {
  buildReport,
  type SelfTestFacts,
  type SetupFacts,
  type SetupReport,
} from "./report";
import {
  loadReusableSelfTest,
  saveSelfTest,
  selfTestFile,
  type SelfTestIo,
} from "./selfTestCache";

declare global {
  var aiOsSetupJobs: JobRegistry | undefined;
  var aiOsSetupOutlook: { at: number; facts: OutlookFacts } | undefined;
  var aiOsSetupOllamaTry: number | undefined;
}

const NO_OUTLOOK_FACTS: OutlookFacts = {
  comRegistered: null,
  classicInstalled: null,
  newOutlook: null,
};

const jobs = () => (globalThis.aiOsSetupJobs ??= new JobRegistry());
const isDirectory = (p: string) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/** Runs a command to completion, hidden, without a shell. Resolves with
 *  `status: null` if it had to be killed for taking too long. */
export function runCommand(
  command: string,
  args: string[],
  options: { timeoutMs?: number; env?: Record<string, string>; cwd?: string } = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...withoutTlsOverride(), ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill();
        }, options.timeoutMs)
      : undefined;
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.once("error", (error) => {
      if (timer) clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ status: timedOut ? null : code, stdout, stderr });
    });
  });
}

// --- reading the computer ---------------------------------------------------

function modelsDir(): string {
  return (
    process.env.OLLAMA_MODELS?.trim() || path.join(os.homedir(), ".ollama", "models")
  );
}

/** Free bytes on the drive that holds `dir` (or its nearest existing parent). */
function freeBytes(dir: string): number | null {
  let probe = path.resolve(dir);
  for (let i = 0; i < 8 && !existsSync(probe); i++) probe = path.dirname(probe);
  try {
    const stats = statfsSync(probe);
    return Number(stats.bavail) * Number(stats.bsize);
  } catch {
    return null;
  }
}

async function installedModels(baseUrl: string): Promise<string[] | null> {
  try {
    const res = await fetch(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(3_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { models?: { name?: string; model?: string }[] };
    return (body.models ?? []).map((m) => m.name ?? m.model ?? "").filter(Boolean);
  } catch {
    return null;
  }
}

/** The Outlook question is slow (a PowerShell start): see background.ts for when it repeats. */
async function cachedOutlook(context: StatusContext): Promise<OutlookFacts> {
  const cached = globalThis.aiOsSetupOutlook;
  const now = Date.now();
  if (!outlookProbeDue({ context, cachedAt: cached?.at, now })) {
    return cached?.facts ?? NO_OUTLOOK_FACTS;
  }
  const facts = await probeOutlook(runCommand);
  globalThis.aiOsSetupOutlook = { at: now, facts };
  return facts;
}

/** Setup's model check needs Ollama: start it in the background, at most once a minute. */
function startOllamaForSetup(
  context: StatusContext,
  exeFound: boolean,
  running: boolean,
): void {
  const now = Date.now();
  if (
    !ollamaStartDue({
      context,
      exeFound,
      running,
      lastAttemptAt: globalThis.aiOsSetupOllamaTry,
      now,
    })
  ) {
    return;
  }
  globalThis.aiOsSetupOllamaTry = now;
  void ensureRuntime().catch(() => undefined);
}

function currentSelfTest(): SelfTestFacts | "running" | null {
  const snapshot = jobs().job<SelfTestFacts>("selftest").snapshot();
  if (snapshot.running) return "running";
  if (snapshot.progress) return snapshot.progress;
  // A pass from the last week for this version stands in for a new run.
  return loadReusableSelfTest(selfTestFile(resolveDataDir()), selfTestIo, {
    now: Date.now(),
    appVersion: appVersion(),
  });
}

const selfTestIo: SelfTestIo = {
  read: (file) => (existsSync(file) ? readFileSync(file, "utf8") : null),
  write: (file, text) => {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  },
};

/** The desktop shell sets AI_OS_APP_VERSION; `pnpm dev` falls back to package.json. */
function appVersion(): string {
  const fromEnv = process.env.AI_OS_APP_VERSION?.trim();
  if (fromEnv) return fromEnv;
  try {
    const pkg = JSON.parse(
      readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
    );
    return typeof pkg.version === "string" ? pkg.version : "unknown";
  } catch {
    return "unknown";
  }
}

export async function collectFacts(
  context: StatusContext = "refresh",
): Promise<SetupFacts> {
  const config = getAiRuntimeConfig();
  const exe = resolveOllamaExe({
    env: process.env,
    platform: process.platform,
    exists: existsSync,
    override: config.ollamaExe,
  });
  const runtime = await getRuntimeStatus();
  const store = new Store(resolveDataDir());
  const inboxPath = resolveInboxDir((await store.loadConfig()).inboxDir);
  const python = resolvePython();
  startOllamaForSetup(context, Boolean(exe.path), runtime.running);
  // A stopped Ollama cannot list its models; the manifests on disk can.
  const onDisk = runtime.running
    ? null
    : modelsOnDisk(modelsDir(), allowedModels(), existsSync);

  return {
    platform: process.platform,
    ollama: {
      exe: exe.path ?? null,
      running: runtime.running,
      version: runtime.version ?? null,
      installedModels: runtime.running
        ? await installedModels(config.baseUrl)
        : onDisk && onDisk.length > 0
          ? onDisk
          : null,
      defaultModel: runtime.defaultModel,
      ...(runtime.modelNote ? { modelNote: runtime.modelNote } : {}),
    },
    hardware: { totalRamBytes: os.totalmem(), freeDiskBytes: freeBytes(modelsDir()) },
    inbox: {
      path: inboxPath,
      fromEnvironment: Boolean(process.env.AI_OS_PMO_INBOX_DIR?.trim()),
      exists: isDirectory(inboxPath),
      oneDrive: oneDriveFacts(process.env, isDirectory),
      isDirectory,
    },
    outlook: await cachedOutlook(context),
    engine: { python, selfTest: currentSelfTest() },
  };
}

export interface SetupStatus {
  report: SetupReport;
  jobs: {
    install: JobSnapshot<InstallProgress>;
    pull: JobSnapshot<PullProgress>;
  };
}

export async function getStatus(
  context: StatusContext = "refresh",
): Promise<SetupStatus> {
  const facts = await collectFacts(context);
  return {
    report: buildReport(facts),
    jobs: {
      install: jobs().job<InstallProgress>("install-ollama").snapshot(),
      pull: jobs().job<PullProgress>("pull-model").snapshot(),
    },
  };
}

// --- actions ------------------------------------------------------------------

export type ActionResult =
  { ok: true } | { ok: false; reason: string; needsConfirmation?: true };

export function startInstall(): ActionResult {
  const job = jobs().job<InstallProgress>("install-ollama");
  if (job.running) return { ok: true };
  void job
    .start(async (update, signal) => {
      const config = getAiRuntimeConfig();
      await installOllama({
        fetchImpl: fetch,
        makeTempDir: () => mkdtemp(path.join(os.tmpdir(), "ai-os-ollama-")),
        openWrite: async (file, options) => {
          const handle = await open(file, options?.append ? "a" : "w");
          return {
            write: async (chunk) => void (await handle.write(chunk)),
            close: () => handle.close(),
          };
        },
        removeDir: (dir) => rm(dir, { recursive: true, force: true }),
        joinPath: path.join,
        run: runCommand,
        findOllama: () =>
          resolveOllamaExe({
            env: process.env,
            platform: process.platform,
            exists: existsSync,
            override: config.ollamaExe,
          }).path,
        onProgress: update,
        signal,
      });
    })
    .catch((error) => console.error("[setup] ollama install failed:", error));
  return { ok: true };
}

export async function startPull(
  requested: string | undefined,
  fallback: boolean,
): Promise<ActionResult> {
  const config = getAiRuntimeConfig();
  const active = getActiveModel();
  const model = modelToPull({ requested, fallback, active });
  if (!isPullable(model, config.defaultModel) && !isPullable(model, active)) {
    return {
      ok: false,
      reason: `AI OS only downloads ${config.defaultModel} or ${FALLBACK_MODEL}.`,
    };
  }
  const check = preflight({
    model,
    freeDiskBytes: freeBytes(modelsDir()),
    totalRamBytes: os.totalmem(),
  });
  if (check.blocked) return { ok: false, reason: check.blocked };

  const job = jobs().job<PullProgress>("pull-model");
  if (job.running) return { ok: true };
  // The choice is what makes every AI call ask for this model from now on.
  const saved = saveModelChoice(model);
  if (!saved.ok) console.error("[setup]", saved.reason);
  void job
    .start(async (update, signal) => {
      await pullModel({
        fetchImpl: fetch,
        baseUrl: config.baseUrl,
        model,
        signal,
        onProgress: update,
        ensureServer: async () => (await ensureRuntime()).running,
      });
    })
    .catch((error) => console.error("[setup] model download failed:", error));
  return { ok: true };
}

export function cancel(
  kind: Extract<JobKind, "install-ollama" | "pull-model">,
): ActionResult {
  jobs().job(kind).cancel();
  return { ok: true };
}

/** The Python used for the self-test: the console build, so its output is readable. */
function consolePython(exe: string): string {
  const dir = path.dirname(exe);
  return path.basename(exe).toLowerCase() === "pythonw.exe" &&
    existsSync(path.join(dir, "python.exe"))
    ? path.join(dir, "python.exe")
    : exe;
}

export function startSelfTest(): ActionResult {
  const python = resolvePython();
  if (!python) {
    return { ok: false, reason: "No Python was found for the Tasks engine." };
  }
  const job = jobs().job<SelfTestFacts>("selftest");
  if (job.running) return { ok: true };
  void job
    .start(async (update) => {
      const failed = (detail: string): SelfTestFacts => ({
        ok: false,
        python: "unknown",
        checks: [{ id: "run", title: "Self-test", ok: false, detail }],
      });
      try {
        const result = await runCommand(
          consolePython(python),
          [path.join(process.cwd(), "tasks-engine", "selftest.py")],
          {
            timeoutMs: 300_000,
            env: { PYTHONNOUSERSITE: "1" },
            cwd: path.join(process.cwd(), "tasks-engine"),
          },
        );
        const line = result.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) ?? "";
        const facts =
          result.status === 0 && line
            ? (JSON.parse(line) as SelfTestFacts)
            : failed(
                result.status === null
                  ? "The self-test took too long."
                  : (result.stderr || "no output").trim().slice(-500),
              );
        saveSelfTest(selfTestFile(resolveDataDir()), facts, selfTestIo, {
          now: Date.now(),
          appVersion: appVersion(),
        });
        update(facts);
      } catch (error) {
        update(failed(error instanceof Error ? error.message : String(error)));
      }
    })
    .catch((error) => console.error("[setup] self-test failed:", error));
  return { ok: true };
}

export async function saveInbox(
  raw: unknown,
  options: { confirmNonEmpty?: boolean } = {},
): Promise<ActionResult> {
  const store = new Store(resolveDataDir());
  await mkdir(store.root, { recursive: true });
  return saveInboxChoice({
    raw,
    env: process.env,
    store,
    isDirectory,
    isAbsolute: path.isAbsolute,
    confirmNonEmpty: options.confirmNonEmpty === true,
    safety: inboxSafetyFacts(store.root),
  });
}
