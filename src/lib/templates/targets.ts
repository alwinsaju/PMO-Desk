// Where a template can be used. Each target is one place that produces text from
// a template: a mail-sending task or one piece of an app. The catalog says which
// kind of template it takes and which `{{placeholders}}` it can fill, so the
// Templates app can offer only what works and refuse what would stay unfilled.
// Pure data (no node imports): the Templates app, the API and the PMO app share it.
import type { TemplateKind } from "./types.ts";

export interface PlaceholderDef {
  name: string;
  description: string;
  /** Shown in the live preview. */
  sample: string;
}

export interface TemplateTarget {
  /** `task:<task id>` or `app:<app id>:<slot>`; what `Template.usedBy` holds. */
  key: string;
  type: "task" | "app";
  /** "Aging Report", "PMO To-Do" */
  label: string;
  /** What the template becomes there: "Email draft", "Sign-off request". */
  detail: string;
  kind: TemplateKind;
  placeholders: PlaceholderDef[];
  /** The recipients (To, Cc) are used by this target, not just subject and body. */
  usesRecipients: boolean;
}

const sender = (): PlaceholderDef => ({
  name: "my_name",
  description: "Your first name, from the PMO To-Do settings",
  sample: "Alex",
});

export const TARGETS: readonly TemplateTarget[] = [
  {
    key: "task:weekly-aging-report",
    type: "task",
    label: "Aging Report",
    detail: "Email draft",
    kind: "email",
    usesRecipients: true,
    placeholders: [
      {
        name: "date_subject",
        description: "The cutoff date as the subject shows it",
        sample: "5th August",
      },
      {
        name: "date_full",
        description: "The cutoff date with the year",
        sample: "5th August 2026",
      },
      { name: "total", description: "Number of aging incidents", sample: "42" },
      { name: "people", description: "Number of people with incidents", sample: "11" },
    ],
  },
  {
    key: "task:weekly-backlog-report",
    type: "task",
    label: "Backlog Report",
    detail: "Email draft",
    kind: "email",
    usesRecipients: true,
    placeholders: [
      { name: "date", description: "The report date", sample: "05 August 2026" },
      { name: "total", description: "Number of backlog incidents", sample: "87" },
      { name: "people", description: "Number of people with incidents", sample: "14" },
    ],
  },
  {
    key: "task:deployment-dep-weekend-mailer",
    type: "task",
    label: "Deployment & DEP Weekend Mailer",
    detail: "Email draft",
    kind: "email",
    usesRecipients: true,
    placeholders: [
      {
        name: "date",
        description: "The date as the subject shows it",
        sample: "8/22/2026",
      },
      {
        name: "body_date",
        description: "The date as written in the message",
        sample: "22nd August",
      },
      { name: "title", description: "The title of this week's block", sample: "Aug 22" },
    ],
  },
  {
    key: "app:pmo-todo:signoff",
    type: "app",
    label: "PMO To-Do",
    detail: "Sign-off request",
    kind: "email",
    usesRecipients: false,
    placeholders: [
      {
        name: "greeting",
        description: "“Hi Sam,” (or “Hi,” without a name)",
        sample: "Hi Sam,",
      },
      { name: "title", description: "The to-do's title", sample: "Release plan v2" },
      {
        name: "by_date",
        description: "“ by Thu 5 Mar 2026” when the to-do has a due date, else nothing",
        sample: " by Thu 5 Mar 2026",
      },
      {
        name: "summary",
        description: "The first sentence of the description, if there is one",
        sample: " It covers the cut-over steps.",
      },
      {
        name: "context",
        description: "Where the request came from (message and link)",
        sample: 'This follows the email "Release plan" from Priya.',
      },
      sender(),
    ],
  },
  {
    key: "app:pmo-todo:chaser",
    type: "app",
    label: "PMO To-Do",
    detail: "Chaser",
    kind: "email",
    usesRecipients: false,
    placeholders: [
      {
        name: "greeting",
        description: "“Hi Sam,” for the person you are waiting on",
        sample: "Hi Sam,",
      },
      { name: "title", description: "The to-do's title", sample: "Release plan v2" },
      { name: "waiting_on", description: "Who you are waiting on", sample: "Sam Rivera" },
      {
        name: "waited",
        description: "How long you have waited",
        sample: "3 working days",
      },
      sender(),
    ],
  },
  {
    key: "app:pmo-todo:report",
    type: "app",
    label: "PMO To-Do",
    detail: "Weekly report",
    kind: "report",
    usesRecipients: false,
    placeholders: [
      {
        name: "report",
        description: "The report itself (put it where you want it)",
        sample: "## Summary\n- Open: 12\n- Closed this period: 5",
      },
      {
        name: "title",
        description: "The report title",
        sample: "Project Atlas: Weekly status",
      },
      {
        name: "period",
        description: "The period it covers",
        sample: "Mon 19 Oct to Sun 25 Oct 2026",
      },
      sender(),
    ],
  },
  {
    key: "app:staff:leave-approved",
    type: "app",
    label: "Staff",
    detail: "Leave approved reply",
    kind: "email",
    usesRecipients: false,
    placeholders: [
      { name: "first_name", description: "The requester's first name", sample: "Ana" },
      {
        name: "dates",
        description: "The leave dates",
        sample: "2026-11-05 to 2026-11-07",
      },
      { name: "type", description: "The kind of leave", sample: "pto" },
      sender(),
    ],
  },
  {
    key: "app:staff:leave-rejected",
    type: "app",
    label: "Staff",
    detail: "Leave not approved reply",
    kind: "email",
    usesRecipients: false,
    placeholders: [
      { name: "first_name", description: "The requester's first name", sample: "Ana" },
      {
        name: "dates",
        description: "The leave dates",
        sample: "2026-11-05 to 2026-11-07",
      },
      { name: "type", description: "The kind of leave", sample: "pto" },
      {
        name: "note",
        description: "The reason you typed, or nothing",
        sample: "It is release week.",
      },
      sender(),
    ],
  },
  {
    key: "app:staff:birthday",
    type: "app",
    label: "Staff",
    detail: "Birthday greeting",
    kind: "email",
    usesRecipients: false,
    placeholders: [
      { name: "first_name", description: "Their first name", sample: "Ana" },
      sender(),
    ],
  },
  {
    key: "app:staff:anniversary",
    type: "app",
    label: "Staff",
    detail: "Work anniversary greeting",
    kind: "email",
    usesRecipients: false,
    placeholders: [
      { name: "first_name", description: "Their first name", sample: "Ana" },
      { name: "years", description: "Whole years on the team", sample: "3" },
      sender(),
    ],
  },
  {
    key: "app:pmo-todo:escalation",
    type: "app",
    label: "PMO To-Do",
    detail: "Escalation",
    kind: "email",
    usesRecipients: false,
    placeholders: [
      { name: "title", description: "The to-do's title", sample: "Release plan v2" },
      { name: "waiting_on", description: "Who you are waiting on", sample: "Sam Rivera" },
      { name: "due", description: "The due date, or nothing", sample: "2026-11-05" },
      sender(),
    ],
  },
  {
    key: "app:pmo-todo:handoff",
    type: "app",
    label: "PMO To-Do",
    detail: "Hand-over note",
    kind: "email",
    usesRecipients: false,
    placeholders: [
      { name: "first_name", description: "Who takes it over", sample: "Ben" },
      { name: "title", description: "The to-do's title", sample: "Release plan v2" },
      { name: "due", description: "The due date, or nothing", sample: "2026-11-05" },
      { name: "priority", description: "Its priority", sample: "high" },
      { name: "stage", description: "Where it is now, or nothing", sample: "Review" },
      {
        name: "waiting_on",
        description: "Who it waits on, or nothing",
        sample: "Sam Rivera",
      },
      {
        name: "background",
        description: "The to-do's description, or nothing",
        sample: "It covers the cut-over steps.",
      },
      {
        name: "still_to_do",
        description: "The open action items as a list, or nothing",
        sample: "- Confirm the date\n- Send the plan",
      },
      sender(),
    ],
  },
];

export const targetByKey = (key: string): TemplateTarget | undefined =>
  TARGETS.find((target) => target.key === key);

export const targetsOfKind = (kind: TemplateKind): TemplateTarget[] =>
  TARGETS.filter((target) => target.kind === kind);

/** "Aging Report · Email draft" */
export const targetLabel = (target: Pick<TemplateTarget, "label" | "detail">): string =>
  `${target.label} · ${target.detail}`;

/** Placeholder names a template assigned to `keys` may use: those every one of
 *  its targets can fill. No targets = anything is allowed (nothing uses it yet). */
export function allowedPlaceholders(keys: readonly string[]): Set<string> | null {
  const targets = keys.map(targetByKey).filter((t): t is TemplateTarget => !!t);
  if (targets.length === 0) return null;
  const [first, ...rest] = targets.map((t) => new Set(t.placeholders.map((p) => p.name)));
  return new Set([...first].filter((name) => rest.every((set) => set.has(name))));
}

/** The sample values of the targets' common placeholders, for the live preview. */
export function sampleValues(keys: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of keys) {
    for (const p of targetByKey(key)?.placeholders ?? []) out[p.name] ??= p.sample;
  }
  return out;
}
