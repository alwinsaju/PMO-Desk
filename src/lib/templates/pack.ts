// Template packs: a JSON file of templates (and the snippets they use) that can be shared with a teammate.
// Importing never overwrites anything: each template arrives under a free name, used nowhere until chosen. Pure.
import { checkInput } from "./library.ts";
import { snippetKey } from "./render.ts";
import type { Template, TemplateInput } from "./types.ts";

export const PACK_FORMAT = "ai-os-template-pack";
export const PACK_VERSION = 1;

export interface Pack {
  format: typeof PACK_FORMAT;
  version: typeof PACK_VERSION;
  exportedAt: string;
  templates: TemplateInput[];
}

const SNIPPET_USE = /\{\{\s*>\s*([a-z][a-z0-9_]*)\s*\}\}/g;

const inputOf = (t: Template): TemplateInput => ({
  name: t.name,
  kind: t.kind,
  description: t.description,
  subject: t.subject,
  to: t.to,
  cc: t.cc,
  body: t.body,
  usedBy: [],
  ...(t.tags?.length ? { tags: t.tags } : {}),
  ...(t.variants?.length ? { variants: t.variants } : {}),
});

/** The templates to share, plus any snippet they include (so the pack works on its own). Places are not
 *  exported: what uses a template is the other person's choice. */
export function buildPack(
  all: readonly Template[],
  ids: readonly string[],
  now: string,
): Pack {
  const chosen = all.filter((t) => ids.includes(t.id));
  const wanted = new Set<string>();
  for (const t of chosen)
    for (const text of [
      t.subject,
      t.body,
      ...(t.variants ?? []).flatMap((v) => [v.subject, v.body]),
    ])
      for (const m of text.matchAll(SNIPPET_USE)) wanted.add(m[1]);
  const snippets = all.filter(
    (t) => t.kind === "snippet" && wanted.has(snippetKey(t.name)) && !ids.includes(t.id),
  );
  return {
    format: PACK_FORMAT,
    version: PACK_VERSION,
    exportedAt: now,
    templates: [...chosen, ...snippets].map(inputOf),
  };
}

export type PackResult =
  | { ok: true; templates: TemplateInput[]; skipped: string[] }
  | { ok: false; reason: string };

/** Reads a pack from text. Every template is checked like any edit; ones that fail are skipped by name. A name
 *  already in the library (or earlier in the pack) gets " (imported)" added. */
export function readPack(textIn: string, existingNames: readonly string[]): PackResult {
  let raw: unknown;
  try {
    raw = JSON.parse(textIn);
  } catch {
    return { ok: false, reason: "That file is not a template pack." };
  }
  const pack = raw as Partial<Pack> | null;
  if (!pack || pack.format !== PACK_FORMAT || !Array.isArray(pack.templates))
    return { ok: false, reason: "That file is not a template pack." };
  if (pack.version !== PACK_VERSION)
    return {
      ok: false,
      reason: "This pack was made by a different version of PMO Desk.",
    };
  const taken = new Set(existingNames.map((n) => n.toLowerCase()));
  const templates: TemplateInput[] = [];
  const skipped: string[] = [];
  for (const item of pack.templates.slice(0, 100)) {
    const checked = checkInput({ ...(item as object), usedBy: [] });
    if (!checked.ok) {
      skipped.push(String((item as { name?: unknown })?.name ?? "(unnamed)"));
      continue;
    }
    let name = checked.value.name;
    for (let n = 1; taken.has(name.toLowerCase()); n++)
      name = `${checked.value.name} (imported${n > 1 ? ` ${n}` : ""})`.slice(0, 80);
    taken.add(name.toLowerCase());
    templates.push({ ...checked.value, name, usedBy: [] });
  }
  if (templates.length === 0)
    return { ok: false, reason: "Nothing in that pack could be imported." };
  return { ok: true, templates, skipped };
}
