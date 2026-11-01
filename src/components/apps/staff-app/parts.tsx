"use client";

import type { ReactNode } from "react";
import {
  CaretDownIcon,
  CaretUpDownIcon,
  CaretUpIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import {
  Avatar,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import { initials, photoUrl, type SortKey, type SortState } from "@/lib/staff/employees";
import type { Hue, Tone } from "@/lib/staff/rosterCatalog";
import type { Employee } from "@/lib/staff/types";

/** Tone -> colors, all from the theme tokens so dark, light and Deloitte mode follow. */
export const TONE_PILL: Record<Tone, string> = {
  accent: "bg-accent-soft text-accent-ink",
  info: "bg-info-soft text-info",
  amber: "bg-amber-soft text-amber",
  red: "bg-red-soft text-red",
  success: "bg-success-soft text-success",
  neutral: "bg-chip text-ink-soft",
};

export const TONE_DOT: Record<Tone, string> = {
  accent: "bg-accent",
  info: "bg-info",
  amber: "bg-amber",
  red: "bg-red",
  success: "bg-success-dot",
  neutral: "bg-ink-faint",
};

/** The shift roster's colours (src/styles/roster-colors.css): a filled pill and a dot. */
export const hueClass = (hue: Hue): string => `rh-${hue}`;
export const hueDot = (hue: Hue): string => `rd-${hue}`;

export function TonePill({
  tone,
  children,
  className,
}: {
  tone: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "rounded-chip inline-flex h-6 items-center gap-1.5 px-2.5 text-[12px] leading-none font-semibold whitespace-nowrap",
        TONE_PILL[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Onshore / Offshore as a chip with a dot, so it reads at a glance down a column. */
export function LocationChip({ location }: { location: string }) {
  if (!location) return DASH;
  const onshore = location === "Onshore";
  return (
    <TonePill tone={onshore ? "accent" : "info"}>
      <span
        aria-hidden
        className={cn("h-1.5 w-1.5 rounded-full", onshore ? "bg-accent" : "bg-info")}
      />
      {location}
    </TonePill>
  );
}

export function LevelChip({ level }: { level: string }) {
  if (!level) return DASH;
  return (
    <span
      title={level}
      className="bg-chip text-ink-soft rounded-chip inline-flex h-6 max-w-full items-center px-2.5 text-[12px] leading-none font-semibold"
    >
      <span className="truncate">{level}</span>
    </span>
  );
}

export const TH_CLASS =
  "px-3 py-2 text-left text-[11.5px] font-bold tracking-[0.06em] uppercase";

/** A column header that sorts its table when clicked and says which way it is sorted. */
export function SortableTh({
  label,
  sortKey,
  sort,
  onSort,
  className,
  children,
}: {
  label: string;
  sortKey: SortKey;
  sort: SortState;
  onSort: (key: SortKey) => void;
  className?: string;
  /** Anything that sits on the header's edge, such as a resize handle. */
  children?: ReactNode;
}) {
  const active = sort.key === sortKey;
  const Caret = !active
    ? CaretUpDownIcon
    : sort.dir === "asc"
      ? CaretUpIcon
      : CaretDownIcon;
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
      className={cn(TH_CLASS, "relative", className)}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        title={`Sort by ${label.toLowerCase()}`}
        className={cn(
          "focus-ring rounded-control hover:text-ink -ml-1 inline-flex max-w-full items-center gap-1 px-1 py-0.5 tracking-[inherit] uppercase",
          active && "text-ink",
        )}
      >
        <span className="truncate">{label}</span>
        <Caret
          size={11}
          weight="bold"
          aria-hidden
          className={cn("shrink-0", active ? "text-accent-ink" : "opacity-40")}
        />
      </button>
      {children}
    </th>
  );
}

const AVATAR_SIZE = {
  sm: "h-7 w-7 text-[11px]",
  md: "h-9 w-9 text-[13px]",
  lg: "h-12 w-12 text-base",
  xl: "h-[76px] w-[76px] text-[26px]",
} as const;

export function EmployeeAvatar({
  employee,
  size = "md",
  className,
}: {
  employee: Pick<
    Employee,
    "id" | "firstName" | "lastName" | "deloitteEmail" | "photoVersion"
  >;
  size?: keyof typeof AVATAR_SIZE;
  className?: string;
}) {
  return (
    <Avatar
      src={photoUrl(employee)}
      alt=""
      fallback={initials(employee)}
      className={cn(AVATAR_SIZE[size], className)}
    />
  );
}

/** A person who may not be in the directory yet: the profile picture when there is
 *  a profile, otherwise the initials of the name. */
export function PersonAvatar({
  employee,
  name,
  size = "sm",
  className,
}: {
  employee: Pick<
    Employee,
    "id" | "firstName" | "lastName" | "deloitteEmail" | "photoVersion"
  > | null;
  name: string;
  size?: keyof typeof AVATAR_SIZE;
  className?: string;
}) {
  if (employee)
    return <EmployeeAvatar employee={employee} size={size} className={className} />;
  const letters = name
    .split(/[\s,]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  return (
    <Avatar
      alt=""
      fallback={letters || "?"}
      className={cn(AVATAR_SIZE[size], className)}
    />
  );
}

/** Native select in the same look as `Input`. */
export const SELECT_CLASS = cn(
  "rounded-control border-line-strong bg-field text-ink h-9 w-full border px-3 text-sm",
  "transition-[border-color,box-shadow] duration-[250ms]",
  "focus-visible:border-focus focus-visible:shadow-field-focus focus-visible:outline-none",
  "disabled:pointer-events-none disabled:opacity-40",
);

export function Field({
  label,
  htmlFor,
  error,
  hint,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <label
        htmlFor={htmlFor}
        className="text-ink-soft flex items-center gap-1.5 text-[12.5px] font-semibold"
      >
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-red text-[12px] leading-snug">
          {error}
        </p>
      ) : hint ? (
        <p className="text-ink-muted text-[12px] leading-snug">{hint}</p>
      ) : null}
    </div>
  );
}

/** A filter button that opens a one-of-many list; "" means no filter. */
export function FilterMenu({
  label,
  value,
  options,
  onChange,
}: {
  /** Plural noun, e.g. "offerings": the button reads "All offerings". */
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label={`Filter by ${label}`}
          className={cn(value && "bg-accent-soft text-accent-ink")}
        >
          <span className="max-w-[140px] truncate">{value || `All ${label}`}</span>
          <CaretDownIcon size={12} weight="bold" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[320px] overflow-y-auto">
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          <DropdownMenuRadioItem value="">All {label}</DropdownMenuRadioItem>
          {options.map((option) => (
            <DropdownMenuRadioItem key={option} value={option}>
              {option}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  busy,
  error,
  onConfirm,
  onOpenChange,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
        {error && (
          <p role="alert" className="text-red mt-3 flex items-start gap-2 text-[13px]">
            <WarningCircleIcon size={16} className="mt-px shrink-0" />
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={onConfirm}
            className="text-red"
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  actions,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-[240px] flex-col items-center justify-center gap-3 px-8 py-10 text-center">
      <div className="bg-accent-soft text-accent-ink grid h-14 w-14 place-items-center rounded-full">
        {icon}
      </div>
      <h3 className="text-ink text-[17px] font-bold">{title}</h3>
      {children && (
        <p className="text-ink-muted max-w-[420px] text-[13.5px] leading-relaxed">
          {children}
        </p>
      )}
      {actions && (
        <div className="mt-1 flex flex-wrap justify-center gap-2">{actions}</div>
      )}
    </div>
  );
}

/** Shown in place of an empty value. */
export const DASH = <span className="text-ink-faint">—</span>;
