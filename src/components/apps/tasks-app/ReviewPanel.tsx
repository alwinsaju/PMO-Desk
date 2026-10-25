"use client";

import { useCallback, useEffect, useMemo, useState, type RefObject } from "react";
import { Badge, Button, ScrollArea } from "@/components/ui";
import { fetchReviewIncidents, postReviewResolutions } from "./api";
import { ReviewImportDialog } from "./ReviewImportDialog";
import { ReviewIncidentDialog } from "./ReviewIncidentDialog";
import {
  applyResolutions,
  toResolutionPayload,
  withResolvedLabels,
} from "./reviewImport";
import type { ReviewIncident, ReviewQueue } from "./types";

interface ReviewPanelProps {
  taskId: string;
  /** Live task state — the panel reloads when a run reaches/leaves the
   *  review gate so the list always reflects the current run. */
  taskState: string;
  /** Notified whenever the pending count changes so the parent can gate
   *  its Approve button. */
  onPendingChange?: (pending: number) => void;
  /** Notified when staged-but-unsaved resolutions appear/disappear, so the
   *  parent can stop the dialog closing and silently dropping them. */
  onDirtyChange?: (dirty: boolean) => void;
  /** Lets the parent trigger a save of the staged resolutions (resolves
   *  true once persisted). Populated only while this panel is mounted. */
  saveRef?: RefObject<(() => Promise<boolean>) | null>;
}

const EMPTY_QUEUE: ReviewQueue = { count: 0, pending: 0, options: [], incidents: [] };

/**
 * The in-app review queue for a task: every incident prepare_data flagged
 * as needing a human Subcategory2, listed so the human can click through,
 * classify each one in ReviewIncidentDialog, and save the batch. Resolutions
 * are staged locally and POSTed together; the engine's Approve gate refuses
 * to continue until pending reaches zero, so this panel is where the run
 * actually gets unblocked.
 */
export function ReviewPanel({
  taskId,
  taskState,
  onPendingChange,
  onDirtyChange,
  saveRef,
}: ReviewPanelProps) {
  const [queue, setQueue] = useState<ReviewQueue>(EMPTY_QUEUE);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [selectedNumber, setSelectedNumber] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await fetchReviewIncidents(taskId);
      setQueue(next);
      setLoaded(true);
      onPendingChange?.(next.pending);
    } catch {
      // A failed fetch leaves the last-known queue on screen.
    }
  }, [taskId, onPendingChange]);

  useEffect(() => {
    setLoaded(false);
    setDirty(false);
    setSaveError(null);
    load();
  }, [load, taskState]);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  // Unmounting drops anything staged, so it can no longer be "unsaved".
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  // New labels (staged now, or saved earlier and handed back by the engine)
  // aren't in the queue's own option list; fold them in so they display
  // and can be reused from the picker.
  const options = useMemo(
    () => withResolvedLabels(queue.options, queue.incidents),
    [queue.options, queue.incidents],
  );

  const selectedIncident = selectedNumber
    ? (queue.incidents.find((i) => i.number === selectedNumber) ?? null)
    : null;

  // Unresolved first, resolved sink to the bottom so the remaining work is
  // always what's on screen first (#1). Stable within each group.
  const sortedIncidents = [...queue.incidents].sort(
    (a, b) =>
      Number(Boolean(a.resolved_subcategory2)) - Number(Boolean(b.resolved_subcategory2)),
  );

  // The one staging path — single picks and bulk imports both go through
  // applyResolutions so `pending` and `dirty` can't diverge between them.
  const handleResolve = useCallback(
    (number: string, subcategory2: string) => {
      setQueue((current) => {
        const next = applyResolutions(current.incidents, [{ number, subcategory2 }]);
        onPendingChange?.(next.pending);
        return { ...current, incidents: next.incidents, pending: next.pending };
      });
      setDirty(true);
    },
    [onPendingChange],
  );

  // POSTs the FULL set of resolved incidents (the engine overwrites its
  // file with whatever is sent), then re-reads the queue so what's shown is
  // what the engine will actually gate Approve on.
  const persist = useCallback(
    async (incidents: ReviewIncident[]): Promise<boolean> => {
      setSaving(true);
      setSaveError(null);
      try {
        const result = await postReviewResolutions(
          taskId,
          toResolutionPayload(incidents),
        );
        if (!result.ok) {
          setSaveError(result.reason ?? "the engine rejected the save");
          return false;
        }
        setDirty(false);
        await load();
        return true;
      } catch {
        setSaveError("couldn't reach the engine — your choices are still staged here.");
        return false;
      } finally {
        setSaving(false);
      }
    },
    [taskId, load],
  );

  const handleSave = useCallback(
    () => persist(queue.incidents),
    [persist, queue.incidents],
  );

  const handleImport = useCallback(
    async (resolutions: { number: string; subcategory2: string }[], save: boolean) => {
      // Import wins over anything already staged for the same incident.
      const next = applyResolutions(queue.incidents, resolutions);
      setQueue({ ...queue, incidents: next.incidents, pending: next.pending });
      onPendingChange?.(next.pending);
      setDirty(true);
      if (save) await persist(next.incidents);
    },
    [queue, onPendingChange, persist],
  );

  useEffect(() => {
    if (!saveRef) return;
    saveRef.current = handleSave;
    return () => {
      saveRef.current = null;
    };
  }, [saveRef, handleSave]);

  if (!loaded) {
    return <p className="text-ink-muted p-3.5 text-[13px]">Loading review queue…</p>;
  }
  if (queue.count === 0) {
    return (
      <p className="text-ink-muted p-3.5 text-[13px]">
        No incidents need review — the next run&apos;s queue will appear here.
      </p>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-ink-muted text-[13px]">
          <span className="text-ink font-semibold">{queue.pending}</span> of {queue.count}{" "}
          still need a Subcategory2
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" onClick={() => setImportOpen(true)} disabled={saving}>
            Import…
          </Button>
          <Button onClick={handleSave} disabled={!dirty || saving}>
            {saving ? "Saving…" : dirty ? "Save resolutions" : "Saved"}
          </Button>
        </div>
      </div>
      {saveError && (
        <p className="text-red mb-2 text-[13px]">Couldn&apos;t save: {saveError}</p>
      )}

      <ScrollArea className="border-line bg-card rounded-card h-64 border">
        <div className="flex flex-col gap-2 p-2.5">
          {sortedIncidents.map((incident) => (
            <IncidentRow
              key={incident.number}
              incident={incident}
              onClick={() => setSelectedNumber(incident.number)}
            />
          ))}
        </div>
      </ScrollArea>

      <ReviewImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        incidents={queue.incidents}
        options={options}
        saving={saving}
        onApply={handleImport}
      />

      <ReviewIncidentDialog
        incident={selectedIncident}
        options={options}
        onResolve={handleResolve}
        onOpenChange={(open) => {
          if (!open) setSelectedNumber(null);
        }}
      />
    </div>
  );
}

function IncidentRow({
  incident,
  onClick,
}: {
  incident: ReviewIncident;
  onClick: () => void;
}) {
  const resolved = Boolean(incident.resolved_subcategory2);
  return (
    <button
      type="button"
      onClick={onClick}
      className="row-bar border-line bg-card hover:bg-field rounded-control flex items-center justify-between gap-3 border px-4 py-3 text-left transition-colors duration-200"
    >
      <div className="min-w-0">
        <p className="text-ink font-mono text-[12.5px] font-semibold">
          {incident.number}
        </p>
        <p className="text-ink-muted line-clamp-1 text-xs">
          {incident.short_description ?? "(no description)"}
        </p>
      </div>
      {resolved ? (
        <Badge variant="accent" className="shrink-0">
          {incident.resolved_subcategory2}
        </Badge>
      ) : (
        <Badge variant="warning" className="shrink-0">
          Needs review
        </Badge>
      )}
    </button>
  );
}
