"use client";

import { create } from "zustand";
import { resolveIdentity, type Identity } from "@/lib/shell/userIdentity";

interface IdentityState {
  identity: Identity;
  load: () => Promise<void>;
}

const NOBODY: Identity = { name: "", initials: "" };
let started = false;

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, { cache: "no-store" });
    return response.ok ? ((await response.json()) as T) : null;
  } catch {
    return null;
  }
}

/** Who the lock screen greets. Loaded once; a failed lookup just leaves "Welcome". */
export const useUserIdentity = create<IdentityState>()((set) => ({
  identity: NOBODY,
  load: async () => {
    if (started) return;
    started = true;
    const [info, pmo] = await Promise.all([
      getJson<{ account?: string }>("/api/platform/info"),
      getJson<{ config?: { me?: { names?: string[] } } }>("/api/pmo/config"),
    ]);
    set({
      identity: resolveIdentity({
        pmoNames: pmo?.config?.me?.names,
        account: info?.account,
      }),
    });
  },
}));
