/**
 * Pure helpers for bulk-filling the review queue's Subcategory2 values from
 * a pasted two-column block or a spreadsheet, instead of clicking through
 * every incident. No React, no network, no spreadsheet library — the
 * caller hands in already-parsed rows (see readWorkbook.ts for the .xlsx
 * side) — so every rule below can be unit-tested directly.
 *
 * Vocabulary rule: a value matching an existing option
 * (case/whitespace-insensitively) is normalized to that option's spelling.
 * Any other non-blank value is accepted as a NEW label, exactly as typed
 * (whitespace collapsed) — the engine and the downstream workbook build
 * take any label — and reported in `newLabels` so typos can be spotted
 * before saving. Near-duplicates inside one import ("Server Related" /
 * "server related") collapse to the first spelling seen.
 */
import { findSimilarLabel } from "./labelMatch.ts";
import type { ReviewIncident } from "./types";

/** One (incident number, Subcategory2) pair read from a paste or a sheet. */
export interface ImportRow {
  number: string;
  value: string;
  /** "review" rows come from a sheet/paste that only contains queue
   *  candidates, so a number missing from the queue is worth reporting.
   *  "all" rows come from a whole-month sheet (e.g. `Incidents`), where
   *  thousands of non-queue numbers are expected and silently ignored. */
  scope?: "review" | "all";
  /** Which paste/sheet the row came from. Repeats within one source: the
   *  later row wins (a re-typed correction); across sources: the earlier,
   *  higher-priority source wins. */
  source?: string;
}

/** One sheet as returned by the spreadsheet reader. */
export interface SheetData {
  sheet: string;
  data: unknown[][];
}

export interface ImportPlan {
  /** Everything that gets staged: existing options (canonicalized) and new labels. */
  resolutions: { number: string; subcategory2: string }[];
  /** Distinct labels not in the option list, with how many incidents use each. */
  newLabels: { label: string; count: number }[];
  /** Row's number isn't in the review queue (only reported for "review" rows). */
  notInQueue: { number: string; value: string }[];
  /** Queue incidents the import supplied nothing usable for (blank, "skip",
   *  placeholder or absent) that aren't already resolved. */
  stillBlank: string[];
  /** Matches that replace a different already-staged/saved value. */
  overwrites: number;
  /** Numbers that appeared more than once with usable values (last wins). */
  duplicates: number;
}

/** Lower-cases and collapses every run of whitespace (incl. NBSP) so
 *  "Hardware  issue " and "hardware issue" compare equal. */
export function normalizeKey(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Values that mean "no answer" — the engine ignores "skip", and
 *  "Needs Review" is the placeholder prepare_data writes into unresolved
 *  rows, so a sheet that still holds it hasn't been filled in. */
const BLANK_PLACEHOLDERS = new Set(["", "skip", "needs review"]);

function isBlankValue(value: string): boolean {
  return BLANK_PLACEHOLDERS.has(normalizeKey(value));
}

// ---------------------------------------------------------------------------
// Column / header detection
// ---------------------------------------------------------------------------

/** Header text with everything but letters and digits dropped, so
 *  "Sub-category 2", "SubCategory2" and "subcategory_2" all become
 *  "subcategory2". */
function headerKey(cell: unknown): string {
  return String(cell ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

const NUMBER_HEADERS = new Set([
  "number",
  "incident",
  "incidentnumber",
  "incidentno",
  "incno",
  "incnumber",
  "inc",
  "ticket",
  "ticketnumber",
]);
const SUBCATEGORY2_HEADERS = new Set(["subcategory2", "subcat2", "subcategory02"]);

/** Finds the incident-number and Subcategory2 column indexes in a header
 *  row, or null unless both are present. */
export function findColumns(
  headerRow: unknown[],
): { number: number; subcategory2: number } | null {
  const keys = headerRow.map(headerKey);
  const number = keys.findIndex((key) => NUMBER_HEADERS.has(key));
  const subcategory2 = keys.findIndex((key) => SUBCATEGORY2_HEADERS.has(key));
  return number >= 0 && subcategory2 >= 0 ? { number, subcategory2 } : null;
}

function cellText(cell: unknown): string {
  if (cell === null || cell === undefined) return "";
  if (cell instanceof Date) return "";
  return String(cell).replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Paste
// ---------------------------------------------------------------------------

/** Splits one pasted line into cells: tabs (what Excel copies) win, then
 *  commas (CSV, honouring simple "quoted, values"), then the first run of
 *  whitespace ("INC123 Hardware Issue"). */
function splitLine(line: string): string[] {
  if (line.includes("\t")) return line.split("\t");
  if (line.includes(",")) {
    const cells: string[] = [];
    let current = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (quoted && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          quoted = !quoted;
        }
      } else if (char === "," && !quoted) {
        cells.push(current);
        current = "";
      } else {
        current += char;
      }
    }
    cells.push(current);
    return cells;
  }
  const match = line.trim().match(/^(\S+)\s+(.*)$/);
  return match ? [match[1], match[2]] : [line];
}

function stripQuotes(text: string): string {
  const trimmed = text.trim();
  return trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')
    ? trimmed.slice(1, -1).trim()
    : trimmed;
}

/**
 * Parses pasted text (two columns copied out of Excel, or CSV) into rows.
 * An optional header row is detected by name; when it names the columns
 * they're honoured (so a wider paste still works), otherwise column 1 is
 * the number and column 2 the Subcategory2. Rows with no number are
 * dropped; a number with no second cell yields an empty value (which later
 * counts as "still blank", not as a resolution).
 */
export function parsePastedText(text: string): ImportRow[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length === 0) return [];

  let numberCol = 0;
  let valueCol = 1;
  let start = 0;
  const header = findColumns(splitLine(lines[0]));
  if (header) {
    numberCol = header.number;
    valueCol = header.subcategory2;
    start = 1;
  }

  const rows: ImportRow[] = [];
  for (const line of lines.slice(start)) {
    const cells = splitLine(line);
    const number = stripQuotes(cells[numberCol] ?? "");
    if (!number) continue;
    rows.push({
      number,
      value: stripQuotes(cells[valueCol] ?? ""),
      scope: "review",
      source: "paste",
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Workbook
// ---------------------------------------------------------------------------

/** How many leading rows to scan for the header, in case a sheet has a
 *  title banner above it. */
const HEADER_SCAN_ROWS = 10;

/**
 * Pulls (number, Subcategory2) rows out of every sheet that has both
 * columns, `Review Needed` first, then `Incidents`, then any other. A
 * sheet is skipped silently if it lacks either header. Rows from a
 * "Review Needed" sheet are scoped "review" (unknown numbers get
 * reported); rows from any other sheet are scoped "all" (the whole
 * month — unknown numbers are expected and ignored).
 *
 * Rows come back in sheet-priority order, so planImport's first-wins merge
 * means a value filled in on `Review Needed` beats one on `Incidents`, and
 * a blank on `Review Needed` falls through to `Incidents`.
 */
export function rowsFromSheets(sheets: SheetData[]): ImportRow[] {
  const priority = (name: string) => {
    const key = headerKey(name);
    if (key === "reviewneeded") return 0;
    if (key === "incidents") return 1;
    return 2;
  };
  const ordered = [...sheets].sort((a, b) => priority(a.sheet) - priority(b.sheet));

  const rows: ImportRow[] = [];
  for (const { sheet, data } of ordered) {
    let headerIndex = -1;
    let columns: { number: number; subcategory2: number } | null = null;
    for (let i = 0; i < Math.min(data.length, HEADER_SCAN_ROWS); i++) {
      columns = findColumns(data[i] ?? []);
      if (columns) {
        headerIndex = i;
        break;
      }
    }
    if (!columns) continue;

    const scope = priority(sheet) === 0 ? "review" : "all";
    for (const row of data.slice(headerIndex + 1)) {
      const number = cellText(row?.[columns.number]);
      if (!number) continue;
      rows.push({
        number,
        value: cellText(row?.[columns.subcategory2]),
        scope,
        source: sheet,
      });
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Matching / validation
// ---------------------------------------------------------------------------

/**
 * Validates import rows against the live queue and returns what would be
 * staged plus everything that wasn't. Pure — staging is the caller's job
 * (see applyResolutions).
 *
 * Per number only usable (non-blank) rows count. Within one source (the
 * paste, or a single sheet) a repeated number takes the LATER row and is
 * counted in `duplicates`; across sources the FIRST wins, which is how a
 * value filled in on `Review Needed` outranks `Incidents` while a blank
 * there falls through to it.
 */
export function planImport(
  incidents: ReviewIncident[],
  options: string[],
  rows: ImportRow[],
): ImportPlan {
  const optionByKey = new Map<string, string>();
  for (const option of options) {
    const key = normalizeKey(option);
    if (key && !optionByKey.has(key)) optionByKey.set(key, option);
  }
  const incidentByKey = new Map<string, ReviewIncident>();
  for (const incident of incidents) {
    incidentByKey.set(normalizeKey(incident.number), incident);
  }

  const chosen = new Map<string, ImportRow>();
  let duplicates = 0;
  for (const row of rows) {
    if (isBlankValue(row.value)) continue;
    const key = normalizeKey(row.number);
    const existing = chosen.get(key);
    if (!existing) {
      chosen.set(key, row);
    } else if (existing.source === row.source) {
      if (existing.value !== row.value) duplicates++;
      chosen.set(key, row);
    }
  }

  const plan: ImportPlan = {
    resolutions: [],
    newLabels: [],
    notInQueue: [],
    stillBlank: [],
    overwrites: 0,
    duplicates,
  };
  const supplied = new Set<string>();

  for (const [key, row] of chosen) {
    const incident = incidentByKey.get(key);
    if (!incident) {
      if (row.scope !== "all")
        plan.notInQueue.push({ number: row.number, value: row.value });
      continue;
    }
    supplied.add(key);
    const valueKey = normalizeKey(row.value);
    let canonical =
      optionByKey.get(valueKey) ?? findSimilarLabel(row.value, options) ?? undefined;
    if (!canonical) {
      // New label: the first spelling seen in this import wins for all, including
      // later spellings of it that only differ by a typo ("softgood" / "soft goods").
      const spelling =
        findSimilarLabel(
          row.value,
          plan.newLabels.map((entry) => entry.label),
        ) ?? null;
      const existing = spelling
        ? plan.newLabels.find((entry) => entry.label === spelling)
        : undefined;
      if (existing) {
        existing.count++;
        canonical = existing.label;
      } else {
        canonical = row.value.replace(/\s+/g, " ").trim();
        const entry = { label: canonical, count: 1 };
        plan.newLabels.push(entry);
      }
    }
    plan.resolutions.push({ number: incident.number, subcategory2: canonical });
    if (incident.resolved_subcategory2 && incident.resolved_subcategory2 !== canonical) {
      plan.overwrites++;
    }
  }

  for (const incident of incidents) {
    if (!supplied.has(normalizeKey(incident.number)) && !incident.resolved_subcategory2) {
      plan.stillBlank.push(incident.number);
    }
  }
  return plan;
}

/**
 * The single staging path for resolutions: returns the incidents with the
 * given resolutions applied (later entries replace earlier ones and any
 * previously staged value for the same incident — the import wins) plus
 * the resulting pending count. Used for one-at-a-time picks and bulk
 * imports alike, so `pending` and the dirty flag can't diverge between them.
 */
export function applyResolutions(
  incidents: ReviewIncident[],
  resolutions: { number: string; subcategory2: string }[],
): { incidents: ReviewIncident[]; pending: number } {
  const byNumber = new Map(resolutions.map((r) => [r.number, r.subcategory2]));
  const next = incidents.map((incident) =>
    byNumber.has(incident.number)
      ? { ...incident, resolved_subcategory2: byNumber.get(incident.number) as string }
      : incident,
  );
  return {
    incidents: next,
    pending: next.filter((i) => !i.resolved_subcategory2).length,
  };
}

/** The full set of currently resolved incidents, in the exact shape the
 *  engine's review-resolutions POST wants. The engine OVERWRITES its file
 *  with whatever is posted, so this must always be the complete set. */
export function toResolutionPayload(
  incidents: ReviewIncident[],
): { number: string; subcategory2: string }[] {
  return incidents
    .filter((i) => i.resolved_subcategory2)
    .map((i) => ({ number: i.number, subcategory2: i.resolved_subcategory2 as string }));
}

/**
 * The option list with spelling variants of one category folded into its
 * first spelling ("softgood issue" next to "Soft Goods Issue" is listed once),
 * plus any label already resolved on an incident that the list doesn't
 * contain (a new label staged this session, or one saved earlier and handed
 * back by the engine), so those show up in the picker for reuse. The list's
 * own spelling wins.
 */
export function withResolvedLabels(
  options: string[],
  incidents: ReviewIncident[],
): string[] {
  const result: string[] = [];
  const add = (label: string) => {
    if (!findSimilarLabel(label, result)) result.push(label);
  };
  options.forEach(add);
  for (const incident of incidents) {
    if (incident.resolved_subcategory2) add(incident.resolved_subcategory2);
  }
  const unchanged =
    result.length === options.length &&
    result.every((label, index) => label === options[index]);
  return unchanged ? options : result;
}
