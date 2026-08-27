"use client";

import { CheckCircleIcon, CircleIcon, CircleNotchIcon } from "@phosphor-icons/react";
import { Badge } from "@/components/ui";
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
 *  validated action) both read as "in progress" here — same spinner, only
 *  the label text differs — see types.ts's AgentTaskStatus doc comment for
 *  what actually distinguishes the two phases. */
const IN_PROGRESS: ReadonlySet<BadgeStatus> = new Set(["thinking", "working"]);

/**
 * Idle / Thinking / Working / Completed status pill for the AI agent,
 * driven entirely by agentStore's `currentTask`. Mirrors the UI kit
 * Avatar's active/idle convention (accent = active, neutral = settled)
 * instead of introducing a second accent color for "completed" — see
 * ARCHITECTURE.md's "ONE accent color" section.
 */
export function AgentStatusBadge() {
  const status: BadgeStatus = useAgentStore((s) => s.currentTask?.status ?? "idle");
  const inProgress = IN_PROGRESS.has(status);

  return (
    <Badge variant={inProgress ? "accent" : "neutral"} className="gap-1.5 py-1 pl-1.5">
      {status === "idle" && (
        <CircleIcon size={8} weight="fill" className="text-ink-faint" />
      )}
      {inProgress && (
        <CircleNotchIcon size={11} weight="bold" className="text-accent animate-spin" />
      )}
      {status === "completed" && (
        <CheckCircleIcon size={11} weight="fill" className="text-ink-muted" />
      )}
      {STATUS_LABEL[status]}
    </Badge>
  );
}
