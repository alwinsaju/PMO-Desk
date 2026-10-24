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

// Severity takes the status tones (red / amber / info), each with its own
// glyph, and every chip also spells the word out, so nothing depends on
// color perception.
const CHIP_CLASS: Record<string, string> = {
  error: "bg-red-soft text-red",
  warning: "bg-amber-soft text-amber",
  info: "bg-info-soft text-info",
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
        "inline-flex items-center gap-1 text-[11.5px] leading-normal font-semibold whitespace-nowrap",
        !bare && "rounded-chip px-2.5 py-0.5",
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
        "rounded-control border-line-strong bg-field text-ink h-9 w-full border px-3 text-[13px]",
        "transition-[border-color,box-shadow] duration-[250ms]",
        "focus-visible:border-focus focus-visible:shadow-field-focus focus-visible:outline-none",
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
        className="text-ink-muted pointer-events-none absolute top-1/2 left-3 -translate-y-1/2"
      />
      <Input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="pl-9 text-[13px]"
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
        "rounded-chip inline-flex h-8 items-center gap-1.5 px-3.5 text-[13px] font-semibold whitespace-nowrap transition-[color,background-color] duration-200",
        "focus-visible:ring-focus focus-visible:ring-2 focus-visible:outline-none",
        active
          ? "bg-accent-soft text-accent-ink"
          : "bg-chip text-ink-muted hover:bg-chip-strong hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

/** Quiet notice used for loading / unavailable / empty gate data. */
export function GateNote({ children }: { children: ReactNode }) {
  return <p className="text-ink-muted p-3.5 text-[13px]">{children}</p>;
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h4 className="text-ink-muted text-[11px] font-bold tracking-[0.08em] uppercase">
      {children}
    </h4>
  );
}
