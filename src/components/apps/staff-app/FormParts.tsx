"use client";

import type { ReactNode } from "react";
import { CheckCircleIcon, WarningCircleIcon } from "@phosphor-icons/react";
import {
  DialogDescription,
  DialogTitle,
  Input,
  type FormFieldControlProps,
  type InputProps,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import { noSpellcheck } from "@/lib/ui/noSpellcheck";

/** The top of a dialog that keeps its footer in view: title and a line of help. */
export function DialogHead({
  title,
  description,
}: {
  title: string;
  description: ReactNode;
}) {
  return (
    <div className="px-7 pt-7 pb-4">
      <DialogTitle>{title}</DialogTitle>
      <DialogDescription>{description}</DialogDescription>
    </div>
  );
}

/** The part of a dialog that scrolls between the heading and the sticky footer. */
export function DialogScroll({ children }: { children: ReactNode }) {
  return (
    <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-7 pb-5">{children}</div>
  );
}

/** Actions that stay at the bottom while the form scrolls. */
export function StickyFooter({
  note,
  children,
}: {
  /** A line on the left: what is wrong, or what will happen. */
  note?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="border-line bg-surface-elevated flex flex-wrap items-center gap-x-4 gap-y-2 border-t px-7 py-4">
      <div className="min-w-0 flex-1 text-[12.5px]">{note}</div>
      <div className="flex shrink-0 gap-2">{children}</div>
    </div>
  );
}

export function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="mt-6 min-w-0 first:mt-0">
      <legend className="text-ink-muted border-line mb-3 w-full border-b pb-1.5 text-[11.5px] font-bold tracking-[0.08em] uppercase">
        {title}
      </legend>
      <div className="grid gap-x-4 gap-y-3.5 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

/**
 * A text input for use inside `FormField`: spreads the field's id and aria props, and shows a
 * tick when a checked value is fine or a warning when the field is flagged.
 */
export function ValidatedInput({
  control,
  error,
  checked,
  className,
  ...props
}: Omit<InputProps, "id"> & {
  control: FormFieldControlProps;
  /** The current error for the field, if any (it is shown by the field after blur or submit). */
  error?: string | null;
  /** The field has rules: show a tick once it holds a value that passes them. */
  checked?: boolean;
}) {
  const flagged = control["aria-invalid"] === true;
  const ok = checked && !error && String(props.value ?? "").trim() !== "";
  const Icon = flagged ? WarningCircleIcon : ok ? CheckCircleIcon : null;
  return (
    <div className="relative">
      <Input
        {...noSpellcheck}
        {...control}
        {...props}
        className={cn(Icon && "pr-9", className)}
      />
      {Icon && (
        <Icon
          size={16}
          weight="fill"
          aria-hidden
          className={cn(
            "pointer-events-none absolute top-1/2 right-3 -translate-y-1/2",
            flagged ? "text-red" : "text-success",
          )}
        />
      )}
    </div>
  );
}
