"use client";

import { useCallback, useEffect, useState } from "react";
import { TrashIcon } from "@phosphor-icons/react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  IconButton,
  Switch,
} from "@/components/ui";
import type { SavedExample } from "@/lib/pmo/savedExamples";
import {
  deleteSavedExample,
  fetchSavedExamples,
  setSavedExamplesEnabled,
  type ExamplesState,
} from "./api";
import { Chip, ErrorLine, Note, ScrollBody } from "./parts";

interface SavedExamplesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** What the row shows for an example: its subject, else the start of its message. */
export function exampleLabel(example: SavedExample): string {
  const label = example.subject.trim() || example.message.replace(/\s+/g, " ").trim();
  return label.length > 90 ? `${label.slice(0, 89).trimEnd()}…` : label;
}

/**
 * The saved-examples library: the "Use my saved examples in prompts" switch
 * (off by default) and the examples saved from the review queue, each with a
 * delete. Everything is a local file; the examples are only ever put in the
 * prompt of the local model, and only while the switch is on.
 */
export function SavedExamplesDialog({ open, onOpenChange }: SavedExamplesDialogProps) {
  const [data, setData] = useState<ExamplesState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const apply = useCallback((reply: Awaited<ReturnType<typeof fetchSavedExamples>>) => {
    if (reply.ok) {
      setData({ enabled: reply.enabled, examples: reply.examples, max: reply.max });
      setError(null);
    } else setError(reply.reason);
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    fetchSavedExamples()
      .then((reply) => {
        if (!cancelled) apply(reply);
      })
      .catch(() => {
        if (!cancelled) setError("Could not reach the app server.");
      });
    return () => {
      cancelled = true;
    };
  }, [open, apply]);

  async function run(action: () => ReturnType<typeof fetchSavedExamples>) {
    setBusy(true);
    try {
      apply(await action());
    } catch {
      setError("Could not reach the app server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-full max-w-xl flex-col px-[30px] pt-7 pb-6">
        <DialogTitle className="shrink-0">Saved examples</DialogTitle>
        <DialogDescription className="shrink-0">
          Good results you saved from the Review Queue. When the switch below is on, the
          structuring prompt includes up to two of them that look like the new message, so
          the model copies your style. They stay on this computer.
        </DialogDescription>

        <label className="mt-4 flex shrink-0 items-center justify-between gap-4">
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-ink text-[13.5px] font-medium">
              Use my saved examples in prompts
            </span>
            <span className="text-ink-muted text-[12px] leading-snug">
              Off by default. A longer prompt makes the local model a little slower.
            </span>
          </span>
          <Switch
            checked={data?.enabled ?? false}
            disabled={busy || data === null}
            onCheckedChange={(enabled) =>
              void run(() => setSavedExamplesEnabled(enabled))
            }
            aria-label="Use my saved examples in prompts"
          />
        </label>

        {error && <ErrorLine className="mt-3 shrink-0">{error}</ErrorLine>}

        <div className="text-ink-muted mt-5 shrink-0 text-[12px] font-semibold tracking-wide uppercase">
          {data ? `${data.examples.length} of ${data.max} saved` : "Loading…"}
        </div>

        <ScrollBody className="mt-2 pr-2">
          {data && data.examples.length === 0 ? (
            <Note>
              Nothing saved yet. Open a proposal in the Review Queue and choose{" "}
              <strong>Save as an example</strong>.
            </Note>
          ) : (
            <ul className="flex flex-col gap-2">
              {data?.examples.map((example) => (
                <li
                  key={example.id}
                  className="border-line bg-card rounded-card flex items-start gap-3 border px-4 py-3"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="text-ink truncate text-[13.5px] font-semibold">
                      {example.title}
                    </span>
                    <span className="text-ink-muted truncate text-[12px]">
                      From: {exampleLabel(example)}
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Chip>{example.priority}</Chip>
                      <span className="text-ink-muted text-[11.5px] tabular-nums">
                        Saved {example.savedAt.slice(0, 10)}
                      </span>
                    </span>
                  </div>
                  <IconButton
                    aria-label={`Delete saved example: ${example.title}`}
                    tooltip="Delete"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void run(() => deleteSavedExample(example.id))}
                  >
                    <TrashIcon size={16} />
                  </IconButton>
                </li>
              ))}
            </ul>
          )}
        </ScrollBody>

        <div className="border-line mt-4 flex shrink-0 justify-end border-t pt-4">
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
