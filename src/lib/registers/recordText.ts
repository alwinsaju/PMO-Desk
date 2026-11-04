// One register record as plain text for an email or minutes. Pure; nothing here sends anything.
// Report-style text for whole registers lives in reports.ts; this is the single-record form.
import { formatDate } from "../staff/dates.ts";
import { recordTitle } from "./records.ts";
import type { FieldDef, FieldValue, RegisterDef, RegisterRecord } from "./types.ts";

export interface RecordText {
  subject: string;
  text: string;
}

function valueText(field: FieldDef, value: FieldValue | undefined): string {
  if (value === undefined || value === "") return "";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (field.type === "date" && typeof value === "string") return formatDate(value);
  return String(value).trim();
}

/**
 * The record as email-ready text: a heading, then "Label: value" for each field that has a value
 * (in the tool's field order), long text on its own lines under its label. `alertText` (for
 * example "Late by 3 days") is added as a "Needs attention" line when there is one.
 */
export function recordText(
  def: RegisterDef,
  record: RegisterRecord,
  alertText?: string | null,
): RecordText {
  const title = recordTitle(def, record);
  const lines = [`${def.title}: ${title}`, ""];
  for (const field of def.fields) {
    if (field.key === def.titleKey) continue;
    const text = valueText(field, record.values[field.key]);
    if (!text) continue;
    if (field.type === "longtext" && text.includes("\n")) {
      lines.push(
        `${field.label}:`,
        ...text.split(/\r?\n/).map((l) => `  ${l}`.trimEnd()),
      );
    } else lines.push(`${field.label}: ${text}`);
  }
  if (alertText) lines.push(`Needs attention: ${alertText}`);
  return { subject: `${def.title}: ${title}`, text: lines.join("\n").trimEnd() };
}
