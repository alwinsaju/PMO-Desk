"use client";

import { CheckCircleIcon, CircleIcon, CircleNotchIcon } from "@phosphor-icons/react";
import { Badge } from "@/components/ui";
import { useAgentStore } from "./agentStore";
import type { AgentTaskStatus } from "./types";

type BadgeStatus = AgentTaskStatus | "idle";

const STATUS_LABEL: Record<BadgeStatus, string> = {
  idle: "Idle",
  working: "Working",
  completed: "Completed",
};

/**
 * Idle / Working / Completed status pill for the AI agent, driven
 * entirely by agentStore's `currentTask`. Mirrors the UI kit Avatar's
 * active/idle convention (accent = active, neutral = settled) instead of
 * introducing a second accent color for "completed" — see
 * ARCHITECTURE.md's "ONE accent color" section.
 */
export function AgentStatusBadge() {
  const status: BadgeStatus = useAgentStore((s) => s.currentTask?.status ?? "idle");

  return (
    <Badge
      variant={status === "working" ? "accent" : "neutral"}
      className="gap-1.5 py-1 pl-1.5"
    >
      {status === "idle" && (
        <CircleIcon size={8} weight="fill" className="text-ink-faint" />
      )}
      {status === "working" && (
        <CircleNotchIcon size={11} weight="bold" className="text-accent animate-spin" />
      )}
      {status === "completed" && (
        <CheckCircleIcon size={11} weight="fill" className="text-ink-muted" />
      )}
      {STATUS_LABEL[status]}
    </Badge>
  );
}
