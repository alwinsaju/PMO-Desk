"use client";

import { useCallback, useMemo, useState } from "react";
import { ScrollArea } from "@/components/ui";
import { AGENT_OFFICE_API_URL } from "./api";
import { TaskCard } from "./TaskCard";
import { TaskDetailDialog } from "./TaskDetailDialog";
import { useAgentOfficeData } from "./useAgentOfficeData";

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

  const selectedTask = useMemo(
    () =>
      selectedTaskId ? (tasks.find((task) => task.id === selectedTaskId) ?? null) : null,
    [tasks, selectedTaskId],
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
          <p className="text-ink-faint text-sm">Loading tasks…</p>
        )}
      </div>
    );
  }

  return (
    <div data-window-id={windowId} className="flex h-full w-full flex-col">
      {connection === "offline" && (
        <div className="border-border/60 text-ink-muted border-b bg-neutral-50 px-4 py-2 text-center text-[12px]">
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
          <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4 p-4">
            {tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                canStart={canStart}
                onSettled={refetch}
                onOpenDetail={setSelectedTaskId}
              />
            ))}
          </div>
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
      <p className="text-ink text-sm font-medium">
        Can&apos;t reach the agent-office backend
      </p>
      <p className="text-ink-faint text-[13px]">
        Make sure it&apos;s running on{" "}
        <code className="text-ink-muted font-mono text-[12px]">
          {AGENT_OFFICE_API_URL}
        </code>
        . This will connect automatically once it&apos;s available.
      </p>
    </div>
  );
}
