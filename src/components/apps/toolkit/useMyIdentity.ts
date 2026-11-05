"use client";

import { useEffect, useState } from "react";
import { fetchState } from "@/components/apps/pmo-todo-app/api";
import type { SelfIdentity } from "@/lib/registers/timesheets";

const NOBODY: SelfIdentity = { names: [], emails: [] };
let cached: Promise<SelfIdentity> | null = null;

/** The signed-in person's names and email addresses from the PMO To-Do settings (empty until known or when none are set), read once. */
export function useMyIdentity(): SelfIdentity {
  const [me, setMe] = useState<SelfIdentity>(NOBODY);
  useEffect(() => {
    let cancelled = false;
    cached ??= fetchState()
      .then((state) => ({ names: state.config.me.names, emails: state.config.me.emails }))
      .catch(() => {
        cached = null;
        return NOBODY;
      });
    void cached.then((who) => {
      if (!cancelled) setMe(who);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return me;
}
