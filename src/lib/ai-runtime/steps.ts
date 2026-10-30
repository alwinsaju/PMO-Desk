// "Open Tasks, then what's overdue": a chain of commands run one after another, with the
// plan shown first. Only chains in which every step is understood are accepted; otherwise
// the whole text goes through the normal path. Pure.

export const MAX_STEPS = 3;

const SPLIT = /\s*(?:,\s*)?(?:\band\s+then\b|\bthen\b|\bafter\s+that\b)\s*/i;

/**
 * The steps of a chain, or null when it is not one: fewer than two parts, too many, or a
 * part that `understood` does not recognise.
 */
export function splitSteps(
  prompt: string,
  understood: (step: string) => boolean,
): string[] | null {
  const parts = prompt
    .split(SPLIT)
    .map((p) =>
      p
        .trim()
        .replace(/^[,;]+|[,;]+$/g, "")
        .trim(),
    )
    .filter(Boolean);
  if (parts.length < 2 || parts.length > MAX_STEPS) return null;
  return parts.every(understood) ? parts : null;
}

export const planText = (steps: readonly string[]): string =>
  `Plan: ${steps.map((s, i) => `${i + 1}. ${s}`).join("  ")}`;
