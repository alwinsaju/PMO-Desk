// Reading, checking and listing register records. Pure: shared by the page and the server.
import { csvSafeCell } from "../pmo/todoExport.ts";
import { normaliseMonth } from "./month.ts";
import {
  MAX_LONGTEXT,
  MAX_TEXT,
  MAX_URL,
  type FieldDef,
  type FieldValue,
  type RegisterDef,
  type RegisterRecord,
} from "./types.ts";

export function newRecordId(): string {
  const hex =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "")
      : Math.random().toString(16).slice(2).padEnd(12, "0");
  return `rg_${hex.slice(0, 12)}`;
}

export const RECORD_ID = /^rg_[0-9a-f]{12}$/;

const tidy = (v: unknown): string =>
  typeof v === "string" ? v.replace(/\u0000/g, "").trim() : "";

const clean = (v: unknown, max: number): string => tidy(v).slice(0, max);

/** Text up to `max` characters. Too long is refused (never cut silently), except when reading a saved file (`lenient`). */
function limited(
  field: FieldDef,
  raw: unknown,
  max: number,
  lenient: boolean,
): { value: string } | { error: string } {
  const text = tidy(raw);
  if (text.length <= max) return { value: text };
  if (lenient) return { value: text.slice(0, max) };
  return {
    error: `${field.label} is too long: ${text.length.toLocaleString("en")} characters, at most ${max.toLocaleString("en")}.`,
  };
}

/** The values a new record starts with. */
export function defaultValues(
  def: RegisterDef,
  today: string,
): Record<string, FieldValue> {
  const values: Record<string, FieldValue> = {};
  for (const f of def.fields) {
    if (f.default === "today") values[f.key] = today;
    else if (f.default !== undefined) values[f.key] = f.default;
    else values[f.key] = f.type === "boolean" ? false : f.type === "tags" ? [] : "";
  }
  return values;
}

/** A web address people can open: http or https, with a host after exactly two slashes and no name or password in it. */
export const isHttpUrl = (value: string): boolean => {
  if (!/^https?:\/\/[^/\s?#\\]/i.test(value)) return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      url.hostname !== "" &&
      url.username === "" &&
      url.password === ""
    );
  } catch {
    return false;
  }
};

/** What a saved link had to pass before the host check was added; used when reading a file so old links stay. */
const isLegacyUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
};

/** A real calendar day, years 0001 to 9999. `isIsoDate` (shared with the other apps) is left alone: it reads years
 *  0001 to 0099 as 1901 to 1999 and so refuses them. The toolkit's own date maths (`addDays`, `daysBetween`) parses
 *  the text and is right for those years, so a register may hold them; `setUTCFullYear` is exact for any year. */
function isRealDate(text: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return false;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (year < 1) return false;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function coerce(
  field: FieldDef,
  raw: unknown,
  lenient: boolean,
): { value: FieldValue } | { error: string } {
  switch (field.type) {
    case "text": {
      if (field.format === "month") {
        const text = clean(raw, MAX_TEXT);
        if (text === "") return { value: "" };
        const month = normaliseMonth(text);
        if (month) return { value: month };
        return lenient
          ? { value: text }
          : {
              error: `${field.label} must be a month like 2026-03 (“Nov 2026” works too).`,
            };
      }
      return limited(field, raw, MAX_TEXT, lenient);
    }
    case "person":
      return limited(field, raw, MAX_TEXT, lenient);
    case "longtext":
      return limited(field, raw, MAX_LONGTEXT, lenient);
    case "select": {
      const text = clean(raw, MAX_TEXT);
      if (text === "") return { value: "" };
      return field.options?.includes(text)
        ? { value: text }
        : { error: `${field.label} must be one of: ${field.options?.join(", ")}.` };
    }
    case "date": {
      const text = clean(raw, 10);
      if (text === "") return { value: "" };
      return isRealDate(text)
        ? { value: text }
        : { error: `${field.label} is not a real date (use year-month-day).` };
    }
    case "number": {
      if (raw === "" || raw === null || raw === undefined) return { value: "" };
      const n = typeof raw === "number" ? raw : Number(String(raw).trim());
      if (!Number.isFinite(n) || Math.abs(n) > 1e12) {
        return { error: `${field.label} must be a number.` };
      }
      if (!lenient && field.integer && !Number.isInteger(n)) {
        return { error: `${field.label} must be a whole number.` };
      }
      if (
        (field.min !== undefined && n < field.min) ||
        (field.max !== undefined && n > field.max)
      ) {
        const range =
          field.min !== undefined && field.max !== undefined
            ? `between ${field.min} and ${field.max}`
            : field.min !== undefined
              ? `at least ${field.min}`
              : `at most ${field.max}`;
        return { error: `${field.label} must be ${range}.` };
      }
      return { value: n };
    }
    case "url": {
      const long = limited(field, raw, MAX_URL, lenient);
      if ("error" in long) return long;
      const text = long.value;
      if (text === "") return { value: "" };
      return (lenient ? isLegacyUrl(text) : isHttpUrl(text))
        ? { value: text }
        : {
            error: `${field.label} must be a web address starting with http:// or https:// and a site name.`,
          };
    }
    case "tags": {
      const list = Array.isArray(raw)
        ? raw
        : typeof raw === "string"
          ? raw.split(",")
          : [];
      const tags = [...new Set(list.map((t) => clean(t, 40)).filter(Boolean))].slice(
        0,
        20,
      );
      return { value: tags };
    }
    case "boolean":
      return { value: raw === true || raw === "true" };
  }
}

interface FieldProblem {
  key: string;
  message: string;
}

/** Every problem with the input, in field order, each tied to the field to mark; the cleaned values alongside.
 *  `lenient` is for reading a saved file: rules added after a record was saved (a longer text, the month format,
 *  the cross-field rules) do not fail it. Wrong select options, numbers and dates still do. */
function checkValues(
  def: RegisterDef,
  input: unknown,
  lenient = false,
): { values: Record<string, FieldValue>; problems: FieldProblem[] } {
  const raw =
    typeof input === "object" && input !== null && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const values: Record<string, FieldValue> = {};
  const problems: FieldProblem[] = [];
  for (const field of def.fields) {
    const result = coerce(field, raw[field.key], lenient);
    if ("error" in result) {
      problems.push({ key: field.key, message: result.error });
      continue;
    }
    values[field.key] = result.value;
    const empty =
      result.value === "" || (Array.isArray(result.value) && result.value.length === 0);
    if (field.required && empty) {
      problems.push({ key: field.key, message: `${field.label} is required.` });
    }
  }
  const range = problems.length === 0 && !lenient ? crossCheck(def, values) : null;
  if (range) problems.push(range);
  return { values, problems };
}

/** The values for a record, each cleaned to its field's type; unknown keys are dropped. */
export function sanitizeValues(
  def: RegisterDef,
  input: unknown,
  lenient = false,
): { ok: true; values: Record<string, FieldValue> } | { ok: false; reason: string } {
  const { values, problems } = checkValues(def, input, lenient);
  return problems.length > 0
    ? { ok: false, reason: problems[0].message }
    : { ok: true, values };
}

/** What is wrong with each field, by field key, so the form can mark the field itself. */
export function fieldErrors(def: RegisterDef, input: unknown): Record<string, string> {
  return Object.fromEntries(
    checkValues(def, input).problems.map((p) => [p.key, p.message]),
  );
}

/** Rules that involve two fields; the problem is shown on the later one. */
function crossCheck(
  def: RegisterDef,
  values: Record<string, FieldValue>,
): FieldProblem | null {
  if (def.id === "capacity" && values.from && values.to && values.to < values.from) {
    return { key: "to", message: "The end date cannot be before the start date." };
  }
  if (
    def.id === "vendors" &&
    values.startDate &&
    values.renewalDate &&
    values.renewalDate < values.startDate
  ) {
    return {
      key: "renewalDate",
      message: "The renewal or end date cannot be before the contract start.",
    };
  }
  if (def.id === "sla") {
    if (values.resolvedOn && values.received && values.resolvedOn < values.received) {
      return {
        key: "resolvedOn",
        message: "Resolved on cannot be before it was received.",
      };
    }
    if (values.status === "Open" && values.resolvedOn) {
      return {
        key: "resolvedOn",
        message:
          "This item is still Open: clear Resolved on, or set the status to Resolved.",
      };
    }
    if (values.status === "Resolved" && !values.resolvedOn) {
      return {
        key: "resolvedOn",
        message: "Add the day it was resolved, or set the status back to Open.",
      };
    }
  }
  return null;
}

/** The form's side effects of changing one field: an SLA item set to Resolved gets today as its resolved day,
 *  and one set back to Open loses it, so the two never disagree. Returns the values to use. */
export function applyFieldChange(
  def: RegisterDef,
  values: Record<string, FieldValue>,
  key: string,
  value: FieldValue,
  today: string,
): Record<string, FieldValue> {
  const next = { ...values, [key]: value };
  if (def.id === "sla" && key === "status") {
    if (value === "Resolved" && !next.resolvedOn) next.resolvedOn = today;
    if (value === "Open") next.resolvedOn = "";
  }
  return next;
}

const asStamp = (value: unknown, now: string): string | null =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  Date.parse(value) <= Date.parse(now)
    ? value
    : null;

/** A whole record from what the page sent; keeps the id, creation time and to-do link of an existing one.
 *  A new record may bring its own `createdAt` (an Undo of a delete restores the original time). */
export function sanitizeRecord(
  def: RegisterDef,
  input: unknown,
  now: string,
  existing?: RegisterRecord,
  lenient = false,
): { ok: true; record: RegisterRecord } | { ok: false; reason: string } {
  const raw =
    typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  const parsed = sanitizeValues(def, raw.values, lenient);
  if (!parsed.ok) return parsed;
  const id =
    existing?.id ??
    (typeof raw.id === "string" && RECORD_ID.test(raw.id) ? raw.id : newRecordId());
  const todoId =
    typeof raw.todoId === "string" && /^[a-z]{1,4}_[0-9a-f]{8,40}$/.test(raw.todoId)
      ? raw.todoId
      : existing?.todoId;
  return {
    ok: true,
    record: {
      id,
      createdAt: existing?.createdAt ?? asStamp(raw.createdAt, now) ?? now,
      updatedAt: now,
      values: parsed.values,
      ...(todoId ? { todoId } : {}),
    },
  };
}

export const CONFIG_MIN = 1;
export const CONFIG_MAX = 365;

/** Why these settings cannot be saved (every number must be a whole number of days), or null when they can. */
export function configProblem(def: RegisterDef, input: unknown): string | null {
  const raw =
    typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  for (const [key, fallback] of Object.entries(def.config ?? {})) {
    if (typeof fallback !== "number" || raw[key] === undefined) continue;
    const value = raw[key];
    const n = typeof value === "number" ? value : Number(String(value).trim());
    const blank = value === "" || value === null || String(value).trim() === "";
    if (blank || !Number.isInteger(n) || n < CONFIG_MIN || n > CONFIG_MAX) {
      return `${key.toUpperCase()} days must be a whole number from ${CONFIG_MIN} to ${CONFIG_MAX}.`;
    }
  }
  return null;
}

export function sanitizeConfig(
  def: RegisterDef,
  input: unknown,
): Record<string, FieldValue> {
  const base = def.config ?? {};
  const raw =
    typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  const out: Record<string, FieldValue> = {};
  for (const [key, fallback] of Object.entries(base)) {
    const value = raw[key];
    if (typeof fallback === "number") {
      const n = typeof value === "number" ? value : Number(value);
      out[key] = Number.isFinite(n) && n >= 0 && n <= 3650 ? n : fallback;
    } else out[key] = typeof value === "string" ? clean(value, MAX_TEXT) : fallback;
  }
  return out;
}

export const textOf = (record: RegisterRecord, key: string): string => {
  const v = record.values[key];
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
};

export const numberOf = (record: RegisterRecord, key: string): number | null => {
  const v = record.values[key];
  return typeof v === "number" ? v : null;
};

export const flagOf = (record: RegisterRecord, key: string): boolean =>
  record.values[key] === true;

export const recordTitle = (def: RegisterDef, record: RegisterRecord): string =>
  textOf(record, def.titleKey) || "(untitled)";

/** Open means not in a closed status (a register without statuses is always open). */
export function isOpen(def: RegisterDef, record: RegisterRecord): boolean {
  if (!def.statusKey) return true;
  return !(def.closed ?? []).includes(textOf(record, def.statusKey));
}

export interface RecordFilter {
  query?: string;
  status?: string;
  includeClosed?: boolean;
  /** Field values a record must have (the heat-map cell that was clicked). */
  match?: Record<string, string>;
}

export function filterRecords(
  def: RegisterDef,
  items: readonly RegisterRecord[],
  filter: RecordFilter,
): RegisterRecord[] {
  const query = (filter.query ?? "").trim().toLowerCase();
  const match = Object.entries(filter.match ?? {});
  return items.filter((item) => {
    // Picking a status in the filter is asking for those records, closed or not.
    const askedFor =
      !!filter.status && !!def.statusKey && textOf(item, def.statusKey) === filter.status;
    if (!filter.includeClosed && !askedFor && !isOpen(def, item)) return false;
    if (filter.status && def.statusKey && textOf(item, def.statusKey) !== filter.status) {
      return false;
    }
    if (match.some(([key, value]) => textOf(item, key) !== value)) return false;
    if (!query) return true;
    return Object.values(item.values).some((v) =>
      (Array.isArray(v) ? v.join(" ") : String(v)).toLowerCase().includes(query),
    );
  });
}

/** Sorted by the definition's key; records without a value go last. */
export function sortRecords(
  def: RegisterDef,
  items: readonly RegisterRecord[],
): RegisterRecord[] {
  const dir = def.sortDir === "asc" ? 1 : -1;
  return [...items].sort((a, b) => {
    const x = textOf(a, def.sortKey);
    const y = textOf(b, def.sortKey);
    if (x === "" && y === "") return b.updatedAt.localeCompare(a.updatedAt);
    if (x === "") return 1;
    if (y === "") return -1;
    const numeric = typeof a.values[def.sortKey] === "number";
    const cmp = numeric
      ? Number(x) - Number(y)
      : x.localeCompare(y, undefined, { numeric: true });
    return cmp === 0 ? b.updatedAt.localeCompare(a.updatedAt) : cmp * dir;
  });
}

/** The project names to suggest, from the status-report register's records: each name once
 *  (compared case-insensitively, the first spelling wins), sorted, blanks left out. */
export function projectSuggestions(items: readonly RegisterRecord[]): string[] {
  const seen = new Map<string, string>();
  for (const item of items) {
    const name = textOf(item, "project").trim();
    if (name && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/** Rows for a CSV: a header, then every record's fields in definition order. Text that a spreadsheet would run
 *  as a formula (starting = + - @) is made safe; numbers are left as numbers. */
export function csvRows(def: RegisterDef, items: readonly RegisterRecord[]): string[][] {
  return [
    def.fields.map((f) => f.label),
    ...items.map((item) =>
      def.fields.map((f) => {
        const v = item.values[f.key];
        if (typeof v === "number") return String(v);
        return csvSafeCell(
          Array.isArray(v)
            ? v.join("; ")
            : v === true
              ? "yes"
              : v === false
                ? "no"
                : String(v ?? ""),
        );
      }),
    ),
  ];
}

/** How many records have each value of the status field. */
export function statusCounts(
  def: RegisterDef,
  items: readonly RegisterRecord[],
): { status: string; count: number }[] {
  if (!def.statusKey) return [];
  const options = def.fields.find((f) => f.key === def.statusKey)?.options ?? [];
  return options.map((status) => ({
    status,
    count: items.filter((i) => textOf(i, def.statusKey!) === status).length,
  }));
}
