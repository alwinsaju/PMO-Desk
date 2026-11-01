"use client";

import { useState, type ReactNode } from "react";
import { TrayIcon } from "@phosphor-icons/react";
import {
  Button,
  ChipInput,
  DueChip,
  EmptyState,
  ErrorState,
  FormField,
  Input,
  PriorityStripe,
  Skeleton,
  SkeletonList,
  SkeletonText,
  SourceBadge,
  StatusChip,
  ValidationSummary,
  addedHeadline,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import { noSpellcheck } from "@/lib/ui/noSpellcheck";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const validateEmail = (value: string) =>
  EMAIL.test(value) ? null : "Not an email address";

function ExampleSection({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn("spot rounded-card bg-card border-line border p-5", className)}
    >
      <h3 className="text-ink-muted mb-3 text-[11.5px] font-bold tracking-[0.08em] uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

/** Shared empty / error / loading states, forms and chips (see docs/ui-guidelines.md). */
export function SharedComponentExamples() {
  const [emails, setEmails] = useState<string[]>([
    "alex.morgan@deloitte.com",
    "not-an-email",
  ]);
  const [name, setName] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const today = new Date();
  const day = (offset: number) => {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
    return d;
  };

  return (
    <>
      <ExampleSection title="Empty, error and loading states">
        <div className="grid gap-4 md:grid-cols-2">
          <EmptyState
            icon={<TrayIcon size={22} />}
            headline="No risks logged yet"
            description="Log a risk, assumption, issue or dependency to start the RAID log."
            action={<Button size="sm">Add item</Button>}
          />
          <ErrorState
            title="Couldn't reach the Tasks engine"
            cause="The engine is still starting."
            nextStep="Wait a few seconds, then retry."
            detail="ECONNREFUSED 127.0.0.1:8000"
            where="Tasks"
            onRetry={() => undefined}
          />
          <SkeletonList rows={3} />
          <div className="flex flex-col gap-3">
            <Skeleton variant="block" />
            <SkeletonText lines={3} />
          </div>
        </div>
      </ExampleSection>

      <ExampleSection title="Forms and validation">
        <div className="flex max-w-md flex-col gap-4">
          <FormField
            label="Name"
            hint="As it appears on the roster."
            error={name.trim() ? null : "Enter a name."}
            showErrorNow={submitted}
          >
            {(control) => (
              <Input
                {...noSpellcheck}
                {...control}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            )}
          </FormField>
          <FormField
            label="To"
            hint="Paste a list; separate with commas, semicolons or spaces."
          >
            {(control) => (
              <ChipInput
                {...control}
                values={emails}
                onChange={setEmails}
                validate={validateEmail}
                normalize={(v) => v.toLowerCase()}
                noun="email"
                placeholder="name@deloitte.com"
              />
            )}
          </FormField>
          <Button size="sm" className="self-start" onClick={() => setSubmitted(true)}>
            Submit
          </Button>
          <ValidationSummary
            headline={addedHeadline(
              emails.filter((e) => !validateEmail(e)).length,
              "person",
              "people",
            )}
            groups={[
              {
                label: "Not an email address",
                values: emails.filter((e) => validateEmail(e)),
                tone: "error",
              },
            ]}
          />
        </div>
      </ExampleSection>

      <ExampleSection title="Chips and dates">
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip status="running" />
          <StatusChip status="waiting" />
          <StatusChip status="done" />
          <StatusChip status="failed" />
          <DueChip due={day(-3)} />
          <DueChip due={day(0)} />
          <DueChip due={day(1)} />
          <DueChip due={day(20)} />
          <SourceBadge source="outlook" />
          <SourceBadge source="teams" />
          <SourceBadge source="manual" />
        </div>
        <div className="mt-3 flex flex-col gap-2">
          {["high", "medium", "low"].map((priority) => (
            <div
              key={priority}
              className="bg-chip rounded-control flex items-stretch gap-3 px-3 py-2 text-sm"
            >
              <PriorityStripe priority={priority} />
              <span className="text-ink-soft capitalize">{priority} priority row</span>
            </div>
          ))}
        </div>
      </ExampleSection>
    </>
  );
}
