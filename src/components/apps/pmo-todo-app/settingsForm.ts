// The Settings form as plain text boxes (one entry per line) and its
// conversion to a config patch, checked by the same zod schema the server uses.
// Pure, with .ts imports, so `pnpm test` can load it (see queueView.test.mjs).
import {
  PmoConfigPatchSchema,
  type PmoConfig,
  type PmoConfigPatch,
} from "../../../lib/pmo/types.ts";
import {
  parseDomainList,
  parseEmailList,
  type ListIssue,
} from "../../../lib/pmo/listValidation.ts";

/** The list fields, one entry per line in the form. */
export const LIST_FIELDS = [
  "names",
  "emails",
  "allowedSenderDomains",
  "allowedTenantIds",
  "teamsChatAllowlist",
  "blockedDomains",
  "blockedTerms",
] as const;
export type ListField = (typeof LIST_FIELDS)[number];
/** The Reminders section: switches and times as the form holds them. */
export interface RemindersForm {
  enabled: boolean;
  hideDetails: boolean;
  quietOutsideHours: boolean;
  digest: boolean;
  keepRunningInTray: boolean;
  timeZone: string;
  workStart: string;
  workEnd: string;
  leadWorkingDays: string;
  chaserDays: string;
  /** 0 = Sunday. */
  workDays: number[];
}
export type FormText = Record<ListField, string> & {
  retentionDays: string;
  reminders: RemindersForm;
  /** The weekly report's heading. */
  reportTitle: string;
  reportProject: string;
};

export function formFromConfig(config: PmoConfig): FormText {
  const join = (values: string[]) => values.join("\n");
  return {
    names: join(config.me.names),
    emails: join(config.me.emails),
    allowedSenderDomains: join(config.allowedSenderDomains),
    allowedTenantIds: join(config.allowedTenantIds),
    teamsChatAllowlist: join(config.teamsChatAllowlist),
    blockedDomains: join(config.blockedDomains),
    blockedTerms: join(config.blockedTerms),
    retentionDays: String(config.retentionDays),
    reportTitle: config.report.title,
    reportProject: config.report.projectName,
    reminders: {
      ...config.reminders,
      leadWorkingDays: String(config.reminders.leadWorkingDays),
      chaserDays: String(config.reminders.chaserDays),
      workDays: [...config.reminders.workDays],
    },
  };
}

/** Non-blank lines, remembering which line of the box each came from. */
function entries(text: string): { value: string; line: number }[] {
  return text
    .split(/\r?\n/)
    .map((value, index) => ({ value: value.trim(), line: index + 1 }))
    .filter((entry) => entry.value !== "");
}

/** The three lists that are real email addresses / domains. Typed with one
 *  entry per line, commas also work; each entry is checked on its own. */
export const CHECKED_LISTS = {
  emails: parseEmailList,
  allowedSenderDomains: parseDomainList,
  blockedDomains: parseDomainList,
} as const;
export type CheckedListField = keyof typeof CHECKED_LISTS;

export const checkedList = (field: CheckedListField, text: string) =>
  CHECKED_LISTS[field](text);

const describeIssues = (issues: ListIssue[]) => {
  const [first] = issues;
  const more = issues.length > 1 ? ` (and ${issues.length - 1} more)` : "";
  return `"${first.value}": ${first.reason}${more}`;
};

/** Turn the form into a config patch, or say what is wrong, field by field. */
export function buildPatch(
  form: FormText,
):
  | { patch: PmoConfigPatch; errors: null }
  | { patch: null; errors: Partial<Record<string, string>> } {
  const lists = Object.fromEntries(
    LIST_FIELDS.map((field) => [field, entries(form[field])]),
  ) as Record<ListField, { value: string; line: number }[]>;
  const checked = {
    emails: checkedList("emails", form.emails),
    allowedSenderDomains: checkedList("allowedSenderDomains", form.allowedSenderDomains),
    blockedDomains: checkedList("blockedDomains", form.blockedDomains),
  };
  const retention =
    form.retentionDays.trim() === "" ? Number.NaN : Number(form.retentionDays);
  const candidate = {
    me: {
      names: lists.names.map((entry) => entry.value),
      emails: checked.emails.valid,
    },
    allowedSenderDomains: checked.allowedSenderDomains.valid,
    allowedTenantIds: lists.allowedTenantIds.map((entry) => entry.value),
    teamsChatAllowlist: lists.teamsChatAllowlist.map((entry) => entry.value),
    blockedDomains: checked.blockedDomains.valid,
    blockedTerms: lists.blockedTerms.map((entry) => entry.value),
    retentionDays: retention,
    report: { title: form.reportTitle.trim(), projectName: form.reportProject.trim() },
    reminders: {
      ...form.reminders,
      timeZone: form.reminders.timeZone.trim(),
      leadWorkingDays:
        form.reminders.leadWorkingDays.trim() === ""
          ? Number.NaN
          : Number(form.reminders.leadWorkingDays),
      chaserDays:
        form.reminders.chaserDays.trim() === ""
          ? Number.NaN
          : Number(form.reminders.chaserDays),
      workDays: [...form.reminders.workDays].sort(),
    },
  };
  const parsed = PmoConfigPatchSchema.safeParse(candidate);
  const errors: Record<string, string> = {};
  for (const [field, result] of Object.entries(checked)) {
    if (result.invalid.length > 0) errors[field] = describeIssues(result.invalid);
  }
  if (parsed.success && Object.keys(errors).length === 0) {
    return { patch: parsed.data, errors: null };
  }

  for (const issue of parsed.success ? [] : parsed.error.issues) {
    const [head, second, third] = issue.path;
    if (head === "reminders" || head === "report") {
      errors[`${head}.${String(second)}`] ??= issue.message;
      continue;
    }
    const field: string =
      head === "me" ? (second === "names" ? "names" : "emails") : String(head);
    const index =
      typeof third === "number" ? third : typeof second === "number" ? second : null;
    const line =
      index !== null && field in lists
        ? lists[field as ListField][index]?.line
        : undefined;
    errors[field] ??= line ? `Line ${line}: ${issue.message}` : issue.message;
  }
  return { patch: null, errors };
}
