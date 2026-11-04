// Undo for "Remove from roster". Offboarding keeps the profile and photo and the shift roster
// entry with its shifts; the only things it changes are the person's time off (deleted) and the
// link from their shift roster entry to their profile (cleared). The server hands both back in
// the offboard reply, and undoing puts exactly those back. Pure: the store calls are arguments.
import type { TimeOffRequest } from "./types.ts";

/** A shift roster member and the directory profile it was linked to before offboarding. */
export interface RosterLink {
  memberId: string;
  employeeId: string;
}

/** What offboarding took away from one or more people. */
export interface OffboardUndo {
  timeOff: TimeOffRequest[];
  unlinked: RosterLink[];
}

/** The `undo` part of an offboard reply, or an empty one when it is missing or malformed. */
export function readOffboardUndo(value: unknown): OffboardUndo {
  const raw = (value ?? {}) as { timeOff?: unknown; unlinked?: unknown };
  const timeOff = Array.isArray(raw.timeOff)
    ? (raw.timeOff.filter(
        (r) => r && typeof (r as TimeOffRequest).id === "string",
      ) as TimeOffRequest[])
    : [];
  const unlinked = Array.isArray(raw.unlinked)
    ? (raw.unlinked.filter(
        (l) =>
          l &&
          typeof (l as RosterLink).memberId === "string" &&
          typeof (l as RosterLink).employeeId === "string",
      ) as RosterLink[])
    : [];
  return { timeOff, unlinked };
}

type Result = { ok: true } | { ok: false; reason: string };

export interface UndoActions {
  /** Moves the person back and relinks their shift roster entry. */
  restore: (ids: string[], relink: RosterLink[]) => Promise<Result>;
  /** Adds time-off requests back (the person is on the roster again by then). */
  addTimeOff: (requests: TimeOffRequest[]) => Promise<Result>;
}

/** Puts one offboarded person back as they were: the profile first, then the time off that was
 *  deleted. If only the second step fails the person is still back, and the reason says so. */
export async function undoOffboard(
  personId: string,
  undo: OffboardUndo,
  actions: UndoActions,
): Promise<Result> {
  const relink = undo.unlinked.filter((l) => l.employeeId === personId);
  const timeOff = undo.timeOff.filter((r) => r.employeeId === personId);
  const restored = await actions.restore([personId], relink);
  if (!restored.ok) return restored;
  if (timeOff.length === 0) return { ok: true };
  const added = await actions.addTimeOff(timeOff);
  if (!added.ok) {
    return {
      ok: false,
      reason: `They are back on the roster, but their time off could not be added again. ${added.reason}`,
    };
  }
  return { ok: true };
}
