// The client-side copy of the shift roster's configuration (schedules, teams,
// members, events). The day-by-day assignments live in staffStore (`shifts`);
// this holds everything that says what those days mean and who is on the roster.
// Edits show at once and are undone if the server refuses them.
import { useEffect } from "react";
import { create } from "zustand";
import { defaultRosterConfig } from "./rosterCatalog.ts";
import { useStaffStore } from "./staffStore.ts";
import type { RosterConfig, ShiftAssignment } from "./types.ts";

export type RosterResult = { ok: true } | { ok: false; reason: string };

const OFFLINE = "Can't reach the PMO Desk server. Try again in a moment.";
const SYNC_MS = 20_000;

export interface RosterState {
  config: RosterConfig;
  /** False until the first read from the server finished (the starting config shows meanwhile). */
  loaded: boolean;
  load: () => Promise<void>;
  /** Replaces the configuration. */
  save: (next: RosterConfig) => Promise<RosterResult>;
  /** The workbook import: the new configuration plus the shifts to merge in. */
  importPlan: (config: RosterConfig, upsert: ShiftAssignment[]) => Promise<RosterResult>;
}

let confirmed: RosterConfig = defaultRosterConfig();
let inFlight = 0;
let queue: Promise<unknown> = Promise.resolve();

async function reason(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { reason?: unknown };
    if (typeof body.reason === "string" && body.reason) return body.reason;
  } catch {
    // Not JSON.
  }
  return "The server could not save that.";
}

export const useRosterStore = create<RosterState>()((set) => ({
  config: confirmed,
  loaded: false,

  load: async () => {
    if (inFlight > 0) return;
    try {
      const response = await fetch("/api/staff/roster");
      const body = (await response.json()) as { ok?: boolean; config?: RosterConfig };
      if (!response.ok || body.ok !== true || !body.config) return;
      if (inFlight > 0) return;
      confirmed = body.config;
      set({ config: confirmed, loaded: true });
    } catch {
      // Keeps what it has; the next sync tries again.
    }
  },

  save: (next) => {
    inFlight++;
    set({ config: next });
    const run = async (): Promise<RosterResult> => {
      try {
        const response = await fetch("/api/staff/roster", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ config: next }),
        });
        if (!response.ok) {
          set({ config: confirmed });
          return { ok: false, reason: await reason(response) };
        }
        const body = (await response.json()) as { config?: RosterConfig };
        if (body.config) confirmed = body.config;
        else confirmed = next;
        set({ config: confirmed });
        // Shifts of people who left the roster are dropped on the server.
        void useStaffStore.getState().load();
        return { ok: true };
      } catch {
        set({ config: confirmed });
        return { ok: false, reason: OFFLINE };
      } finally {
        inFlight--;
      }
    };
    const queued = queue.then(run);
    queue = queued;
    return queued;
  },

  importPlan: (config, upsert) => {
    inFlight++;
    const run = async (): Promise<RosterResult> => {
      try {
        const response = await fetch("/api/staff/roster", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ config, upsert }),
        });
        if (!response.ok) return { ok: false, reason: await reason(response) };
        confirmed = config;
        set({ config });
        return { ok: true };
      } catch {
        return { ok: false, reason: OFFLINE };
      } finally {
        inFlight--;
      }
    };
    const queued = queue.then(run).then(async (result) => {
      if (result.ok) await useStaffStore.getState().load();
      return result;
    });
    queue = queued;
    return queued;
  },
}));

/** Keeps the roster configuration loaded and fresh while the component is mounted. */
export function useRosterSync(): void {
  useEffect(() => {
    void useRosterStore.getState().load();
    const timer = setInterval(() => {
      if (document.visibilityState !== "hidden") void useRosterStore.getState().load();
    }, SYNC_MS);
    return () => clearInterval(timer);
  }, []);
}
