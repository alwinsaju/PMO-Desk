// Pasting incidents into the SLA watcher: lines of "Number, Priority, Opened[, Title]" from a spreadsheet
// or an export. Pure.
import { isIsoDate } from "../staff/dates.ts";
import { MAX_TEXT } from "./types.ts";

export interface SlaRow {
  ref: string;
  title: string;
  priority: "P1" | "P2" | "P3" | "P4";
  received: string;
}

export interface SlaImport {
  rows: SlaRow[];
  skipped: { line: string; reason: string }[];
}

const MONTHS = [
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

/** yyyy-mm-dd, d/m/yyyy (day first), d-Mon-yyyy or "5 Mar 2026" (a time after the date is ignored). */
export function parseDay(text: string): string | null {
  const t = text
    .trim()
    .split(/[ T]\d{1,2}:\d{2}/)[0]!
    .trim();
  if (isIsoDate(t)) return t;
  const slash = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(t);
  if (slash) {
    const iso = `${slash[3]}-${slash[2]!.padStart(2, "0")}-${slash[1]!.padStart(2, "0")}`;
    return isIsoDate(iso) ? iso : null;
  }
  const named = /^(\d{1,2})[ -]([A-Za-z]{3})[a-z]*[ ,-]*(\d{4})$/.exec(t);
  if (named) {
    const m = MONTHS.indexOf(named[2]!.toLowerCase());
    if (m < 0) return null;
    const iso = `${named[3]}-${String(m + 1).padStart(2, "0")}-${named[1]!.padStart(2, "0")}`;
    return isIsoDate(iso) ? iso : null;
  }
  return null;
}

/** "1 - Critical" and "P2" and "high" to P1..P4. Words count as whole words: "urgentish" is not urgent. */
export function parsePriority(text: string): SlaRow["priority"] | null {
  const t = text.trim().toLowerCase();
  const digit = /^(?:p)?([1-4])\b/.exec(t);
  if (digit) return `P${digit[1]}` as SlaRow["priority"];
  if (/\b(critical|urgent)\b/.test(t)) return "P1";
  if (/\bhigh\b/.test(t)) return "P2";
  if (/\b(moderate|medium)\b/.test(t)) return "P3";
  if (/\blow\b/.test(t)) return "P4";
  return null;
}

/** The text after "Added 5 items" for the lines that were left out: how many, and up to three different reasons. */
export function skippedText(skipped: SlaImport["skipped"]): string {
  if (skipped.length === 0) return "";
  const reasons = [...new Set(skipped.map((s) => s.reason))];
  const shown = reasons.slice(0, 3).join("; ");
  return `; skipped ${skipped.length} (${shown}${reasons.length > 3 ? "; and more" : ""})`;
}

export function parseSlaRows(text: string): SlaImport {
  const rows: SlaRow[] = [];
  const skipped: SlaImport["skipped"] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells = line.includes("\t") ? line.split("\t") : line.split(",");
    if (cells.length < 3) {
      skipped.push({ line, reason: "needs a number, a priority and a date" });
      continue;
    }
    const [ref, prio, opened, ...rest] = cells.map((c) => c.trim());
    if (/^(number|ref|reference|id)$/i.test(ref!)) continue;
    const priority = parsePriority(prio!);
    const received = parseDay(opened!);
    if (!ref) skipped.push({ line, reason: "no number in front" });
    else if (!priority) skipped.push({ line, reason: `unknown priority “${prio}”` });
    else if (!received) skipped.push({ line, reason: `unknown date “${opened}”` });
    else if (seen.has(ref.toLowerCase())) {
      skipped.push({ line, reason: `“${ref}” is listed twice` });
    } else {
      seen.add(ref.toLowerCase());
      rows.push({
        ref: ref.slice(0, MAX_TEXT),
        title: (rest.join(", ").trim() || ref).slice(0, MAX_TEXT),
        priority,
        received,
      });
    }
  }
  return { rows, skipped };
}
