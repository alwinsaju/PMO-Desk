// Values and wrappers for the templates the PMO To-Do app uses (targets.ts:
// `app:pmo-todo:chaser` and `app:pmo-todo:report`; the sign-off request is in
// signoffRequest.ts). Pure: the dialogs call these with a template they fetched.
import { renderFields, type Rendered } from "../templates/render.ts";
import type { Template } from "../templates/types.ts";
import { waitingState } from "./due.ts";
import type { PmoConfig, ReminderPrefs, Todo } from "./types.ts";

type Fields = Pick<Template, "subject" | "to" | "cc" | "body">;

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** "Sam Rivera <sam@x.com>" -> "Sam"; "the vendor team" stays whole. */
function greetingName(waitingOn: string | null): string {
  const name = (waitingOn ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!name) return "";
  const words = name.split(" ");
  const group = /\b(team|group|desk|committee|everyone|all)\b/i.test(name);
  return group || words.length === 1 ? name : words[0];
}

export interface ChaserValuesInput {
  todo: Pick<
    Todo,
    "title" | "waitingOn" | "waitingSince" | "updatedAt" | "chaserDays" | "status"
  >;
  now: Date;
  prefs: Pick<ReminderPrefs, "timeZone" | "workDays" | "chaserDays">;
  /** My first name, for the sign-off. */
  myName: string;
}

/** The pieces of a chaser, by the names the chaser template can use. */
export function chaserValues(input: ChaserValuesInput): Record<string, string> {
  const { todo } = input;
  const waiting = waitingState(todo, input.now, input.prefs);
  const name = greetingName(todo.waitingOn);
  return {
    greeting: name ? `Hi ${name},` : "Hi,",
    title: todo.title.replace(/\s+/g, " ").trim(),
    waiting_on: (todo.waitingOn ?? "").replace(/\s+/g, " ").trim(),
    waited: waiting
      ? waiting.quietDays > 0
        ? plural(waiting.quietDays, "working day")
        : waiting.calendarDays > 0
          ? plural(waiting.calendarDays, "day")
          : "less than a day"
      : "a while",
    my_name: input.myName,
  };
}

/** The name to sign a message with: the first name in the settings, as written
 *  ("Qa Tester", not "Qa"). Empty when none is set. */
export const myFullName = (me: Pick<PmoConfig["me"], "names">): string =>
  (me.names[0] ?? "").replace(/\s+/g, " ").trim();

/** A chaser written from a template: subject, recipient and message. */
export function chaserFromTemplate(
  template: Fields,
  values: Record<string, string>,
): Rendered {
  return renderFields(template, values);
}

/**
 * What the chaser dialog shows after "Use my template". A template may leave the subject
 * or the recipient blank; those then keep the app's own subject and the model draft's
 * recipient instead of leaving an empty field. (The subject once came out blank here.)
 */
export function chaserDialogFields(
  template: Fields,
  values: Record<string, string>,
  fallback: { subject: string; to: string },
): { subject: string; to: string; body: string } {
  const written = chaserFromTemplate(template, values);
  return {
    subject: written.subject || fallback.subject,
    to: written.to || fallback.to,
    body: written.body,
  };
}

export interface ReportValuesInput {
  title: string;
  periodLabel: string;
  me: Pick<PmoConfig["me"], "names">;
}

const first = (names: readonly string[]) => (names[0] ?? "").split(/[\s(,<]/)[0] ?? "";

/**
 * The weekly report inside a template: `{{report}}` becomes `report` (Markdown or
 * plain text, whichever the caller is copying), `{{title}}`, `{{period}}` and
 * `{{my_name}}` are filled. Returns the new subject and message.
 */
export function applyReportTemplate(
  template: Fields,
  report: string,
  input: ReportValuesInput,
): { subject: string; body: string } {
  const rendered = renderFields(template, {
    report: report.trim(),
    title: input.title,
    period: input.periodLabel,
    my_name: first(input.me.names),
  });
  return { subject: rendered.subject, body: `${rendered.body}\n` };
}
