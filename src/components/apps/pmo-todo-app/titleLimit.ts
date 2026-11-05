// The to-do title limit the server enforces, and the counter the forms show near it.
export const TITLE_MAX = 200;

/** "187 / 200" once the title is within 20% of the limit, else null (no clutter). */
export function titleCounter(length: number, max = TITLE_MAX): string | null {
  return length >= Math.floor(max * 0.8) ? `${length} / ${max}` : null;
}
