// Placeholder handling for templates. Pure (no node imports). The Python twin is
// tasks/shared/template_lib/library.py; keep the two in step (placeholder syntax,
// unknown names left as typed, `**bold**`).

const PLACEHOLDER = /\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g;
const IF_NAME = /\{\{\s*#if\s+([a-z][a-z0-9_]*)/g;
const SNIPPET = /\{\{\s*>\s*([a-z][a-z0-9_]*)\s*\}\}/g;
// An innermost {{#if ...}} block: no further #if inside it, so nested blocks resolve from the inside out.
const IF_BLOCK =
  /\{\{\s*#if\s+([a-z][a-z0-9_]*)(?:\s*(>=|<=|!=|>|<|=)\s*([^\s}]+))?\s*\}\}((?:(?!\{\{\s*#if\b)[\s\S])*?)\{\{\s*\/if\s*\}\}/;
const ELSE = /\{\{\s*else\s*\}\}/;

export type Values = Readonly<Record<string, string>>;
/** Reusable pieces of text, by key (see `snippetKey`); `{{> key}}` is replaced by the piece. */
export type Snippets = Readonly<Record<string, string>>;

/** The key a snippet is used by: its name in lower case with every run of other characters as `_`. */
export function snippetKey(name: string): string {
  const key = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return /^[a-z]/.test(key) ? key : key ? `s_${key}` : "";
}

/** The snippets in a list of templates (those of kind "snippet"). */
export function snippetsFrom(
  templates: readonly { kind: string; name: string; body: string }[],
): Snippets {
  const out: Record<string, string> = {};
  for (const t of templates) {
    const key = t.kind === "snippet" ? snippetKey(t.name) : "";
    if (key && !(key in out)) out[key] = t.body;
  }
  return out;
}

/** Replaces `{{> key}}` with the snippet's text, up to three levels deep (a snippet may use another).
 *  An unknown key is left as typed. */
export function inlineSnippets(source: string, snippets: Snippets): string {
  let text = source;
  for (let depth = 0; depth < 3; depth++) {
    const next = text.replace(SNIPPET, (whole, key: string) =>
      Object.hasOwn(snippets, key) ? snippets[key] : whole,
    );
    if (next === text) break;
    text = next;
  }
  return text;
}

const truthy = (value: string | undefined): boolean => {
  const v = (value ?? "").trim().toLowerCase();
  return v !== "" && v !== "0" && v !== "false" && v !== "no";
};

function holds(
  value: string | undefined,
  op: string | undefined,
  against: string | undefined,
): boolean {
  if (value === undefined) return false;
  if (!op || against === undefined) return truthy(value);
  const a = Number(value.trim());
  const b = Number(against);
  const numeric = value.trim() !== "" && Number.isFinite(a) && Number.isFinite(b);
  if (numeric) {
    switch (op) {
      case ">":
        return a > b;
      case ">=":
        return a >= b;
      case "<":
        return a < b;
      case "<=":
        return a <= b;
      case "=":
        return a === b;
      default:
        return a !== b;
    }
  }
  const x = value.trim().toLowerCase();
  const y = against.toLowerCase();
  if (op === "=") return x === y;
  if (op === "!=") return x !== y;
  return false;
}

/**
 * Resolves `{{#if name}}...{{else}}...{{/if}}` blocks, innermost first. The condition is a name (true when it
 * has a value that is not 0, false or no) or `name > 0` (also >=, <, <=, = and !=; numbers when both sides are
 * numbers, else text). A name with no value is false. An unmatched tag is left as typed.
 */
export function resolveConditions(source: string, values: Values): string {
  let text = source;
  for (let i = 0; i < 50; i++) {
    const match = IF_BLOCK.exec(text);
    if (!match) break;
    const [whole, name, op, against, inner] = match;
    const parts = inner.split(ELSE);
    const chosen = holds(values[name], op, against) ? parts[0] : (parts[1] ?? "");
    text = text.slice(0, match.index) + chosen + text.slice(match.index + whole.length);
  }
  return text;
}

/** The distinct placeholder names used in `texts`, in order of first use (names used in conditions too). */
export function placeholdersIn(...texts: readonly string[]): string[] {
  const found: string[] = [];
  for (const text of texts) {
    for (const match of text.matchAll(PLACEHOLDER)) {
      if (match[1] !== "else" && !found.includes(match[1])) found.push(match[1]);
    }
    for (const match of text.matchAll(IF_NAME)) {
      if (!found.includes(match[1])) found.push(match[1]);
    }
  }
  return found;
}

/** Placeholders in `texts` that are not in `allowed`. */
export function unknownPlaceholders(
  texts: readonly string[],
  allowed: ReadonlySet<string>,
): string[] {
  return placeholdersIn(...texts).filter((name) => !allowed.has(name));
}

const ANY_BRACES = /\{\{([^{}]*)\}\}/g;
const VALID_TAG = [
  /^[a-z][a-z0-9_]*$/,
  /^(?:else|\/if)$/,
  /^#if\s+[a-z][a-z0-9_]*(?:\s*(?:>=|<=|!=|>|<|=)\s*[^\s}]+)?$/,
  /^>\s*[a-z][a-z0-9_]*$/,
];

/** `{{...}}` pieces in `texts` that can never be filled in because the name is not written the way
 *  placeholders are (lower-case letters, numbers and underscores): `{{Name}}`, `{{first name}}`. */
export function malformedPlaceholders(texts: readonly string[]): string[] {
  const found: string[] = [];
  for (const text of texts) {
    for (const match of text.matchAll(ANY_BRACES)) {
      const inner = match[1].trim();
      if (!inner || VALID_TAG.some((valid) => valid.test(inner))) continue;
      const shown = inner.length > 30 ? `${inner.slice(0, 29)}…` : inner;
      if (!found.includes(shown)) found.push(shown);
    }
  }
  return found.slice(0, 5);
}

/**
 * Resolves the `{{#if}}` blocks, then replaces each `{{name}}` with its value. One pass, so a value that
 * itself contains `{{x}}` is never expanded again. A name with no value is left exactly as typed, so a
 * mistake is visible in the draft rather than silently blank. `snippets` (optional) fills `{{> key}}` first.
 */
export function renderText(source: string, values: Values, snippets?: Snippets): string {
  const full = snippets ? inlineSnippets(source, snippets) : source;
  return resolveConditions(full, values).replace(PLACEHOLDER, (whole, name: string) =>
    Object.hasOwn(values, name) ? values[name] : whole,
  );
}

/** Line breaks to `\n`, runs of blank lines to one blank line, ends trimmed. */
export function tidyText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** A single-line field (subject, address): no line breaks. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export interface Segment {
  text: string;
  bold: boolean;
}

/** Splits text on `**bold**` so a preview can show it without using HTML. */
export function boldSegments(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const match of text.matchAll(/\*\*(.+?)\*\*/g)) {
    const at = match.index ?? 0;
    if (at > last) out.push({ text: text.slice(last, at), bold: false });
    out.push({ text: match[1], bold: true });
    last = at + match[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), bold: false });
  return out;
}

/** The text without its `**` markers, for plain-text uses (mailto, clipboard). */
export const stripBold = (text: string): string => text.replace(/\*\*(.+?)\*\*/g, "$1");

export interface Rendered {
  subject: string;
  to: string;
  cc: string;
  body: string;
}

/** A template (or its fields) filled in with `values`, ready to use as plain text.
 *  Only the template's own `**` markers are removed, never a value's. */
export function renderFields(
  fields: Pick<Rendered, "subject" | "to" | "cc" | "body">,
  values: Values,
  snippets?: Snippets,
): Rendered {
  return {
    subject: oneLine(renderText(fields.subject, values, snippets)),
    to: oneLine(renderText(fields.to, values, snippets)),
    cc: oneLine(renderText(fields.cc, values, snippets)),
    body: tidyText(renderText(stripBold(fields.body), values, snippets)),
  };
}
