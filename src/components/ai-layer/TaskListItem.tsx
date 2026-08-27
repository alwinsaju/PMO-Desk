"use client";

import { CheckCircleIcon, CircleNotchIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import type { AgentTask } from "./types";

interface TaskListItemProps {
  task: AgentTask;
}

/** One row in TaskList. Purely presentational — TaskList owns the list
 *  (empty state, scrolling), this owns rendering a single AgentTask. */
export function TaskListItem({ task }: TaskListItemProps) {
  const isWorking = task.status === "working";
  const timestamp = new Date(task.completedAt ?? task.createdAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <li className="flex items-start gap-2.5 px-3.5 py-2.5">
      <span
        className={cn("mt-0.5 shrink-0", isWorking ? "text-accent" : "text-ink-muted")}
      >
        {isWorking ? (
          <CircleNotchIcon size={14} weight="bold" className="animate-spin" />
        ) : (
          <CheckCircleIcon size={14} weight="fill" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-ink truncate text-[13px] font-medium">{task.prompt}</p>
        <p className="text-ink-faint text-[11px]">{timestamp}</p>
      </div>
    </li>
  );
}
