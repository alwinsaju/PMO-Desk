"use client";

import { motion } from "motion/react";
import { ScrollArea } from "@/components/ui";
import { cn } from "@/lib/cn";
import { easeEntrance, easeExit } from "@/lib/motion";
import { useAgentStore } from "./agentStore";
import { TaskListItem } from "./TaskListItem";

interface TaskListProps {
  /** Toggled by clicking the AI's presence avatar (PresenceAvatars.tsx).
   *  Collapsed by default, per the reference product's clean default
   *  screen. */
  isExpanded: boolean;
}

/**
 * Collapsible task history, anchored just above the presence avatar row
 * (PresenceAvatars.tsx positions this absolutely via `bottom-full`).
 * Reads `taskHistory` (most-recent-first) straight from agentStore;
 * there's no separate fetch/loading state since this is a mocked shell.
 *
 * Always mounted — collapse/expand animates opacity/scale/position on this
 * one persistent node rather than mounting/unmounting the panel via
 * AnimatePresence's `exit`, which isn't reliable in this project's React 19
 * + motion setup (see AICursor.tsx's doc comment for the full story).
 * `initial={false}` so it never plays an unwanted pop-in on first mount —
 * it should just silently start in whatever state `isExpanded` already is
 * (collapsed, in practice, since that's the default). The transition
 * mirrors the UI kit's Popover/DropdownMenu open/close treatment
 * (`overlayEnter`/`overlayExit` in src/lib/motion.ts) since this panel is
 * conceptually the same kind of flyout, just not Radix-portaled.
 */
export function TaskList({ isExpanded }: TaskListProps) {
  const tasks = useAgentStore((s) => s.taskHistory);

  return (
    <motion.div
      initial={false}
      animate={{
        opacity: isExpanded ? 1 : 0,
        scale: isExpanded ? 1 : 0.96,
        y: isExpanded ? 0 : 4,
      }}
      transition={{
        duration: isExpanded ? 0.16 : 0.12,
        ease: isExpanded ? easeEntrance : easeExit,
      }}
      aria-hidden={!isExpanded}
      className={cn(
        "border-border/60 bg-surface-elevated/95 shadow-float-lg absolute right-0 bottom-full mb-3 w-72 overflow-hidden rounded-2xl border backdrop-blur-xl",
        !isExpanded && "pointer-events-none",
      )}
    >
      <div className="border-border/60 border-b px-3.5 py-2.5">
        <span className="text-ink text-[13px] font-semibold">Task history</span>
      </div>
      {tasks.length === 0 ? (
        <p className="text-ink-faint px-3.5 py-6 text-center text-[12px]">
          No tasks yet — ask the AI something to get started.
        </p>
      ) : (
        <ScrollArea className="max-h-72">
          <ul className="divide-border/60 divide-y">
            {tasks.map((task) => (
              <TaskListItem key={task.id} task={task} />
            ))}
          </ul>
        </ScrollArea>
      )}
    </motion.div>
  );
}
