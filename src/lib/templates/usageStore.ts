"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createServerBackedStorage } from "@/lib/persistedStorage";
import { markUsed, sanitizeUsage, type Usage } from "./usage";

interface UsageState {
  used: Usage;
  /** Records that a template just produced a draft. */
  mark: (templateId: string) => void;
}

export const useTemplateUsage = create<UsageState>()(
  persist(
    (set) => ({
      used: {},
      mark: (id) =>
        set((s) => {
          const next = markUsed(s.used, id, new Date().toISOString());
          return next === s.used ? s : { used: next };
        }),
    }),
    {
      name: "template-usage",
      version: 1,
      storage: createJSONStorage(() => createServerBackedStorage("template-usage")),
      partialize: (s) => ({ used: s.used }),
      merge: (persisted, current) => ({
        ...current,
        used: sanitizeUsage((persisted as { used?: unknown } | null)?.used),
      }),
    },
  ),
);

/** Call when a template has produced a draft the person can use. */
export const markTemplateUsed = (templateId: string | undefined | null): void => {
  if (templateId) useTemplateUsage.getState().mark(templateId);
};
