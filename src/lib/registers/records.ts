// Reading, checking and listing register records. Pure: shared by the page and the server.
import { isIsoDate } from "../staff/dates.ts";
import {
  MAX_LONGTEXT,
  MAX_TEXT,
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

const clean = (v: unknown, max: number): string =>
  typeof v === "string"
    ? v
        .replace(/\u0000/g, "")
        .trim()
        .slice(0, max)
    : "";

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

export const isHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
};

function coerce(
  field: FieldDef,
  raw: unknown,
): { value: FieldValue } | { error: string } {
  switch (field.type) {
    case "text":
    case "person":
      return { value: clean(raw, MAX_TEXT) };
    case "longtext":
      return { value: clean(raw, MAX_LONGTEXT) };
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
      return isIsoDate(text)
        ? { value: text }
        : { error: `${field.label} is not a real date (use year-month-day).` };
    }
    case "number": {
      if (raw === "" || raw === null || raw === undefined) return { value: "" };
      const n = typeof raw === "number" ? raw : Number(String(raw).trim());
      if (!Number.isFinite(n) || Math.abs(n) > 1e12) {
        return { error: `${field.label} must be a number.` };
      }
      if (
        (field.min !== undefined && n < field.min) ||
        (field.max !== undefined && n > field.max)
      ) {
        return {
          error: `${field.label} must be between ${field.min ?? "any"} and ${field.max ?? "any"}.`,
        };
      }
      return { value: n };
    }
    case "url": {
      const text = clean(raw, 500);
      if (text === "") return { value: "" };
      return isHttpUrl(text)
        ? { value: text }
        : { error: `${field.label} must be a web address starting with https://.` };
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

/** Every problem with the input, in field order, each tied to the field to mark; the cleaned values alongside. */
function checkValues(
  def: RegisterDef,
  input: unknown,
): { values: Record<string, FieldValue>; problems: FieldProblem[] } {
  const raw =
    typeof input === "object" && input !== null && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const values: Record<string, FieldValue> = {};
  const problems: FieldProblem[] = [];
  for (const field of def.fields) {
    const result = coerce(field, raw[field.key]);
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
  const range = problems.length === 0 ? crossCheck(def, values) : null;
  if (range) problems.push(range);
  return { values, problems };
}

/** The values for a record, each cleaned to its field's type; unknown keys are dropped. */
export function sanitizeValues(
  def: RegisterDef,
  input: unknown,
): { ok: true; values: Record<string, FieldValue> } | { ok: false; reason: string } {
  const { values, problems } = checkValues(def, input);
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
    def.id === "sla" &&
    values.resolvedOn &&
    values.received &&
    values.resolvedOn < values.received
  ) {
    return {
      key: "resolvedOn",
      message: "Resolved on cannot be before it was received.",
    };
  }
  return null;
}

/** A whole record from what the page sent; keeps the id, creation time and to-do link of an existing one. */
export function sanitizeRecord(
  def: RegisterDef,
  input: unknown,
  now: string,
  existing?: RegisterRecord,
): { ok: true; record: RegisterRecord } | { ok: false; reason: string } {
  const raw =
    typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  const parsed = sanitizeValues(def, raw.values);
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
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      values: parsed.values,
      ...(todoId ? { todoId } : {}),
    },
  };
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
}

export function filterRecords(
  def: RegisterDef,
  items: readonly RegisterRecord[],
  filter: RecordFilter,
): RegisterRecord[] {
  const query = (filter.query ?? "").trim().toLowerCase();
  return items.filter((item) => {
    if (!filter.includeClosed && !isOpen(def, item)) return false;
    if (filter.status && def.statusKey && textOf(item, def.statusKey) !== filter.status) {
      return false;
    }
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

/** Rows for a CSV: a header, then every record's fields in definition order. */
export function csvRows(def: RegisterDef, items: readonly RegisterRecord[]): string[][] {
  return [
    def.fields.map((f) => f.label),
    ...items.map((item) =>
      def.fields.map((f) => {
        const v = item.values[f.key];
        return Array.isArray(v)
          ? v.join("; ")
          : v === true
            ? "yes"
            : v === false
              ? "no"
              : String(v ?? "");
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
