"use client";

import { SparkleIcon } from "@phosphor-icons/react";
import { Tooltip } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useAgentStore } from "./agentStore";
import { AgentStatusBadge } from "./AgentStatusBadge";
import { TaskList } from "./TaskList";

/**
 * Corner AI indicators, bottom-right: the AI agent's status pill plus the AI orb (an
 * accent-gradient round button).
 * The orb gets a rotating `ai-ring` while a task is in flight — thinking or
 * working, read from agentStore's `currentTask` — and clicking it
 * expands/collapses the "AI activity" task history panel — collapsed by
 * default, per the reference product's clean default screen.
 */
export function PresenceAvatars() {
  // "active" for either in-progress phase (thinking about a decision, or
  // applying a validated action) — see types.ts's AgentTaskStatus doc
  // comment; only "completed" (and idle, i.e. no task at all) reads as
  // settled.
  const isActive = useAgentStore(
    (s) => s.currentTask !== null && s.currentTask.status !== "completed",
  );
  const isTaskListExpanded = useAgentStore((s) => s.isTaskListExpanded);
  const toggleTaskList = useAgentStore((s) => s.toggleTaskList);

  return (
    <>
      <div className="absolute right-6 bottom-7 z-[var(--z-chrome)] flex flex-col items-end gap-3">
        {/* Always mounted (see TaskList.tsx's own doc comment for why).
            TaskList positions itself absolutely — this column is already
            `position: absolute`, so it's TaskList's containing block for
            free — which is what keeps its collapsed/expanded animation
            from ever shifting the row below: that row stays pinned to
            `bottom-7` either way, since an absolutely-positioned child
            doesn't participate in this column's own `flex`/`gap` layout. */}
        <TaskList isExpanded={isTaskListExpanded} />

        <div className="flex items-center gap-3">
          <AgentStatusBadge />
          <Tooltip label="AI activity" side="top" sideOffset={10}>
            <button
              type="button"
              onClick={toggleTaskList}
              aria-label="AI agent — toggle task history"
              aria-expanded={isTaskListExpanded}
              className={cn(
                "ai-ring rounded-orb text-accent-contrast grid h-12 w-12 place-items-center",
                "bg-[linear-gradient(145deg,var(--color-accent-2),var(--color-accent))]",
                "shadow-[0_8px_22px_-6px_var(--color-accent),inset_0_1px_0_rgba(255,255,255,0.35)]",
                "ease-spring transition-[transform,opacity] duration-[400ms] hover:scale-[1.08] active:scale-[0.94]",
                "focus-visible:ring-focus focus-visible:ring-offset-surface focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
                !isActive && "[--ai-ring-opacity:0] [--ai-ring-state:paused]",
              )}
            >
              <SparkleIcon size={23} weight="duotone" aria-hidden />
            </button>
          </Tooltip>
        </div>
      </div>
    </>
  );
}
