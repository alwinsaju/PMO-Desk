// Export of the PMO to-do list: a CSV (opens in Excel) and an .xlsx workbook from the in-house writer.
// Pure: the browser builds the files and downloads them, so nothing is written on the server.
import { toCsv } from "../staff/exportFiles.ts";
import type { XlsxSheet } from "../xlsx/writeXlsx.ts";
import type { Todo } from "./types.ts";

export const TODO_EXPORT_HEADERS = [
  "Title",
  "Status",
  "Owner",
  "Requester",
  "Due",
  "Priority",
  "Tags",
  "Created",
  "Completed",
] as const;

type ExportTodo = Pick<
  Todo,
  | "title"
  | "status"
  | "owner"
  | "requester"
  | "dueAt"
  | "priority"
  | "tags"
  | "createdAt"
  | "completedAt"
>;

const STATUS_LABEL: Record<Todo["status"], string> = {
  open: "Open",
  done: "Done",
  cancelled: "Cancelled",
};
const PRIORITY_LABEL: Record<Todo["priority"], string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
};

const pad = (n: number): string => String(n).padStart(2, "0");

/** yyyy-mm-dd in the viewer's time zone for a saved timestamp; "" when there is none or it is unreadable. */
export function localDay(iso: string | null | undefined): string {
  if (!iso) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/** The text of one cell, before any CSV protection. */
export function todoExportRow(todo: ExportTodo): string[] {
  return [
    todo.title,
    STATUS_LABEL[todo.status] ?? todo.status,
    todo.owner.isMe ? "Me" : (todo.owner.name ?? todo.owner.email ?? ""),
    todo.requester.name ?? todo.requester.email ?? "",
    todo.dueAt ?? "",
    PRIORITY_LABEL[todo.priority] ?? todo.priority,
    todo.tags.join("; "),
    localDay(todo.createdAt),
    localDay(todo.completedAt),
  ];
}

/**
 * Stops a spreadsheet from running a cell as a formula (CSV formula injection): a cell that starts with
 * = + - @ (or a tab or carriage return) gets a leading apostrophe. Titles and owners come from e-mails, so
 * they are untrusted. (A .xlsx cell is written as plain text, so it needs no such change.)
 */
export function csvSafeCell(cell: string): string {
  return /^[=+\-@\t\r]/.test(cell) ? `'${cell}` : cell;
}

/** The CSV text (with a BOM so accents survive in Excel), one row per to-do under the header row. */
export function todosToCsv(todos: readonly ExportTodo[]): string {
  return toCsv([
    [...TODO_EXPORT_HEADERS],
    ...todos.map((t) => todoExportRow(t).map(csvSafeCell)),
  ]);
}

/** One sheet for the in-house .xlsx writer. Every value is text, which Excel never evaluates. */
export function todosToSheets(todos: readonly ExportTodo[]): XlsxSheet[] {
  return [
    {
      name: "To-dos",
      rows: [[...TODO_EXPORT_HEADERS], ...todos.map((t) => todoExportRow(t))],
      widths: [50, 12, 20, 20, 12, 10, 24, 12, 12],
      headerRows: [0],
      freeze: { rows: 1 },
    },
  ];
}

export type ExportScope = "filtered" | "all";

/** "pmo-todos-filtered-2026-11-05.csv". */
export function todoExportFilename(
  scope: ExportScope,
  extension: "csv" | "xlsx",
  today: string,
): string {
  return `pmo-todos-${scope}-${today}.${extension}`;
}

/** What the export buttons say they will include, e.g. "the 12 to-dos in the current list". */
export function exportScopeText(scope: ExportScope, count: number): string {
  const noun = count === 1 ? "to-do" : "to-dos";
  return scope === "filtered"
    ? `the ${count} ${noun} in the current list (filter, tag and search applied)`
    : `all ${count} ${noun}, including done and cancelled`;
}
