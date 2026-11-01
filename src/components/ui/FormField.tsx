"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import { describedBy, errorId, hintId, shouldShowError } from "./fieldLogic";

export interface FormFieldControlProps {
  id: string;
  "aria-invalid": true | undefined;
  "aria-describedby": string | undefined;
}

export interface FormFieldProps {
  label: React.ReactNode;
  /** Shown under the control until there is an error to show. */
  hint?: React.ReactNode;
  /** Current validation message (null/undefined = valid). Shown only after blur or `showErrorNow`. */
  error?: string | null;
  /** Set to true after a submit attempt so untouched fields show their error too. */
  showErrorNow?: boolean;
  id?: string;
  className?: string;
  /** The control, or a function that receives the id and aria props to spread onto it. */
  children: React.ReactNode | ((control: FormFieldControlProps) => React.ReactNode);
}

/**
 * Label + control + hint + error. The error appears only once the user has
 * left the field (or after a submit attempt), then outlines the control in red
 * (`aria-invalid`) and is tied to it with `aria-describedby`.
 *
 * `<FormField label="Email" error={e}>{(c) => <Input {...c} />}</FormField>`
 */
export function FormField({
  label,
  hint,
  error,
  showErrorNow,
  id,
  className,
  children,
}: FormFieldProps) {
  const autoId = React.useId();
  const fieldId = id ?? autoId;
  const [touched, setTouched] = React.useState(false);
  const showError = shouldShowError({ error, touched, showErrorNow });

  const control: FormFieldControlProps = {
    id: fieldId,
    "aria-invalid": showError ? true : undefined,
    "aria-describedby": describedBy(fieldId, { hasHint: Boolean(hint), showError }),
  };

  // Moving between parts of one control (chips, buttons) is not "leaving the field".
  const onBlur = (event: React.FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setTouched(true);
    }
  };

  return (
    <div
      onBlur={onBlur}
      className={cn(
        "flex min-w-0 flex-col gap-1.5",
        "[&_[aria-invalid=true]]:border-red [&_[aria-invalid=true]]:shadow-[0_0_0_3px_var(--color-red-soft)]",
        className,
      )}
    >
      <label htmlFor={fieldId} className="text-ink-soft text-[12.5px] font-semibold">
        {label}
      </label>
      {typeof children === "function" ? children(control) : children}
      {showError ? (
        <p
          id={errorId(fieldId)}
          role="alert"
          className="text-red text-[12px] leading-snug"
        >
          {error}
        </p>
      ) : hint ? (
        <p id={hintId(fieldId)} className="text-ink-muted text-[12px] leading-snug">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
