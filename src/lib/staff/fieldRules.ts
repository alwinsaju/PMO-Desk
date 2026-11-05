// The rules a person's details must pass. The server schema (schema.ts) and every form, chip
// and import preview in the app use these same numbers and checks, so what the screen accepts
// is exactly what the server saves. Pure.
import { isIsoDate } from "./dates.ts";

/** Longest value, in characters after trimming, of each text field. */
export const LIMITS = {
  firstName: 80,
  lastName: 80,
  deloitteEmail: 254,
  takedaEmail: 254,
  milestone: 4,
  homeOffice: 200,
  level: 60,
  offering: 200,
  op: 200,
  team: 200,
  phone: 40,
  skill: 60,
  skills: 60,
  deloittePersonId: 60,
  networkId: 60,
  workdayId: 60,
  gender: 40,
  clientManager: 200,
  birthday: 10,
} as const;

/** The most people one save (add, import or remove) may carry. */
export const MAX_BATCH = 2000;

/** The same address rule the server uses: plain letters, digits and . _ ' + - before the @, a real domain after it. */
const EMAIL =
  /^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;

export function isValidEmail(value: string): boolean {
  const email = value.trim();
  return email.length <= LIMITS.deloitteEmail && EMAIL.test(email);
}

/** Plain-language reason an address is refused, or null when it is fine. */
export function emailProblem(value: string): string | null {
  const email = value.trim();
  if (email.length > LIMITS.deloitteEmail) return "That email address is too long.";
  return EMAIL.test(email)
    ? null
    : "Not a valid email address (plain letters and digits, like first.last@deloitte.com).";
}

/** "MM-DD" (29 Feb allowed) or "yyyy-mm-dd", and a real calendar day; empty means unknown. */
export function isValidBirthday(value: string): boolean {
  const v = value.trim();
  if (v === "") return true;
  if (/^\d{2}-\d{2}$/.test(v)) return isIsoDate(`2000-${v}`);
  return isIsoDate(v);
}

export const BIRTHDAY_HINT = "Use MM-DD, a real day (for example 03-14).";

export const FIELD_LABELS = {
  firstName: "First name",
  lastName: "Last name",
  deloitteEmail: "Deloitte email",
  takedaEmail: "Takeda email",
  milestone: "Milestone",
  homeOffice: "Home office",
  level: "Level",
  offering: "Offering",
  op: "Offering portfolio",
  team: "Team",
  phone: "Phone",
  skills: "Skills",
  deloittePersonId: "Deloitte person ID",
  networkId: "Network ID",
  workdayId: "Workday ID",
  gender: "Gender",
  clientManager: "Client manager",
  birthday: "Birthday",
} as const;

export type CheckedField = keyof typeof FIELD_LABELS;
export type FieldProblems = Partial<Record<CheckedField, string>>;

const LENGTH_FIELDS = [
  "firstName",
  "lastName",
  "homeOffice",
  "level",
  "offering",
  "op",
  "team",
  "phone",
  "deloittePersonId",
  "networkId",
  "workdayId",
  "gender",
  "clientManager",
] as const;

/** Every problem the server would refuse in this person's details, in plain words.
 *  Missing fields are fine here (an import row may carry only some of them). */
export function checkEmployeeFields(
  person: Partial<
    Record<(typeof LENGTH_FIELDS)[number], string> & {
      deloitteEmail: string;
      takedaEmail: string;
      milestone: string;
      birthday: string;
      skills: string[];
    }
  >,
): FieldProblems {
  const problems: FieldProblems = {};
  for (const key of LENGTH_FIELDS) {
    const value = person[key];
    if (typeof value === "string" && value.trim().length > LIMITS[key]) {
      problems[key] =
        `${FIELD_LABELS[key]} is too long (${LIMITS[key]} characters at most).`;
    }
  }
  const email = person.deloitteEmail;
  if (typeof email === "string" && email.trim() !== "") {
    const problem = emailProblem(email);
    if (problem) problems.deloitteEmail = problem;
  }
  const takeda = person.takedaEmail;
  if (typeof takeda === "string" && takeda.trim() !== "") {
    const problem = emailProblem(takeda);
    if (problem) problems.takedaEmail = problem;
  }
  const milestone = person.milestone;
  if (typeof milestone === "string" && milestone.trim() !== "") {
    if (!/^\d{4}$/.test(milestone.trim())) problems.milestone = "Use a four-digit year.";
  }
  const birthday = person.birthday;
  if (typeof birthday === "string" && !isValidBirthday(birthday)) {
    problems.birthday = BIRTHDAY_HINT;
  }
  const skills = person.skills;
  if (Array.isArray(skills)) {
    if (skills.length > LIMITS.skills) {
      problems.skills = `Too many skills (${LIMITS.skills} at most).`;
    } else if (skills.some((s) => s.trim().length > LIMITS.skill)) {
      problems.skills = `A skill is too long (${LIMITS.skill} characters at most).`;
    }
  }
  return problems;
}
