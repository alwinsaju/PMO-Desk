"use client";

import {
  useCallback,
  useLayoutEffect,
  useRef,
  type ComponentProps,
  type ReactNode,
} from "react";
import { Badge, type BadgeProps, type BadgeVariant } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { Proposal, StructuringInfo } from "@/lib/pmo/types";
import { SOURCE_LABEL, statusLabel } from "./queueView";

/** Thin themed scrollbar for native scroll regions (the `scroll-thin` utility,
 *  tinted from the line tokens so it follows the theme and brand). */
export const THIN_SCROLLBAR = "scroll-thin";

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

export type ChipTone =
  | "neutral"
  | "accent"
  | "strong"
  | "outline"
  | "warning"
  | "success"
  | "info"
  | "danger";

/** `strong` is the view-logic's "must be seen first" tone (an overdue to-do, a
 *  declined sign-off); it is drawn in the danger colours. */
const CHIP_VARIANT: Record<ChipTone, BadgeVariant> = {
  neutral: "neutral",
  accent: "accent",
  strong: "danger",
  outline: "outline",
  warning: "warning",
  success: "success",
  info: "info",
  danger: "danger",
};

/** A small status pill (the Badge primitive, so it follows the theme and the
 *  brand). Keep to one loud chip (danger / warning) per row. */
export function Chip({
  tone = "neutral",
  className,
  ...props
}: Omit<BadgeProps, "variant"> & { tone?: ChipTone }) {
  return (
    <Badge
      variant={CHIP_VARIANT[tone]}
      className={cn("whitespace-nowrap", className)}
      {...props}
    />
  );
}

/** Lists stop growing at this width and centre, so a maximised window does not
 *  stretch a row across the whole screen. */
export const CONTENT_WIDTH = "mx-auto w-full max-w-5xl";
/** The list gutter: 24px in a normal window, 16px in a narrow one. */
export const GUTTER_X = "px-4 @md:px-6";

/** A row of pills that scrolls sideways in a narrow window: it fades out at the
 *  right edge so a half-cut pill reads as "more this way", not as a glitch. */
export const PILL_STRIP =
  "flex gap-1.5 overflow-x-auto [scrollbar-width:none] [mask-image:linear-gradient(to_right,black_calc(100%-1.5rem),transparent)] @lg:[mask-image:none]";

/** The list-row surface shared by the queue, to-do and filtered rows: a card
 *  with the cursor spotlight on hover (no lift or scale) and the standard
 *  entrance. */
export const ROW_CARD =
  "spot animate-rise rounded-card border-line bg-card min-w-0 border";

/** The bar that sticks to the top of a scrolling list. The window body is glass,
 *  which would let the rows show through; this lays the same tint over a solid
 *  surface so it looks like the window but hides what scrolls beneath it. */
export const STICKY_BAR =
  "border-line sticky top-0 z-10 border-b bg-surface bg-[image:linear-gradient(var(--color-win),var(--color-win))]";

/** A pane that holds an original message (or any quoted text). */
export const MESSAGE_PANE = "border-line bg-card rounded-card flex flex-col border p-4";

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
      <p className="text-ink-muted max-w-sm text-[13.5px] leading-relaxed">{children}</p>
    </div>
  );
}

/** The small caps heading above a group of rows or fields. */
export function SectionLabel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <h3
      className={cn(
        "text-ink-muted text-[11px] font-bold tracking-[0.08em] uppercase",
        className,
      )}
    >
      {children}
    </h3>
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
    <label className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <span className="text-ink-muted text-[11px] font-bold tracking-[0.08em] uppercase">
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
        "rounded-control border-line-strong bg-field text-ink min-h-20 w-full resize-y border px-3.5 py-2.5 text-sm leading-snug",
        "placeholder:text-ink-muted",
        "transition-[border-color,box-shadow] duration-[250ms]",
        "focus-visible:border-focus focus-visible:shadow-field-focus focus-visible:outline-none",
        "aria-invalid:border-red disabled:pointer-events-none disabled:opacity-40",
        className,
      )}
      {...props}
    />
  );
}

/** Native `<select>` in the kit's control language: type-ahead, arrow keys and
 *  the OS picker all keep working, which a custom listbox would lose. */
export function NativeSelect({ className, ...props }: ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "rounded-control border-line-strong bg-field text-ink h-9 border px-3 text-[13px]",
        "transition-[border-color,box-shadow] duration-[250ms]",
        "focus-visible:border-focus focus-visible:shadow-field-focus focus-visible:outline-none",
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
    <div className="flex flex-wrap gap-2" role="radiogroup">
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
              "rounded-chip transition-ui h-9 px-4 text-[13.5px] font-semibold whitespace-nowrap",
              "focus-visible:ring-focus focus-visible:ring-2 focus-visible:outline-none disabled:opacity-40",
              active
                ? "bg-ink text-ink-inverse dark:bg-accent dark:text-accent-contrast"
                : "text-ink hover:bg-chip shadow-[inset_0_0_0_1px_var(--color-line-strong)]",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** A toggle pill for a filter or a weekday (selected = the accent tint), with
 *  an optional count. */
export function FilterPill({
  active,
  onClick,
  count,
  disabled,
  children,
}: {
  active: boolean;
  onClick: () => void;
  count?: number;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "rounded-chip inline-flex h-8 shrink-0 items-center gap-2 px-3.5 text-[13px] font-semibold whitespace-nowrap transition-[color,background-color] duration-200",
        "focus-visible:ring-focus focus-visible:ring-2 focus-visible:outline-none disabled:opacity-40",
        active
          ? "bg-accent-soft text-accent-ink"
          : "bg-chip text-ink-muted hover:bg-chip-strong hover:text-ink",
      )}
    >
      {children}
      {count !== undefined && (
        <span
          className={cn(
            "tabular-nums",
            active ? "text-accent-ink opacity-80" : "text-ink-muted",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

/** A small one-tap suggestion (a due date, a name) next to a field. */
export function QuickChip({
  className,
  type = "button",
  ...props
}: ComponentProps<"button">) {
  return (
    <button
      type={type}
      className={cn(
        "rounded-chip bg-chip text-ink-muted hover:bg-chip-strong hover:text-ink h-7 px-3 text-[12px] font-semibold transition-colors duration-200",
        "focus-visible:ring-focus focus-visible:ring-2 focus-visible:outline-none disabled:opacity-40",
        className,
      )}
      {...props}
    />
  );
}

const NOTE_TONE = {
  neutral: "bg-chip text-ink-soft",
  accent: "bg-accent-soft text-ink",
  warning: "bg-amber-soft text-ink",
  danger: "bg-red-soft text-red",
} as const;

/** An inline note or notice inside a dialog or card (not a toast). */
export function Note({
  tone = "neutral",
  className,
  ...props
}: ComponentProps<"div"> & { tone?: keyof typeof NOTE_TONE }) {
  return (
    <div
      className={cn(
        "rounded-control px-3.5 py-2.5 text-[13px] leading-relaxed break-words",
        NOTE_TONE[tone],
        className,
      )}
      {...props}
    />
  );
}

/** A failed save or request, in words, in the danger colour. */
export function ErrorLine({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      role="alert"
      className={cn("text-red text-[13px] font-semibold", className)}
      {...props}
    />
  );
}

/** The message under a form field that failed validation. */
export function FieldError({ message }: { message: string | undefined }) {
  if (!message) return null;
  return (
    <span role="alert" className="text-red text-[12px] font-semibold">
      {message}
    </span>
  );
}

const SOURCE_TONE: Record<keyof typeof SOURCE_LABEL, string> = {
  outlook: "bg-info-soft text-info",
  // Teams has no token of its own: violet in the default look, a neutral
  // ink-tinted chip in Deloitte mode (the brand has no violet).
  teams:
    "bg-[rgba(110,86,200,0.15)] text-[#6249b8] dark:text-[#b7a5ff] brand-dl:bg-chip-strong brand-dl:text-ink",
  manual: "bg-chip text-ink-soft",
};

/** The fixed-width source chip at the start of a row, so rows line up. */
export function SourceBadge({
  source,
  className,
}: {
  source: keyof typeof SOURCE_LABEL;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "rounded-control inline-flex h-6 w-[72px] shrink-0 items-center justify-center text-[11.5px] font-bold tracking-[0.02em]",
        SOURCE_TONE[source],
        className,
      )}
    >
      {SOURCE_LABEL[source]}
    </span>
  );
}

/** Status pill for a queue row (fixed width, so the column lines up). The accent
 *  is for the states where the model is working or has something ready; "failed"
 *  is the danger colour. */
export function ProposalStatusBadge({
  proposal,
  structuring,
}: {
  proposal: Proposal;
  structuring: StructuringInfo;
}) {
  const label = statusLabel(proposal, structuring);
  const active = proposal.status === "structuring" && !structuring.paused;
  const variant: BadgeVariant =
    proposal.status === "failed"
      ? "danger"
      : proposal.status === "ready" && proposal.isActionable !== false
        ? "accent"
        : active
          ? "accent"
          : "neutral";
  return (
    <Badge variant={variant} dot={active} pulse={active} fixedWidth={96}>
      {label}
    </Badge>
  );
}
