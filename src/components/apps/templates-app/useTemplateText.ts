"use client";

import { useCallback } from "react";
import { markTemplateUsed } from "@/lib/templates/usageStore";
import { renderFields } from "@/lib/templates/render";
import { useAssignedTemplate } from "./useAssignedTemplate";

export interface TemplateText {
  subject: string;
  body: string;
}

/**
 * The wording for a place that makes a mail: the assigned template filled in with `values`, or `fallback`
 * (the built-in wording) when none is set or it renders empty. `used()` records that a draft was made from it.
 */
export function useTemplateText(targetKey: string, active = true) {
  const template = useAssignedTemplate(targetKey, active);
  const fill = useCallback(
    (values: Record<string, string>, fallback: TemplateText): TemplateText => {
      if (!template) return fallback;
      const r = renderFields(
        { subject: template.subject, to: "", cc: "", body: template.body },
        values,
      );
      return { subject: r.subject || fallback.subject, body: r.body || fallback.body };
    },
    [template],
  );
  const used = useCallback(() => markTemplateUsed(template?.id), [template]);
  return { fill, used, template };
}
