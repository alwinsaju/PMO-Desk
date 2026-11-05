// Turns the first problem zod finds in a request into a sentence a PMO person can act on
// ("jane@x.com: the Deloitte email is not a valid email address."), never the raw
// "Invalid email address (upsert.0.deloitteEmail)". Pure.
import { FIELD_LABELS } from "./fieldRules.ts";

export interface IssueLike {
  code: string;
  message: string;
  path: PropertyKey[];
}

const LABELS: Record<string, string> = {
  ...FIELD_LABELS,
  rollOffDate: "Roll-off date",
  staffitStartDate: "Staffit start date",
  staffitEndDate: "Staffit end date",
  contractEndDate: "Contract end date",
  location: "Location",
  email: "Email",
  startDate: "Start date",
  endDate: "End date",
  date: "Date",
  reason: "Reason",
  type: "Type",
  status: "Status",
  employeeId: "Employee",
  memberId: "Person",
  name: "Name",
  label: "Label",
  note: "Note",
  text: "Custom hours",
  city: "City",
  role: "Role",
  start: "Start time",
  end: "End time",
  id: "Reference",
  scheduleId: "Schedule",
  groupId: "Team",
  ref: "Shift",
  photoBase64: "Photo",
};

const NOUNS: Record<string, string> = {
  schedules: "Schedule",
  groups: "Team",
  members: "Person",
  events: "Event",
  shifts: "Shift",
  upsert: "Entry",
};

const GENERIC = "Some of the details are not valid. Check them and try again.";

const isIndex = (part: PropertyKey): part is number => typeof part === "number";

function valueAt(root: unknown, path: readonly PropertyKey[]): unknown {
  let node = root;
  for (const part of path) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<PropertyKey, unknown>)[part];
  }
  return node;
}

/** The person or item the problem is in: their email or name when the request carries one, else "Entry 3". */
function whoIs(path: readonly PropertyKey[], body: unknown): string {
  let at = -1;
  path.forEach((part, i) => {
    if (isIndex(part)) at = i;
  });
  if (at < 0) return "";
  const entity = valueAt(body, path.slice(0, at + 1));
  if (entity && typeof entity === "object") {
    const e = entity as Record<string, unknown>;
    const name = [e.firstName, e.lastName]
      .filter((v): v is string => typeof v === "string" && v.trim() !== "")
      .join(" ");
    for (const candidate of [e.deloitteEmail, e.email, name, e.name, e.label]) {
      if (typeof candidate === "string" && candidate.trim() !== "") {
        return candidate.trim().slice(0, 60);
      }
    }
  }
  const parent = path[at - 1];
  const noun = typeof parent === "string" ? (NOUNS[parent] ?? "Entry") : "Entry";
  return `${noun} ${(path[at] as number) + 1}`;
}

export function plainIssue(
  error: { issues: readonly IssueLike[] },
  body?: unknown,
): string {
  const issue = error.issues[0] as
    (IssueLike & { origin?: unknown; maximum?: unknown; format?: unknown }) | undefined;
  if (!issue) return GENERIC;
  const path = issue.path;
  const leaf = [...path].reverse().find((p): p is string => typeof p === "string");
  const lastIsIndex = path.length > 0 && isIndex(path[path.length - 1]);
  const field = leaf && !lastIsIndex ? (LABELS[leaf] ?? "") : "";
  const subject = field || "This";
  const input = valueAt(body, path);
  const origin = typeof issue.origin === "string" ? issue.origin : "";

  let what: string;
  switch (issue.code) {
    case "too_big":
      if (origin === "string") {
        what = `${subject} is too long (at most ${String(issue.maximum)} characters).`;
      } else if (leaf === "skills") {
        what = `There are too many skills (at most ${String(issue.maximum)}).`;
      } else if (path.length <= 1) {
        what = `That is too many at once (at most ${String(issue.maximum)}). Split it into smaller groups.`;
      } else {
        what = `${subject} has too many entries (at most ${String(issue.maximum)}).`;
      }
      break;
    case "too_small":
      what =
        origin === "array" && path.length <= 1
          ? "Nothing was selected."
          : `${subject} cannot be empty.`;
      break;
    case "invalid_format":
      if (issue.format === "email") {
        what =
          typeof input === "string" && input !== ""
            ? `${field || "The email"} "${input.slice(0, 60)}" is not a valid email address.`
            : `${field || "The email"} is not a valid email address.`;
      } else {
        what = `${subject} is not in the right form.`;
      }
      break;
    case "invalid_value":
      what = `${subject} is not one of the allowed choices.`;
      break;
    case "invalid_type":
      what = `${subject} is missing or not in the right form.`;
      break;
    case "custom":
      what = field ? `${field}: ${issue.message}` : issue.message;
      break;
    default:
      what = GENERIC;
  }

  const who = whoIs(path, body);
  // The sentence already names the address, so it is not repeated in front of it.
  const named =
    issue.code === "invalid_format" &&
    issue.format === "email" &&
    typeof input === "string" &&
    who === input.trim().slice(0, 60);
  return who && !named ? `${who}: ${what}` : what;
}
