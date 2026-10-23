"use client";

import type { ReactNode, SelectHTMLAttributes } from "react";
import {
  InfoIcon,
  MagnifyingGlassIcon,
  WarningIcon,
  WarningOctagonIcon,
} from "@phosphor-icons/react";
import { Input } from "@/components/ui";
import { cn } from "@/lib/cn";

// Severity is communicated with value contrast + a glyph, never a second hue
// (this product has exactly one accent — the same restraint TaskStateBadge
// and StepTracker apply): error is the inverted "ink" pill, warning a filled
// neutral, info an outline. Every chip also spells the word out, so nothing
// depends on color perception.
const CHIP_CLASS: Record<string, string> = {
  error: "bg-ink text-surface-elevated",
  warning: "bg-neutral-150 text-ink",
  info: "border border-border text-ink-muted",
};

export function SeverityChip({
  severity,
  count,
  bare = false,
  className,
}: {
  severity: string;
  /** When given, shows "<count> <severity>" instead of just the word. */
  count?: number;
  /** Glyph + word only, no pill — for use inside another control. */
  bare?: boolean;
  className?: string;
}) {
  const Glyph =
    severity === "error"
      ? WarningOctagonIcon
      : severity === "warning"
        ? WarningIcon
        : InfoIcon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[11px] leading-normal font-medium whitespace-nowrap",
        !bare && "rounded-pill px-2 py-0.5",
        !bare && (CHIP_CLASS[severity] ?? CHIP_CLASS.info),
        className,
      )}
    >
      <Glyph size={11} weight="bold" aria-hidden />
      {count === undefined ? severity : `${count} ${severity}`}
    </span>
  );
}

/** Native `<select>` dressed in the UI kit's control language — chosen over
 *  a custom listbox so a 20-row form stays fully keyboard- and
 *  touch-friendly (type-ahead, arrow keys, OS picker on mobile). */
export function NativeSelect({
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <select
      className={cn(
        "rounded-control border-border bg-surface-elevated text-ink h-8 w-full border px-2 text-[12px]",
        "ease-standard transition-[border-color,box-shadow] duration-150",
        "focus-visible:border-accent focus-visible:ring-accent/30 focus-visible:ring-2 focus-visible:outline-none",
        "disabled:pointer-events-none disabled:opacity-40",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

/** Search box with a leading glass icon. */
export function SearchField({
  value,
  onChange,
  placeholder,
  label,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
  className?: string;
}) {
  return (
    <div className={cn("relative min-w-0", className)}>
      <MagnifyingGlassIcon
        size={13}
        weight="bold"
        aria-hidden
        className="text-ink-faint pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2"
      />
      <Input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="h-8 pl-8 text-[12px]"
      />
    </div>
  );
}

/** A small toggle chip used for filters (selected = the accent state). */
export function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-pill ease-standard inline-flex h-7 items-center gap-1 px-2.5 text-[12px] font-medium whitespace-nowrap transition-colors duration-100",
        "focus-visible:ring-accent focus-visible:ring-offset-surface focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none",
        active
          ? "bg-accent-subtle text-accent-800"
          : "text-ink-muted border-border border hover:bg-neutral-100",
      )}
    >
      {children}
    </button>
  );
}

/** Quiet notice used for loading / unavailable / empty gate data. */
export function GateNote({ children }: { children: ReactNode }) {
  return <p className="text-ink-faint p-3 text-[12px]">{children}</p>;
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h4 className="text-ink-muted text-[11px] font-semibold tracking-wide uppercase">
      {children}
    </h4>
  );
}
