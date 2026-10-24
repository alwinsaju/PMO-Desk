// Read-only tail of the Ollama SERVER's own log, for the "Raw" view of the model
// log dialog. Two fixed locations, nothing derived from a request:
//   - AI OS started Ollama:   %TEMP%\ai-os-ollama.log (lifecycle.ts writes it)
//   - someone else's Ollama:  %LOCALAPPDATA%\Ollama\server.log (the tray app's)
// This file only decides WHICH path and how to cut the tail; the actual file
// access is injected (index.ts passes read-only fs calls), so tests never touch
// a real disk. It never opens anything for writing.
import path from "node:path";

export const SERVER_LOG_MAX_BYTES = 256 * 1024;
export const SERVER_LOG_MAX_LINES = 200;
export const SERVER_LOG_MAX_LINE_CHARS = 2000;

export interface ServerLogSource {
  kind: "owned" | "external" | "none";
  /** Short plain wording for the UI: whose log this is. */
  label: string;
  /** The fixed file read (shown so the user knows what it is), when there is one. */
  path?: string;
}

export interface ServerLogTail {
  source: ServerLogSource;
  lines: string[];
  /** The file was longer than what was read (older lines are not shown). */
  truncated: boolean;
  /** No such file (yet), or it could not be read. */
  unavailable: string | null;
}

/** The log of an Ollama that AI OS spawned. Single definition: lifecycle.ts
 *  writes to it and the reader below reads from it. */
export function ownedLogPath(
  tmpDir: string,
  platform: string = process.platform,
): string {
  const p = platform === "win32" ? path.win32 : path.posix;
  return p.join(tmpDir, "ai-os-ollama.log");
}

export interface ResolveOptions {
  owned: boolean;
  platform: string;
  env: Record<string, string | undefined>;
  tmpDir: string;
  home?: string;
}

export function resolveServerLog(options: ResolveOptions): ServerLogSource {
  const { owned, platform, env, tmpDir, home } = options;
  if (owned) {
    return {
      kind: "owned",
      label: "Ollama's output (AI OS started this Ollama)",
      path: ownedLogPath(tmpDir, platform),
    };
  }
  if (platform === "win32") {
    const local = Object.entries(env).find(
      ([k]) => k.toLowerCase() === "localappdata",
    )?.[1];
    if (local) {
      return {
        kind: "external",
        label: "Ollama's own server log (a shared Ollama that AI OS did not start)",
        path: path.win32.join(local, "Ollama", "server.log"),
      };
    }
  } else if (platform === "darwin" && home) {
    return {
      kind: "external",
      label: "Ollama's own server log (a shared Ollama that AI OS did not start)",
      path: path.posix.join(home, ".ollama", "logs", "server.log"),
    };
  }
  return {
    kind: "none",
    label: "Ollama's server log",
  };
}

export interface TailDeps {
  /** Size in bytes, or null if the file does not exist. */
  size(file: string): number | null;
  /** Read `length` bytes starting at `start` (read-only). */
  read(file: string, start: number, length: number): string;
}

/** Last `maxLines` lines of the file, reading at most `maxBytes` from its end. */
export function readServerLogTail(
  source: ServerLogSource,
  deps: TailDeps,
  limits: { maxBytes?: number; maxLines?: number; maxLineChars?: number } = {},
): ServerLogTail {
  const maxBytes = limits.maxBytes ?? SERVER_LOG_MAX_BYTES;
  const maxLines = limits.maxLines ?? SERVER_LOG_MAX_LINES;
  const maxLineChars = limits.maxLineChars ?? SERVER_LOG_MAX_LINE_CHARS;

  if (!source.path) {
    return {
      source,
      lines: [],
      truncated: false,
      unavailable: "AI OS does not know where this Ollama writes its log.",
    };
  }
  try {
    const size = deps.size(source.path);
    if (size === null) {
      return { source, lines: [], truncated: false, unavailable: "No log file yet." };
    }
    const start = Math.max(0, size - maxBytes);
    const text = size === 0 ? "" : deps.read(source.path, start, size - start);
    let lines = text.split(/\r?\n/);
    // Starting mid-file: the first line is probably cut in half.
    if (start > 0) lines = lines.slice(1);
    while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    const truncated = start > 0 || lines.length > maxLines;
    lines = lines
      .slice(-maxLines)
      .map((line) =>
        line.length > maxLineChars ? `${line.slice(0, maxLineChars)}…` : line,
      );
    return { source, lines, truncated, unavailable: null };
  } catch (error) {
    return {
      source,
      lines: [],
      truncated: false,
      unavailable: `Could not read the log: ${error instanceof Error ? error.message : "unknown error"}.`,
    };
  }
}
