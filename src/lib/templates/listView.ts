// What the Templates list says about each entry: its type's colour and a "used by" badge. Pure.
import { snippetKey } from "./render.ts";
import type { Template, TemplateKind } from "./types.ts";

/** Badge tone per type; the list icon takes the same one. */
export const KIND_TONE: Record<TemplateKind, "info" | "accent" | "warning"> = {
  email: "info",
  report: "accent",
  snippet: "warning",
};

const includes = (key: string, text: string): boolean =>
  new RegExp(`\\{\\{\\s*>\\s*${key}\\s*\\}\\}`).test(text);

/** How many places use the template: its tasks and apps, or for a snippet the templates that include it. */
export function usedByCount(
  template: Pick<Template, "kind" | "name" | "usedBy">,
  templates: readonly Pick<Template, "id" | "kind" | "subject" | "body">[] = [],
  selfId?: string,
): number {
  if (template.kind !== "snippet") return template.usedBy.length;
  const key = snippetKey(template.name);
  if (!key) return 0;
  return templates.filter(
    (t) => t.id !== selfId && (includes(key, t.body) || includes(key, t.subject)),
  ).length;
}

export interface UsedByBadge {
  label: string;
  tone: "accent" | "neutral";
}

export function usedByBadge(count: number, kind: TemplateKind): UsedByBadge {
  if (count === 0) return { label: "Not used", tone: "neutral" };
  return {
    label:
      kind === "snippet"
        ? `In ${count} template${count === 1 ? "" : "s"}`
        : `Used by ${count}`,
    tone: "accent",
  };
}
