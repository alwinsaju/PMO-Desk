"use client";

import { useEffect, useState } from "react";
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
import { StepTracker } from "./StepTracker";
import { TaskStateBadge } from "./TaskStateBadge";
import { humanize, statusSentence } from "./taskPresenter";
import type { HistoryRun, LogEntry, Task } from "./types";

/** Matches the log tab's live-refresh cadence to the rest of the app's poll
 *  interval — mirrors agentPresenter.js's buildStepLog, which "refreshes
 *  live while open." */
const LOG_POLL_MS = 2000;

interface TaskDetailDialogProps {
  /** null closes the dialog. */
  task: Task | null;
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
export function TaskDetailDialog({ task, onOpenChange }: TaskDetailDialogProps) {
  const [lastTask, setLastTask] = useState<Task | null>(task);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [history, setHistory] = useState<HistoryRun[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);

  useEffect(() => {
    if (task) setLastTask(task);
  }, [task]);

  const taskId = task?.id ?? null;
  const taskState = task?.state ?? null;

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
    <Dialog open={task !== null} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col overflow-y-auto">
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

            <div className="mt-4">
              <StepTracker task={lastTask} />
            </div>

            {lastTask.notifications.length > 0 && (
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

            <Tabs defaultValue="log" className="mt-4 flex min-h-0 flex-1 flex-col">
              <TabsList>
                <TabsTrigger value="log">Log</TabsTrigger>
                <TabsTrigger value="history">History</TabsTrigger>
              </TabsList>

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
                            {humanize(entry.step)} · {entry.stream}
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
                        </li>
                      ))}
                    </ul>
                  )}
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
