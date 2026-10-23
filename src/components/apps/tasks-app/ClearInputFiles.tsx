"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { cleanupInputs, getInputs } from "./api";
import {
  canClearInputs,
  cleanupResultText,
  clearButtonLabel,
  clearConfirmText,
  keepsSomeInputs,
} from "./startForm";
import { hasStartForm } from "./taskPresenter";
import type { Cleanable, Task } from "./types";

interface ClearInputFilesProps {
  task: Task;
  /** Called after a cleanup settles so the caller can refetch tasks. */
  onSettled: () => void;
}

/**
 * "Clear input files (N files, X MB)" for the task detail view: deletes the
 * files uploaded for a task that sits idle. Offered only while the task is
 * resting and the backend reports something cleanable; the delete is behind
 * an inline confirmation. Reads `cleanable` from GET /inputs and posts to
 * /cleanup; an older backend without either simply hides the control.
 * Render it with `key={task.id}` so its state belongs to one task.
 */
export function ClearInputFiles({ task, onSettled }: ClearInputFilesProps) {
  const [cleanable, setCleanable] = useState<Cleanable | null>(null);
  const [supported, setSupported] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const seq = useRef(0);

  const taskId = task.id;
  const resting = task.state === "resting";
  const onInputsPlatform = hasStartForm(task);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    const reply = await getInputs(taskId);
    if (seq.current !== mine) return;
    setCleanable(reply.ok && reply.cleanable ? reply.cleanable : null);
  }, [taskId]);

  // Re-read whenever the task settles back to resting (a finished run has
  // just cleaned itself); anything else hides the control and its last result.
  useEffect(() => {
    if (onInputsPlatform && resting) {
      void load();
    } else {
      seq.current += 1;
      setCleanable(null);
      setConfirming(false);
      setResult(null);
    }
  }, [onInputsPlatform, resting, load]);

  const clear = async () => {
    setBusy(true);
    setResult(null);
    const reply = await cleanupInputs(taskId);
    setBusy(false);
    setConfirming(false);
    if (reply.notFound) {
      setSupported(false);
      return;
    }
    if (reply.ok) {
      setResult({ ok: true, text: cleanupResultText(reply) });
    } else {
      setResult({
        ok: false,
        text: reply.reason?.trim() || "The files couldn't be removed.",
      });
    }
    await load();
    onSettled();
  };

  if (!supported) return null;
  const offer = canClearInputs(task, cleanable);
  if (!offer && !result) return null;

  return (
    <div
      className="border-border/60 mt-4 flex flex-col gap-2 border-t pt-3"
      role="group"
      aria-label="Input files"
    >
      {offer && cleanable && !confirming && (
        <div>
          <Button
            size="sm"
            variant="ghost"
            className="text-ink-muted -ml-3"
            onClick={() => setConfirming(true)}
          >
            {clearButtonLabel(cleanable)}
          </Button>
        </div>
      )}

      {offer && cleanable && confirming && (
        <div className="border-border flex flex-col gap-2 rounded-lg border bg-neutral-50 p-3">
          <p className="text-ink text-[12px]">
            {clearConfirmText(cleanable, keepsSomeInputs(task))}
          </p>
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={busy} onClick={clear}>
              {busy ? "Deleting…" : "Delete files"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {result && (
        <p className="text-ink-muted text-[12px]" role={result.ok ? "status" : "alert"}>
          {result.text}
        </p>
      )}
    </div>
  );
}
