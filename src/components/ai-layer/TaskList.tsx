"use client";

import { ScrollArea } from "@/components/ui";
import { useAgentStore } from "./agentStore";
import { TaskListItem } from "./TaskListItem";

/**
 * Collapsible task history — NOT visible by default (per the reference
 * product's clean default screen); PresenceAvatars mounts this only while
 * `isTaskListExpanded` is true, toggled by clicking the AI's presence
 * avatar. Reads `taskHistory` (most-recent-first) straight from
 * agentStore; there's no separate fetch/loading state since this is a
 * mocked shell.
 */
export function TaskList() {
  const tasks = useAgentStore((s) => s.taskHistory);

  return (
    <div className="border-border/60 bg-surface-elevated/95 shadow-float-lg w-72 overflow-hidden rounded-2xl border backdrop-blur-xl">
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
    </div>
  );
}
