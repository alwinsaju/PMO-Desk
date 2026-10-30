"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollArea, Tabs, TabsList, TabsTrigger } from "@/components/ui";
import { EngineDownNotice } from "./EngineDownNotice";
import { HistoryTab } from "./HistoryTab";
import { PacksTab } from "./PacksTab";
import { ScheduleTab } from "./ScheduleTab";
import { useTasksPrefs } from "@/lib/tasks/tasksPrefsStore";
import { TaskCard } from "./TaskCard";
import { TaskDetailDialog } from "./TaskDetailDialog";
import { useTasksData } from "./useTasksData";
import { isFreshRunRequest, useTasksNav } from "./tasksNavStore";
import type { Task } from "./types";

/** The header's filter tabs, derived purely from each task's own `state`
 *  (no extra data): "Needs you" = waiting at a human gate or failed,
 *  "Running" = working/finishing, "Idle" = resting. */
type TaskFilter = "all" | "needs" | "running" | "idle";

/** The window's own sections: the workflow cards, every past run, and schedules plus the send-later queue. */
type TasksView = "workflows" | "history" | "schedule" | "packs";

const NEEDS_YOU = new Set<Task["state"]>(["awaiting_review", "awaiting_send", "error"]);
const RUNNING = new Set<Task["state"]>(["working", "finishing"]);

function matchesFilter(task: Task, filter: TaskFilter): boolean {
  switch (filter) {
    case "needs":
      return NEEDS_YOU.has(task.state);
    case "running":
      return RUNNING.has(task.state);
    case "idle":
      return task.state === "resting";
    default:
      return true;
  }
}

/**
 * Root Tasks window — matches the `AppComponent` contract
 * (`ComponentType<{ windowId: string }>`, see src/components/apps/types.ts)
 * and is registered under "tasks" in `index.ts`.
 *
 * Unlike every other app in this registry, this one is a live client of a
 * separate, already-running FastAPI engine (tasks-engine) rather than
 * local/mocked state — see api.ts and useTasksData.ts. `windowId`
 * isn't needed for any lookup here (state lives in the polling hook, not
 * per-window) but is stamped onto the root as a data attribute per this
 * registry's usual convention (see AppStoreApp.tsx).
 */
export function TasksApp({ windowId }: { windowId: string }) {
  const { tasks, connection, hasLoadedOnce, refetch } = useTasksData();
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [filter, setFilter] = useState<TaskFilter>("all");
  const [view, setView] = useState<TasksView>("workflows");
  const queued = useTasksPrefs((s) => s.queue.length);
  // The task the command bar asked for ("prepare the aging report"): its card is marked
  // for a few seconds, and its Run form opens (see TaskActions).
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const runRequest = useTasksNav((s) => s.runRequest);
  useEffect(() => {
    if (!runRequest) return;
    setFilter("all");
    setView("workflows");
    setHighlightId(runRequest.taskId);
  }, [runRequest]);
  useEffect(() => {
    if (!highlightId) return;
    const timer = setTimeout(() => setHighlightId(null), 4000);
    return () => clearTimeout(timer);
  }, [highlightId]);

  // The Dashboard's "View log": open that task's details once the list has loaded.
  const detailRequest = useTasksNav((s) => s.detailRequest);
  useEffect(() => {
    if (!detailRequest || !hasLoadedOnce) return;
    useTasksNav.getState().clearDetailRequest(detailRequest.id);
    if (!isFreshRunRequest(detailRequest)) return;
    setFilter("all");
    setView("workflows");
    if (tasks.some((task) => task.id === detailRequest.taskId)) {
      setSelectedTaskId(detailRequest.taskId);
    }
  }, [detailRequest, hasLoadedOnce, tasks]);

  const selectedTask = useMemo(
    () =>
      selectedTaskId ? (tasks.find((task) => task.id === selectedTaskId) ?? null) : null,
    [tasks, selectedTaskId],
  );
  const counts = useMemo(
    () => ({
      all: tasks.length,
      needs: tasks.filter((t) => matchesFilter(t, "needs")).length,
      running: tasks.filter((t) => matchesFilter(t, "running")).length,
      idle: tasks.filter((t) => matchesFilter(t, "idle")).length,
    }),
    [tasks],
  );
  const visibleTasks = useMemo(
    () => tasks.filter((t) => matchesFilter(t, filter)),
    [tasks, filter],
  );
  const handleDetailOpenChange = useCallback((open: boolean) => {
    if (!open) setSelectedTaskId(null);
  }, []);

  // Never blank the screen for a transient failure once we've shown real
  // data before — only the very first load (never yet succeeded) gets the
  // full-panel loading/error treatment; see useTasksData's doc
  // comment for why a later failure instead just flips a small banner.
  if (!hasLoadedOnce) {
    return (
      <div
        data-window-id={windowId}
        className="flex h-full w-full items-center justify-center p-6"
      >
        {connection === "offline" ? (
          <EngineDownNotice />
        ) : (
          <p className="text-ink-muted text-sm">Loading tasks…</p>
        )}
      </div>
    );
  }

  return (
    <div data-window-id={windowId} className="flex h-full w-full flex-col">
      {connection === "offline" && <EngineDownNotice compact />}

      <div className="px-6 pt-1 pb-2">
        <Tabs value={view} onValueChange={(v) => setView(v as TasksView)}>
          <TabsList aria-label="Tasks views">
            <TabsTrigger value="workflows">Workflows</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
            <TabsTrigger value="schedule" count={queued || undefined}>
              Schedule
            </TabsTrigger>
            <TabsTrigger value="packs">Packs</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        {view === "history" ? (
          <HistoryTab tasks={tasks} />
        ) : view === "schedule" ? (
          <ScheduleTab tasks={tasks} onSettled={refetch} />
        ) : view === "packs" ? (
          <PacksTab onChanged={refetch} />
        ) : tasks.length === 0 ? (
          <div className="flex h-full items-center justify-center p-6">
            <p className="text-ink-faint text-sm">
              No tasks found in this workspace yet.
            </p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-6 pt-2 pb-[18px]">
              <p className="text-ink-muted text-sm" aria-live="polite">
                {counts.needs} need you · {counts.running} running · {counts.all} workflow
                {counts.all === 1 ? "" : "s"}
              </p>
              <Tabs value={filter} onValueChange={(v) => setFilter(v as TaskFilter)}>
                <TabsList aria-label="Filter workflows">
                  <TabsTrigger value="all">All</TabsTrigger>
                  <TabsTrigger value="needs" count={counts.needs}>
                    Needs you
                  </TabsTrigger>
                  <TabsTrigger value="running" count={counts.running}>
                    Running
                  </TabsTrigger>
                  <TabsTrigger value="idle" count={counts.idle}>
                    Idle
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            {visibleTasks.length === 0 ? (
              <p className="text-ink-faint px-6 py-10 text-center text-sm">
                Nothing here right now.
              </p>
            ) : (
              <div className="grid auto-rows-[1fr] grid-cols-[repeat(auto-fill,minmax(300px,1fr))] content-start gap-4 px-6 pb-6">
                {visibleTasks.map((task, index) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    onSettled={refetch}
                    onOpenDetail={setSelectedTaskId}
                    index={index}
                    highlighted={task.id === highlightId}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </ScrollArea>

      <TaskDetailDialog
        task={selectedTask}
        onSettled={refetch}
        onOpenChange={handleDetailOpenChange}
      />
    </div>
  );
}
