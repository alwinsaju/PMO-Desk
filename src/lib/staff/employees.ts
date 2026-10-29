// Pure employee logic: names, validation, spreadsheet import/export, filtering.
// No React, no I/O, so `pnpm test` can run it directly.
import type { Employee, ProfilePayload, StaffLocation } from "./types.ts";
import { daysBetween, isIsoDate } from "./dates.ts";

export const EMPLOYEE_ID = /^emp_[0-9a-f]{8,32}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The sample row in the roster template; never a real person. */
const PLACEHOLDER_EMAIL = "email@deloitte.com";

export function newEmployeeId(): string {
  const hex =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "")
      : Math.random().toString(16).slice(2).padEnd(12, "0");
  return `emp_${hex.slice(0, 12)}`;
}

export function isValidEmail(value: string): boolean {
  return EMAIL.test(value.trim());
}

const capitalise = (word: string) =>
  word ? word[0].toUpperCase() + word.slice(1).toLowerCase() : word;

/** "jane.doe@x.com" -> Jane / Doe, until the M365 profile gives the real name. */
export function nameFromEmail(email: string): { firstName: string; lastName: string } {
  const local = email.split("@")[0] ?? "";
  const words = local
    .replace(/\d+$/, "")
    .split(/[._-]+/)
    .filter(Boolean)
    .map(capitalise);
  return { firstName: words[0] ?? "", lastName: words.slice(1).join(" ") };
}

export function fullName(employee: Pick<Employee, "firstName" | "lastName">): string {
  return `${employee.firstName} ${employee.lastName}`.trim();
}

/** Where the profile picture is served from; undefined when there is none.
 *  The version is part of the URL so a new photo is never served from cache. */
export function photoUrl(
  employee: Pick<Employee, "id" | "photoVersion">,
): string | undefined {
  return employee.photoVersion > 0
    ? `/api/staff/photos/${employee.id}?v=${employee.photoVersion}`
    : undefined;
}

/** What to show for a person: their name, else their e-mail. */
export function displayName(
  employee: Pick<Employee, "firstName" | "lastName" | "deloitteEmail">,
): string {
  return fullName(employee) || employee.deloitteEmail;
}

export function initials(
  employee: Pick<Employee, "firstName" | "lastName" | "deloitteEmail">,
): string {
  const letters = [employee.firstName, employee.lastName]
    .map((part) => part.trim()[0] ?? "")
    .join("");
  return (letters || employee.deloitteEmail.slice(0, 1)).toUpperCase();
}

export function createEmployee(
  input: Partial<Employee> = {},
  now: string = new Date().toISOString(),
): Employee {
  return {
    id: newEmployeeId(),
    firstName: "",
    lastName: "",
    deloitteEmail: "",
    milestone: "",
    rollOffDate: "",
    campus: false,
    location: "",
    homeOffice: "",
    level: "",
    offering: "",
    op: "",
    team: "",
    phone: "",
    skills: [],
    deloittePersonId: "",
    takedaEmail: "",
    staffitStartDate: "",
    staffitEndDate: "",
    contractEndDate: "",
    networkId: "",
    workdayId: "",
    gender: "",
    clientManager: "",
    excludeFromShiftRoster: false,
    photoVersion: 0,
    profileSync: "manual",
    createdAt: now,
    updatedAt: now,
    ...input,
  };
}

/** The "add by e-mail" path: everything the M365 profile will fill stays empty
 *  and the person is flagged as waiting for it. */
export function employeeFromEmail(
  email: string,
  now: string = new Date().toISOString(),
): Employee {
  const clean = email.trim();
  return createEmployee(
    { ...nameFromEmail(clean), deloitteEmail: clean, profileSync: "pending" },
    now,
  );
}

export type EmployeeErrors = Partial<
  Record<
    | "deloitteEmail"
    | "takedaEmail"
    | "milestone"
    | "rollOffDate"
    | "staffitStartDate"
    | "staffitEndDate"
    | "contractEndDate"
    | "name",
    string
  >
>;

const DATE_FIELDS = [
  ["rollOffDate", "Roll-off date"],
  ["staffitStartDate", "Staffit start date"],
  ["staffitEndDate", "Staffit end date"],
  ["contractEndDate", "Contract end date"],
] as const;

export function validateEmployee(
  draft: Employee,
  others: readonly Pick<Employee, "id" | "deloitteEmail">[],
): EmployeeErrors {
  const errors: EmployeeErrors = {};
  const email = draft.deloitteEmail.trim();
  if (!email) errors.deloitteEmail = "Deloitte email is required.";
  else if (!isValidEmail(email)) errors.deloitteEmail = "Enter a valid email address.";
  else if (
    others.some(
      (o) => o.id !== draft.id && o.deloitteEmail.toLowerCase() === email.toLowerCase(),
    )
  ) {
    errors.deloitteEmail = "Someone with this email is already on the roster.";
  }
  if (draft.takedaEmail.trim() && !isValidEmail(draft.takedaEmail)) {
    errors.takedaEmail = "Enter a valid email address.";
  }
  if (draft.milestone.trim() && !/^\d{4}$/.test(draft.milestone.trim())) {
    errors.milestone = "Use a four-digit year.";
  }
  for (const [key, label] of DATE_FIELDS) {
    if (draft[key] && !isIsoDate(draft[key]))
      errors[key] = `${label} is not a valid date.`;
  }
  if (!fullName(draft) && !email) errors.name = "Add a name or an email.";
  return errors;
}

export function hasErrors(errors: EmployeeErrors): boolean {
  return Object.keys(errors).length > 0;
}

/** Fields the M365 profile owns (besides the photo). `op` (offering portfolio) is
 *  the profile's department; `offering` is not in M365 and is set by hand. */
export const M365_FIELDS = [
  "firstName",
  "lastName",
  "homeOffice",
  "level",
  "op",
  "phone",
] as const satisfies readonly (keyof Employee)[];

const clean = (value: unknown): string =>
  typeof value === "string"
    ? value.trim()
    : typeof value === "number" && Number.isFinite(value)
      ? String(value)
      : "";

/** Applies a profile from M365: only non-empty values overwrite, so a profile
 *  with a missing field never blanks what is already on file. */
export function applyProfile(
  employee: Employee,
  profile: ProfilePayload,
  now: string = new Date().toISOString(),
): Employee {
  const next: Employee = { ...employee };
  for (const key of M365_FIELDS) {
    const value = clean(profile[key]);
    if (value) next[key] = value;
  }
  return { ...next, profileSync: "synced", updatedAt: now };
}

/** True while the person still waits for their M365 profile. Names do not count as
 *  profile data (they are guessed from the email), but anything else the profile
 *  owns does: once it is filled in, by the flow or by hand, nothing is awaited. */
export function isAwaitingProfile(
  employee: Pick<
    Employee,
    "profileSync" | "level" | "op" | "phone" | "homeOffice" | "photoVersion"
  >,
): boolean {
  return (
    employee.profileSync === "pending" &&
    !(
      employee.level.trim() ||
      employee.op.trim() ||
      employee.phone.trim() ||
      employee.homeOffice.trim() ||
      employee.photoVersion > 0
    )
  );
}

/** The profile state to save for an edited person. An edit made from a copy that was
 *  loaded before the M365 profile arrived must not bring "waiting" back or blank the
 *  profile; an edit that fills the profile in by hand ends the wait too. */
export function settleProfileSync(incoming: Employee, stored?: Employee): Employee {
  if (incoming.profileSync !== "pending") return incoming;
  if (stored && stored.profileSync !== "pending") {
    const next: Employee = { ...incoming, profileSync: stored.profileSync };
    for (const key of M365_FIELDS) {
      if (!clean(next[key])) next[key] = stored[key];
    }
    return next;
  }
  return isAwaitingProfile(incoming) ? incoming : { ...incoming, profileSync: "manual" };
}

export function findByEmail<T extends Pick<Employee, "deloitteEmail">>(
  employees: readonly T[],
  email: string,
): T | undefined {
  const wanted = email.trim().toLowerCase();
  return wanted
    ? employees.find((e) => e.deloitteEmail.toLowerCase() === wanted)
    : undefined;
}

export interface EmailBatch {
  /** New people to add, in the order given, without repeats. */
  valid: string[];
  /** Already on the roster, or repeated in the list. */
  duplicates: string[];
  invalid: string[];
}

/** Splits pasted text (lines, commas, semicolons or spaces) into e-mail addresses
 *  and sorts them into new, already-known and not-an-email. */
export function parseEmailList(
  text: string,
  existing: readonly Pick<Employee, "deloitteEmail">[],
): EmailBatch {
  const known = new Set(existing.map((e) => e.deloitteEmail.toLowerCase()));
  const batch: EmailBatch = { valid: [], duplicates: [], invalid: [] };
  for (const token of text.split(/[\s,;]+/).filter(Boolean)) {
    const email = token.replace(/^[<"']+|[>"']+$/g, "");
    if (!isValidEmail(email)) batch.invalid.push(token);
    else if (known.has(email.toLowerCase())) batch.duplicates.push(email);
    else {
      known.add(email.toLowerCase());
      batch.valid.push(email);
    }
  }
  return batch;
}

// ---------------------------------------------------------------------------
// Spreadsheet columns (the roster template, in its order)
// ---------------------------------------------------------------------------

type ColumnKey = keyof Employee | "fullName";

interface Column {
  key: ColumnKey;
  header: string;
  /** Extra spellings accepted on import. */
  aliases?: string[];
}

export const ROSTER_COLUMNS: readonly Column[] = [
  { key: "firstName", header: "First Name" },
  { key: "lastName", header: "Last Name" },
  { key: "fullName", header: "Full Name" },
  { key: "milestone", header: "Milestone" },
  {
    key: "deloitteEmail",
    header: "Deloitte Email- id",
    aliases: ["Deloitte Email", "Email"],
  },
  { key: "rollOffDate", header: "Roll-off date", aliases: ["Rolloff date"] },
  { key: "campus", header: "Campus" },
  { key: "location", header: "Location" },
  { key: "homeOffice", header: "Home office" },
  { key: "level", header: "Level" },
  { key: "offering", header: "Offering" },
  { key: "op", header: "OP", aliases: ["Offering Portfolio"] },
  { key: "team", header: "Team" },
  { key: "phone", header: "Phone No", aliases: ["Phone", "Phone Number"] },
  { key: "skills", header: "Skills" },
  { key: "deloittePersonId", header: "Deloitte Person ID" },
  { key: "takedaEmail", header: "Takeda Email ID", aliases: ["Takeda Email"] },
  { key: "staffitStartDate", header: "Staffit Start Date" },
  { key: "staffitEndDate", header: "STAFFIT End Date", aliases: ["Staffit End Date"] },
  { key: "contractEndDate", header: "Contract End Date" },
  { key: "networkId", header: "Network ID" },
  { key: "workdayId", header: "Workday ID" },
  { key: "gender", header: "Gender", aliases: ["Gender ( The column should be hidden)"] },
  { key: "clientManager", header: "Client Manager" },
  {
    key: "excludeFromShiftRoster",
    header: "Exclude from shift roster",
    aliases: ["Excluded from shift roster"],
  },
];

const normalise = (text: unknown): string =>
  String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const HEADER_LOOKUP: ReadonlyMap<string, ColumnKey> = new Map(
  ROSTER_COLUMNS.flatMap((column) =>
    [column.header, ...(column.aliases ?? [])].map(
      (name) => [normalise(name), column.key] as const,
    ),
  ),
);

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

/** Date cells arrive as Date objects, Excel serials, ISO text or day-first text. */
export function parseDateCell(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    // Excel dates carry no zone; read them as the calendar day they were typed.
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
  }
  if (typeof value === "number" && value > 20000 && value < 80000) {
    return parseDateCell(new Date(Math.round((value - 25569) * 86400 * 1000)));
  }
  const text = clean(value);
  if (!text) return "";
  if (isIsoDate(text)) return text;
  const pad = (n: number) => String(n).padStart(2, "0");
  const numeric = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
  if (numeric) {
    const iso = `${numeric[3]}-${pad(Number(numeric[2]))}-${pad(Number(numeric[1]))}`;
    return isIsoDate(iso) ? iso : "";
  }
  const named = /^(\d{1,2})[ -]([A-Za-z]{3})[a-z]*[ ,-]*(\d{4})$/.exec(text);
  if (named) {
    const month = MONTHS.indexOf(named[2].toLowerCase());
    const iso = `${named[3]}-${pad(month + 1)}-${pad(Number(named[1]))}`;
    return month >= 0 && isIsoDate(iso) ? iso : "";
  }
  return "";
}

const TRUE_WORDS = new Set(["yes", "y", "true", "1", "campus"]);

export function parseSkills(value: unknown): string[] {
  const seen = new Set<string>();
  const skills: string[] = [];
  for (const part of clean(value).split(/[,;\n]/)) {
    const skill = part.trim();
    if (skill && !seen.has(skill.toLowerCase())) {
      seen.add(skill.toLowerCase());
      skills.push(skill);
    }
  }
  return skills;
}

function parseLocation(value: unknown): StaffLocation | "" {
  const word = clean(value).toLowerCase();
  if (word.startsWith("on")) return "Onshore";
  if (word.startsWith("off")) return "Offshore";
  return "";
}

export interface ImportRow {
  row: number;
  employee: Partial<Employee>;
}
export interface ImportSkip {
  row: number;
  reason: string;
}
export interface ImportResult {
  rows: ImportRow[];
  skipped: ImportSkip[];
  /** False when no recognisable header row was found. */
  headerFound: boolean;
}

/** Turns sheet rows (first recognisable row = headers) into partial employees.
 *  Rows without a usable Deloitte email are skipped with the reason. */
export function parseRosterRows(rows: readonly (readonly unknown[])[]): ImportResult {
  const headerIndex = rows.findIndex(
    (row) => row.filter((cell) => HEADER_LOOKUP.has(normalise(cell))).length >= 2,
  );
  if (headerIndex < 0) return { rows: [], skipped: [], headerFound: false };

  const columns = rows[headerIndex].map((cell) => HEADER_LOOKUP.get(normalise(cell)));
  const result: ImportResult = { rows: [], skipped: [], headerFound: true };

  rows.slice(headerIndex + 1).forEach((cells, offset) => {
    const row = headerIndex + offset + 2; // 1-based sheet row
    if (cells.every((cell) => clean(cell) === "")) return;
    const raw: Partial<Record<ColumnKey, unknown>> = {};
    columns.forEach((key, i) => {
      if (key && raw[key] === undefined) raw[key] = cells[i];
    });

    const email = clean(raw.deloitteEmail);
    if (!isValidEmail(email) || email.toLowerCase() === PLACEHOLDER_EMAIL) {
      result.skipped.push({
        row,
        reason: email ? "Not a valid Deloitte email" : "No Deloitte email",
      });
      return;
    }

    const employee: Partial<Employee> = { deloitteEmail: email };
    const text = (key: keyof Employee) => {
      const value = clean(raw[key]);
      if (value) (employee as Record<string, unknown>)[key] = value;
    };
    for (const key of [
      "firstName",
      "lastName",
      "homeOffice",
      "level",
      "offering",
      "op",
      "team",
      "phone",
      "deloittePersonId",
      "takedaEmail",
      "networkId",
      "workdayId",
      "clientManager",
      "gender",
    ] as const) {
      text(key);
    }
    if (!employee.firstName && !employee.lastName) {
      const [first = "", ...rest] = clean(raw.fullName).split(/\s+/).filter(Boolean);
      if (first) {
        employee.firstName = first;
        employee.lastName = rest.join(" ");
      }
    }
    const milestone = clean(raw.milestone).replace(/\.0+$/, "");
    if (milestone) employee.milestone = milestone;
    for (const key of [
      "rollOffDate",
      "staffitStartDate",
      "staffitEndDate",
      "contractEndDate",
    ] as const) {
      const date = parseDateCell(raw[key]);
      if (date) employee[key] = date;
    }
    if (clean(raw.campus))
      employee.campus = TRUE_WORDS.has(clean(raw.campus).toLowerCase());
    if (clean(raw.excludeFromShiftRoster)) {
      employee.excludeFromShiftRoster = TRUE_WORDS.has(
        clean(raw.excludeFromShiftRoster).toLowerCase(),
      );
    }
    const location = parseLocation(raw.location);
    if (location) employee.location = location;
    const skills = parseSkills(raw.skills);
    if (skills.length) employee.skills = skills;

    result.rows.push({ row, employee });
  });
  return result;
}

export interface ImportPlan {
  upserts: Employee[];
  added: number;
  updated: number;
}

/** Matches imported rows to existing people by e-mail: a match is updated with
 *  the cells that had a value, anything else is added. */
export function planImport(
  existing: readonly Employee[],
  rows: readonly ImportRow[],
  now: string = new Date().toISOString(),
): ImportPlan {
  const plan: ImportPlan = { upserts: [], added: 0, updated: 0 };
  const byEmail = new Map(existing.map((e) => [e.deloitteEmail.toLowerCase(), e]));
  for (const { employee } of rows) {
    const key = (employee.deloitteEmail ?? "").toLowerCase();
    const current = byEmail.get(key);
    const next = current
      ? {
          ...current,
          ...employee,
          id: current.id,
          photoVersion: current.photoVersion,
          updatedAt: now,
        }
      : createEmployee(
          {
            ...employee,
            ...(employee.firstName || employee.lastName ? {} : nameFromEmail(key)),
          },
          now,
        );
    byEmail.set(key, next);
    const at = plan.upserts.findIndex((e) => e.id === next.id);
    if (at >= 0) plan.upserts[at] = next;
    else {
      plan.upserts.push(next);
      if (current) plan.updated++;
      else plan.added++;
    }
  }
  return plan;
}

function csvCell(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** The roster in the template's column order. Gender stays out of the file. */
export function employeesToCsv(employees: readonly Employee[]): string {
  const columns = ROSTER_COLUMNS.filter((c) => c.key !== "gender");
  const lines = [columns.map((c) => csvCell(c.header)).join(",")];
  for (const e of employees) {
    const cells = columns.map((c) => {
      if (c.key === "fullName") return fullName(e);
      const value = e[c.key];
      if (c.key === "campus" || c.key === "excludeFromShiftRoster") {
        return value ? "Yes" : "No";
      }
      if (Array.isArray(value)) return value.join(", ");
      return String(value ?? "");
    });
    lines.push(cells.map(csvCell).join(","));
  }
  return lines.join("\r\n");
}

// ---------------------------------------------------------------------------
// Directory view: filter, sort, summarise
// ---------------------------------------------------------------------------

export interface DirectoryFilter {
  query: string;
  location: StaffLocation | "";
  offering: string;
  op: string;
  level: string;
}

export const NO_FILTER: DirectoryFilter = {
  query: "",
  location: "",
  offering: "",
  op: "",
  level: "",
};

export function filterEmployees<T extends Employee>(
  employees: readonly T[],
  filter: DirectoryFilter,
): T[] {
  const terms = filter.query.toLowerCase().split(/\s+/).filter(Boolean);
  return employees.filter((e) => {
    if (filter.location && e.location !== filter.location) return false;
    if (filter.offering && e.offering !== filter.offering) return false;
    if (filter.op && e.op !== filter.op) return false;
    if (filter.level && e.level !== filter.level) return false;
    if (terms.length === 0) return true;
    const haystack = [
      fullName(e),
      e.deloitteEmail,
      e.level,
      e.op,
      e.offering,
      e.team,
      e.homeOffice,
      e.clientManager,
      e.networkId,
      e.workdayId,
      e.deloittePersonId,
      ...e.skills,
    ]
      .join(" ")
      .toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

export type SortKey = "name" | "level" | "rolloff" | "recent";

export const SORT_LABELS: Record<SortKey, string> = {
  name: "Name A–Z",
  level: "Level",
  rolloff: "Roll-off (soonest)",
  recent: "Recently added",
};

const byName = (a: Employee, b: Employee) =>
  displayName(a).localeCompare(displayName(b), undefined, { sensitivity: "base" });

export function sortEmployees(employees: readonly Employee[], key: SortKey): Employee[] {
  const list = [...employees];
  switch (key) {
    case "level":
      return list.sort(
        (a, b) =>
          (a.level || "\uffff").localeCompare(b.level || "\uffff", undefined, {
            numeric: true,
          }) || byName(a, b),
      );
    case "rolloff":
      return list.sort(
        (a, b) =>
          (a.rollOffDate || "9999").localeCompare(b.rollOffDate || "9999") ||
          byName(a, b),
      );
    case "recent":
      return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || byName(a, b));
    default:
      return list.sort(byName);
  }
}

/** Distinct non-empty values of a text field, sorted. */
export function distinctValues(
  employees: readonly Employee[],
  key: "offering" | "op" | "level" | "team" | "homeOffice",
): string[] {
  return [...new Set(employees.map((e) => e[key]).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  );
}

export interface RollOff {
  kind: "none" | "past" | "soon" | "later";
  /** Whole days from today (negative = already rolled off). */
  days: number;
}

export const ROLL_OFF_SOON_DAYS = 30;

export function rollOffStatus(date: string, today: string): RollOff {
  if (!isIsoDate(date) || !isIsoDate(today)) return { kind: "none", days: 0 };
  const days = daysBetween(today, date);
  if (days < 0) return { kind: "past", days };
  return { kind: days <= ROLL_OFF_SOON_DAYS ? "soon" : "later", days };
}

/** The people who take part in the shift roster: everyone not marked as excluded. */
export function shiftRosterPeople<T extends Pick<Employee, "excludeFromShiftRoster">>(
  employees: readonly T[],
): T[] {
  return employees.filter((e) => !e.excludeFromShiftRoster);
}

export interface RosterStats {
  total: number;
  onshore: number;
  offshore: number;
  rollingOff: number;
  awaitingProfile: number;
}

export function rosterStats(employees: readonly Employee[], today: string): RosterStats {
  return {
    total: employees.length,
    onshore: employees.filter((e) => e.location === "Onshore").length,
    offshore: employees.filter((e) => e.location === "Offshore").length,
    rollingOff: employees.filter(
      (e) => rollOffStatus(e.rollOffDate, today).kind === "soon",
    ).length,
    awaitingProfile: employees.filter(isAwaitingProfile).length,
  };
}
