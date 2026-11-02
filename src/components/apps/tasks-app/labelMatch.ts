/**
 * Recognises that two spellings are the same category, so typing "softgood
 * issue" picks "Soft Goods Issue" instead of adding a second, nearly identical
 * option. The rules mirror tasks/monthly-report-deck/scripts/labels.py (the
 * Python side that folds the saved workbook's labels); both are tested with
 * the same cases. Pure: no React, no network.
 *
 * Same label = after lower-casing, dropping punctuation/spaces and ignoring a
 * plural "s" per word, the digits are identical and the text is identical or
 * a typo away (one character; two from 20 characters). Short labels (under 12
 * characters) must match exactly ("EDQ Issue" is not "EOD Issue"), the first
 * letter must match, a typo may not introduce a word another category uses
 * ("Referral issue" is not a typo of "Deferral issue"), and a label that adds
 * a whole word ("... Arm Used" vs "... Arm Used PIN") is more than a typo.
 */

const FUZZY_MIN_LENGTH = 12;
const LONG_LENGTH = 20;

function stem(word: string): string {
  return word.length > 3 && word.endsWith("s") && !word.endsWith("ss")
    ? word.slice(0, -1)
    : word;
}

export function labelWords(label: string): string[] {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map(stem);
}

export function labelKey(label: string): string {
  return labelWords(label).join("");
}

function digitsOf(key: string): string {
  return (key.match(/\d+/g) ?? []).join(",");
}

function within(a: string, b: string, limit: number): boolean {
  if (Math.abs(a.length - b.length) > limit) return false;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current.push(
        Math.min(
          previous[j] + 1,
          current[j - 1] + 1,
          previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
        ),
      );
    }
    if (Math.min(...current) > limit) return false;
    previous = current;
  }
  return previous[b.length] <= limit;
}

/** Same label up to a typo; `isKnownWord` says whether a word is in real use elsewhere. */
export function isSameLabel(
  label: string,
  other: string,
  isKnownWord: (word: string) => boolean = () => false,
): boolean {
  const key = labelKey(label);
  const otherKey = labelKey(other);
  if (!key || !otherKey) return false;
  if (key === otherKey) return true;
  const longest = Math.max(key.length, otherKey.length);
  if (
    longest < FUZZY_MIN_LENGTH ||
    key[0] !== otherKey[0] ||
    digitsOf(key) !== digitsOf(otherKey)
  ) {
    return false;
  }
  if (!within(key, otherKey, longest >= LONG_LENGTH ? 2 : 1)) return false;
  const ownWords = new Set(labelWords(other));
  return !labelWords(label).some((word) => !ownWords.has(word) && isKnownWord(word));
}

/** The option that `label` is a spelling of (exact or a typo), or null when it is new. */
export function findSimilarLabel(
  label: string,
  options: readonly string[],
): string | null {
  const key = labelKey(label);
  if (!key) return null;
  const exact = options.find((option) => labelKey(option) === key);
  if (exact) return exact;
  for (const option of options) {
    const knownElsewhere = (word: string) =>
      options.some((other) => other !== option && labelWords(other).includes(word));
    if (isSameLabel(label, option, knownElsewhere)) return option;
  }
  return null;
}
