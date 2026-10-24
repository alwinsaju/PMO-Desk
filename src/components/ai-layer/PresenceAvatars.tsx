"use client";

import { SparkleIcon } from "@phosphor-icons/react";
import { Tooltip } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useAgentStore } from "./agentStore";
import { AgentStatusBadge } from "./AgentStatusBadge";
import { TaskList } from "./TaskList";

/**
 * Decorative placeholder "collaborators" for the bottom-left presence
 * cluster. This pass has no real multiplayer backend, so these are fixed
 * initials-only avatars, not real accounts — purely to sell the "presence"
 * concept the reference product's screenshots show. Exactly 3, matching
 * the reference's 2-3-avatar cluster. `tone` is the avatar fill: two
 * gradients, plus the accent gradient for the agent. In Deloitte mode the
 * first two swap to brand blue / dark gray (`brand-dl:`).
 */
const collaborators = [
  {
    id: "a",
    initials: "JL",
    name: "Jordan L.",
    active: true,
    tone: "bg-[linear-gradient(145deg,#5a93e0,#3b62c4)] text-white brand-dl:bg-none brand-dl:bg-[#00a3e0] brand-dl:text-black",
  },
  {
    id: "b",
    initials: "MK",
    name: "Maya K.",
    active: false,
    tone: "bg-[linear-gradient(145deg,#d9779f,#b0488a)] text-white brand-dl:bg-none brand-dl:bg-[#282728] brand-dl:dark:bg-[#555555]",
  },
  {
    id: "c",
    initials: "SR",
    name: "Shift Roster agent",
    active: true,
    tone: "bg-[linear-gradient(145deg,var(--color-accent-2),var(--color-accent))] text-accent-contrast",
  },
];

/**
 * Corner presence indicators: a cluster of overlapping placeholder
 * "collaborator" avatars bottom-left (they fan out when the cluster is
 * hovered; a small green dot marks the active ones), and, bottom-right, the
 * AI agent's status pill plus the AI orb (an accent-gradient round button).
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
      <div
        role="group"
        aria-label="Collaborators"
        className="group/pres absolute bottom-7 left-6 z-[var(--z-chrome)] flex items-center pl-2.5"
      >
        {collaborators.map((person) => (
          <Tooltip key={person.id} label={person.name} side="top" sideOffset={10}>
            <span
              role="img"
              aria-label={person.active ? `${person.name} (active)` : person.name}
              className={cn(
                "border-surface-elevated relative -ml-2.5 grid h-[38px] w-[38px] place-items-center rounded-full border-2 text-xs font-bold",
                "ease-spring shadow-[0_4px_12px_rgba(30,30,60,0.2)] transition-[margin,box-shadow] duration-[450ms]",
                "group-hover/pres:ml-1 hover:shadow-[0_0_0_3px_var(--color-accent-soft),0_4px_12px_rgba(30,30,60,0.2)]",
                person.tone,
              )}
            >
              {person.initials}
              {person.active && (
                <i
                  aria-hidden
                  className="bg-success-dot border-surface-elevated absolute -right-px -bottom-px h-2.5 w-2.5 rounded-full border-2"
                />
              )}
            </span>
          </Tooltip>
        ))}
      </div>

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
                !isActive && "[--ai-ring-opacity:0]",
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
