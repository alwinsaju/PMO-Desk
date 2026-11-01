"use client";

import { motion } from "motion/react";
import { easeStandard } from "@/lib/motion";
import { EngineLaunchScreen } from "./EngineLaunchScreen";
import { TasksApp } from "./TasksApp";
import { useEngineLauncher } from "./useEngineLauncher";

/** Plain opacity crossfade for the hand-off between this gate's two very
 *  differently-shaped states (a centered loading card vs. the real app's
 *  full grid) — a mount-triggered `initial`/`animate` pair, keyed per
 *  branch below so React treats each as a fresh node instead of morphing
 *  one into the other. No exit animation needed: the outgoing state simply
 *  disappears the instant the incoming one mounts, same as before this
 *  existed — see AICursor.tsx's doc comment for why this project avoids
 *  AnimatePresence's `exit` for this kind of swap. */
const GATE_TRANSITION = { duration: 0.2, ease: easeStandard };

/**
 * What actually gets registered under "tasks" (see index.ts) — wraps the
 * real <TasksApp> with an auto-launch step for its Tasks engine,
 * so opening the app no longer requires `uvicorn` to already be running by
 * hand. <TasksApp> itself is untouched and still works exactly as before
 * if ever rendered directly (e.g. in isolation/tests): all of the new
 * behavior lives in this file + useEngineLauncher.ts +
 * EngineLaunchScreen.tsx, deliberately kept out of the existing
 * TasksApp/TaskCard/etc. files.
 *
 * While useEngineLauncher's phase isn't "ready", <TasksApp> (and its
 * useTasksData poll loop) isn't mounted at all — so once it is
 * mounted, its very first poll should already succeed, since we've just
 * confirmed the engine is reachable.
 */
export function TasksAppGate({ windowId }: { windowId: string }) {
  const launcher = useEngineLauncher();

  if (launcher.phase !== "ready") {
    return (
      <motion.div
        key="launching"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={GATE_TRANSITION}
        data-window-id={windowId}
        className="flex h-full w-full items-center justify-center p-6"
      >
        <EngineLaunchScreen
          state={launcher.phase === "failed" ? "failed" : "launching"}
          reason={launcher.reason}
          startedAt={launcher.startedAt}
          retrying={launcher.retrying}
          onRetry={launcher.retry}
        />
      </motion.div>
    );
  }

  return (
    <motion.div
      key="ready"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={GATE_TRANSITION}
      className="h-full w-full"
    >
      <TasksApp windowId={windowId} />
    </motion.div>
  );
}
