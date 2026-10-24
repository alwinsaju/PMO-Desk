"use client";

import { cn } from "@/lib/cn";
import { useAgentStore } from "./agentStore";
import type { AgentTaskStatus } from "./types";

type BadgeStatus = AgentTaskStatus | "idle";

const STATUS_LABEL: Record<BadgeStatus, string> = {
  idle: "Idle",
  thinking: "Thinking",
  working: "Working",
  completed: "Completed",
};

/** "thinking" (awaiting the model's decision) and "working" (applying a
 *  validated action) both read as "in progress" here — the dot blinks in the
 *  accent color; only the label text differs — see types.ts's AgentTaskStatus
 *  doc comment for what actually distinguishes the two phases. */
const IN_PROGRESS: ReadonlySet<BadgeStatus> = new Set(["thinking", "working"]);

/**
 * Idle / Thinking / Working / Completed status pill for the AI agent: a
 * frosted-glass pill (`glass`) with a status dot — grey while idle, accent and
 * pulsing while thinking/working, green once completed — driven entirely by
 * agentStore's `currentTask`. Mirrors the one-accent rule (accent = in
 * progress, neutral = settled); "completed" uses the shared success dot
 * rather than a second accent color — see ARCHITECTURE.md's "ONE accent
 * color" section.
 */
export function AgentStatusBadge() {
  const status: BadgeStatus = useAgentStore((s) => s.currentTask?.status ?? "idle");
  const inProgress = IN_PROGRESS.has(status);

  return (
    <span
      role="status"
      className="glass rounded-chip text-ink-soft inline-flex h-[30px] items-center gap-2 px-[13px] text-[12.5px] font-semibold"
    >
      <i
        aria-hidden
        className={cn(
          "h-[7px] w-[7px] rounded-full not-italic transition-colors duration-300",
          status === "idle" && "bg-ink-faint",
          inProgress && "bg-accent-ink motion-safe:animate-blink",
          status === "completed" && "bg-success-dot",
        )}
      />
      {STATUS_LABEL[status]}
    </span>
  );
}
