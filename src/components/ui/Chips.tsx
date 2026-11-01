import * as React from "react";
import { cn } from "@/lib/cn";
import { formatDate, type DateInput } from "@/lib/ui/dates";
import { Badge, type BadgeProps } from "./Badge";
import {
  dueChip,
  priorityTone,
  sourceChip,
  statusChip,
  type PriorityToneName,
} from "./chipLogic";

type ChipProps = Omit<BadgeProps, "variant" | "children" | "dot">;

/** Status of a to-do, run or request: Done, Running, Waiting, Failed, Pending... */
export function StatusChip({
  status,
  label,
  ...props
}: ChipProps & { status: string | null | undefined; label?: string }) {
  const spec = statusChip(status);
  return (
    <Badge variant={spec.variant} dot={spec.dot} pulse={spec.dot} {...props}>
      {label ?? spec.label}
    </Badge>
  );
}

/** Due date: red when overdue ("3d late"), amber today, neutral later. */
export function DueChip({
  due,
  now,
  done,
  ...props
}: ChipProps & { due: DateInput; now?: Date; done?: boolean }) {
  const spec = dueChip(due, now ?? new Date(), { done });
  return (
    <Badge variant={spec.variant} title={formatDate(due) || undefined} {...props}>
      {spec.label}
    </Badge>
  );
}

const stripeClassName: Record<PriorityToneName, string> = {
  red: "bg-red",
  amber: "bg-amber",
  muted: "bg-ink-faint",
};

/**
 * Thin vertical bar for the edge of a row. The priority is also in the
 * accessible name, so colour is never the only signal. Renders nothing for an
 * unknown priority.
 */
export function PriorityStripe({
  priority,
  className,
  ...props
}: Omit<React.HTMLAttributes<HTMLSpanElement>, "children"> & {
  priority: string | null | undefined;
}) {
  const found = priorityTone(priority);
  if (!found) return null;
  return (
    <span
      role="img"
      aria-label={found.label}
      title={found.label}
      className={cn(
        "w-1 shrink-0 self-stretch rounded-full",
        stripeClassName[found.tone],
        className,
      )}
      {...props}
    />
  );
}

/** Where an item came from: Outlook, Teams or Manual. */
export function SourceBadge({
  source,
  ...props
}: ChipProps & { source: string | null | undefined }) {
  const spec = sourceChip(source);
  return (
    <Badge variant={spec.variant} {...props}>
      {spec.label}
    </Badge>
  );
}
