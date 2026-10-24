// Installs Ollama (the local AI runtime) for the current user, the way a person
// would, but without needing to click through: download the official
// OllamaSetup.exe from ollama.com, check it is signed by Ollama Inc., run it
// silently (it installs per-user, no administrator rights) and check that
// `ollama --version` now answers. Every outside effect is injected, so tests run
// the whole flow against fakes: no download, no installer, no process.

export const OLLAMA_INSTALLER_URL = "https://ollama.com/download/OllamaSetup.exe";
export const OLLAMA_PUBLISHER = "Ollama Inc.";
/** Inno Setup switches: no pages, no message boxes, no reboot. */
export const OLLAMA_INSTALLER_ARGS = [
  "/SP-",
  "/VERYSILENT",
  "/SUPPRESSMSGBOXES",
  "/NORESTART",
];
const INSTALL_TIMEOUT_MS = 15 * 60_000;

export type InstallPhase =
  "idle" | "downloading" | "verifying" | "installing" | "checking" | "done" | "error";

export interface InstallProgress {
  phase: InstallPhase;
  /** 0-100 while downloading and the size is known. */
  percent: number | null;
  downloadedBytes: number;
  totalBytes: number | null;
  message: string;
  error?: string;
  /** Set when the person has to do it by hand (download blocked, no rights...). */
  manualSteps?: string[];
  version?: string;
}

export interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export interface OllamaInstallDeps {
  fetchImpl: typeof fetch;
  /** A fresh, empty folder for the download; returns its path. */
  makeTempDir: () => Promise<string>;
  /** Opens `path` for writing. */
  openWrite: (path: string) => Promise<{
    write: (chunk: Uint8Array) => Promise<void>;
    close: () => Promise<void>;
  }>;
  removeDir: (path: string) => Promise<void>;
  joinPath: (dir: string, name: string) => string;
  run: (
    command: string,
    args: string[],
    options?: { timeoutMs?: number; env?: Record<string, string> },
  ) => Promise<RunResult>;
  /** Where `ollama` is now (the resolution the AI runtime uses), if anywhere. */
  findOllama: () => string | undefined;
  onProgress: (progress: InstallProgress) => void;
  signal?: AbortSignal;
}

export function manualInstallSteps(): string[] {
  return [
    `On a computer with internet access, download the installer from ${OLLAMA_INSTALLER_URL.replace(/\/OllamaSetup\.exe$/, "")} (the Windows download).`,
    "Copy OllamaSetup.exe to this computer and double-click it. It installs for your user only; no administrator rights are needed.",
    "When it finishes, come back here and press Check again.",
  ];
}

/** PowerShell reads the path from an environment variable, so no quoting can go wrong. */
export const SIGNATURE_COMMAND =
  "$s = Get-AuthenticodeSignature -LiteralPath $env:AI_OS_VERIFY_PATH; " +
  "@{ status = $s.Status.ToString(); subject = [string]$s.SignerCertificate.Subject } | ConvertTo-Json -Compress";

export function parseSignature(stdout: string): { valid: boolean; publisher: string } {
  try {
    const value = JSON.parse(stdout.trim()) as { status?: string; subject?: string };
    const subject = String(value.subject ?? "");
    const publisher = /(?:^|,\s*)CN=([^,]+)/.exec(subject)?.[1]?.trim() ?? "";
    return { valid: value.status === "Valid", publisher };
  } catch {
    return { valid: false, publisher: "" };
  }
}

export function isOllamaSignature(signature: {
  valid: boolean;
  publisher: string;
}): boolean {
  return signature.valid && signature.publisher === OLLAMA_PUBLISHER;
}

async function download(deps: OllamaInstallDeps, destination: string): Promise<void> {
  const { fetchImpl, signal, onProgress } = deps;
  const response = await fetchImpl(OLLAMA_INSTALLER_URL, { signal, redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(`The download server answered HTTP ${response.status}.`);
  }
  const total = Number(response.headers.get("content-length")) || null;
  const out = await deps.openWrite(destination);
  let downloaded = 0;
  let lastReport = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      await out.write(value);
      downloaded += value.byteLength;
      if (downloaded - lastReport >= 4 * 1024 * 1024 || downloaded === total) {
        lastReport = downloaded;
        onProgress({
          phase: "downloading",
          percent: total
            ? Math.min(100, Math.floor((downloaded / total) * 1000) / 10)
            : null,
          downloadedBytes: downloaded,
          totalBytes: total,
          message: "Downloading Ollama from ollama.com…",
        });
      }
    }
  } finally {
    await out.close();
  }
  if (total && downloaded !== total) {
    throw new Error("The download ended early.");
  }
}

export async function installOllama(deps: OllamaInstallDeps): Promise<InstallProgress> {
  const emit = (progress: InstallProgress) => {
    deps.onProgress(progress);
    return progress;
  };
  const fail = (message: string, manual = true): InstallProgress =>
    emit({
      phase: "error",
      percent: null,
      downloadedBytes: 0,
      totalBytes: null,
      message,
      error: message,
      manualSteps: manual ? manualInstallSteps() : undefined,
    });

  emit({
    phase: "downloading",
    percent: null,
    downloadedBytes: 0,
    totalBytes: null,
    message: "Starting the download from ollama.com…",
  });

  let dir: string | undefined;
  try {
    dir = await deps.makeTempDir();
    const installer = deps.joinPath(dir, "OllamaSetup.exe");

    try {
      await download(deps, installer);
    } catch (error) {
      if (deps.signal?.aborted) return fail("The installation was cancelled.", false);
      const detail = error instanceof Error ? error.message : String(error);
      return fail(
        `Could not download Ollama (${detail}). A company network or proxy may be blocking ollama.com.`,
      );
    }

    emit({
      phase: "verifying",
      percent: null,
      downloadedBytes: 0,
      totalBytes: null,
      message: "Checking that the installer is signed by Ollama…",
    });
    const signature = await deps.run(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", SIGNATURE_COMMAND],
      { timeoutMs: 60_000, env: { AI_OS_VERIFY_PATH: installer } },
    );
    const parsed = parseSignature(signature.stdout);
    if (!isOllamaSignature(parsed)) {
      return fail(
        parsed.valid
          ? `The downloaded installer is signed by "${parsed.publisher}", not by Ollama Inc., so it was not run.`
          : "The downloaded installer does not have a valid signature, so it was not run.",
      );
    }

    emit({
      phase: "installing",
      percent: null,
      downloadedBytes: 0,
      totalBytes: null,
      message:
        "Installing Ollama. This takes a minute or two; nothing else is needed from you.",
    });
    const install = await deps.run(installer, OLLAMA_INSTALLER_ARGS, {
      timeoutMs: INSTALL_TIMEOUT_MS,
    });
    if (install.status !== 0) {
      return fail(
        install.status === null
          ? "The Ollama installer did not finish in time."
          : `The Ollama installer stopped with code ${install.status}.`,
      );
    }

    emit({
      phase: "checking",
      percent: null,
      downloadedBytes: 0,
      totalBytes: null,
      message: "Checking the installation…",
    });
    const exe = deps.findOllama();
    if (!exe) return fail("The installer finished, but Ollama was not found afterwards.");
    const version = await deps.run(exe, ["--version"], { timeoutMs: 30_000 });
    if (version.status !== 0)
      return fail("Ollama was installed but did not start when checked.");
    const shown = /(\d+\.\d+\.\d+\S*)/.exec(`${version.stdout} ${version.stderr}`)?.[1];
    return emit({
      phase: "done",
      percent: 100,
      downloadedBytes: 0,
      totalBytes: null,
      message: shown ? `Ollama ${shown} is installed.` : "Ollama is installed.",
      version: shown,
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  } finally {
    if (dir) await deps.removeDir(dir).catch(() => undefined);
  }
}
