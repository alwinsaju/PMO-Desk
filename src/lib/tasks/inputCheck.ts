/** Checks an uploaded incident export before a run, and boils it down to a snapshot that two runs can be
 *  compared by. Reads the sheet data already parsed in the browser; nothing leaves the computer. Pure. */

export interface SheetData {
  sheet: string;
  data: unknown[][];
}

export interface SheetRule {
  sheet: string;
  required: string[];
  /** The first columns must be exactly these (the backlog report checks this). */
  leading?: string[];
}

const NUMBER_ETC = ["Number", "Assigned to", "Updated"];

/** Per `taskId:inputId`. Only the incident exports have rules; other files are just checked as readable. */
export const INPUT_RULES: Record<string, SheetRule> = {
  "weekly-aging-report:incident": { sheet: "Page 1", required: NUMBER_ETC },
  "weekly-backlog-report:incident": {
    sheet: "Page 1",
    required: ["Number", "Requested for", "Opened", "Assigned to"],
    leading: ["Number", "Requested for", "Opened"],
  },
  "monthly-report-deck:incident": {
    sheet: "Page 1",
    required: ["Number", "Opened", "Updated", "Assigned to", "Category", "Priority", "State"],
  },
};

export const ruleFor = (taskId: string, inputId: string): SheetRule | null =>
  INPUT_RULES[`${taskId}:${inputId}`] ?? null;

export interface InputCheck {
  ok: boolean;
  /** Things that will stop the task. */
  problems: string[];
  /** Things worth a look but not blocking. */
  warnings: string[];
  rows: number;
}

const text = (v: unknown) => (v == null ? "" : String(v).trim());

const asDate = (v: unknown): Date | null => {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v;
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v.trim())) {
    const d = new Date(v.trim());
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
};

const headerIndex = (header: unknown[]): Map<string, number> => {
  const map = new Map<string, number>();
  header.forEach((h, i) => {
    const key = text(h);
    if (key && !map.has(key)) map.set(key, i);
  });
  return map;
};

/** How old the newest "Updated" may be before the export looks stale. */
export const STALE_DAYS = 14;

export function checkSheets(
  sheets: readonly SheetData[],
  rule: SheetRule,
  now: Date,
): InputCheck {
  const sheet = sheets.find((s) => s.sheet === rule.sheet);
  if (!sheet) {
    return {
      ok: false,
      problems: [
        `There is no sheet called “${rule.sheet}”. Download the export again without renaming it.`,
      ],
      warnings: [],
      rows: 0,
    };
  }
  const [header = [], ...body] = sheet.data;
  const index = headerIndex(header);
  const problems: string[] = [];
  const missing = rule.required.filter((c) => !index.has(c));
  if (missing.length) problems.push(`Missing column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}.`);
  if (rule.leading && rule.leading.some((c, i) => text(header[i]) !== c)) {
    problems.push(`The first columns should be ${rule.leading.join(", ")}.`);
  }
  const rows = body.filter((r) => r.some((c) => text(c) !== "")).length;
  const warnings: string[] = [];
  if (rows === 0) problems.push("The sheet has no rows.");

  const updated = index.get("Updated");
  if (updated !== undefined && rows > 0) {
    const dates = body.map((r) => asDate(r[updated])).filter((d): d is Date => !!d);
    if (dates.length > 0) {
      const newest = dates.reduce((a, b) => (a > b ? a : b));
      const age = Math.floor((now.getTime() - newest.getTime()) / 86_400_000);
      if (age > STALE_DAYS) {
        warnings.push(
          `This export looks old: its newest update was ${age} days ago (${newest.toISOString().slice(0, 10)}).`,
        );
      }
    }
  }
  const number = index.get("Number");
  if (number !== undefined && rows > 0) {
    const seen = new Set<string>();
    let dupes = 0;
    for (const r of body) {
      const n = text(r[number]);
      if (!n) continue;
      if (seen.has(n)) dupes += 1;
      seen.add(n);
    }
    if (dupes > 0) warnings.push(`${dupes} incident number${dupes > 1 ? "s appear" : " appears"} more than once.`);
  }
  return { ok: problems.length === 0, problems, warnings, rows };
}

/** One incident, as much as the comparison needs. */
export interface SnapshotRow {
  n: string;
  priority: string;
  /** yyyy-mm-dd the incident was opened, "" if unknown. */
  opened: string;
}

export interface RunSnapshot {
  taskId: string;
  /** ISO time the file was read. */
  at: string;
  total: number;
  rows: SnapshotRow[];
}

export function snapshotFrom(
  taskId: string,
  sheets: readonly SheetData[],
  rule: SheetRule,
  now: Date,
): RunSnapshot | null {
  const sheet = sheets.find((s) => s.sheet === rule.sheet);
  if (!sheet) return null;
  const [header = [], ...body] = sheet.data;
  const index = headerIndex(header);
  const number = index.get("Number");
  if (number === undefined) return null;
  const priority = index.get("Priority");
  const opened = index.get("Opened");
  const rows: SnapshotRow[] = [];
  for (const r of body) {
    const n = text(r[number]);
    if (!n) continue;
    const date = opened === undefined ? null : asDate(r[opened]);
    rows.push({
      n,
      priority: priority === undefined ? "" : text(r[priority]),
      opened: date ? date.toISOString().slice(0, 10) : "",
    });
  }
  return { taskId, at: now.toISOString(), total: rows.length, rows };
}

export interface Comparison {
  added: SnapshotRow[];
  closed: SnapshotRow[];
  carried: number;
  /** Carried over and opened more than `ageDays` ago. */
  ageing: SnapshotRow[];
}

export function compareSnapshots(
  previous: RunSnapshot,
  current: RunSnapshot,
  ageDays = 30,
): Comparison {
  const before = new Set(previous.rows.map((r) => r.n));
  const after = new Set(current.rows.map((r) => r.n));
  const cutoff = new Date(current.at);
  cutoff.setDate(cutoff.getDate() - ageDays);
  const cut = cutoff.toISOString().slice(0, 10);
  const carried = current.rows.filter((r) => before.has(r.n));
  return {
    added: current.rows.filter((r) => !before.has(r.n)),
    closed: previous.rows.filter((r) => !after.has(r.n)),
    carried: carried.length,
    ageing: carried.filter((r) => r.opened !== "" && r.opened < cut),
  };
}

export function comparisonText(c: Comparison): string {
  return `${c.added.length} new, ${c.closed.length} closed, ${c.carried} carried over${
    c.ageing.length ? ` (${c.ageing.length} open more than 30 days)` : ""
  }.`;
}

/** Counts per priority, biggest first. */
export function byPriority(rows: readonly SnapshotRow[]): { priority: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.priority || "Unknown", (counts.get(r.priority || "Unknown") ?? 0) + 1);
  return [...counts]
    .map(([priority, count]) => ({ priority, count }))
    .sort((a, b) => b.count - a.count || a.priority.localeCompare(b.priority));
}

/** Keeps the newest snapshots per task (without the rows of the older ones, which a trend does not need). */
export const MAX_SNAPSHOTS = 12;

const MAX_ROWS = 8_000;

/** Stored snapshots, with anything malformed dropped. */
export function sanitizeSnapshots(value: unknown): RunSnapshot[] {
  if (!Array.isArray(value)) return [];
  const out: RunSnapshot[] = [];
  for (const raw of value.slice(-60)) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.taskId !== "string" || typeof r.at !== "string") continue;
    if (Number.isNaN(Date.parse(r.at)) || !Array.isArray(r.rows)) continue;
    const rows: SnapshotRow[] = [];
    for (const row of r.rows.slice(0, MAX_ROWS)) {
      if (!row || typeof row !== "object") continue;
      const x = row as Record<string, unknown>;
      if (typeof x.n !== "string") continue;
      rows.push({
        n: x.n.slice(0, 40),
        priority: typeof x.priority === "string" ? x.priority.slice(0, 40) : "",
        opened: typeof x.opened === "string" ? x.opened.slice(0, 10) : "",
      });
    }
    const total = Number.isFinite(r.total) ? Number(r.total) : rows.length;
    out.push({ taskId: r.taskId.slice(0, 120), at: r.at, total, rows });
  }
  return out;
}

export function pushSnapshot(list: readonly RunSnapshot[], snap: RunSnapshot): RunSnapshot[] {
  const mine = [...list.filter((s) => s.taskId === snap.taskId), snap].slice(-MAX_SNAPSHOTS);
  const others = list.filter((s) => s.taskId !== snap.taskId);
  return [...others, ...mine.map((s, i) => (i < mine.length - 1 ? { ...s, rows: [] } : s))];
}

/** SVG polyline points for a small trend line; null with fewer than two values. */
export function sparkline(values: readonly number[], width: number, height: number): string | null {
  if (values.length < 2) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  return values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = height - ((v - min) / span) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}
