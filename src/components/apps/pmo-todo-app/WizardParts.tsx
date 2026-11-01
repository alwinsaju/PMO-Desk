"use client";

import type { ComponentType } from "react";
import {
  AtIcon,
  BellRingingIcon,
  CheckCircleIcon,
  CheckIcon,
  ClockIcon,
  FolderOpenIcon,
  ListChecksIcon,
  RobotIcon,
  UserCircleIcon,
  type IconProps,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  FIRST_RUN_STEPS,
  type FirstRunForm,
  type FirstRunStepId,
} from "@/lib/pmo/firstRun";
import {
  STEP_ICON,
  STEP_SHORT,
  nextSteps,
  wizardProgress,
  type NextStep,
  type SummaryRow,
} from "@/lib/pmo/wizardView";
import { SectionLabel } from "./parts";

const STEP_ICONS: Record<(typeof STEP_ICON)[FirstRunStepId], ComponentType<IconProps>> = {
  user: UserCircleIcon,
  clock: ClockIcon,
  at: AtIcon,
  folder: FolderOpenIcon,
};

/** The picture beside a step's heading: a large icon on a soft accent tile, with
 *  two quiet rings behind it. Decorative; the heading says what the step is. */
export function StepIllustration({ step }: { step: FirstRunStepId }) {
  const Icon = STEP_ICONS[STEP_ICON[step]];
  return (
    <span
      aria-hidden
      data-testid="step-illustration"
      className="bg-accent-soft text-accent-ink relative grid h-16 w-16 shrink-0 place-items-center rounded-2xl"
    >
      <span className="border-accent/30 absolute -inset-1.5 rounded-[1.25rem] border" />
      <span className="border-accent/15 absolute -inset-3 rounded-[1.5rem] border" />
      <Icon size={32} weight="duotone" />
    </span>
  );
}

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

const NEXT_ICONS: Record<NextStep["icon"], ComponentType<IconProps>> = {
  folder: FolderOpenIcon,
  robot: RobotIcon,
  review: ListChecksIcon,
  bell: BellRingingIcon,
};

/** The last screen: setup is saved, and what the app does from here. */
export function WizardDone({
  form,
  onContinue,
}: {
  form: FirstRunForm;
  onContinue: () => void;
}) {
  return (
    <div className="flex flex-col gap-6" data-testid="wizard-done">
      <header className="flex items-center gap-4">
        <span
          aria-hidden
          className="bg-success-soft text-success grid h-16 w-16 shrink-0 place-items-center rounded-2xl"
        >
          <CheckCircleIcon size={36} weight="duotone" />
        </span>
        <div className="flex flex-col gap-1.5">
          <h2 className="text-ink text-[26px] leading-tight font-semibold">
            You&apos;re set
          </h2>
          <p className="text-ink-muted text-[14px] leading-relaxed">
            PMO To-Do is ready. This is what happens next.
          </p>
        </div>
      </header>
      <ol aria-label="What happens next" className="flex flex-col gap-2.5">
        {nextSteps(form).map(({ icon, title, text }, index) => {
          const Icon = NEXT_ICONS[icon];
          return (
            <li
              key={title}
              className="border-line bg-card rounded-card flex items-start gap-3.5 border px-4 py-3"
            >
              <span
                aria-hidden
                className="bg-accent-soft text-accent-ink grid h-9 w-9 shrink-0 place-items-center rounded-full"
              >
                <Icon size={18} weight="bold" />
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-ink text-[14px] font-semibold">
                  <span className="text-ink-muted tabular-nums">{index + 1}. </span>
                  {title}
                </span>
                <span className="text-ink-muted text-[13px] leading-relaxed break-words">
                  {text}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
      <Button className="self-end" onClick={onContinue}>
        Open the Review Queue
      </Button>
    </div>
  );
}
