"use client";

import { CheckIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import type { AgentTask } from "./types";

interface TaskListItemProps {
  task: AgentTask;
}

/** One row in TaskList. Purely presentational — TaskList owns the list
 *  (empty state, scrolling), this owns rendering a single AgentTask: a
 *  22px accent-tinted check circle (or a spinning ring while the task is
 *  still in flight), the outcome in semibold and the time below it. */
export function TaskListItem({ task }: TaskListItemProps) {
  const isInProgress = task.status !== "completed";
  const timestamp = new Date(task.completedAt ?? task.createdAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <li className="rounded-control flex gap-[11px] px-2 py-2.5">
      <span
        aria-hidden
        className={cn(
          "mt-px grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full",
          isInProgress
            ? "border-accent-soft border-t-accent-ink motion-safe:animate-rot border-2"
            : "bg-accent-soft text-accent-ink",
        )}
      >
        {!isInProgress && <CheckIcon size={13} weight="bold" />}
      </span>
      <div className="min-w-0 flex-1">
        {/* `summary` (the real outcome — "Creating a note: ..." or the
            AI's reply text) takes over once the task completes; falls back
            to the raw prompt while still in flight or if it's absent. */}
        <p className="text-ink truncate text-[13.5px] leading-snug font-semibold">
          {task.summary ?? task.prompt}
        </p>
        <p className="text-ink-muted text-xs">
          <span className="sr-only">
            {isInProgress ? "In progress, " : "Completed, "}
          </span>
          {timestamp}
        </p>
      </div>
    </li>
  );
}
