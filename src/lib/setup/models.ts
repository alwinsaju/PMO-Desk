// What the first-run setup knows about the local AI models: which ones it may
// pull, roughly how big they are, and what to warn about before a multi-GB
// download starts. Pure: no I/O, so `pnpm test` covers it directly.
import { MODEL_SIZE, formatBytes } from "../format.ts";

/** Used when the default model does not fit this computer (see core.ts). */
export const FALLBACK_MODEL = "qwen3.5:9b";

const GB = 1_000_000_000;

export interface ModelNeeds {
  /** Download size, approximate (Ollama does not announce it up front). */
  sizeBytes: number;
  /** RAM below which the model will be slow or swap. */
  minRamBytes: number;
}

/** Estimates, used only for advice. A model not listed gets no size warning. */
export const MODEL_NEEDS: Readonly<Record<string, ModelNeeds>> = {
  "gemma4:12b": { sizeBytes: 12 * GB, minRamBytes: 16 * 1024 ** 3 },
  "qwen3.5:9b": { sizeBytes: 6.6 * GB, minRamBytes: 12 * 1024 ** 3 },
};

/** "about 6.6 GB" for a model in the size table, else "of unknown size" (reads
 *  after "a download"). The table is MODEL_NEEDS: one place for both. */
export function downloadSizeText(model: string): string {
  const needs = Object.entries(MODEL_NEEDS).find(([tag]) => sameModel(tag, model));
  return needs
    ? `about ${formatBytes(needs[1].sizeBytes, MODEL_SIZE)}`
    : "of unknown size";
}

/** The model a download request is for: the smaller one when asked, else the
 *  one named, else the one in use. */
export function modelToPull(input: {
  requested: string | undefined;
  fallback: boolean;
  active: string;
}): string {
  return input.fallback ? FALLBACK_MODEL : input.requested?.trim() || input.active;
}

/** Only the configured default model and the fallback may be pulled from the UI. */
export function isPullable(model: string, defaultModel: string): boolean {
  const wanted = model.trim().toLowerCase();
  return wanted === defaultModel.trim().toLowerCase() || wanted === FALLBACK_MODEL;
}

/** "gemma4:12b" and "gemma4:12b:latest"-style tags compare by their name part. */
export function sameModel(a: string, b: string): boolean {
  const norm = (name: string) =>
    name
      .trim()
      .toLowerCase()
      .replace(/:latest$/, "");
  return norm(a) === norm(b);
}

export interface PreflightInput {
  model: string;
  /** Free space on the drive that holds Ollama's models, or null if unknown. */
  freeDiskBytes: number | null;
  totalRamBytes: number;
}

export interface Preflight {
  /** A reason the pull cannot work at all (not enough disk). */
  blocked: string | null;
  /** Things worth knowing first; the pull can still go ahead. */
  warnings: string[];
}

export function preflight({
  model,
  freeDiskBytes,
  totalRamBytes,
}: PreflightInput): Preflight {
  const needs = MODEL_NEEDS[model.trim().toLowerCase()];
  const warnings: string[] = [];
  let blocked: string | null = null;
  if (!needs) return { blocked, warnings };

  if (freeDiskBytes !== null) {
    if (freeDiskBytes < needs.sizeBytes * 1.05) {
      blocked =
        `There is not enough free disk space: ${model} needs about ${formatBytes(needs.sizeBytes, MODEL_SIZE)} ` +
        `and only ${formatBytes(freeDiskBytes, MODEL_SIZE)} is free. Free up space and try again.`;
    } else if (freeDiskBytes < needs.sizeBytes + 5 * GB) {
      warnings.push(
        `Disk space is tight: ${formatBytes(freeDiskBytes, MODEL_SIZE)} free for a ${formatBytes(needs.sizeBytes, MODEL_SIZE)} download.`,
      );
    }
  }
  if (totalRamBytes < needs.minRamBytes) {
    const gb = Math.round(totalRamBytes / 1024 ** 3);
    const need = Math.round(needs.minRamBytes / 1024 ** 3);
    warnings.push(
      `This computer has ${gb} GB of memory; ${model} runs best with ${need} GB or more` +
        (model.toLowerCase() === FALLBACK_MODEL
          ? "."
          : `. The smaller ${FALLBACK_MODEL} is a better fit.`),
    );
  }
  return { blocked, warnings };
}
