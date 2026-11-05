// The template library's rules, as pure functions over a plain list: checking an
// edit, creating and updating (a target has at most one template per kind, so
// claiming it takes it from the previous one), deleting and looking up the
// template a target uses. No files here; server.ts stores the result.
import {
  malformedPlaceholders,
  oneLine,
  tidyText,
  unknownPlaceholders,
} from "./render.ts";
import { STARTERS } from "./starters.ts";
import { allowedPlaceholders, targetByKey, targetLabel } from "./targets.ts";
import {
  KIND_LABEL,
  LIBRARY_VERSION,
  LIMITS,
  TEMPLATE_KINDS,
  type Displaced,
  type Template,
  type TemplateInput,
  type TemplateKind,
  type TemplateLibrary,
  type TemplateVariant,
  type TemplateVersion,
} from "./types.ts";

export const TEMPLATE_ID = /^tpl_[0-9a-f]{8,32}$/;

export const newTemplateId = (): string =>
  `tpl_${globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;

export type TemplateErrors = Partial<
  Record<
    "name" | "kind" | "subject" | "to" | "cc" | "body" | "usedBy" | "variants",
    string
  >
>;

export type Checked =
  { ok: true; value: TemplateInput } | { ok: false; errors: TemplateErrors };

const text = (value: unknown): string => (typeof value === "string" ? value : "");

const list = (names: readonly string[]) => names.map((n) => `{{${n}}}`).join(", ");

function malformedMessage(found: readonly string[]): string {
  return `${found.length === 1 ? "A placeholder" : "Some placeholders"} (${found.map((n) => `{{${n}}}`).join(", ")}) can never be filled in. Use lower-case letters, numbers and underscores, like {{first_name}}.`;
}

function unknownMessage(unknown: readonly string[], where: string): string {
  return `${list(unknown)} ${unknown.length === 1 ? "is" : "are"} not available ${where}.`;
}

/** "in Aging Report · Email draft" for one place, "in every place this template is used" for several. */
function placeSentence(usedBy: readonly string[]): string {
  if (usedBy.length === 1) {
    const target = targetByKey(usedBy[0]);
    if (target) return `in ${targetLabel(target)}`;
  }
  return "in every place this template is used";
}

/** Up to LIMITS.tags short, distinct labels (case-insensitive), each with no line breaks. */
export function cleanTags(raw: unknown): string[] {
  const out: string[] = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    const tag = oneLine(text(item)).slice(0, LIMITS.tag);
    if (tag && !out.some((t) => t.toLowerCase() === tag.toLowerCase())) out.push(tag);
    if (out.length >= LIMITS.tags) break;
  }
  return out;
}

/** Up to LIMITS.variants other wordings; one needs a label and some text. */
export function cleanVariants(raw: unknown): TemplateVariant[] {
  const out: TemplateVariant[] = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    if (typeof item !== "object" || item === null) continue;
    const v = item as Record<string, unknown>;
    const label = oneLine(text(v.label)).slice(0, LIMITS.variantLabel);
    const body = tidyText(text(v.body)).slice(0, LIMITS.body);
    if (!label || !body) continue;
    const id = /^[a-z0-9_-]{1,40}$/.test(text(v.id)) ? text(v.id) : `v${out.length + 1}`;
    if (out.some((x) => x.id === id)) continue;
    out.push({
      id,
      label,
      subject: oneLine(text(v.subject)).slice(0, LIMITS.subject),
      body,
    });
    if (out.length >= LIMITS.variants) break;
  }
  return out;
}

function cleanHistory(raw: unknown): TemplateVersion[] {
  const out: TemplateVersion[] = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    if (typeof item !== "object" || item === null) continue;
    const v = item as Record<string, unknown>;
    if (!text(v.at) || !text(v.name)) continue;
    out.push({
      at: text(v.at),
      name: oneLine(text(v.name)).slice(0, LIMITS.name),
      description: oneLine(text(v.description)).slice(0, LIMITS.description),
      subject: oneLine(text(v.subject)).slice(0, LIMITS.subject),
      to: oneLine(text(v.to)).slice(0, LIMITS.address),
      cc: oneLine(text(v.cc)).slice(0, LIMITS.address),
      body: tidyText(text(v.body)).slice(0, LIMITS.body),
    });
    if (out.length >= LIMITS.history) break;
  }
  return out;
}

/**
 * Cleans what came in (any JSON) into a TemplateInput, or says what is wrong per
 * field. A subject or address never holds a line break, and a template that is
 * used by a target may only use placeholders every one of its targets can fill.
 */
export function checkInput(raw: unknown): Checked {
  const source =
    typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const errors: TemplateErrors = {};

  const name = oneLine(text(source.name));
  if (!name) errors.name = "Give the template a name.";
  else if (name.length > LIMITS.name)
    errors.name = `Keep the name under ${LIMITS.name} characters.`;

  const kind = source.kind;
  if (!TEMPLATE_KINDS.includes(kind as TemplateKind))
    errors.kind = "Choose Email, Report or Snippet.";

  const subject = oneLine(text(source.subject));
  if (subject.length > LIMITS.subject) {
    errors.subject = `Keep the subject under ${LIMITS.subject} characters.`;
  }
  const to = oneLine(text(source.to));
  const cc = oneLine(text(source.cc));
  if (to.length > LIMITS.address) errors.to = "That To line is too long.";
  if (cc.length > LIMITS.address) errors.cc = "That Cc line is too long.";

  const body = tidyText(text(source.body));
  if (!body) errors.body = "The message is empty.";
  else if (body.length > LIMITS.body) {
    errors.body = `Keep the message under ${LIMITS.body.toLocaleString("en-US")} characters.`;
  }

  const description = oneLine(text(source.description)).slice(0, LIMITS.description);

  const usedBy: string[] = [];
  for (const key of Array.isArray(source.usedBy) ? source.usedBy : []) {
    if (typeof key !== "string" || usedBy.includes(key)) continue;
    const target = targetByKey(key);
    if (!target) {
      errors.usedBy = "One of the chosen places no longer exists.";
    } else if (TEMPLATE_KINDS.includes(kind as TemplateKind) && target.kind !== kind) {
      errors.usedBy = `${targetLabel(target)} takes ${KIND_LABEL[target.kind]} templates, not ${KIND_LABEL[kind as TemplateKind]}.`;
    } else {
      usedBy.push(key);
    }
  }

  const allowed = allowedPlaceholders(usedBy);
  const where = placeSentence(usedBy);
  if (!errors.body && !errors.subject) {
    const malformed = malformedPlaceholders([subject, to, cc, body]);
    if (malformed.length > 0) errors.body = malformedMessage(malformed);
    else if (allowed) {
      const unknown = unknownPlaceholders([subject, to, cc, body], allowed);
      if (unknown.length > 0) errors.body = unknownMessage(unknown, where);
    }
  }
  if (source.variants !== undefined) {
    for (const variant of cleanVariants(source.variants)) {
      const texts = [variant.subject, variant.body];
      const malformed = malformedPlaceholders(texts);
      const unknown = allowed ? unknownPlaceholders(texts, allowed) : [];
      if (malformed.length > 0) {
        errors.variants = `In the other wording “${variant.label}”: ${malformedMessage(malformed)}`;
      } else if (unknown.length > 0) {
        errors.variants = `In the other wording “${variant.label}”: ${unknownMessage(unknown, where)}`;
      }
      if (errors.variants) break;
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const starterId = typeof source.starterId === "string" ? source.starterId : undefined;
  return {
    ok: true,
    value: {
      name,
      kind: kind as TemplateKind,
      description,
      subject,
      to,
      cc,
      body,
      usedBy,
      ...(source.tags !== undefined ? { tags: cleanTags(source.tags) } : {}),
      ...(source.variants !== undefined
        ? { variants: cleanVariants(source.variants) }
        : {}),
      ...(starterId && STARTERS.some((s) => s.starterId === starterId)
        ? { starterId }
        : {}),
    },
  };
}

export const emptyLibrary = (): TemplateLibrary => ({
  version: LIBRARY_VERSION,
  templates: [],
});

/** The starting library: every starter, in use where it was used before. */
export function starterLibrary(now: string): TemplateLibrary {
  return {
    version: LIBRARY_VERSION,
    templates: STARTERS.map((starter) => ({
      ...starter,
      id: newTemplateId(),
      createdAt: now,
      updatedAt: now,
    })),
  };
}

/** Removes `keys` from every template except `exceptId`; reports who lost what. */
function claim(
  templates: readonly Template[],
  keys: readonly string[],
  exceptId: string,
  now: string,
): { templates: Template[]; displaced: Displaced[] } {
  const displaced: Displaced[] = [];
  const next = templates.map((tpl) => {
    if (tpl.id === exceptId) return tpl;
    const lost = tpl.usedBy.filter((key) => keys.includes(key));
    if (lost.length === 0) return tpl;
    for (const targetKey of lost) {
      displaced.push({ templateId: tpl.id, templateName: tpl.name, targetKey });
    }
    return {
      ...tpl,
      usedBy: tpl.usedBy.filter((key) => !keys.includes(key)),
      updatedAt: now,
    };
  });
  return { templates: next, displaced };
}

export interface Change {
  library: TemplateLibrary;
  template: Template;
  displaced: Displaced[];
}

export function createTemplate(
  library: TemplateLibrary,
  input: TemplateInput,
  now: string,
  id: string = newTemplateId(),
): Change | { error: string } {
  if (library.templates.length >= LIMITS.templates) {
    return { error: `The library holds at most ${LIMITS.templates} templates.` };
  }
  const template: Template = { ...input, id, createdAt: now, updatedAt: now };
  const { templates, displaced } = claim(library.templates, input.usedBy, id, now);
  return {
    library: { ...library, templates: [...templates, template] },
    template,
    displaced,
  };
}

const TEXT_FIELDS = ["name", "description", "subject", "to", "cc", "body"] as const;

/** The saved state of `tpl` as a history entry. */
export const versionOf = (tpl: Template): TemplateVersion => ({
  at: tpl.updatedAt,
  name: tpl.name,
  description: tpl.description,
  subject: tpl.subject,
  to: tpl.to,
  cc: tpl.cc,
  body: tpl.body,
});

export function updateTemplate(
  library: TemplateLibrary,
  id: string,
  input: TemplateInput,
  now: string,
): Change | { error: string } {
  const existing = library.templates.find((tpl) => tpl.id === id);
  if (!existing) return { error: "That template no longer exists." };
  const changed = TEXT_FIELDS.some((f) => input[f] !== existing[f]);
  const history = changed
    ? [versionOf(existing), ...(existing.history ?? [])].slice(0, LIMITS.history)
    : existing.history;
  const tags = input.tags ?? existing.tags;
  const variants = input.variants ?? existing.variants;
  const template: Template = {
    ...input,
    id,
    ...(tags?.length ? { tags } : {}),
    ...(variants?.length ? { variants } : {}),
    ...(history?.length ? { history } : {}),
    createdAt: existing.createdAt,
    updatedAt: now,
  };
  if (!tags?.length) delete template.tags;
  if (!input.starterId) delete template.starterId;
  const { templates, displaced } = claim(library.templates, input.usedBy, id, now);
  return {
    library: {
      ...library,
      templates: templates.map((tpl) => (tpl.id === id ? template : tpl)),
    },
    template,
    displaced,
  };
}

export function deleteTemplate(
  library: TemplateLibrary,
  id: string,
): { library: TemplateLibrary; removed: Template } | { error: string } {
  const removed = library.templates.find((tpl) => tpl.id === id);
  if (!removed) return { error: "That template no longer exists." };
  return {
    library: { ...library, templates: library.templates.filter((tpl) => tpl.id !== id) },
    removed,
  };
}

/** The template a target uses, if any. */
export function templateFor(
  library: TemplateLibrary,
  targetKey: string,
): Template | null {
  return library.templates.find((tpl) => tpl.usedBy.includes(targetKey)) ?? null;
}

/** Adds each built-in template the library no longer has (by its `starterId`). A restored one takes
 *  only the places nobody uses now, so nothing is taken from a template that has them. */
export function addMissingStarters(
  library: TemplateLibrary,
  now: string,
): { library: TemplateLibrary; added: Template[] } {
  const held = new Set(library.templates.flatMap((tpl) => tpl.usedBy));
  const have = new Set(library.templates.map((tpl) => tpl.starterId).filter(Boolean));
  const added: Template[] = [];
  for (const starter of STARTERS) {
    if (have.has(starter.starterId)) continue;
    if (library.templates.length + added.length >= LIMITS.templates) break;
    const usedBy = starter.usedBy.filter((key) => !held.has(key));
    for (const key of usedBy) held.add(key);
    added.push({
      ...starter,
      usedBy,
      id: newTemplateId(),
      createdAt: now,
      updatedAt: now,
    });
  }
  return { library: { ...library, templates: [...library.templates, ...added] }, added };
}

/** Puts back a deleted template exactly as it was (same id, dates and version history). It takes
 *  only the places nobody has now; `leftBehind` are those that stay with their new template. */
export function undeleteTemplate(
  library: TemplateLibrary,
  gone: Template,
  now: string,
): (Change & { leftBehind: string[] }) | { error: string } {
  if (library.templates.some((tpl) => tpl.id === gone.id)) {
    return { error: "That template is already back." };
  }
  if (library.templates.length >= LIMITS.templates) {
    return { error: `The library holds at most ${LIMITS.templates} templates.` };
  }
  const held = new Set(library.templates.flatMap((tpl) => tpl.usedBy));
  const usedBy = gone.usedBy.filter((key) => !held.has(key));
  const template: Template = { ...gone, usedBy, updatedAt: now };
  return {
    library: { ...library, templates: [...library.templates, template] },
    template,
    displaced: [],
    leftBehind: gone.usedBy.filter((key) => held.has(key)),
  };
}

/**
 * Reads whatever library.json held into a library. Lenient on purpose: a template
 * is kept as long as it has an id, a name and a kind, with its text cleaned up
 * but never judged (a placeholder that a target dropped must not delete the
 * template); targets that no longer exist are removed from `usedBy`. `null` =
 * not a library at all. Each place keeps one template: if a hand-edited file gives
 * the same place to two, the first one in the file keeps it.
 */
export function parseLibrary(raw: unknown): TemplateLibrary | null {
  return parseLibraryDetailed(raw)?.library ?? null;
}

export interface ParsedLibrary {
  library: TemplateLibrary;
  /** Entries left out because they had no usable id, name or kind. */
  dropped: number;
  /** Places taken off a later template because an earlier one already had them. */
  conflicts: number;
}

export function parseLibraryDetailed(raw: unknown): ParsedLibrary | null {
  if (typeof raw !== "object" || raw === null) return null;
  const list = (raw as { templates?: unknown }).templates;
  if (!Array.isArray(list)) return null;
  const templates: Template[] = [];
  const claimed = new Set<string>();
  let dropped = 0;
  let conflicts = 0;
  for (const item of list) {
    if (typeof item !== "object" || item === null) {
      dropped += 1;
      continue;
    }
    const record = item as Record<string, unknown>;
    const id = text(record.id);
    const name = oneLine(text(record.name)).slice(0, LIMITS.name);
    const kind = record.kind;
    if (
      !TEMPLATE_ID.test(id) ||
      !name ||
      !TEMPLATE_KINDS.includes(kind as TemplateKind) ||
      templates.some((tpl) => tpl.id === id)
    ) {
      dropped += 1;
      continue;
    }
    const usedBy = (Array.isArray(record.usedBy) ? record.usedBy : []).filter(
      (key, at, all): key is string =>
        typeof key === "string" &&
        all.indexOf(key) === at &&
        targetByKey(key)?.kind === kind &&
        (!claimed.has(key) || (conflicts++, false)),
    );
    for (const key of usedBy) claimed.add(key);
    const starterId = text(record.starterId);
    templates.push({
      id,
      name,
      kind: kind as TemplateKind,
      description: oneLine(text(record.description)).slice(0, LIMITS.description),
      subject: oneLine(text(record.subject)).slice(0, LIMITS.subject),
      to: oneLine(text(record.to)).slice(0, LIMITS.address),
      cc: oneLine(text(record.cc)).slice(0, LIMITS.address),
      body: tidyText(text(record.body)).slice(0, LIMITS.body),
      usedBy,
      ...(cleanTags(record.tags).length ? { tags: cleanTags(record.tags) } : {}),
      ...(cleanVariants(record.variants).length
        ? { variants: cleanVariants(record.variants) }
        : {}),
      ...(cleanHistory(record.history).length
        ? { history: cleanHistory(record.history) }
        : {}),
      ...(STARTERS.some((s) => s.starterId === starterId) ? { starterId } : {}),
      createdAt: text(record.createdAt) || text(record.updatedAt),
      updatedAt: text(record.updatedAt) || text(record.createdAt),
    });
  }
  return { library: { version: LIBRARY_VERSION, templates }, dropped, conflicts };
}
