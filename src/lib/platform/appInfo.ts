// What the app is and where its data is. Server only.
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveDataDir } from "../pmo/server/paths.ts";
import { folderSize } from "./backup.ts";

/** The desktop shell sets AI_OS_APP_VERSION; `pnpm dev` falls back to package.json. */
export function appVersion(
  env: Record<string, string | undefined> = process.env,
): string {
  const fromEnv = env.AI_OS_APP_VERSION?.trim();
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

export interface PlatformInfo {
  version: string;
  dataDir: string;
  files: number;
  bytes: number;
  desktop: boolean;
  /** The computer account's name, only used to greet the person ("Welcome, Alex"). */
  account: string;
}

function accountName(env: Record<string, string | undefined>): string {
  try {
    return os.userInfo().username;
  } catch {
    return env.USERNAME ?? "";
  }
}

export async function platformInfo(
  env: Record<string, string | undefined> = process.env,
): Promise<PlatformInfo> {
  const dataDir = resolveDataDir(env);
  const size = await folderSize(dataDir);
  return {
    version: appVersion(env),
    dataDir,
    files: size.files,
    bytes: size.bytes,
    desktop: env.AI_OS_DESKTOP_MODE === "1",
    account: accountName(env),
  };
}
