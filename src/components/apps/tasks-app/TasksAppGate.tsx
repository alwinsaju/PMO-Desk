"use client";

import { BackendLaunchScreen } from "./BackendLaunchScreen";
import { TasksApp } from "./TasksApp";
import { useBackendLauncher } from "./useBackendLauncher";

/**
 * What actually gets registered under "tasks" (see index.ts) — wraps the
 * real <TasksApp> with an auto-launch step for its agent-office backend,
 * so opening the app no longer requires `uvicorn` to already be running by
 * hand. <TasksApp> itself is untouched and still works exactly as before
 * if ever rendered directly (e.g. in isolation/tests): all of the new
 * behavior lives in this file + useBackendLauncher.ts +
 * BackendLaunchScreen.tsx, deliberately kept out of the existing
 * TasksApp/TaskCard/etc. files.
 *
 * While useBackendLauncher's phase isn't "ready", <TasksApp> (and its
 * useAgentOfficeData poll loop) isn't mounted at all — so once it is
 * mounted, its very first poll should already succeed, since we've just
 * confirmed the backend is reachable.
 */
export function TasksAppGate({ windowId }: { windowId: string }) {
  const launcher = useBackendLauncher();

  if (launcher.phase !== "ready") {
    return (
      <div
        data-window-id={windowId}
        className="flex h-full w-full items-center justify-center p-6"
      >
        <BackendLaunchScreen
          state={launcher.phase === "failed" ? "failed" : "launching"}
          reason={launcher.reason}
          onRetry={launcher.retry}
        />
      </div>
    );
  }

  return <TasksApp windowId={windowId} />;
}
