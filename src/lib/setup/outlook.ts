// Is classic Outlook (the one with COM automation) available on this computer?
// The four older mail tasks drive it; "new Outlook" has no COM, so those tasks
// cannot work with it. This is a report only: it reads two registry keys and the
// list of installed packages and never opens Outlook, a mailbox or a message.

import type { RunResult } from "./ollamaInstall.ts";

export interface OutlookFacts {
  /** `Outlook.Application` is registered for COM (classic Outlook, now or once). */
  comRegistered: boolean | null;
  /** OUTLOOK.EXE is registered under App Paths. */
  classicInstalled: boolean | null;
  /** The Microsoft Store "new Outlook" package is installed. */
  newOutlook: boolean | null;
}

type Run = (
  command: string,
  args: string[],
  options?: { timeoutMs?: number },
) => Promise<RunResult>;

const COM_KEY = "HKCR\\Outlook.Application\\CLSID";
const APP_PATH_KEY =
  "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\OUTLOOK.EXE";
const NEW_OUTLOOK_COMMAND =
  "if (Get-AppxPackage -Name Microsoft.OutlookForWindows -ErrorAction SilentlyContinue) { 'yes' } else { 'no' }";

async function keyExists(run: Run, key: string): Promise<boolean | null> {
  try {
    const result = await run("reg.exe", ["query", key], { timeoutMs: 10_000 });
    if (result.status === 0) return true;
    // exit 1 = "unable to find the specified registry key"; anything else is unknown
    return result.status === 1 ? false : null;
  } catch {
    return null;
  }
}

export async function probeOutlook(
  run: Run,
  platform: string = process.platform,
): Promise<OutlookFacts> {
  if (platform !== "win32")
    return { comRegistered: null, classicInstalled: null, newOutlook: null };
  const [comRegistered, classicInstalled] = await Promise.all([
    keyExists(run, COM_KEY),
    keyExists(run, APP_PATH_KEY),
  ]);
  // Only worth asking (it is slow) when classic Outlook is not set up for COM.
  let newOutlook: boolean | null = null;
  if (comRegistered === true) return { comRegistered, classicInstalled, newOutlook };
  try {
    const result = await run(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", NEW_OUTLOOK_COMMAND],
      { timeoutMs: 20_000 },
    );
    if (result.status === 0) newOutlook = result.stdout.trim() === "yes";
  } catch {
    newOutlook = null;
  }
  return { comRegistered, classicInstalled, newOutlook };
}
