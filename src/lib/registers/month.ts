// Reading a month the way people type it ("2026-03", "3/2026", "Nov 2026") as yyyy-mm. Pure.

const NAMES = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

const valid = (year: number, month: number): string | null =>
  year >= 1900 && year <= 2200 && month >= 1 && month <= 12
    ? `${year}-${String(month).padStart(2, "0")}`
    : null;

const monthFromName = (word: string): number => {
  const lower = word.toLowerCase();
  if (lower.length < 3) return 0;
  const index = NAMES.findIndex((n) => lower.startsWith(n));
  return index < 0 ? 0 : index + 1;
};

/** "2026-03", "2026-3", "2026/03", "3/2026", "Nov 2026", "November 2026", "2026 Nov" or a full date as yyyy-mm; null when it is not a month. */
export function normaliseMonth(input: string): string | null {
  const text = input.trim();
  let m = /^(\d{4})[-/.](\d{1,2})(?:[-/.]\d{1,2})?$/.exec(text);
  if (m) return valid(Number(m[1]), Number(m[2]));
  m = /^(\d{1,2})[-/.](\d{4})$/.exec(text);
  if (m) return valid(Number(m[2]), Number(m[1]));
  m = /^([A-Za-z]{3,9})\.?[\s,-]+(\d{4})$/.exec(text);
  if (m) {
    const month = monthFromName(m[1]!);
    return month ? valid(Number(m[2]), month) : null;
  }
  m = /^(\d{4})[\s,-]+([A-Za-z]{3,9})\.?$/.exec(text);
  if (m) {
    const month = monthFromName(m[2]!);
    return month ? valid(Number(m[1]), month) : null;
  }
  return null;
}
