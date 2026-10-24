"use client";

import { motion } from "motion/react";
import { cn } from "@/lib/cn";
import { easeExit } from "@/lib/motion";
import { useAgentStore } from "./agentStore";
import { TaskListItem } from "./TaskListItem";

/** `--ease-spring` as a motion tuple — the panel pops open with the same
 *  overshoot as every other popover (src/lib/motion.ts has no twin yet). */
const easeSpring = [0.34, 1.5, 0.64, 1] as const;

interface TaskListProps {
  /** Toggled by clicking the AI orb (PresenceAvatars.tsx). Collapsed by
   *  default, per the reference product's clean default screen. */
  isExpanded: boolean;
}

/**
 * The "AI activity" panel: a frosted-glass popover (`glass-pop`) anchored just
 * above the AI orb row (PresenceAvatars.tsx positions this absolutely via
 * `bottom-full`), listing the task history (most-recent-first) as check /
 * spinner rows. Reads `taskHistory` straight from agentStore; there's no
 * separate fetch/loading state since this is a mocked shell.
 *
 * Always mounted — collapse/expand animates opacity/scale/position on this
 * one persistent node rather than mounting/unmounting the panel via
 * AnimatePresence's `exit`, which isn't reliable in this project's React 19
 * + motion setup (see AICursor.tsx's doc comment for the full story).
 * `initial={false}` so it never plays an unwanted pop-in on first mount —
 * it should just silently start in whatever state `isExpanded` already is
 * (collapsed, in practice, since that's the default). The transition
 * mirrors the UI kit's Popover open/close treatment (`popEnter`/`popExit` in
 * src/lib/motion.ts: spring in, quick out) since this panel is conceptually
 * the same kind of flyout, just not Radix-portaled. The list scrolls inside
 * a plain `overflow-y-auto` box (the old ScrollArea had its max-height on the
 * Radix Root, so a long history could never scroll).
 */
export function TaskList({ isExpanded }: TaskListProps) {
  const tasks = useAgentStore((s) => s.taskHistory);

  return (
    <motion.div
      initial={false}
      animate={{
        opacity: isExpanded ? 1 : 0,
        scale: isExpanded ? 1 : 0.92,
        y: isExpanded ? 0 : 8,
      }}
      transition={
        isExpanded
          ? {
              opacity: { duration: 0.25 },
              scale: { duration: 0.45, ease: easeSpring },
              y: { duration: 0.45, ease: easeSpring },
            }
          : { duration: 0.14, ease: easeExit }
      }
      aria-hidden={!isExpanded}
      inert={!isExpanded}
      style={{ transformOrigin: "100% 100%" }}
      className={cn(
        "glass-pop rounded-surface absolute right-0 bottom-full mb-3 w-[min(21.25rem,calc(100vw-3rem))] p-3.5",
        !isExpanded && "pointer-events-none",
      )}
    >
      <p className="text-ink-muted px-2 pt-0.5 pb-1.5 text-[11.5px] font-bold tracking-[0.08em] uppercase">
        AI activity
      </p>
      {tasks.length === 0 ? (
        <p className="text-ink-muted px-2 py-5 text-center text-[13px]">
          No tasks yet — ask the AI something to get started.
        </p>
      ) : (
        <ul className="scroll-thin max-h-72 overflow-y-auto overscroll-contain">
          {tasks.map((task) => (
            <TaskListItem key={task.id} task={task} />
          ))}
        </ul>
      )}
    </motion.div>
  );
}
