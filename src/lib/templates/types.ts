// Shared shapes of the Template library: email and report templates that the
// tasks and apps use instead of wording baked into a task folder. Plain types
// and constants only: the server store, the API routes, the Python task library
// (tasks/shared/template_lib) and the Templates app all agree on this file.

export const TEMPLATE_KINDS = ["email", "report", "snippet"] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

export const KIND_LABEL: Record<TemplateKind, string> = {
  email: "Email",
  report: "Report",
  snippet: "Snippet",
};

export const LIMITS = {
  name: 80,
  description: 240,
  subject: 200,
  address: 1000,
  body: 20_000,
  templates: 100,
  tags: 8,
  tag: 30,
  variants: 5,
  variantLabel: 40,
  history: 20,
} as const;

/** library.json holds `{ version, templates }`. The Python side reads the same file. */
export const LIBRARY_VERSION = 1;
export const LIBRARY_FILE = "library.json";

/** Another wording of a template for a different group of recipients (the client, the team, ...). */
export interface TemplateVariant {
  id: string;
  label: string;
  subject: string;
  body: string;
}

/** An earlier saved state of a template, kept so it can be restored. */
export interface TemplateVersion {
  /** When that state was saved. */
  at: string;
  name: string;
  description: string;
  subject: string;
  to: string;
  cc: string;
  body: string;
}

export interface Template {
  /** `tpl_<hex>` */
  id: string;
  name: string;
  /** "snippet": a reusable piece of text that other templates include with `{{> name}}`; it is
   *  never used by a task or app itself. */
  kind: TemplateKind;
  description: string;
  /** Email: the subject line. Report: the title line. Placeholders allowed. */
  subject: string;
  /** Email only. Blank = the task keeps its own recipients. */
  to: string;
  cc: string;
  /** The text. `{{name}}` is replaced, `**bold**` is bold in HTML mail. */
  body: string;
  /** Keys of the tasks and apps that use it (see targets.ts). */
  usedBy: string[];
  /** Short labels to find it by. */
  tags?: string[];
  /** Other wordings, chosen where the template is used. */
  variants?: TemplateVariant[];
  /** Earlier saved states, newest first. */
  history?: TemplateVersion[];
  /** Set on a starter template: which original it can be restored to. */
  starterId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateLibrary {
  version: typeof LIBRARY_VERSION;
  templates: Template[];
}

/** What a person edits (everything else is set by the server). `tags` and `variants`, when left out,
 *  keep what the template already has. */
export interface TemplateInput {
  name: string;
  kind: TemplateKind;
  description: string;
  subject: string;
  to: string;
  cc: string;
  body: string;
  usedBy: string[];
  tags?: string[];
  variants?: TemplateVariant[];
  starterId?: string;
}

/** A target that was taken from another template when this one claimed it. */
export interface Displaced {
  templateId: string;
  templateName: string;
  targetKey: string;
}
