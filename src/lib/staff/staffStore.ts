// The shared, client-side copy of the staff data (roster, shifts, time off).
// The server's files are the source of truth; this store mirrors them, applies
// edits optimistically and keeps itself fresh. Every open Staff window, and any
// other app that needs people, reads the same state:
//
//   const people = useEmployees();      // in a component
//   const people = getEmployees();      // anywhere else
//
// Like notesStore, this file has no "use client": it imports only zustand and
// plain modules, and every consumer is already client code.
import { useEffect } from "react";
import { create } from "zustand";
import { mergeChanges } from "./changes.ts";
import { readOffboardUndo, type OffboardUndo, type RosterLink } from "./offboardUndo.ts";
import type {
  Employee,
  OffboardedEmployee,
  ShiftAssignment,
  StaffChanges,
  StaffKind,
  TimeOffRequest,
} from "./types.ts";

export type StaffStatus = "idle" | "loading" | "ready" | "offline";
export type StaffResult = { ok: true } | { ok: false; reason: string };

interface Collections {
  employees: Employee;
  shifts: ShiftAssignment;
  timeoff: TimeOffRequest;
  offboarded: OffboardedEmployee;
}

const OFFLINE = "Can't reach the PMO Desk server. Try again in a moment.";

/** True when a batch adds or changes someone who is waiting for an M365 profile. */
const hasPendingProfile = (changes: unknown): boolean =>
  ((changes as { upsert?: { profileSync?: string }[] }).upsert ?? []).some(
    (p) => p.profileSync === "pending",
  );
export const SYNC_INTERVAL_MS = 20_000;

export interface StaffState {
  employees: Employee[];
  shifts: ShiftAssignment[];
  timeOff: TimeOffRequest[];
  /** People moved off the roster; other apps do not see them. */
  offboarded: OffboardedEmployee[];
  /** What the server has confirmed, without the edits still on their way. Things that start
   *  by themselves for new people (checklists) read these, so a failed add leaves nothing behind. */
  savedEmployees: Employee[];
  savedOffboarded: OffboardedEmployee[];
  status: StaffStatus;
  /** Reads all collections from the server. Skipped while an edit is in flight. */
  load: () => Promise<void>;
  /** Applies a batch of upserts/removals; reverted if the server refuses it. */
  commit: <K extends StaffKind>(
    kind: K,
    changes: StaffChanges<Collections[K]>,
  ) => Promise<StaffResult>;
  /** Moves people off the roster into the offboarded list (dropping their time off).
   *  On success `undo` holds what was dropped, for `undoOffboard`. */
  offboard: (ids: string[]) => Promise<StaffResult & { undo?: OffboardUndo }>;
  /** Moves offboarded people back onto the roster, and links the given shift roster
   *  entries back to them. */
  restore: (ids: string[], relink?: RosterLink[]) => Promise<StaffResult>;
  uploadPhoto: (employeeId: string, image: Blob) => Promise<StaffResult>;
  removePhoto: (employeeId: string) => Promise<StaffResult>;
  /** Asks the M365 flow for this person's profile again. */
  requestProfile: (employeeId: string) => Promise<StaffResult>;
  /** Starts the M365 requests over for everybody still waiting (a few at a time). */
  requestAllProfiles: () => Promise<StaffResult>;
}

let inFlight = 0;
const queues: Partial<Record<StaffKind, Promise<unknown>>> = {};

// What the server last confirmed, plus the edits still on their way to it. What
// the UI shows is always the confirmed data with the pending edits laid over it,
// so an edit that fails simply drops out and nothing else is disturbed.
const confirmed: { [K in StaffKind]: Collections[K][] } = {
  employees: [],
  shifts: [],
  timeoff: [],
  offboarded: [],
};
const pending: { [K in StaffKind]: StaffChanges<Collections[K]>[] } = {
  employees: [],
  shifts: [],
  timeoff: [],
  offboarded: [],
};
/** People being removed from the roster whose offboard is still on its way to the server:
 *  they leave the screen at once, in one state change, and come back if the server refuses. */
const departing = new Set<string>();

function visible(): Pick<
  StaffState,
  "employees" | "shifts" | "timeOff" | "offboarded" | "savedEmployees" | "savedOffboarded"
> {
  const lay = <K extends StaffKind>(kind: K): Collections[K][] =>
    pending[kind].reduce<Collections[K][]>(
      (items, changes) => mergeChanges(items, changes),
      confirmed[kind],
    );
  const laid = lay("employees");
  const employees = departing.size > 0 ? laid.filter((e) => !departing.has(e.id)) : laid;
  // A person who is gone takes their time off with them (their shift roster entry
  // stays, unlinked, so its shifts are kept).
  const people = new Set(employees.map((e) => e.id));
  return {
    employees,
    shifts: lay("shifts"),
    timeOff: lay("timeoff").filter((r) => people.has(r.employeeId)),
    offboarded: lay("offboarded"),
    savedEmployees: confirmed.employees,
    savedOffboarded: confirmed.offboarded,
  };
}

async function readReason(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { reason?: unknown };
    if (typeof body.reason === "string" && body.reason) return body.reason;
  } catch {
    // Not JSON: fall through to the generic message.
  }
  return "The server could not save that.";
}

async function fetchItems<T>(kind: StaffKind): Promise<T[]> {
  const response = await fetch(`/api/staff/${kind}`);
  const body = (await response.json()) as { ok?: boolean; items?: T[] };
  if (!response.ok || body.ok !== true || !Array.isArray(body.items)) {
    throw new Error("Bad reply");
  }
  return body.items;
}

export const useStaffStore = create<StaffState>()((set, get) => {
  const tracked = async <T>(run: () => Promise<T>): Promise<T> => {
    inFlight++;
    try {
      return await run();
    } finally {
      inFlight--;
    }
  };

  const reloadEmployees = async () => {
    try {
      const [employees, offboarded] = await Promise.all([
        fetchItems<Employee>("employees"),
        fetchItems<OffboardedEmployee>("offboarded"),
      ]);
      Object.assign(confirmed, { employees, offboarded });
      set(visible());
    } catch {
      // The next sync picks it up.
    }
  };

  // Runs after every earlier write to either list, and before any later one.
  const move = (action: "offboard" | "restore", ids: string[], relink?: RosterLink[]) => {
    inFlight++;
    if (action === "offboard") {
      for (const id of ids) departing.add(id);
      set(visible());
    }
    const run = async (): Promise<StaffResult & { undo?: OffboardUndo }> => {
      try {
        const response = await fetch("/api/staff/offboard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            relink?.length ? { action, ids, relink } : { action, ids },
          ),
        });
        if (!response.ok) return { ok: false, reason: await readReason(response) };
        const body = (await response.json()) as {
          employees?: Employee[];
          offboarded?: OffboardedEmployee[];
          undo?: unknown;
        };
        if (!Array.isArray(body.employees) || !Array.isArray(body.offboarded)) {
          throw new Error("Bad reply");
        }
        confirmed.employees = body.employees;
        confirmed.offboarded = body.offboarded;
        if (action === "offboard") {
          // Their time off went with them on the server.
          const gone = new Set(ids);
          confirmed.timeoff = confirmed.timeoff.filter((r) => !gone.has(r.employeeId));
          return { ok: true, undo: readOffboardUndo(body.undo) };
        }
        return { ok: true };
      } catch {
        return { ok: false, reason: OFFLINE };
      } finally {
        inFlight--;
        if (action === "offboard") for (const id of ids) departing.delete(id);
        set(visible());
      }
    };
    const earlier = Promise.all([queues.employees, queues.offboarded]);
    const queued = earlier.then(run);
    queues.employees = queued;
    queues.offboarded = queued;
    return queued;
  };

  return {
    employees: [],
    shifts: [],
    timeOff: [],
    offboarded: [],
    savedEmployees: [],
    savedOffboarded: [],
    status: "idle",

    load: async () => {
      if (inFlight > 0) return;
      if (get().status === "idle") set({ status: "loading" });
      // Apply profile files the M365 flow has left behind before reading the roster.
      await fetch("/api/staff/sync", { method: "POST" }).catch(() => undefined);
      if (inFlight > 0) return;
      try {
        const [employees, shifts, timeoff, offboarded] = await Promise.all([
          fetchItems<Employee>("employees"),
          fetchItems<ShiftAssignment>("shifts"),
          fetchItems<TimeOffRequest>("timeoff"),
          fetchItems<OffboardedEmployee>("offboarded"),
        ]);
        // An edit that started while we were reading is newer than this read.
        if (inFlight > 0) return;
        Object.assign(confirmed, { employees, shifts, timeoff, offboarded });
        set({ ...visible(), status: "ready" });
      } catch {
        set({ status: get().status === "ready" ? "ready" : "offline" });
      }
    },

    commit: (kind, changes) => {
      pending[kind].push(changes as never);
      inFlight++;
      set(visible());

      const settle = () => {
        pending[kind].splice(pending[kind].indexOf(changes as never), 1);
        inFlight--;
      };
      const run = async (): Promise<StaffResult> => {
        try {
          const response = await fetch(`/api/staff/${kind}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(changes),
          });
          if (!response.ok) {
            const reason = await readReason(response);
            settle();
            set(visible());
            return { ok: false, reason };
          }
          const body = (await response.json()) as { items?: unknown[] };
          if (Array.isArray(body.items)) confirmed[kind] = body.items as never;
          // The server does not send the (large) list of shifts back: apply the change here.
          else confirmed[kind] = mergeChanges(confirmed[kind], changes as never) as never;
          settle();
          set(visible());
          if (kind === "employees" && hasPendingProfile(changes)) {
            // Ask M365 for the new people now rather than at the next poll.
            void fetch("/api/staff/sync", { method: "POST" })
              .then(() => reloadEmployees())
              .catch(() => undefined);
          }
          return { ok: true };
        } catch {
          settle();
          set(visible());
          return { ok: false, reason: OFFLINE };
        }
      };
      // One write per collection at a time, in the order they were made.
      const queued = (queues[kind] ?? Promise.resolve()).then(run);
      queues[kind] = queued;
      return queued;
    },

    offboard: (ids) => move("offboard", ids),
    restore: (ids, relink) => move("restore", ids, relink),

    requestProfile: (employeeId) =>
      tracked(async () => {
        try {
          const response = await fetch("/api/staff/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ resend: employeeId }),
          });
          if (!response.ok) return { ok: false, reason: await readReason(response) };
          await reloadEmployees();
          return { ok: true };
        } catch {
          return { ok: false, reason: OFFLINE };
        }
      }),

    requestAllProfiles: () =>
      tracked(async () => {
        try {
          const response = await fetch("/api/staff/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ resendAll: true }),
          });
          if (!response.ok) return { ok: false, reason: await readReason(response) };
          await reloadEmployees();
          return { ok: true };
        } catch {
          return { ok: false, reason: OFFLINE };
        }
      }),

    uploadPhoto: (employeeId, image) =>
      tracked(async () => {
        try {
          const response = await fetch(`/api/staff/photos/${employeeId}`, {
            method: "PUT",
            body: image,
          });
          if (!response.ok) return { ok: false, reason: await readReason(response) };
          await reloadEmployees();
          return { ok: true };
        } catch {
          return { ok: false, reason: OFFLINE };
        }
      }),

    removePhoto: (employeeId) =>
      tracked(async () => {
        try {
          const response = await fetch(`/api/staff/photos/${employeeId}`, {
            method: "DELETE",
          });
          if (!response.ok) return { ok: false, reason: await readReason(response) };
          await reloadEmployees();
          return { ok: true };
        } catch {
          return { ok: false, reason: OFFLINE };
        }
      }),
  };
});

// One poller for however many windows are open.
let watchers = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let onVisible: (() => void) | null = null;

/** Keeps the store fresh (e.g. when the M365 profile flow fills a profile in the
 *  background). Returns a function that stops watching. */
export function startStaffSync(): () => void {
  if (watchers++ === 0) {
    void useStaffStore.getState().load();
    timer = setInterval(() => {
      if (document.visibilityState !== "hidden") void useStaffStore.getState().load();
    }, SYNC_INTERVAL_MS);
    onVisible = () => {
      if (document.visibilityState === "visible") void useStaffStore.getState().load();
    };
    document.addEventListener("visibilitychange", onVisible);
  }
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    if (--watchers === 0) {
      if (timer) clearInterval(timer);
      timer = null;
      if (onVisible) document.removeEventListener("visibilitychange", onVisible);
      onVisible = null;
    }
  };
}

/** Keeps the store loaded and fresh for as long as the calling component is mounted. */
export function useStaffSync(): void {
  useEffect(() => startStaffSync(), []);
}

/** The roster, kept fresh while at least one component uses it. */
export function useEmployees(): Employee[] {
  useStaffSync();
  return useStaffStore((s) => s.employees);
}

export function getEmployees(): Employee[] {
  return useStaffStore.getState().employees;
}
