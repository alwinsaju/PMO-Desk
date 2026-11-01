"use client";

import { CheckIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { FIRST_RUN_STEPS, type FirstRunStepId } from "@/lib/pmo/firstRun";
import { STEP_SHORT, wizardProgress, type SummaryRow } from "@/lib/pmo/wizardView";
import { SectionLabel } from "./parts";

/** "Step 2 of 4" over a row of numbered dots; finished steps show a tick. */
export function WizardStepper({ step }: { step: number }) {
  const { label } = wizardProgress(step, FIRST_RUN_STEPS.length);
  return (
    <div className="flex flex-col gap-3">
      <SectionLabel>{label}</SectionLabel>
      <ol aria-label="Setup progress" className="flex items-center gap-2">
        {FIRST_RUN_STEPS.map(({ id }, index) => {
          const done = index < step;
          const current = index === step;
          return (
            <li
              key={id}
              aria-current={current ? "step" : undefined}
              className={cn("flex items-center gap-2", index > 0 && "flex-1")}
            >
              {index > 0 && (
                <span
                  aria-hidden
                  className={cn(
                    "h-0.5 flex-1 rounded-full",
                    done || current ? "bg-accent" : "bg-line-strong",
                  )}
                />
              )}
              <span
                className={cn(
                  "grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11.5px] font-bold",
                  done && "bg-accent text-accent-contrast",
                  current && "bg-accent-soft text-accent-ink ring-accent ring-2",
                  !done && !current && "bg-chip text-ink-muted",
                )}
              >
                {done ? <CheckIcon size={12} weight="bold" aria-hidden /> : index + 1}
                {done && <span className="sr-only">done</span>}
              </span>
              <span
                className={cn(
                  "text-[12px] font-semibold whitespace-nowrap",
                  current ? "text-ink" : "text-ink-muted",
                )}
              >
                {STEP_SHORT[id]}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** The answers so far, shown before Finish; each row can jump back to its step. */
export function WizardSummary({
  rows,
  disabled,
  onChange,
}: {
  rows: SummaryRow[];
  disabled?: boolean;
  onChange: (step: FirstRunStepId) => void;
}) {
  return (
    <section
      aria-label="Your answers"
      className="border-line bg-card rounded-card flex flex-col gap-1 border px-4 py-3"
    >
      <SectionLabel className="pb-1">Before you finish</SectionLabel>
      <dl className="flex flex-col">
        {rows.map(({ label, value, step }) => (
          <div
            key={label}
            className="border-line flex items-baseline gap-3 border-t py-1.5 first:border-t-0"
          >
            <dt className="text-ink-muted w-32 shrink-0 text-[12.5px]">{label}</dt>
            <dd
              className={cn(
                "text-ink min-w-0 flex-1 text-[13px] font-medium break-words",
                (value === "Not set" || value === "None") && "text-ink-muted font-normal",
              )}
            >
              {value}
            </dd>
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled}
              aria-label={`Change ${label.toLowerCase()}`}
              onClick={() => onChange(step)}
            >
              Change
            </Button>
          </div>
        ))}
      </dl>
    </section>
  );
}
