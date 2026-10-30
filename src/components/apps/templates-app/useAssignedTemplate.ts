"use client";

import { useEffect, useState } from "react";
import type { Template } from "@/lib/templates/types";
import { fetchAssignedTemplate } from "./api";

/**
 * The template the Template library has set for a task or app (a key from
 * `@/lib/templates/targets`): the template, `null` when none is set (or the server
 * cannot be asked), and `undefined` while it is still being read. It is read again
 * each time `active` turns on (a dialog opening), so an edit in the Templates app
 * shows up without reloading anything.
 */
export function useAssignedTemplate(
  targetKey: string,
  active = true,
  variant: string | null = null,
): Template | null | undefined {
  const [found, setFound] = useState<{
    key: string;
    variant: string | null;
    template: Template | null;
  } | null>(null);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void fetchAssignedTemplate(targetKey, variant).then((template) => {
      if (!cancelled) setFound({ key: targetKey, variant, template });
    });
    return () => {
      cancelled = true;
    };
  }, [targetKey, active, variant]);
  if (!active && found) setFound(null);
  return found && found.key === targetKey && found.variant === variant
    ? found.template
    : undefined;
}
