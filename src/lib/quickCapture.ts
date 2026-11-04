/**
 * The "Quick capture" setting (Quick settings): an opt-in global hotkey of the desktop
 * app. While PMO Desk is running it brings the window forward from any other program and
 * puts the cursor in the command bar, ready to type "/todo ...". The shell owns the
 * shortcut and its saved setting (desktop/quick-capture.cjs, <userData>/quick-capture.json);
 * this file is only the page's side: the bridge shape and the wording of the row.
 */

/** What the desktop shell reports (see createQuickCapture().snapshot()). */
export interface QuickCaptureState {
  /** The saved setting: the person asked for the hotkey. */
  enabled: boolean;
  /** The shortcut is really registered with Windows right now. */
  registered: boolean;
  /** Electron accelerator, e.g. "Control+Shift+Space". */
  accelerator: string;
  /** The same, as the person reads it: "Ctrl+Shift+Space". */
  label: string;
  /** Plain sentence when it was asked for but could not be registered, or saving failed. */
  error: string | null;
}

/** window.aiOsDesktop.quickCapture (desktop/preload.cjs). */
export interface QuickCaptureBridge {
  getState: () => Promise<QuickCaptureState | null>;
  setEnabled: (enabled: boolean) => Promise<QuickCaptureState | null>;
}

type BridgeShape = { quickCapture?: QuickCaptureBridge };

/** The desktop shell's quick-capture bridge; undefined in a plain browser. */
export function getQuickCaptureBridge(): QuickCaptureBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { aiOsDesktop?: BridgeShape }).aiOsDesktop?.quickCapture;
}

export interface QuickCaptureView {
  /** The switch position: what the person asked for. */
  checked: boolean;
  /** One short helper line under the title. */
  hint: string;
  /** Why it is not working (taken by another app, could not save), or null. */
  warning: string | null;
}

export const DEFAULT_LABEL = "Ctrl+Shift+Space";

/** What the Settings row shows, as a pure function of what the shell reported
 *  (`state` is null before it answered or when a call failed). */
export function describeQuickCapture(input: {
  state: QuickCaptureState | null;
  error?: string | null;
}): QuickCaptureView {
  const { state, error } = input;
  const label = state?.label || DEFAULT_LABEL;
  const checked = state?.enabled === true;
  const warning = (checked ? state?.error : null) ?? error ?? null;
  return {
    checked,
    hint: checked
      ? `Press ${label} from any app to add a to-do`
      : `Off. Turn on to add a to-do from any app (${label})`,
    warning,
  };
}
