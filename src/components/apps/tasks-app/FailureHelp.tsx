"use client";

import { useState } from "react";
import { CheckIcon, CopyIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui";
import { explainFailure } from "@/lib/tasks/failureExplainer";
import { plainStepName } from "@/lib/tasks/runHistory";
import type { Task } from "./types";

/** A failed run in plain words: what likely happened, what to try, and the technical line to copy for support. */
export function FailureHelp({ task }: { task: Task }) {
  const [copied, setCopied] = useState(false);
  if (task.state !== "error") return null;
  const step = task.currentStep ? plainStepName(task, task.currentStep) : null;
  const help = explainFailure(task.error, step);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(
        `${task.displayName} - ${step ?? "unknown step"}\n${task.error ?? ""}`,
      );
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section
      data-testid="failure-help"
      className="rounded-card bg-red-soft mt-4 flex flex-col gap-2 px-4 py-3.5"
      aria-label="What went wrong"
    >
      <h4 className="text-red text-[13.5px] font-bold">{help.title}</h4>
      <ol className="text-ink flex list-decimal flex-col gap-1 pl-5 text-[13px]">
        {help.steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      <div className="flex items-center justify-between gap-3">
        <p
          className="text-ink-muted min-w-0 truncate font-mono text-[11.5px]"
          title={help.technical}
        >
          {help.technical}
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0"
          onClick={() => void copy()}
        >
          {copied ? <CheckIcon size={13} weight="bold" /> : <CopyIcon size={13} />}
          {copied ? "Copied" : "Copy details"}
        </Button>
      </div>
    </section>
  );
}
