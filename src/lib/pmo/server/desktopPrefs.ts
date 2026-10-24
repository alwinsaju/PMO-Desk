// The one setting the Electron shell needs without asking the UI: whether
// closing the window should keep the app running in the tray. The shell
// cannot read config.json (it lives in the data dir the Next server owns and
// may not be up), so the server mirrors the value into a tiny file in the
// shell's own userData folder, whose path the shell hands over as
// AI_OS_DESKTOP_PREFS_FILE. Outside the shell the variable is unset and this
// does nothing. The shell reads the file fresh each time a window is closed.
import type { PmoConfig } from "../types.ts";
import { writeJsonAtomic } from "./fsx.ts";
import { resolveDesktopPrefsFile } from "./paths.ts";

export async function syncDesktopPrefs(
  config: Pick<PmoConfig, "reminders">,
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  const file = resolveDesktopPrefsFile(env);
  if (!file) return;
  try {
    await writeJsonAtomic(file, {
      keepRunningInTray: config.reminders.keepRunningInTray,
    });
  } catch (error) {
    // The tray is a convenience; never let it break saving settings.
    console.error("[pmo] could not write the desktop prefs file:", error);
  }
}
