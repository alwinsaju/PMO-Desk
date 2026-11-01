"use client";

import { create } from "zustand";
import { resolveIdentity, type Identity } from "@/lib/shell/userIdentity";

interface IdentityState {
  identity: Identity;
  /** Looks you up; asks again every 20 s (up to 30 times) while the M365 profile has not arrived. */
  load: () => Promise<void>;
}

const NOBODY: Identity = { name: "", initials: "" };
const RETRY_MS = 20_000;
const MAX_RETRIES = 30;
let running = false;
let retries = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, { cache: "no-store" });
    return response.ok ? ((await response.json()) as T) : null;
  } catch {
    return null;
  }
}

interface SelfReply {
  self?: { name?: string; photoUrl?: string; pending?: boolean } | null;
}

/** Who the lock screen greets: your roster profile (full name, M365 photo), else the PMO name,
 *  else the computer's account. A failed lookup just leaves "Welcome". */
export const useUserIdentity = create<IdentityState>()((set, get) => ({
  identity: NOBODY,
  load: async () => {
    if (running) return;
    running = true;
    try {
      const [me, info, pmo] = await Promise.all([
        getJson<SelfReply>("/api/me"),
        getJson<{ account?: string }>("/api/platform/info"),
        getJson<{ config?: { me?: { names?: string[] } } }>("/api/pmo/config"),
      ]);
      set({
        identity: resolveIdentity({
          self: me?.self,
          pmoNames: pmo?.config?.me?.names,
          account: info?.account,
        }),
      });
      clearTimeout(timer);
      if (me?.self?.pending && retries < MAX_RETRIES) {
        retries += 1;
        timer = setTimeout(() => void get().load(), RETRY_MS);
      }
    } finally {
      running = false;
    }
  },
}));
