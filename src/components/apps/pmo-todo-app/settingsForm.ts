// The Settings form as plain text boxes (one entry per line) and its
// conversion to a config patch, checked by the same zod schema the server uses.
// Pure, with .ts imports, so `pnpm test` can load it (see queueView.test.mjs).
import {
  PmoConfigPatchSchema,
  type PmoConfig,
  type PmoConfigPatch,
} from "../../../lib/pmo/types.ts";

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
  chaserDays: string;
  /** 0 = Sunday. */
  workDays: number[];
}
export type FormText = Record<ListField, string> & {
  retentionDays: string;
  reminders: RemindersForm;
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
    reminders: {
      ...config.reminders,
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

/** Turn the form into a config patch, or say what is wrong, field by field. */
export function buildPatch(
  form: FormText,
):
  | { patch: PmoConfigPatch; errors: null }
  | { patch: null; errors: Partial<Record<string, string>> } {
  const lists = Object.fromEntries(
    LIST_FIELDS.map((field) => [field, entries(form[field])]),
  ) as Record<ListField, { value: string; line: number }[]>;
  const retention =
    form.retentionDays.trim() === "" ? Number.NaN : Number(form.retentionDays);
  const candidate = {
    me: {
      names: lists.names.map((entry) => entry.value),
      emails: lists.emails.map((entry) => entry.value),
    },
    allowedSenderDomains: lists.allowedSenderDomains.map((entry) => entry.value),
    allowedTenantIds: lists.allowedTenantIds.map((entry) => entry.value),
    teamsChatAllowlist: lists.teamsChatAllowlist.map((entry) => entry.value),
    blockedDomains: lists.blockedDomains.map((entry) => entry.value),
    blockedTerms: lists.blockedTerms.map((entry) => entry.value),
    retentionDays: retention,
    reminders: {
      ...form.reminders,
      timeZone: form.reminders.timeZone.trim(),
      chaserDays:
        form.reminders.chaserDays.trim() === ""
          ? Number.NaN
          : Number(form.reminders.chaserDays),
      workDays: [...form.reminders.workDays].sort(),
    },
  };
  const parsed = PmoConfigPatchSchema.safeParse(candidate);
  if (parsed.success) return { patch: parsed.data, errors: null };

  const errors: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const [head, second, third] = issue.path;
    if (head === "reminders") {
      errors[`reminders.${String(second)}`] ??= issue.message;
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
