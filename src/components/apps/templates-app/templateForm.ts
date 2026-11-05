// The Templates app's editing logic, without React: the form's draft, what makes it
// changed, which places it can be used in and what the live preview shows. Relative
// `.ts` imports so `pnpm test` can load it under plain Node.
import { checkInput, type TemplateErrors } from "../../../lib/templates/library.ts";
import {
  renderFields,
  renderText,
  tidyText,
  type Rendered,
  type Snippets,
} from "../../../lib/templates/render.ts";
import {
  TARGETS,
  allowedPlaceholders,
  sampleValues,
  targetsOfKind,
  type PlaceholderDef,
  type TemplateTarget,
} from "../../../lib/templates/targets.ts";
import {
  LIMITS,
  type Template,
  type TemplateInput,
  type TemplateKind,
  type TemplateVersion,
} from "../../../lib/templates/types.ts";
import { recipientsProblem } from "../../../lib/templates/recipients.ts";

/** What the form holds: a template's fields; `id` is null for one not saved yet. */
export interface Draft extends TemplateInput {
  id: string | null;
}

export function blankDraft(kind: TemplateKind = "email"): Draft {
  return {
    id: null,
    name: "",
    kind,
    description: "",
    subject: "",
    to: "",
    cc: "",
    body: "",
    usedBy: [],
  };
}

export function draftOf(template: Template): Draft {
  return {
    id: template.id,
    name: template.name,
    kind: template.kind,
    description: template.description,
    subject: template.subject,
    to: template.to,
    cc: template.cc,
    body: template.body,
    usedBy: [...template.usedBy],
    starterId: template.starterId,
  };
}

/** A copy that is saved as a new template, used nowhere until chosen. */
export function copyOf(template: Template): Draft {
  return {
    ...draftOf(template),
    id: null,
    name: `${template.name} (copy)`,
    usedBy: [],
    starterId: undefined,
  };
}

export function toInput(draft: Draft): TemplateInput {
  const { id: _id, ...input } = draft;
  return input;
}

/** Everything a person can set on a saved template, to put it back after a delete. */
export function restoreInput(template: Template): TemplateInput {
  return {
    name: template.name,
    kind: template.kind,
    description: template.description,
    subject: template.subject,
    to: template.to,
    cc: template.cc,
    body: template.body,
    usedBy: [...template.usedBy],
    tags: template.tags ? [...template.tags] : undefined,
    variants: template.variants ? template.variants.map((v) => ({ ...v })) : undefined,
    starterId: template.starterId,
  };
}

const FIELDS = ["name", "kind", "description", "subject", "to", "cc", "body"] as const;

/** What saving `template` with an earlier version's wording would send; tags, wordings and places stay. */
export function versionInput(
  template: Template,
  version: TemplateVersion,
): TemplateInput {
  const { name, description, subject, to, cc, body } = version;
  return { ...restoreInput(template), name, description, subject, to, cc, body };
}

/** Has the draft been changed from the saved template (or, for a new one, filled in)? */
export function isDirty(draft: Draft, saved: Template | null): boolean {
  if (!saved) {
    return (
      FIELDS.some((field) => draft[field] !== blankDraft(draft.kind)[field]) ||
      draft.usedBy.length > 0
    );
  }
  return (
    FIELDS.some((field) => draft[field] !== saved[field]) ||
    [...draft.usedBy].sort().join("|") !== [...saved.usedBy].sort().join("|")
  );
}

/** Changing the kind drops the places that do not take the new one. */
export function withKind(draft: Draft, kind: TemplateKind): Draft {
  const keep = draft.usedBy.filter((key) =>
    TARGETS.some((t) => t.key === key && t.kind === kind),
  );
  return { ...draft, kind, usedBy: keep };
}

export function withPlace(draft: Draft, key: string, on: boolean): Draft {
  const rest = draft.usedBy.filter((k) => k !== key);
  return { ...draft, usedBy: on ? [...rest, key] : rest };
}

/** The template (other than `exceptId`) that has the place now, if any. */
export function holderOf(
  templates: readonly Template[],
  key: string,
  exceptId: string | null,
): Template | undefined {
  return templates.find((tpl) => tpl.id !== exceptId && tpl.usedBy.includes(key));
}

export interface PlaceGroup {
  heading: "Tasks" | "Apps";
  targets: TemplateTarget[];
}

/** The places a template of this kind can be used in, tasks first. */
export function placeGroups(kind: TemplateKind): PlaceGroup[] {
  const targets = targetsOfKind(kind);
  return (
    [
      { heading: "Tasks", targets: targets.filter((t) => t.type === "task") },
      { heading: "Apps", targets: targets.filter((t) => t.type === "app") },
    ] satisfies PlaceGroup[]
  ).filter((group) => group.targets.length > 0);
}

/**
 * The placeholders to offer: those every chosen place can fill; with no place
 * chosen yet, all that any place of this kind offers (the choice then narrows them).
 */
export function offeredPlaceholders(
  draft: Pick<Draft, "kind" | "usedBy">,
): PlaceholderDef[] {
  const targets =
    draft.usedBy.length > 0
      ? TARGETS.filter((t) => draft.usedBy.includes(t.key))
      : targetsOfKind(draft.kind);
  const common = allowedPlaceholders(draft.usedBy);
  const seen = new Map<string, PlaceholderDef>();
  for (const target of targets) {
    for (const p of target.placeholders) {
      if (!seen.has(p.name) && (common === null || common.has(p.name)))
        seen.set(p.name, p);
    }
  }
  return [...seen.values()];
}

/** Inserts `text` over the selection and says where the caret goes. */
export function insertAt(
  value: string,
  start: number,
  end: number,
  text: string,
): { value: string; caret: number } {
  const from = Math.max(0, Math.min(start, value.length));
  const to = Math.max(from, Math.min(end, value.length));
  return {
    value: value.slice(0, from) + text + value.slice(to),
    caret: from + text.length,
  };
}

/** Wraps the selection in `mark` (`**` for bold), or takes the marks off when the selection already
 *  has them (inside it or just outside it). With nothing selected the marks go around the caret. The
 *  result says what to select afterwards. */
export function toggleWrap(
  value: string,
  start: number,
  end: number,
  mark = "**",
): { value: string; start: number; end: number } {
  const from = Math.max(0, Math.min(start, value.length));
  const to = Math.max(from, Math.min(end, value.length));
  const m = mark.length;
  const inner = value.slice(from, to);
  if (inner.length >= 2 * m && inner.startsWith(mark) && inner.endsWith(mark)) {
    const bare = inner.slice(m, inner.length - m);
    return {
      value: value.slice(0, from) + bare + value.slice(to),
      start: from,
      end: from + bare.length,
    };
  }
  if (
    value.slice(from - m, from) === mark &&
    value.slice(to, to + m) === mark &&
    from >= m
  ) {
    return {
      value: value.slice(0, from - m) + inner + value.slice(to + m),
      start: from - m,
      end: to - m,
    };
  }
  return {
    value: value.slice(0, from) + mark + inner + mark + value.slice(to),
    start: from + m,
    end: to + m,
  };
}

/** The placeholders whose name or description contains every word typed (braces ignored). */
export function filterPlaceholders<
  T extends Pick<PlaceholderDef, "name" | "description">,
>(tokens: readonly T[], query: string): T[] {
  const words = query.toLowerCase().replace(/[{}]/g, " ").split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...tokens];
  return tokens.filter((t) => {
    const hay = `${t.name} ${t.description}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** The places whose example values the preview uses: the chosen ones, else every place of the kind. */
const sampleKeys = (draft: Pick<Draft, "kind" | "usedBy">): string[] =>
  draft.usedBy.length > 0 ? draft.usedBy : targetsOfKind(draft.kind).map((t) => t.key);

/** The subject and message as they would read, with each place's sample values (and the library's snippets). */
export function previewOf(draft: Draft, snippets?: Snippets): Rendered {
  return renderFields(draft, sampleValues(sampleKeys(draft)), snippets);
}

/** The message with example values filled in and its `**bold**` markers kept, so
 *  the preview can show them bold. */
export function previewBodyOf(draft: Draft, snippets?: Snippets): string {
  return tidyText(renderText(draft.body, sampleValues(sampleKeys(draft)), snippets));
}

/**
 * The template's wording for the clipboard: the subject (or title line) and the message exactly as typed,
 * with the {{placeholders}} and **bold** markers kept. Not the example-filled preview. To and Cc are left out.
 */
export function wordingOf(draft: Pick<Draft, "kind" | "subject" | "body">): string {
  const subject = draft.subject.trim();
  const body = draft.body.trim();
  const label = draft.kind === "email" ? "Subject" : "Title line";
  if (subject && body) return `${label}: ${subject}\n\n${body}`;
  return subject ? `${label}: ${subject}` : body;
}

/** What is wrong with the form now (nothing is shown until a field has been touched). */
export function problems(draft: Draft): TemplateErrors {
  const checked = checkInput(toInput(draft));
  const errors: TemplateErrors = checked.ok ? {} : { ...checked.errors };
  if (draft.kind === "email") {
    for (const field of ["to", "cc"] as const) {
      const bad = recipientsProblem(draft[field]);
      if (bad && !errors[field]) errors[field] = bad;
    }
  }
  return errors;
}

const FIELD_ORDER = [
  "name",
  "kind",
  "subject",
  "to",
  "cc",
  "body",
  "usedBy",
  "variants",
] as const;

/** The line shown next to Save when Save is pressed but something stops it, so the reason is in view
 *  even when the field itself has scrolled away. Null when nothing stops it. */
export function saveBlockedMessage(errors: TemplateErrors): string | null {
  for (const field of FIELD_ORDER) {
    if (errors[field]) return `Not saved yet: ${errors[field]}`;
  }
  return null;
}

/** What to tell the person after tags are saved: how many are kept, and why some were cut. */
export function tagsSavedMessage(
  typed: readonly string[],
  kept: readonly string[],
): string {
  const asked = new Set(typed.map((t) => t.trim().toLowerCase()).filter(Boolean)).size;
  if (kept.length === 0) return "Tags cleared.";
  if (asked > kept.length) {
    return `Tags saved. ${kept.length} kept: a template has at most ${LIMITS.tags} tags of ${LIMITS.tag} characters.`;
  }
  const cut = typed.some((t) => t.trim().length > LIMITS.tag);
  return cut
    ? `Tags saved. Long tags are shortened to ${LIMITS.tag} characters.`
    : "Tags saved.";
}

/** After Undo of a delete: which places stayed with the template that took them. */
export function undoNotice(name: string, leftBehind: readonly string[]): string {
  return leftBehind.length === 0
    ? `Brought back “${name}”.`
    : `Brought back “${name}”. ${leftBehind.length === 1 ? "One place now uses" : `${leftBehind.length} places now use`} another template, so ${leftBehind.length === 1 ? "it stays" : "they stay"} with that one. Choose them in “Used by” to move ${leftBehind.length === 1 ? "it" : "them"} back.`;
}

/** The note after importing a pack: how many came in, which were skipped on purpose and why any failed. */
export function importSummary(
  made: number,
  failures: readonly string[],
  skipped: readonly string[],
): string {
  const parts = [`Imported ${made} template${made === 1 ? "" : "s"}`];
  if (skipped.length > 0) parts.push(`skipped ${skipped.join(", ")}`);
  let text = `${parts.join("; ")}.`;
  if (failures.length > 0) {
    const reasons = [...new Set(failures)].slice(0, 2).join(" ");
    text += ` ${failures.length} could not be added. ${reasons}`;
  }
  return `${text} None is used anywhere until you choose.`;
}

/** The note after "Restore built-in templates". */
export function restoreSummary(result: {
  added: number;
  rebuilt: boolean;
  backup: string | null;
}): string {
  if (result.rebuilt) {
    return `Started a fresh library with the ${result.added} built-in templates.${result.backup ? ` The unreadable file is kept as ${result.backup}.` : ""}`;
  }
  if (result.added === 0) return "All the built-in templates are already there.";
  return `Added back ${result.added} built-in template${result.added === 1 ? "" : "s"}. Places another template uses stay with it.`;
}
