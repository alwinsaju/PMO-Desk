"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import {
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
import { fetchTaskHistory, fetchTaskLog, openTaskNotification } from "./api";
import { DiffGatePanel } from "./DiffGatePanel";
import { FlagsGatePanel } from "./FlagsGatePanel";
import { FormGatePanel } from "./FormGatePanel";
import { GateNote } from "./GateParts";
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
export function TaskDetailDialog({
  task,
  canStart,
  onSettled,
  onOpenChange,
}: TaskDetailDialogProps) {
  const [lastTask, setLastTask] = useState<Task | null>(task);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [history, setHistory] = useState<HistoryRun[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
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

  useEffect(() => {
    if (task) setLastTask(task);
  }, [task]);

  const taskId = task?.id ?? null;
  const taskState = task?.state ?? null;

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

  // Log: fetched on open, then refreshed on the same cadence as the rest
  // of the app for as long as the dialog stays open.
  useEffect(() => {
    if (!taskId) return;
    const id = taskId;
    let cancelled = false;
    setLog([]);

    async function loadLog() {
      try {
        const entries = await fetchTaskLog(id);
        if (!cancelled) setLog(entries);
      } catch {
        // A hung/failed log fetch just leaves the last-known entries on
        // screen rather than clearing them.
      }
    }

    loadLog();
    const timer = setInterval(loadLog, LOG_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [taskId]);

  // History only ever grows on completion/failure, so it doesn't need the
  // log's polling cadence — refetched on open and whenever this task's own
  // state changes (e.g. a run just finished while the dialog was open).
  useEffect(() => {
    if (!taskId) {
      setHistory([]);
      setHistoryLoaded(false);
      return;
    }
    const id = taskId;
    let cancelled = false;
    setHistoryLoaded(false);
    fetchTaskHistory(id)
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
    <Dialog open={task !== null} onOpenChange={handleOpenChange}>
      <DialogContent
        className={cn(
          "flex max-h-[85vh] flex-col overflow-y-auto",
          gateType ? "max-w-3xl" : "max-w-2xl",
        )}
      >
        {lastTask && (
          <>
            <DialogTitle>{lastTask.displayName}</DialogTitle>
            <DialogDescription asChild>
              <div className="flex items-center gap-2">
                <TaskStateBadge state={lastTask.state} />
                <span className="line-clamp-1">
                  {lastTask.state === "error" && lastTask.error
                    ? lastTask.error
                    : statusSentence(lastTask)}
                </span>
              </div>
            </DialogDescription>

            {confirmClose && reviewDirty && (
              <div className="border-border mt-4 flex flex-col gap-2 rounded-lg border bg-neutral-50 p-3">
                <p className="text-ink text-[12px]">
                  {gateType === "form"
                    ? "You have answers that haven't been saved. Approve only sees saved answers."
                    : "You have Subcategory2 choices that haven't been saved. Approve only sees saved choices."}
                </p>
                {closeError && (
                  <p className="text-ink-muted text-[11px]">
                    Couldn&apos;t save — check the {gateType ? "Questions" : "Review"} tab
                    for details.
                  </p>
                )}
                <div className="flex items-center gap-2">
                  <Button size="sm" disabled={closeSaving} onClick={saveAndClose}>
                    {closeSaving ? "Saving…" : "Save & close"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={closeSaving}
                    onClick={discardAndClose}
                  >
                    Discard & close
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={closeSaving}
                    onClick={() => setConfirmClose(false)}
                  >
                    Keep editing
                  </Button>
                </div>
              </div>
            )}

            <div className="mt-4">
              <StepTracker task={lastTask} />
            </div>

            {lastTask.notifications.length > 0 && !gateType && (
              <div className="mt-4 flex flex-col gap-2">
                <h4 className="text-ink-muted text-[11px] font-semibold tracking-wide uppercase">
                  Recent activity
                </h4>
                <ul className="flex flex-col gap-1.5">
                  {[...lastTask.notifications]
                    .reverse()
                    .slice(0, 5)
                    .map((notification) => (
                      <li
                        key={notification.id}
                        className="border-border/60 flex items-start justify-between gap-3 rounded-lg border p-2.5"
                      >
                        <div className="min-w-0">
                          <p className="text-ink line-clamp-1 text-[12px] font-medium">
                            {notification.title}
                          </p>
                          <p className="text-ink-faint line-clamp-2 text-[11px]">
                            {notification.body}
                          </p>
                        </div>
                        {notification.outputPath && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="shrink-0"
                            onClick={() =>
                              openTaskNotification(lastTask.id, notification.id)
                            }
                          >
                            Open
                          </Button>
                        )}
                      </li>
                    ))}
                </ul>
              </div>
            )}

            <Tabs
              defaultValue="review"
              className={cn("mt-4 flex flex-col", !gateType && "min-h-0 flex-1")}
            >
              <TabsList>
                <TabsTrigger value="review">
                  {gateType
                    ? gateTabLabel(gateType)
                    : `Review${pendingReviews > 0 ? ` (${pendingReviews})` : ""}`}
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
                className="mt-3 min-h-0 flex-1 outline-none data-[state=inactive]:hidden"
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

              <TabsContent value="log" className="min-h-0 flex-1 outline-none">
                <ScrollArea className="h-64">
                  {log.length === 0 ? (
                    <p className="text-ink-faint p-3 text-[12px]">
                      No output yet — start a run to see step logs here.
                    </p>
                  ) : (
                    <div className="flex flex-col gap-2 p-1">
                      {log.map((entry, index) => (
                        <div key={index}>
                          <span className="text-ink-faint font-mono text-[10px] uppercase">
                            {stepLabel(lastTask, entry.step)} · {entry.stream}
                          </span>
                          <pre className="border-border/60 text-ink mt-1 overflow-x-auto rounded-lg border bg-neutral-50 p-2 font-mono text-[11px] whitespace-pre-wrap">
                            {entry.text}
                          </pre>
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </TabsContent>

              <TabsContent value="history" className="min-h-0 flex-1 outline-none">
                <ScrollArea className="h-64">
                  {!historyLoaded ? (
                    <p className="text-ink-faint p-3 text-[12px]">Loading…</p>
                  ) : history.length === 0 ? (
                    <p className="text-ink-faint p-3 text-[12px]">
                      No runs recorded yet.
                    </p>
                  ) : (
                    <ul className="flex flex-col gap-2 p-1">
                      {history.map((run) => (
                        <li
                          key={run.run_id}
                          className="border-border/60 rounded-lg border p-2.5 text-[12px]"
                        >
                          <p className="text-ink font-medium">
                            {run.outcome === "completed" ? "Completed" : "Failed"}
                            {run.agent_name ? ` · ${run.agent_name}` : ""}
                          </p>
                          <p className="text-ink-faint">
                            {new Date(run.started_at).toLocaleString()}
                          </p>
                          {run.error && (
                            <p className="text-ink-faint mt-1 line-clamp-2 font-mono text-[11px]">
                              {run.error}
                            </p>
                          )}
                          {run.approvals && run.approvals.length > 0 && (
                            <ul
                              className="border-border/60 mt-1.5 flex flex-col gap-0.5 border-t pt-1.5"
                              aria-label="Approvals"
                            >
                              {run.approvals.map((approval, index) => (
                                <li
                                  key={`${approval.step}-${approval.at}-${index}`}
                                  className="text-ink-muted flex flex-wrap items-baseline justify-between gap-x-3 text-[11px]"
                                >
                                  <span>
                                    {describeApproval(
                                      approval,
                                      stepLabel(lastTask, approval.step),
                                    )}
                                  </span>
                                  <span className="text-ink-faint">
                                    {parseUtc(approval.at).toLocaleString()}
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
              </TabsContent>
            </Tabs>

            {task && gateType && (
              <div className="border-border/60 mt-4 border-t pt-3">
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
}
