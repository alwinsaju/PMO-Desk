import {
  ChartBarIcon,
  EnvelopeSimpleIcon,
  LightningIcon,
  TicketIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { workflowIcon, type WorkflowIconKey } from "./workflowView";
import type { Task } from "./types";

const ICONS: Record<WorkflowIconKey, typeof LightningIcon> = {
  mail: EnvelopeSimpleIcon,
  roster: UsersThreeIcon,
  incident: TicketIcon,
  report: ChartBarIcon,
  workflow: LightningIcon,
};

/** The rounded tile with a workflow's icon. */
export function WorkflowIcon({
  task,
  className,
}: {
  task: Pick<Task, "id" | "displayName">;
  className?: string;
}) {
  const Icon = ICONS[workflowIcon(task)];
  return (
    <span
      aria-hidden
      className={cn(
        "bg-accent-soft text-accent-ink flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]",
        className,
      )}
    >
      <Icon size={18} weight="duotone" />
    </span>
  );
}
