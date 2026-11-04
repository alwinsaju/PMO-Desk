"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { canSuggest, type SuggestSpec } from "@/lib/registers/registerSuggest";
import type { FieldValue } from "@/lib/registers/types";
import { requestSuggestion } from "./suggestApi";

type Values = Record<string, FieldValue>;

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "done"; message: string; undo?: string }
  | { kind: "error"; reason: string };

const text = (value: FieldValue | undefined) => (typeof value === "string" ? value : "");

/** A small "Suggest" button for one field of a record form (an impact note on a change request, a
 *  Category on a lesson). It asks the local model through the server, puts the answer into the
 *  field for the person to edit, and NEVER saves: Save stays the person's own click. The model is
 *  optional: if it is down, a plain line says so and the form works as before. */
export function SuggestControl({
  tool,
  spec,
  values,
  onApply,
  disabled,
}: {
  tool: string;
  spec: SuggestSpec;
  values: Values;
  /** Put the suggestion (or an undone earlier value) into the field. */
  onApply: (value: string) => void;
  disabled?: boolean;
}) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const latest = useRef(values);
  const running = useRef<AbortController | null>(null);

  useEffect(() => {
    latest.current = values;
  }, [values]);
  // Closing the form cancels a request that is still waiting.
  useEffect(() => () => running.current?.abort(), []);

  const loading = status.kind === "loading";
  const ready = canSuggest(tool, values);

  const ask = async () => {
    running.current?.abort();
    const controller = new AbortController();
    running.current = controller;
    const before = text(values[spec.field]);
    setStatus({ kind: "loading" });
    const reply = await requestSuggestion(tool, values, controller.signal);
    if (controller.signal.aborted) return;
    running.current = null;
    if (!reply.ok) {
      setStatus({ kind: "error", reason: reply.reason });
      return;
    }
    // The person kept typing while the model worked: their text wins.
    if (text(latest.current[spec.field]) !== before) {
      setStatus({
        kind: "error",
        reason:
          "You changed this field while waiting, so the suggestion was not used. Press Suggest to try again.",
      });
      return;
    }
    onApply(reply.value);
    const left = reply.dropped
      ? ` ${reply.dropped === 1 ? "One sentence was" : `${reply.dropped} sentences were`} left out because ${reply.dropped === 1 ? "it" : "they"} named something that is not in the change.`
      : "";
    setStatus({
      kind: "done",
      undo: before !== reply.value ? before : undefined,
      message:
        tool === "lessons"
          ? before === reply.value
            ? `The model suggests ${reply.value}, which is already chosen.`
            : `Suggested ${reply.value}. Change it if you disagree, then Save.`
          : `Suggestion added. Edit it as you like, then Save.${left}`,
    });
  };

  return (
    <div
      className="col-span-2 flex flex-wrap items-center gap-x-3 gap-y-1"
      data-testid="suggest-control"
    >
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || loading || !ready}
        aria-busy={loading}
        title={
          ready
            ? `Ask the local model to suggest ${spec.what}. Nothing is saved.`
            : "Write something in the form first."
        }
        onClick={() => void ask()}
      >
        {loading ? "Suggesting…" : "Suggest"}
      </Button>
      <span className="text-ink-muted text-[12.5px]" role="status" aria-live="polite">
        {status.kind === "idle" &&
          `Suggest ${spec.what} with the local model. You edit it; nothing is saved.`}
        {loading && "Asking the local model. This can take a minute if it was asleep."}
        {status.kind === "done" && (
          <>
            {status.message}
            {status.undo !== undefined && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="ml-1 h-6 px-2"
                onClick={() => {
                  onApply(status.undo ?? "");
                  setStatus({ kind: "idle" });
                }}
              >
                Undo
              </Button>
            )}
          </>
        )}
      </span>
      {status.kind === "error" && (
        <span role="alert" className="text-red text-[12.5px]" data-testid="suggest-error">
          {status.reason}
        </span>
      )}
    </div>
  );
}
