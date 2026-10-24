"use client";

import type { ComponentProps, ReactNode } from "react";
import { Badge } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { Proposal, StructuringInfo } from "@/lib/pmo/types";
import { SOURCE_LABEL, statusLabel } from "./queueView";

/** Small caps label above a form control. */
export function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1", className)}>
      <span className="text-ink-faint text-[10px] font-semibold tracking-wide uppercase">
        {label}
      </span>
      {children}
    </label>
  );
}

export function TextArea({
  className,
  ...props
}: ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "rounded-control border-border bg-surface-elevated text-ink min-h-20 w-full resize-y border px-3 py-2 text-[13px]",
        "placeholder:text-ink-faint",
        "ease-standard transition-[border-color,box-shadow] duration-150",
        "focus-visible:border-accent focus-visible:ring-accent/30 focus-visible:ring-2 focus-visible:outline-none",
        "disabled:pointer-events-none disabled:opacity-40",
        className,
      )}
      {...props}
    />
  );
}

/** A row of mutually exclusive choices drawn as pills. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T;
  options: { value: T; label: string; title?: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={option.title}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              "rounded-pill ease-standard border px-3 py-1 text-[12px] font-medium transition-colors duration-150",
              "focus-visible:ring-accent focus-visible:ring-2 focus-visible:outline-none disabled:opacity-40",
              active
                ? "border-ink bg-ink text-ink-inverse"
                : "border-border text-ink-muted hover:bg-neutral-100",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function SourceBadge({ source }: { source: keyof typeof SOURCE_LABEL }) {
  return <Badge variant="outline">{SOURCE_LABEL[source]}</Badge>;
}

/** Status pill for a queue row. Accent only for the one state that is the
 *  model actively working; everything else leans on contrast. */
export function ProposalStatusBadge({
  proposal,
  structuring,
}: {
  proposal: Proposal;
  structuring: StructuringInfo;
}) {
  const label = statusLabel(proposal, structuring);
  const active = proposal.status === "structuring";
  return (
    <span
      className={cn(
        "rounded-pill inline-flex items-center gap-1.5 px-2.5 py-0.5 text-[11px] font-medium whitespace-nowrap",
        proposal.status === "failed" && "bg-ink text-ink-inverse",
        proposal.status === "ready" &&
          proposal.isActionable !== false &&
          "bg-accent-subtle text-accent-800",
        proposal.status === "ready" &&
          proposal.isActionable === false &&
          "border-border text-ink-muted border",
        active && "bg-accent-subtle text-accent-800",
        proposal.status === "pending" && "text-ink-muted bg-neutral-100",
      )}
    >
      {active && <span className="bg-accent h-1.5 w-1.5 animate-pulse rounded-full" />}
      {label}
    </span>
  );
}
