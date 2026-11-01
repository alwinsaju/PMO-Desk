// Small pure helpers for the to-do and board cards: avatar initials, the action-item
// summary and the per-card "expanded" memory (see cardView.test.mjs).
import type { ActionItem } from "./types.ts";

const PLACEHOLDER = "?";

/** Up to two capital letters for an avatar: "Pat Example" -> "PE", "pat.lee@x.com" ->
 *  "PL", "Sam" -> "S". Nothing usable gives "?". */
export function initials(name: string | null | undefined): string {
  const raw = (name ?? "").trim();
  if (!raw) return PLACEHOLDER;
  const source = raw.includes("@") ? raw.slice(0, raw.indexOf("@")) : raw;
  const words = source
    .split(/[\s._\-,]+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
  if (words.length === 0) return PLACEHOLDER;
  const letters =
    words.length === 1
      ? [...words[0]][0]
      : [...words[0]][0] + [...words[words.length - 1]][0];
  return letters.toLocaleUpperCase("en");
}

export interface ActionItemsView {
  done: number;
  total: number;
  /** "2 of 5 done", or "All 3 done"; empty without items. */
  label: string;
  /** The items this card lists when expanded; the rest are behind "+N more". */
  shown: ActionItem[];
  hidden: number;
}

export const CARD_ITEM_LIMIT = 5;

export function actionItemsView(
  items: readonly ActionItem[],
  limit = CARD_ITEM_LIMIT,
): ActionItemsView {
  const total = items.length;
  const done = items.filter((item) => item.done).length;
  const shown = items.slice(0, limit);
  return {
    done,
    total,
    label:
      total === 0
        ? ""
        : done === total
          ? `All ${total} done`
          : `${done} of ${total} done`,
    shown,
    hidden: total - shown.length,
  };
}

/** `flags` with `id` switched on or off, without touching the original. Off removes
 *  the key, so the record only ever holds what is open. */
export function toggleFlag(
  flags: Readonly<Record<string, true>>,
  id: string,
): Record<string, true> {
  const next = { ...flags };
  if (next[id]) delete next[id];
  else next[id] = true;
  return next;
}
