import * as React from "react";
import { cn } from "@/lib/cn";

export interface EmptyStateProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "title"
> {
  /** A Phosphor icon element, e.g. `<TrayIcon size={22} />`. */
  icon?: React.ReactNode;
  /** What is empty, e.g. "No risks logged yet". */
  headline: React.ReactNode;
  /** One sentence on what goes here or how to fill it. */
  description?: React.ReactNode;
  /** The primary next step, usually a `<Button>`. */
  action?: React.ReactNode;
  /** Less padding, for a card or a narrow pane instead of a whole window. */
  compact?: boolean;
}

/**
 * Replaces a blank pane: icon, headline, one sentence and (optionally) the
 * one thing to do next. Centered in whatever space the parent gives it.
 */
export function EmptyState({
  icon,
  headline,
  description,
  action,
  compact = false,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-sm flex-col items-center justify-center text-center",
        compact ? "gap-2 px-4 py-6" : "min-h-64 gap-3 px-6 py-10",
        className,
      )}
      {...props}
    >
      {icon && (
        <span
          aria-hidden
          className="bg-chip text-ink-muted grid h-12 w-12 place-items-center rounded-full"
        >
          {icon}
        </span>
      )}
      <h3 className="text-ink text-[15px] leading-snug font-semibold">{headline}</h3>
      {description && (
        <p className="text-ink-muted text-[13px] leading-relaxed">{description}</p>
      )}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
