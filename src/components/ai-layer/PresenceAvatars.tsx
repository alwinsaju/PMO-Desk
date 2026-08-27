"use client";

import { Avatar, Tooltip } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useAgentStore } from "./agentStore";
import { AgentStatusBadge } from "./AgentStatusBadge";
import { TaskList } from "./TaskList";

/**
 * Decorative placeholder "collaborators" for the bottom-left presence
 * cluster. This pass has no real multiplayer backend, so these are fixed
 * initials-only avatars, not real accounts — purely to sell the "presence"
 * concept the reference product's screenshots show. Exactly 3, matching
 * the reference's 2-3-avatar cluster.
 */
const collaborators = [
  { id: "a", initials: "JL", presence: "active" as const },
  { id: "b", initials: "MK", presence: "idle" as const },
  { id: "c", initials: "SR", presence: "active" as const },
];

/**
 * Corner presence indicators: a cluster of overlapping placeholder
 * "collaborator" avatars bottom-left, and a single avatar bottom-right
 * representing the AI agent itself (`<Avatar presence="active|idle">`
 * from the UI kit — see src/components/ui/Avatar.tsx). The AI avatar's
 * presence ring reflects whether a task is currently "working" (read from
 * agentStore's `currentTask`), and clicking it expands/collapses the task
 * history panel — collapsed by default, per the reference product's clean
 * default screen.
 */
export function PresenceAvatars() {
  const isWorking = useAgentStore((s) => s.currentTask?.status === "working");
  const isTaskListExpanded = useAgentStore((s) => s.isTaskListExpanded);
  const toggleTaskList = useAgentStore((s) => s.toggleTaskList);

  return (
    <>
      <div className="absolute bottom-6 left-6 z-[var(--z-chrome)] flex items-center">
        {collaborators.map((person, index) => (
          <Avatar
            key={person.id}
            fallback={person.initials}
            presence={person.presence}
            size="sm"
            className={cn(index > 0 && "-ml-2.5")}
          />
        ))}
      </div>

      <div className="absolute right-6 bottom-6 z-[var(--z-chrome)] flex flex-col items-end gap-3">
        {/* Plain conditional mount, deliberately not animated via
            framer-motion's AnimatePresence/`exit` — see AICursor.tsx's doc
            comment: that mechanism didn't reliably unmount nodes in this
            project's React 19 + motion setup, and this panel doesn't need
            the polish enough to justify chasing that further. */}
        {isTaskListExpanded && <TaskList />}

        <div className="flex items-center gap-2">
          <AgentStatusBadge />
          <Tooltip label={isTaskListExpanded ? "Hide task history" : "Show task history"}>
            <button
              type="button"
              onClick={toggleTaskList}
              aria-label="AI agent — toggle task history"
              aria-expanded={isTaskListExpanded}
              className="focus-visible:ring-accent focus-visible:ring-offset-surface rounded-full focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
            >
              <Avatar
                fallback="AI"
                presence={isWorking ? "active" : "idle"}
                className="bg-accent-subtle text-accent-700 font-semibold"
              />
            </button>
          </Tooltip>
        </div>
      </div>
    </>
  );
}
