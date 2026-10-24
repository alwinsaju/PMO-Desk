"use client";

import {
  useCallback,
  useLayoutEffect,
  useRef,
  type ComponentProps,
  type ReactNode,
} from "react";
import { Badge, type BadgeProps } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { Proposal, StructuringInfo } from "@/lib/pmo/types";
import { SOURCE_LABEL, statusLabel } from "./queueView";

/** Thin themed scrollbar for native scroll regions (same thumb colour as the
 *  ScrollArea primitive, so the two look alike). */
export const THIN_SCROLLBAR =
  "[scrollbar-width:thin] [scrollbar-color:var(--color-neutral-300)_transparent]";

/** Last scroll position per scroll region, so leaving a tab and coming back
 *  (which unmounts the tab's content) does not throw the reader to the top. */
const scrollMemory = new Map<string, number>();

/**
 * THE scrolling region of a window tab or a dialog body. A plain overflow
 * container, not the Radix ScrollArea: that one wraps its content in a
 * `display: table` element that grows to the widest child (so `truncate` and
 * `min-w-0` never take effect and the right-hand edge is clipped, which is how
 * the Approve button got cut off), and its viewport needs a definite height
 * (so inside a dialog that only has a `max-height`, it never scrolled at all).
 * Use it as a flex child (`min-h-0 flex-1`) of a column with a bounded height.
 */
export function ScrollBody({
  className,
  memoryKey,
  onScroll,
  ...props
}: ComponentProps<"div"> & {
  /** Remember and restore the scroll position under this key. */
  memoryKey?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (memoryKey && ref.current)
      ref.current.scrollTop = scrollMemory.get(memoryKey) ?? 0;
  }, [memoryKey]);
  const remember = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      if (memoryKey) scrollMemory.set(memoryKey, event.currentTarget.scrollTop);
      onScroll?.(event);
    },
    [memoryKey, onScroll],
  );
  return (
    <div
      ref={ref}
      onScroll={remember}
      className={cn(
        "min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain",
        THIN_SCROLLBAR,
        className,
      )}
      {...props}
    />
  );
}

export type ChipTone = "neutral" | "accent" | "strong" | "outline";

const CHIP_TONE: Record<ChipTone, string> = {
  neutral: "",
  outline: "",
  // The accent tint is a light mint; on the dark theme it reads as a white
  // pill, so it gets the deep end of the same ramp there.
  accent: "dark:bg-accent-900 dark:text-accent-200",
  strong: "bg-ink text-ink-inverse",
};

/** A small status pill. At most one `strong` chip per row: it is the thing that
 *  must be seen first; everything else stays neutral or outlined. */
export function Chip({
  tone = "neutral",
  className,
  ...props
}: Omit<BadgeProps, "variant"> & { tone?: ChipTone }) {
  return (
    <Badge
      variant={tone === "accent" ? "accent" : tone === "outline" ? "outline" : "neutral"}
      className={cn("whitespace-nowrap", CHIP_TONE[tone], className)}
      {...props}
    />
  );
}

/** Lists stop growing at this width and centre, so a maximised window does not
 *  stretch a row across the whole screen. */
export const CONTENT_WIDTH = "mx-auto w-full max-w-4xl";

/** A row of pills that scrolls sideways in a narrow window: it fades out at the
 *  right edge so a half-cut pill reads as "more this way", not as a glitch. */
export const PILL_STRIP =
  "flex gap-1 overflow-x-auto [scrollbar-width:none] [mask-image:linear-gradient(to_right,black_calc(100%-1.5rem),transparent)] @lg:[mask-image:none]";

/** A centred "nothing here" / loading message that fills a tab or panel. */
export function PanelMessage({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-full min-h-40 items-center justify-center p-6 text-center",
        className,
      )}
    >
      <p className="text-ink-faint max-w-sm text-[13px] leading-relaxed">{children}</p>
    </div>
  );
}

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

export function TextArea({ className, ...props }: ComponentProps<"textarea">) {
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

/** Status pill for a queue row. Accent only for the states where the model is
 *  working or has something ready; "failed" is outlined in full-strength ink. */
export function ProposalStatusBadge({
  proposal,
  structuring,
}: {
  proposal: Proposal;
  structuring: StructuringInfo;
}) {
  const label = statusLabel(proposal, structuring);
  const active = proposal.status === "structuring" && !structuring.paused;
  const tone: ChipTone =
    proposal.status === "failed"
      ? "outline"
      : proposal.status === "ready" && proposal.isActionable !== false
        ? "accent"
        : active
          ? "accent"
          : proposal.status === "ready"
            ? "outline"
            : "neutral";
  return (
    <Chip
      tone={tone}
      className={cn(
        "gap-1.5",
        proposal.status === "failed" && "border-ink text-ink font-semibold",
      )}
    >
      {active && <span className="bg-accent h-1.5 w-1.5 animate-pulse rounded-full" />}
      {label}
    </Chip>
  );
}
