// What the "Fast AI model" switch shows. Pure, so `pnpm test` covers the wording and the
// states (installed, downloading, waiting for a download) without a server or a browser.
import { LIGHT_MODEL, downloadSizeText, sameModel } from "../setup/models.ts";

export interface SwitchOption {
  id: string;
  kind: "accurate" | "fast";
  /** null when Ollama could not be asked. */
  installed: boolean | null;
}

export interface SwitchInput {
  /** The model calls use right now. */
  active: string;
  /** The model asked for (the active one differs while the fast one downloads). */
  preferred: string;
  options: readonly SwitchOption[];
  /** The model download in progress, if any. */
  pull: { model: string; percent: number | null } | null;
  /** The last failure, shown instead of the hint. */
  error: string | null;
}

export interface SwitchView {
  checked: boolean;
  hint: string;
}

export function fastSwitchView(input: SwitchInput): SwitchView {
  const fast = input.options.find((o) => o.kind === "fast");
  const accurate = input.options.find((o) => o.kind === "accurate");
  const fastId = fast?.id ?? LIGHT_MODEL;
  const checked = sameModel(input.preferred, fastId);
  if (input.error) return { checked, hint: input.error };

  if (input.pull && sameModel(input.pull.model, fastId)) {
    const percent =
      input.pull.percent === null ? "" : ` ${Math.round(input.pull.percent)}%`;
    return {
      checked,
      hint: `Downloading ${fastId}${percent}. Using ${input.active} until then.`,
    };
  }
  if (checked && fast?.installed === false) {
    return { checked, hint: `${fastId} is not downloaded yet. Using ${input.active}.` };
  }
  if (checked)
    return { checked, hint: `${fastId}. Quicker answers, a little less careful.` };
  const careful = accurate?.id ?? input.active;
  // The careful model may not be the one answering (it is not installed here).
  if (!sameModel(input.active, careful)) {
    const reason =
      accurate?.installed === false
        ? `${careful}, the most careful, is not installed on this computer.`
        : `${careful} is the most careful.`;
    return { checked, hint: `Using ${input.active} right now. ${reason}` };
  }
  if (fast?.installed === false) {
    return {
      checked,
      hint: `${careful}, the most careful. Turn on to download ${fastId} (${downloadSizeText(fastId)}).`,
    };
  }
  return {
    checked,
    hint: `${careful}, the most careful. Slower on this computer.`,
  };
}
