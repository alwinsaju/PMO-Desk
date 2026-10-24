"use client";

import { useCallback, useMemo, useState } from "react";
import { ScrollArea, Tabs, TabsList, TabsTrigger } from "@/components/ui";
import { AGENT_OFFICE_API_URL } from "./api";
import { TaskCard } from "./TaskCard";
import { TaskDetailDialog } from "./TaskDetailDialog";
import { useAgentOfficeData } from "./useAgentOfficeData";
import type { Task } from "./types";

/** The header's filter tabs, derived purely from each task's own `state`
 *  (no extra data): "Needs you" = waiting at a human gate or failed,
 *  "Running" = working/finishing, "Idle" = resting. */
type TaskFilter = "all" | "needs" | "running" | "idle";

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
 * separate, already-running FastAPI backend (agent-office) rather than
 * local/mocked state — see api.ts and useAgentOfficeData.ts. `windowId`
 * isn't needed for any lookup here (state lives in the polling hook, not
 * per-window) but is stamped onto the root as a data attribute per this
 * registry's usual convention (see AppStoreApp.tsx).
 */
export function TasksApp({ windowId }: { windowId: string }) {
  const { tasks, canStart, connection, hasLoadedOnce, refetch } = useAgentOfficeData();
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [filter, setFilter] = useState<TaskFilter>("all");

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
  // full-panel loading/error treatment; see useAgentOfficeData's doc
  // comment for why a later failure instead just flips a small banner.
  if (!hasLoadedOnce) {
    return (
      <div
        data-window-id={windowId}
        className="flex h-full w-full items-center justify-center p-6"
      >
        {connection === "offline" ? (
          <BackendUnreachableNotice />
        ) : (
          <p className="text-ink-muted text-sm">Loading tasks…</p>
        )}
      </div>
    );
  }

  return (
    <div data-window-id={windowId} className="flex h-full w-full flex-col">
      {connection === "offline" && (
        <div
          role="status"
          className="rounded-card bg-amber-soft text-amber mx-6 mb-2 px-3.5 py-2.5 text-center text-[13px]"
        >
          Can&apos;t reach the agent-office backend right now — showing the last known
          state.
        </div>
      )}

      <ScrollArea className="min-h-0 flex-1">
        {tasks.length === 0 ? (
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
                    canStart={canStart}
                    onSettled={refetch}
                    onOpenDetail={setSelectedTaskId}
                    index={index}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </ScrollArea>

      <TaskDetailDialog
        task={selectedTask}
        canStart={canStart}
        onSettled={refetch}
        onOpenChange={handleDetailOpenChange}
      />
    </div>
  );
}

function BackendUnreachableNotice() {
  return (
    <div className="flex max-w-sm flex-col items-center gap-2 text-center">
      <p className="text-ink font-headline text-lg">
        Can&apos;t reach the agent-office backend
      </p>
      <p className="text-ink-muted text-[13.5px]">
        Make sure it&apos;s running on{" "}
        <code className="text-ink-soft font-mono text-[12px]">
          {AGENT_OFFICE_API_URL}
        </code>
        . This will connect automatically once it&apos;s available.
      </p>
    </div>
  );
}
