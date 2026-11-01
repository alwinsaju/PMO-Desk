"use client";

import * as React from "react";
import { XIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { noSpellcheck } from "@/lib/ui/noSpellcheck";
import {
  DEFAULT_SEPARATORS,
  addChips,
  addNotice,
  chipErrorLines,
  chipErrors,
  consumeDraft,
  removeChip,
  splitChips,
  type AddChipsOptions,
  type ChipSeparator,
} from "./chipInputLogic";

export interface ChipInputProps
  extends
    AddChipsOptions,
    Pick<
      React.InputHTMLAttributes<HTMLInputElement>,
      | "id"
      | "placeholder"
      | "disabled"
      | "inputMode"
      | "autoComplete"
      | "aria-label"
      | "aria-labelledby"
      | "aria-describedby"
      | "aria-invalid"
    > {
  values: string[];
  onChange: (values: string[]) => void;
  /** Return an error message, or null when the value is fine. Invalid values stay as red chips. */
  validate?: (value: string) => string | null;
  /** Characters that end a value while typing (Enter and leaving the field always do). */
  separators?: readonly ChipSeparator[];
  /** What one value is called, for "Remove email b@y.com". */
  noun?: string;
  className?: string;
}

/**
 * Multi-value input for emails, domains, skills, To/Cc. Type or paste many
 * values at once; each becomes a chip, checked by `validate`. Backspace on an
 * empty box or the x removes one.
 */
export const ChipInput = React.forwardRef<HTMLInputElement, ChipInputProps>(
  (
    {
      values,
      onChange,
      validate,
      normalize,
      max,
      caseSensitive,
      separators = DEFAULT_SEPARATORS,
      noun = "value",
      className,
      id,
      "aria-describedby": describedByProp,
      ...inputProps
    },
    forwardedRef,
  ) => {
    const [draft, setDraft] = React.useState("");
    const [notice, setNotice] = React.useState<string | null>(null);
    const inputRef = React.useRef<HTMLInputElement | null>(null);
    const autoId = React.useId();
    const baseId = id ?? autoId;
    const errors = chipErrors(values, validate);
    const errorLines = chipErrorLines(values, errors);
    const extraId = `${baseId}-chip-notes`;
    const hasNotes = errorLines.length > 0 || notice !== null;
    const describedBy = [describedByProp, hasNotes ? extraId : null]
      .filter(Boolean)
      .join(" ");

    const setRefs = (node: HTMLInputElement | null) => {
      inputRef.current = node;
      if (typeof forwardedRef === "function") forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
    };

    const commit = (tokens: string[]) => {
      if (tokens.length === 0) return;
      const result = addChips(values, tokens, { normalize, max, caseSensitive });
      setNotice(addNotice(result, max));
      if (result.added.length > 0) onChange(result.values);
    };

    const remove = (index: number) => {
      setNotice(null);
      onChange(removeChip(values, index));
      inputRef.current?.focus();
    };

    const onTextChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      const { tokens, rest } = consumeDraft(event.target.value, separators);
      commit(tokens);
      setDraft(rest);
    };

    const flushDraft = () => {
      commit(splitChips(draft, separators));
      setDraft("");
    };

    const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter" && draft.trim()) {
        event.preventDefault();
        flushDraft();
      } else if (event.key === "Backspace" && draft === "" && values.length > 0) {
        remove(values.length - 1);
      }
    };

    const onPaste = (event: React.ClipboardEvent<HTMLInputElement>) => {
      const tokens = splitChips(event.clipboardData.getData("text"), separators);
      if (tokens.length === 0) return;
      event.preventDefault();
      commit([...splitChips(draft, separators), ...tokens]);
      setDraft("");
    };

    return (
      <div className={cn("flex flex-col gap-1.5", className)}>
        <div
          onClick={() => inputRef.current?.focus()}
          className={cn(
            "rounded-control border-line-strong bg-field flex min-h-9 w-full cursor-text flex-wrap items-center gap-1.5 border px-2 py-1",
            "transition-[border-color,box-shadow] duration-[250ms]",
            "focus-within:border-focus focus-within:shadow-field-focus",
            "has-[input[aria-invalid=true]]:border-red",
            inputProps.disabled && "pointer-events-none opacity-40",
          )}
        >
          {values.map((value, index) => {
            const error = errors[index];
            return (
              <span
                key={`${value}-${index}`}
                title={error ?? undefined}
                data-invalid={error ? "true" : undefined}
                className={cn(
                  "rounded-chip inline-flex h-6 max-w-full items-center gap-1 pr-1 pl-2.5 text-[12.5px] font-medium",
                  error ? "bg-red-soft text-red" : "bg-chip-strong text-ink",
                )}
              >
                <span className="truncate">{value}</span>
                {error && <span className="sr-only">, {error}</span>}
                <button
                  type="button"
                  aria-label={`Remove ${noun} ${value}`}
                  onClick={() => remove(index)}
                  className="hover:bg-chip-strong focus-visible:ring-focus -mr-1 grid h-6 w-6 shrink-0 place-items-center rounded-full focus-visible:ring-2 focus-visible:outline-none"
                >
                  <XIcon size={10} weight="bold" aria-hidden />
                </button>
              </span>
            );
          })}
          <input
            {...noSpellcheck}
            {...inputProps}
            ref={setRefs}
            id={baseId}
            type="text"
            value={draft}
            onChange={onTextChange}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            onBlur={flushDraft}
            aria-describedby={describedBy || undefined}
            className="text-ink placeholder:text-ink-muted h-6 min-w-[9ch] flex-1 bg-transparent px-1 text-sm outline-none"
          />
        </div>
        {hasNotes && (
          <div id={extraId} className="flex flex-col gap-0.5 text-[12px] leading-snug">
            {errorLines.map((line) => (
              <p key={line} className="text-red">
                {line}
              </p>
            ))}
            {notice && (
              <p role="status" className="text-ink-muted">
                {notice}
              </p>
            )}
          </div>
        )}
      </div>
    );
  },
);
ChipInput.displayName = "ChipInput";
