"use client";

import { memo, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  ScrollArea,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui";
import { fetchTaskHistory, fetchTaskLog } from "./api";
import { ClearInputFiles } from "./ClearInputFiles";
import { DiffGatePanel } from "./DiffGatePanel";
import { FlagsGatePanel } from "./FlagsGatePanel";
import { FormGatePanel } from "./FormGatePanel";
import { GateNote } from "./GateParts";
import { OpenFileButtons } from "./OpenFileButtons";
import { ReviewPanel } from "./ReviewPanel";
import { StepTracker } from "./StepTracker";
import { TaskActions } from "./TaskActions";
import { TaskStateBadge } from "./TaskStateBadge";
import {
  describeApproval,
  gateTabLabel,
  hasPanelGates,
  parseUtc,
  statusSentence,
  stepLabel,
} from "./taskPresenter";
import { useGateData } from "./useGateData";
import type { HistoryRun, LogEntry, Task } from "./types";

/** Matches the log tab's live-refresh cadence to the rest of the app's poll
 *  interval — mirrors agentPresenter.js's buildStepLog, which "refreshes
 *  live while open." */
const LOG_POLL_MS = 2000;

interface TaskDetailDialogProps {
  /** null closes the dialog. */
  task: Task | null;
  /** Whether a pool worker is idle — for the action bar shown at a gate. */
  canStart: boolean;
  /** Refetch hook so an Approve/Confirm from here shows up immediately. */
  onSettled: () => void;
  onOpenChange: (open: boolean) => void;
}

/**
 * Lightweight per-task detail view: recent notifications (with an Open
 * button for any that carry an output artifact), a live-refreshing Log
 * tab, and a History tab of past runs — all from endpoints the main grid
 * doesn't otherwise surface. Opened from a task card's "Details" button.
 *
 * `task` is a live reference into the polled tasks array, so the dialog's
 * header/step-tracker stay live while it's open. `lastTask` keeps the last
 * non-null value so `DialogContent` stays mounted (and its close
 * animation plays) even for the one render where `task` has already gone
 * back to null.
 */
export const TaskDetailDialog = memo(function TaskDetailDialog({
  task,
  canStart,
  onSettled,
  onOpenChange,
}: TaskDetailDialogProps) {
  const [lastTask, setLastTask] = useState<Task | null>(task);
  const [pendingReviews, setPendingReviews] = useState(0);
  // Staged-but-unsaved Subcategory2 choices live in ReviewPanel; closing
  // the dialog would silently drop them, so a close attempt is intercepted
  // while any exist. `saveReviewRef` lets the prompt save them first.
  const [reviewDirty, setReviewDirty] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [closeSaving, setCloseSaving] = useState(false);
  const [closeError, setCloseError] = useState(false);
  const saveReviewRef = useRef<(() => Promise<boolean>) | null>(null);
  // Data behind a form/flags/diff gate when the task is waiting at one
  // (always idle for the four older tasks, which keep the incident queue).
  const gate = useGateData(task);
  const gateType = gate.gate;

  // Derived during render (not in an effect): no extra commit per poll.
  if (task && task !== lastTask) setLastTask(task);

  const taskId = task?.id ?? null;

  // The tab-label count belongs to one task's queue; don't let a previous
  // task's number linger until the next panel load reports its own.
  useEffect(() => {
    setPendingReviews(0);
    setConfirmClose(false);
    setCloseError(false);
  }, [taskId]);

  const handleOpenChange = (open: boolean) => {
    if (!open && reviewDirty) {
      setConfirmClose(true);
      return;
    }
    onOpenChange(open);
  };

  const saveAndClose = async () => {
    setCloseSaving(true);
    setCloseError(false);
    const saved = (await saveReviewRef.current?.()) ?? false;
    setCloseSaving(false);
    if (saved) {
      setConfirmClose(false);
      onOpenChange(false);
    } else {
      setCloseError(true);
    }
  };

  const discardAndClose = () => {
    setReviewDirty(false);
    setConfirmClose(false);
    setCloseError(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={task !== null} onOpenChange={handleOpenChange}>
      <DialogContent
        className={cn(
          "scroll-thin flex max-h-[85vh] flex-col overflow-y-auto px-[30px] pt-7 pb-6",
          gateType ? "max-w-3xl" : "max-w-[700px]",
        )}
      >
        {lastTask && (
          <>
            {/* pr-10 keeps the badge clear of the dialog's close button. */}
            <div className="flex items-center gap-3 pr-10">
              <DialogTitle className="min-w-0 truncate pr-0 text-[23px] tracking-[-0.02em]">
                {lastTask.displayName}
              </DialogTitle>
              <TaskStateBadge state={lastTask.state} className="shrink-0" />
            </div>
            <DialogDescription className="mt-2 line-clamp-1 text-[13.5px]">
              {lastTask.state === "error" && lastTask.error
                ? lastTask.error
                : statusSentence(lastTask)}
            </DialogDescription>

            {confirmClose && reviewDirty && (
              <div
                role="alert"
                className="border-line rounded-card bg-amber-soft mt-4 flex flex-col gap-3 border p-3.5"
              >
                <p className="text-ink text-[13px]">
                  {gateType === "form"
                    ? "You have answers that haven't been saved. Approve only sees saved answers."
                    : "You have Subcategory2 choices that haven't been saved. Approve only sees saved choices."}
                </p>
                {closeError && (
                  <p className="text-red text-xs">
                    Couldn&apos;t save — check the {gateType ? "Questions" : "Review"} tab
                    for details.
                  </p>
                )}
                <div className="flex items-center gap-2">
                  <Button disabled={closeSaving} onClick={saveAndClose}>
                    {closeSaving ? "Saving…" : "Save & close"}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={closeSaving}
                    onClick={discardAndClose}
                  >
                    Discard & close
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={closeSaving}
                    onClick={() => setConfirmClose(false)}
                  >
                    Keep editing
                  </Button>
                </div>
              </div>
            )}

            <div className="mt-5 mb-1">
              <StepTracker task={lastTask} />
            </div>

            {lastTask.notifications.length > 0 && !gateType && (
              <div className="mt-4 flex flex-col gap-2">
                <h4 className="text-ink-muted text-[11px] font-bold tracking-[0.08em] uppercase">
                  Recent activity
                </h4>
                <ul className="flex flex-col gap-2">
                  {[...lastTask.notifications]
                    .reverse()
                    .slice(0, 5)
                    .map((notification) => (
                      <li
                        key={notification.id}
                        className="border-line bg-card rounded-card flex items-center justify-between gap-3 border px-4 py-3.5"
                      >
                        <div className="min-w-0">
                          <p className="text-ink line-clamp-1 text-[13.5px] font-semibold">
                            {notification.title}
                          </p>
                          <p className="text-ink-muted line-clamp-2 text-[12.5px]">
                            {notification.body}
                          </p>
                        </div>
                        <OpenFileButtons
                          taskId={lastTask.id}
                          notification={notification}
                          className="shrink-0 justify-end"
                        />
                      </li>
                    ))}
                </ul>
              </div>
            )}

            <Tabs defaultValue="review" className="mt-[18px] flex shrink-0 flex-col">
              <TabsList className="self-start">
                <TabsTrigger
                  value="review"
                  count={pendingReviews > 0 && !gateType ? pendingReviews : undefined}
                >
                  {gateType ? gateTabLabel(gateType) : "Review"}
                </TabsTrigger>
                <TabsTrigger value="log">Log</TabsTrigger>
                <TabsTrigger value="history">History</TabsTrigger>
              </TabsList>

              {/* forceMount: switching to Log/History must not unmount the panel and
                  throw away choices staged but not yet saved. Radix doesn't hide
                  a force-mounted inactive panel itself, hence the class. */}
              <TabsContent
                value="review"
                forceMount
                className="mt-3.5 min-h-0 flex-1 outline-none data-[state=inactive]:hidden"
              >
                {gateType === "form" ? (
                  <FormGatePanel
                    key={`${lastTask.id}:${lastTask.currentStep}`}
                    taskId={lastTask.id}
                    gate={gate}
                    onDirtyChange={setReviewDirty}
                    saveRef={saveReviewRef}
                  />
                ) : gateType === "flags" ? (
                  <FlagsGatePanel task={lastTask} gate={gate} />
                ) : gateType === "diff" ? (
                  <DiffGatePanel gate={gate} />
                ) : hasPanelGates(lastTask) ? (
                  <GateNote>
                    Nothing is waiting on you right now. Questions, draft flags and
                    changes show up here when a run needs you.
                  </GateNote>
                ) : (
                  <ReviewPanel
                    taskId={lastTask.id}
                    taskState={lastTask.state}
                    onPendingChange={setPendingReviews}
                    onDirtyChange={setReviewDirty}
                    saveRef={saveReviewRef}
                  />
                )}
              </TabsContent>

              <TabsContent value="log" className="mt-3.5 min-h-0 flex-1 outline-none">
                <LogTab task={lastTask} />
              </TabsContent>

              <TabsContent value="history" className="mt-3.5 min-h-0 flex-1 outline-none">
                <HistoryTab task={lastTask} />
              </TabsContent>
            </Tabs>

            {task && <ClearInputFiles key={task.id} task={task} onSettled={onSettled} />}

            {task && gateType && (
              <div className="border-line mt-5 border-t pt-4">
                <TaskActions
                  task={task}
                  canStart={canStart}
                  onSettled={onSettled}
                  gate={gate}
                  extraBlock={{
                    approve:
                      gateType === "form" && reviewDirty
                        ? "You have answers that aren't saved yet — save them first."
                        : null,
                  }}
                />
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
});

/** Live log: fetched when the tab is opened, then refreshed on the same
 *  cadence as the rest of the app while it stays open. Mounted only while the
 *  Log tab is selected, so a dialog on another tab does no log polling and the
 *  dialog above it is never re-rendered by a log refresh. */
function LogTab({ task }: { task: Task }) {
  const [log, setLog] = useState<LogEntry[]>([]);
  const taskId = task.id;

  useEffect(() => {
    let cancelled = false;
    setLog([]);

    async function loadLog() {
      if (document.hidden) return;
      try {
        const entries = await fetchTaskLog(taskId);
        // Same array identity when the log did not change (see api.ts).
        if (!cancelled) setLog(entries);
      } catch {
        // A hung/failed log fetch just leaves the last-known entries on
        // screen rather than clearing them.
      }
    }

    void loadLog();
    const timer = setInterval(loadLog, LOG_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [taskId]);

  return (
    <ScrollArea className="h-64">
      {log.length === 0 ? (
        <p className="text-ink-muted p-3.5 text-[13px]">
          No output yet — start a run to see step logs here.
        </p>
      ) : (
        <div className="flex flex-col gap-2 p-1">
          {log.map((entry, index) => (
            // content-visibility: a long log (hundreds of entries, refreshed
            // every 2 s while running) only lays out the entries on screen.
            <div
              key={index}
              className="[contain-intrinsic-size:auto_90px] [content-visibility:auto]"
            >
              <span className="text-ink-muted font-mono text-[10.5px] uppercase">
                {stepLabel(task, entry.step)} · {entry.stream}
              </span>
              <pre className="rounded-card bg-chip text-ink-soft mt-1 overflow-x-auto px-4 py-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap">
                {entry.text}
              </pre>
            </div>
          ))}
        </div>
      )}
    </ScrollArea>
  );
}

/** History only ever grows on completion/failure, so it is fetched when the
 *  tab is opened and whenever this task's own state changes (e.g. a run just
 *  finished while the dialog was open). */
function HistoryTab({ task }: { task: Task }) {
  const [history, setHistory] = useState<HistoryRun[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const taskId = task.id;
  const taskState = task.state;

  useEffect(() => {
    let cancelled = false;
    setHistoryLoaded(false);
    fetchTaskHistory(taskId)
      .then((runs) => {
        if (!cancelled) setHistory(runs);
      })
      .finally(() => {
        if (!cancelled) setHistoryLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [taskId, taskState]);

  return (
    <ScrollArea className="h-64">
      {!historyLoaded ? (
        <p className="text-ink-muted p-3.5 text-[13px]">Loading…</p>
      ) : history.length === 0 ? (
        <p className="text-ink-muted p-3.5 text-[13px]">No runs recorded yet.</p>
      ) : (
        <ul className="flex flex-col gap-2 p-1">
          {history.map((run) => (
            <li
              key={run.run_id}
              className="border-line bg-card rounded-card border px-4 py-3 text-[13px]"
            >
              <p className="text-ink flex items-center gap-2 font-semibold">
                <Badge variant={run.outcome === "completed" ? "success" : "danger"} dot>
                  {run.outcome === "completed" ? "Completed" : "Failed"}
                </Badge>
                {run.agent_name ? (
                  <span className="text-ink-muted font-medium">{run.agent_name}</span>
                ) : null}
              </p>
              <p className="text-ink-muted mt-1.5">
                {new Date(run.started_at).toLocaleString()}
              </p>
              {run.error && (
                <p className="text-red mt-1 line-clamp-2 font-mono text-[11.5px]">
                  {run.error}
                </p>
              )}
              {run.approvals && run.approvals.length > 0 && (
                <ul
                  className="border-line mt-1.5 flex flex-col gap-0.5 border-t pt-1.5"
                  aria-label="Approvals"
                >
                  {run.approvals.map((approval, index) => (
                    <li
                      key={`${approval.step}-${approval.at}-${index}`}
                      className="text-ink-muted flex flex-wrap items-baseline justify-between gap-x-3 text-xs"
                    >
                      <span>
                        {describeApproval(approval, stepLabel(task, approval.step))}
                      </span>
                      <span className="text-ink-muted">
                        {approval.at ? parseUtc(approval.at).toLocaleString() : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </ScrollArea>
  );
}
