// "Export my data" for audits: to-dos, people, time off and templates as one JSON
// file, or as CSV files (which Excel opens) in a zip. Server only. Gender is kept
// on file by the Staff app but never shown, so it is not exported either.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { toCsv } from "../staff/exportFiles.ts";
import { REGISTERS } from "../registers/defs.ts";
import { csvRows } from "../registers/records.ts";
import type { RegisterRecord } from "../registers/types.ts";
import { writeZip, type ZipEntry } from "./zip.ts";

type Row = Record<string, unknown>;

export interface ExportData {
  todos: Row[];
  archivedTodos: Row[];
  employees: Row[];
  shifts: Row[];
  timeOff: Row[];
  roster: unknown;
  templates: Row[];
  /** The PMO toolkit registers, by tool id. */
  registers: Record<string, Row[]>;
}

const asRows = (value: unknown): Row[] =>
  Array.isArray(value)
    ? value.filter((v): v is Row => typeof v === "object" && v !== null)
    : [];

async function readJsonFile(file: string): Promise<unknown> {
  try {
    return JSON.parse((await readFile(file, "utf8")).replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
}

async function readFolder(dir: string): Promise<Row[]> {
  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith(".json")).sort();
  } catch {
    return [];
  }
  const out: Row[] = [];
  for (const name of names) {
    const value = await readJsonFile(path.join(dir, name));
    if (value && typeof value === "object") out.push(value as Row);
  }
  return out;
}

const withoutPrivate = (employee: Row): Row => {
  const copy = { ...employee };
  delete copy.gender;
  return copy;
};

export async function readExportData(root: string): Promise<ExportData> {
  const items = async (kind: string) =>
    asRows(
      ((await readJsonFile(path.join(root, "staff", `${kind}.json`))) as Row)?.items,
    );
  const roster = ((await readJsonFile(path.join(root, "staff", "roster.json"))) as Row)
    ?.config;
  const library = (await readJsonFile(
    path.join(root, "templates", "library.json"),
  )) as Row | null;
  const registers: Record<string, Row[]> = {};
  for (const def of REGISTERS) {
    const file = (await readJsonFile(
      path.join(root, "registers", `${def.id}.json`),
    )) as Row | null;
    const rows = asRows(file?.items);
    if (rows.length > 0) registers[def.id] = rows;
  }
  return {
    todos: await readFolder(path.join(root, "todos")),
    archivedTodos: await readFolder(path.join(root, "archive", "todos")),
    employees: (await items("employees")).map(withoutPrivate),
    shifts: await items("shifts"),
    timeOff: await items("timeoff"),
    roster: roster ?? null,
    templates: asRows(library?.templates),
    registers,
  };
}

export function exportJson(data: ExportData, now: Date, appVersion: string): string {
  return JSON.stringify(
    { format: "ai-os-export", exportedAt: now.toISOString(), appVersion, ...data },
    null,
    2,
  );
}

const text = (v: unknown): string =>
  v === null || v === undefined
    ? ""
    : typeof v === "string"
      ? v
      : typeof v === "number" || typeof v === "boolean"
        ? String(v)
        : Array.isArray(v)
          ? v.map(text).join("; ")
          : JSON.stringify(v);

const nested = (row: Row, key: string, field: string): string => {
  const inner = row[key];
  return inner && typeof inner === "object" ? text((inner as Row)[field]) : "";
};

export function todoRows(todos: readonly Row[], archived: boolean): string[][] {
  const head = [
    "Id",
    "Title",
    "Status",
    "Priority",
    "Due",
    "Owner",
    "Requester",
    "Waiting on",
    "Tags",
    "Repeats",
    "Created",
    "Updated",
    "Completed",
    "Archived",
  ];
  return [
    head,
    ...todos.map((t) => [
      text(t.id),
      text(t.title),
      text(t.status),
      text(t.priority),
      text(t.dueAt),
      nested(t, "owner", "name"),
      nested(t, "requester", "name"),
      text(t.waitingOn),
      text(t.tags),
      text(t.recurrence),
      text(t.createdAt),
      text(t.updatedAt),
      text(t.completedAt),
      archived ? "yes" : "",
    ]),
  ];
}

export function peopleRows(employees: readonly Row[]): string[][] {
  const head = [
    "First name",
    "Last name",
    "Email",
    "Team",
    "Level",
    "Location",
    "Client manager",
    "Roll-off",
    "Contract end",
    "Skills",
  ];
  return [
    head,
    ...employees.map((e) => [
      text(e.firstName),
      text(e.lastName),
      text(e.deloitteEmail),
      text(e.team),
      text(e.level),
      text(e.location),
      text(e.clientManager),
      text(e.rollOffDate),
      text(e.contractEndDate),
      text(e.skills),
    ]),
  ];
}

export function timeOffRows(
  requests: readonly Row[],
  employees: readonly Row[],
): string[][] {
  const names = new Map(
    employees.map((e) => [text(e.id), `${text(e.firstName)} ${text(e.lastName)}`.trim()]),
  );
  return [
    ["Person", "Type", "From", "To", "Status", "Reason", "Requested", "Decided"],
    ...requests.map((r) => [
      names.get(text(r.employeeId)) ?? text(r.employeeId),
      text(r.type),
      text(r.startDate),
      text(r.endDate),
      text(r.status),
      text(r.reason),
      text(r.createdAt),
      text(r.decidedAt),
    ]),
  ];
}

export function templateRows(templates: readonly Row[]): string[][] {
  return [
    ["Name", "Kind", "Subject", "To", "Cc", "Used by", "Tags", "Updated"],
    ...templates.map((t) => [
      text(t.name),
      text(t.kind),
      text(t.subject),
      text(t.to),
      text(t.cc),
      text(t.usedBy),
      text(t.tags),
      text(t.updatedAt),
    ]),
  ];
}

export function exportCsvZip(data: ExportData): Buffer {
  const registerFiles = REGISTERS.filter(
    (def) => (data.registers[def.id] ?? []).length > 0,
  ).map((def) => ({
    name: `registers/${def.id}.csv`,
    rows: csvRows(def, data.registers[def.id] as unknown as RegisterRecord[]),
  }));
  const files: ZipEntry[] = [
    {
      name: "todos.csv",
      rows: [
        ...todoRows(data.todos, false),
        ...todoRows(data.archivedTodos, true).slice(1),
      ],
    },
    { name: "people.csv", rows: peopleRows(data.employees) },
    { name: "time-off.csv", rows: timeOffRows(data.timeOff, data.employees) },
    { name: "templates.csv", rows: templateRows(data.templates) },
    ...registerFiles,
  ].map(({ name, rows }) => ({ name, data: Buffer.from(toCsv(rows), "utf8") }));
  return writeZip(files);
}
