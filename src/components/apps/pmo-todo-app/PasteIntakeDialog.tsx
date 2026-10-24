"use client";

import { useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
} from "@/components/ui";
import {
  MANUAL_ORIGINS,
  MAX_PASTE_CHARS,
  ManualPasteSchema,
  type ManualOrigin,
} from "@/lib/pmo/manualIntake";
import { submitPaste } from "./api";
import { Field, ScrollBody, Segmented, TextArea } from "./parts";

interface PasteIntakeDialogProps {
  open: boolean;
  onSettled: () => void;
  onOpenChange: (open: boolean) => void;
}

const ORIGIN_LABEL: Record<ManualOrigin, string> = {
  manual: "Other",
  teams: "Teams",
  outlook: "Outlook",
};

type Outcome = { kind: "queued"; wouldFilter: string | null } | { kind: "duplicate" };

/**
 * Paste a message in by hand. It becomes a source "manual" file in the same
 * inbox folder the flows write to, so it is de-duplicated, filtered and queued
 * by the ordinary ingest pass: the review queue and the filter treat it like
 * every other message. You vouch for a paste, so the Teams tenant rule does not
 * apply to it, but your blocked domains and terms still do.
 */
export function PasteIntakeDialog({
  open,
  onSettled,
  onOpenChange,
}: PasteIntakeDialogProps) {
  const [subject, setSubject] = useState("");
  const [from, setFrom] = useState("");
  const [body, setBody] = useState("");
  const [origin, setOrigin] = useState<ManualOrigin>("teams");
  const [link, setLink] = useState("");
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setSubject("");
    setFrom("");
    setBody("");
    setLink("");
    setErrors({});
    setServerError(null);
    setOutcome(null);
  }

  async function send() {
    setServerError(null);
    const parsed = ManualPasteSchema.safeParse({ subject, from, body, origin, link });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "body");
        next[key] ??= issue.message;
      }
      return setErrors(next);
    }
    setErrors({});
    setBusy(true);
    try {
      const reply = await submitPaste(parsed.data);
      if (!reply.ok) return setServerError(reply.reason);
      setOutcome(
        reply.duplicate
          ? { kind: "duplicate" }
          : { kind: "queued", wouldFilter: reply.wouldFilter },
      );
      onSettled();
    } catch {
      setServerError("Could not reach the app server.");
    } finally {
      setBusy(false);
    }
  }

  function close(next: boolean) {
    onOpenChange(next);
    if (!next && outcome) reset();
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="flex max-h-full max-w-xl flex-col p-5">
        <DialogTitle className="shrink-0">Paste a message</DialogTitle>
        <DialogDescription className="shrink-0">
          Copy the text of a Teams message or an email and paste it here. It goes through
          the same filter and review queue as everything else.
        </DialogDescription>

        {outcome ? (
          <div className="mt-4 flex flex-col gap-3">
            {outcome.kind === "duplicate" ? (
              <p className="text-ink text-[13px]">
                This exact text is already in the system, so nothing was added. (Pasting
                the same message twice is recognised and counted once.)
              </p>
            ) : (
              <>
                <p className="text-ink text-[13px]">
                  Dropped into the inbox folder. It reaches the Review Queue after the
                  next scan, a few seconds from now, once the local model has structured
                  it.
                </p>
                {outcome.wouldFilter && (
                  <p className="text-ink text-[13px] font-medium">
                    Your block list will catch it, so it will appear under Filtered
                    instead: {outcome.wouldFilter}
                  </p>
                )}
              </>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={reset}>
                Paste another
              </Button>
              <Button onClick={() => close(false)}>Done</Button>
            </div>
          </div>
        ) : (
          <>
            <ScrollBody className="mt-4 pr-2">
              <div className="flex flex-col gap-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="From (optional)">
                    <Input
                      value={from}
                      disabled={busy}
                      placeholder="Name or name@deloitte.com"
                      aria-invalid={errors.from ? true : undefined}
                      onChange={(event) => setFrom(event.target.value)}
                    />
                    <FieldError message={errors.from} />
                  </Field>
                  <Field label="Subject (optional)">
                    <Input
                      value={subject}
                      disabled={busy}
                      placeholder="Chat name or email subject"
                      aria-invalid={errors.subject ? true : undefined}
                      onChange={(event) => setSubject(event.target.value)}
                    />
                    <FieldError message={errors.subject} />
                  </Field>
                </div>

                <Field label="Where is it from?">
                  <Segmented
                    value={origin}
                    disabled={busy}
                    onChange={setOrigin}
                    options={MANUAL_ORIGINS.map((value) => ({
                      value,
                      label: ORIGIN_LABEL[value],
                    }))}
                  />
                </Field>

                <Field label="Message text">
                  <TextArea
                    value={body}
                    disabled={busy}
                    rows={9}
                    className="min-h-40"
                    placeholder="Paste the message here"
                    aria-invalid={errors.body ? true : undefined}
                    onChange={(event) => setBody(event.target.value)}
                  />
                  <span className="text-ink-faint text-[11px]">
                    {body.length.toLocaleString("en-GB")} /{" "}
                    {MAX_PASTE_CHARS.toLocaleString("en-GB")} characters
                  </span>
                  <FieldError message={errors.body} />
                </Field>

                <Field label="Link to the message (optional)">
                  <Input
                    value={link}
                    disabled={busy}
                    placeholder="https://teams.microsoft.com/l/message/..."
                    aria-invalid={errors.link ? true : undefined}
                    onChange={(event) => setLink(event.target.value)}
                  />
                  <FieldError message={errors.link} />
                </Field>

                <p className="text-ink-faint rounded-lg bg-neutral-50 px-3 py-2 text-[12px] leading-relaxed">
                  Another way for Teams: on the message choose <strong>...</strong>, then{" "}
                  <strong>Share to Outlook</strong> (if your Teams has it), send it to
                  yourself and flag the email. The flagged-email flow or the Outlook
                  script then brings it in as ordinary mail, with a real sender address.
                </p>
              </div>
            </ScrollBody>
            {serverError && (
              <p role="alert" className="text-ink mt-2 shrink-0 text-[12px] font-medium">
                {serverError}
              </p>
            )}
            <div className="border-border mt-3 flex shrink-0 justify-end gap-2 border-t pt-3">
              <Button variant="ghost" onClick={() => close(false)}>
                Cancel
              </Button>
              <Button disabled={busy || !body.trim()} onClick={() => void send()}>
                Add to inbox
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function FieldError({ message }: { message: string | undefined }) {
  if (!message) return null;
  return (
    <span role="alert" className="text-ink text-[11px] font-medium">
      {message}
    </span>
  );
}
