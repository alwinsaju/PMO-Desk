import { toast } from "@/lib/notifications/toastStore";
import {
  dropUntouchedOffboarding,
  removedMessage,
  restoredMessage,
} from "@/lib/staff/bulkOffboard";
import { undoOffboardMany, type OffboardUndo } from "@/lib/staff/offboardUndo";
import { useRosterStore } from "@/lib/staff/rosterStore";
import { useStaffPrefs } from "@/lib/staff/staffPrefsStore";
import { useStaffStore } from "@/lib/staff/staffStore";
import { CHECKLIST_TOAST_KEY, dismissToastByKey } from "./startedToast";

type Result = { ok: true } | { ok: false; reason: string };

/**
 * Removes several people from the roster in one go (the same offboarding as the details pane,
 * so nothing is deleted for good) and offers one Undo for all of them. Uses the stores
 * directly because the directory may have changed by the time Undo is pressed.
 */
export async function offboardMany(ids: string[]): Promise<Result> {
  const result = await useStaffStore.getState().offboard(ids);
  if (!result.ok) return result;
  const undo = result.undo ?? { timeOff: [], unlinked: [] };
  toast({
    key: "undo-bulk-offboard",
    title: "Removed from roster",
    message: removedMessage(ids.length),
    durationMs: 10_000,
    action: { label: "Undo", run: () => void undoRemoveMany(ids, undo) },
  });
  return { ok: true };
}

async function undoRemoveMany(ids: string[], undo: OffboardUndo) {
  const store = useStaffStore.getState();
  const result = await undoOffboardMany(ids, undo, {
    restore: (restoreIds, relink) => store.restore(restoreIds, relink),
    addTimeOff: (requests) => store.commit("timeoff", { upsert: requests }),
  });
  void useRosterStore.getState().load();
  if (!result.ok) {
    toast({ tone: "danger", message: result.reason });
    return;
  }
  // Offboarding started a checklist for each of them; drop the ones nothing was ticked on.
  useStaffPrefs.getState().update((p) => ({
    ...p,
    checklists: dropUntouchedOffboarding(p.checklists, ids),
  }));
  dismissToastByKey(CHECKLIST_TOAST_KEY);
  toast({ tone: "success", message: restoredMessage(ids.length) });
}
