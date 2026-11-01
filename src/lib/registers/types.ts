// The shape of a PMO register: a list of records with typed fields. Every PMO tool (RAID log,
// decision log, vendor tracker...) is one definition here plus, where it needs more than a list,
// a small bespoke panel. Pure: shared by the page and the server.

export type FieldType =
  | "text"
  | "longtext"
  | "select"
  | "date"
  | "number"
  | "person"
  | "url"
  | "tags"
  | "boolean";

export type FieldValue = string | number | boolean | string[];

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  options?: readonly string[];
  required?: boolean;
  placeholder?: string;
  /** Used for a new record. "today" fills a date with the current day. */
  default?: FieldValue | "today";
  /** For numbers: the smallest and largest allowed. */
  min?: number;
  max?: number;
}

export type RuleId =
  "due" | "raid" | "sla" | "renewal" | "contact" | "event" | "invoice" | "rag";

export interface RegisterDef {
  id: string;
  title: string;
  /** "risk or issue", for buttons: "Add risk or issue". */
  noun: string;
  /** What "Add your first ..." says in an empty list, where the general noun is too vague ("item" -> "risk"). */
  firstNoun?: string;
  blurb: string;
  fields: readonly FieldDef[];
  titleKey: string;
  /** The status field; records whose status is in `closed` are not open. */
  statusKey?: string;
  closed?: readonly string[];
  /** A date after which an open record is late. */
  dueKey?: string;
  /** A person field: who to chase, and who a to-do is made for. */
  ownerKey?: string;
  columns: readonly string[];
  sortKey: string;
  sortDir: "asc" | "desc";
  rule?: RuleId;
  /** A one-click action on a row that sets a date field to today (e.g. "Log contact"). */
  stamp?: { key: string; label: string };
  /** Which extra panel this tool adds above the list (see the app). */
  extras?: "sla" | "changes" | "invoice" | "status-report" | "governance" | "minutes";
  /** A tool with its own screen instead of the list (its records still use this definition). */
  custom?: "timesheets" | "capacity";
  /** Settings the rule needs, editable in the tool (e.g. SLA days by priority). */
  config?: Record<string, FieldValue>;
  /** Two select fields shown as a count grid above the list (RAID: impact x likelihood). */
  heat?: { rows: string; cols: string };
  /** How the Add/Edit form groups its fields; without it they are grouped by type (see layout.ts). */
  formGroups?: readonly { title: string; keys: readonly string[] }[];
}

export interface RegisterRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  values: Record<string, FieldValue>;
  /** The PMO to-do made from this record, so it is made once. */
  todoId?: string;
}

export interface RegisterFile {
  items: RegisterRecord[];
  config: Record<string, FieldValue>;
}

export type AlertLevel = "late" | "soon" | "info";

export interface RecordAlert {
  level: AlertLevel;
  text: string;
}

export const MAX_RECORDS = 5000;
export const MAX_TEXT = 200;
export const MAX_LONGTEXT = 4000;
