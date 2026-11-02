/**
 * Pure helpers for the fast review flow: pick a category once and move on,
 * add a category that isn't in the list, apply one answer to identical
 * tickets, and accept the local AI model's suggestions in bulk. No React, no
 * network, so every rule can be unit-tested directly.
 */
import { findSimilarLabel } from "./labelMatch.ts";
import { normalizeKey } from "./reviewImport.ts";
import type { AiSuggestion, ReviewIncident } from "./types";

const MAX_LABEL_LENGTH = 60;

/** Status placeholders come from the ticket State, never from a human or the AI. */
const RESERVED_LABELS = new Set(["", "skip", "needs review"]);

export type LabelCheck =
  | { ok: true; label: string; isNew: boolean; matchedFrom?: string }
  | { ok: false; reason: string };

/**
 * Turns what the user typed into the label to save: an existing option (any
 * casing/spacing, plural or small typo) keeps the list's own spelling, so the
 * same category is never added twice; anything else becomes a new category
 * with whitespace collapsed. `matchedFrom` is set when a differently spelled
 * option was used instead of what was typed.
 */
export function resolveLabel(typed: string, options: readonly string[]): LabelCheck {
  const label = typed.replace(/\s+/g, " ").trim();
  const key = normalizeKey(label);
  if (RESERVED_LABELS.has(key)) {
    return { ok: false, reason: "Type a category name." };
  }
  if (label.length > MAX_LABEL_LENGTH) {
    return {
      ok: false,
      reason: `Keep category names under ${MAX_LABEL_LENGTH} characters.`,
    };
  }
  const existing = options.find((option) => normalizeKey(option) === key);
  if (existing) return { ok: true, label: existing, isNew: false };
  const similar = findSimilarLabel(label, options);
  return similar
    ? { ok: true, label: similar, isNew: false, matchedFrom: label }
    : { ok: true, label, isNew: true };
}

/**
 * Options narrowed by a search. `canAdd` is true only when the text is a
 * genuinely new category; `similar` is the existing option the text is merely
 * another spelling of (offered as "use this one" instead of an add row).
 */
export function searchOptions(
  options: readonly string[],
  query: string,
): { matches: string[]; canAdd: boolean; similar: string | null } {
  const key = normalizeKey(query);
  if (!key) return { matches: [...options], canAdd: false, similar: null };
  const matches = options.filter((option) => normalizeKey(option).includes(key));
  const exact = options.some((option) => normalizeKey(option) === key);
  const similar = exact ? null : findSimilarLabel(query, options);
  return { matches, canAdd: !exact && !similar && !RESERVED_LABELS.has(key), similar };
}

/** The next unresolved incident after `currentNumber`, wrapping around; null when none remain. */
export function nextPendingNumber(
  incidents: readonly ReviewIncident[],
  currentNumber: string | null,
): string | null {
  const start = incidents.findIndex((i) => i.number === currentNumber);
  for (let step = 1; step <= incidents.length; step++) {
    const candidate = incidents[(start + step + incidents.length) % incidents.length];
    if (
      candidate &&
      !candidate.resolved_subcategory2 &&
      candidate.number !== currentNumber
    ) {
      return candidate.number;
    }
  }
  return null;
}

/** The neighbouring incident (any state) for Previous/Next browsing. */
export function neighbourNumber(
  incidents: readonly ReviewIncident[],
  currentNumber: string,
  direction: 1 | -1,
): string | null {
  const index = incidents.findIndex((i) => i.number === currentNumber);
  if (index < 0) return null;
  return incidents[index + direction]?.number ?? null;
}

function descriptionKey(incident: ReviewIncident): string {
  return normalizeKey(incident.short_description ?? "");
}

/**
 * Other unresolved incidents of the same kind of ticket: the same Short
 * description, or resolution notes that are almost the same text (the
 * engine's `notes_group`), so one answer can be applied to all of them.
 */
export function similarPending(
  incidents: readonly ReviewIncident[],
  incident: ReviewIncident,
): ReviewIncident[] {
  const key = descriptionKey(incident);
  const group = incident.notes_group;
  if (!key && !group) return [];
  return incidents.filter(
    (other) =>
      other.number !== incident.number &&
      !other.resolved_subcategory2 &&
      ((key && descriptionKey(other) === key) || (group && other.notes_group === group)),
  );
}

const CONFIDENCE_RANK: Record<AiSuggestion["confidence"], number> = {
  low: 0,
  medium: 1,
  high: 2,
};

/** Resolutions that accepting the AI suggestions of unresolved incidents would stage.
 *  A suggested label that is only another spelling of an existing option is staged
 *  as that option, so accepting suggestions never adds a duplicate category. */
export function acceptableSuggestions(
  incidents: readonly ReviewIncident[],
  minConfidence: AiSuggestion["confidence"] = "low",
  options: readonly string[] = [],
): { number: string; subcategory2: string }[] {
  return incidents
    .filter(
      (i) =>
        !i.resolved_subcategory2 &&
        i.ai_suggestion &&
        CONFIDENCE_RANK[i.ai_suggestion.confidence] >= CONFIDENCE_RANK[minConfidence],
    )
    .map((i) => {
      const label = (i.ai_suggestion as AiSuggestion).label;
      return {
        number: i.number,
        subcategory2: findSimilarLabel(label, options) ?? label,
      };
    });
}
