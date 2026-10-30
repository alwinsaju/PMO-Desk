"use client";

import { useRef, useState } from "react";
import { CheckIcon, CopyIcon, EnvelopeSimpleIcon } from "@phosphor-icons/react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
} from "@/components/ui";
import { buildMailto, defaultChaserSubject } from "@/lib/pmo/chaser";
import { chaserDialogFields, chaserValues } from "@/lib/pmo/templateValues";
import { myFirstName } from "@/lib/pmo/signoffRequest";
import type { ChaserJob, PmoConfig, ReminderPrefs, Todo } from "@/lib/pmo/types";
import { discardChaser, startChaser } from "./api";
import { ErrorLine, Field, Note, ScrollBody, TextArea } from "./parts";
import { useAssignedTemplate } from "../templates-app/useAssignedTemplate";
import { markTemplateUsed } from "@/lib/templates/usageStore";

interface ChaserDialogProps {
  todo: Todo;
  /** The draft for this to-do (from the polled state), if any. */
  job: ChaserJob | undefined;
  /** Who "me" is, the reminder settings and the server's clock: what a chaser
   *  template needs to fill in its sign-off and how long you have waited. */
  me: PmoConfig["me"];
  reminders: ReminderPrefs;
  nowIso: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSettled: () => void;
}

/**
 * Review, edit and copy a follow-up drafted by the LOCAL model, or written from
 * the chaser template in the Template library. Nothing here
 * sends anything: Copy puts the text on the clipboard, and "Open as unsent
 * draft" is a plain mailto: link the browser/OS hands to the user's own mail
 * program, which only opens a compose window. The model's text is untrusted and
 * is only ever shown inside a <textarea> (plain text, never as HTML).
 */
export function ChaserDialog({
  todo,
  job,
  me,
  reminders,
  nowIso,
  open,
  onOpenChange,
  onSettled,
}: ChaserDialogProps) {
  const [seededFor, setSeededFor] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [subject, setSubject] = useState("");
  const [to, setTo] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The person chose the template's wording: the model's draft no longer overwrites the fields.
  const [fromTemplate, setFromTemplate] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [variant, setVariant] = useState<string | null>(null);
  const template = useAssignedTemplate("app:pmo-todo:chaser", open, variant);

  // Seed the editable fields once per finished draft (not on every poll, which
  // would overwrite what the person is typing).
  if (job?.status === "ready" && job.id !== seededFor && !fromTemplate) {
    setSeededFor(job.id);
    setText(job.text ?? "");
    setSubject(job.subject ?? "");
    setTo(job.to ?? "");
    setCopied(false);
  }

  const useTemplate = () => {
    if (!template) return;
    const written = chaserDialogFields(
      template,
      chaserValues({
        todo,
        now: new Date(nowIso),
        prefs: reminders,
        myName: myFirstName(me),
      }),
      { subject: defaultChaserSubject(todo), to: job?.to ?? "" },
    );
    setText(written.body);
    setSubject(written.subject);
    setTo(written.to);
    setFromTemplate(true);
    setCopied(false);
    setError(null);
    markTemplateUsed(template.id);
  };

  const useModelDraft = () => {
    if (job?.status !== "ready") return;
    setText(job.text ?? "");
    setSubject(job.subject ?? "");
    setTo(job.to ?? "");
    setFromTemplate(false);
    setSeededFor(job.id);
    setCopied(false);
  };

  const draftAgain = async () => {
    setBusy(true);
    setError(null);
    try {
      const reply = await startChaser(todo.id);
      if (!reply.ok) setError(reply.reason);
      onSettled();
    } catch {
      setError("Could not reach the app server.");
    } finally {
      setBusy(false);
    }
  };

  const discard = async () => {
    setBusy(true);
    try {
      await discardChaser(todo.id);
      onSettled();
      onOpenChange(false);
    } catch {
      setError("Could not reach the app server.");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    const done = () => {
      setError(null);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    };
    try {
      await navigator.clipboard.writeText(text);
      done();
    } catch {
      // No clipboard permission: select the text and try the older route; if
      // that fails too, the text is selected for Ctrl+C.
      textRef.current?.select();
      let ok = false;
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
      if (ok) done();
      else setError("Could not copy automatically. The text is selected: press Ctrl+C.");
    }
  };

  const mailto = buildMailto({ to, subject, body: text });
  const drafting = job?.status === "drafting";
  const ready = job?.status === "ready";
  const failed = job?.status === "failed";
  const editing = ready || fromTemplate;
  if (!open && fromTemplate) setFromTemplate(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-full max-w-xl flex-col px-[30px] pt-7 pb-6"
        // Opening should not select the address in the first field.
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <DialogTitle className="shrink-0">
          Chaser to {todo.waitingOn ?? "the person you are waiting on"}
        </DialogTitle>
        <DialogDescription className="shrink-0 text-[13px]">
          {template
            ? "Drafted by the local model from this to-do, or written from your template. Edit it, then copy it. This app never sends anything."
            : "Drafted by the local model from this to-do. Edit it, then copy it. This app never sends anything."}
        </DialogDescription>

        {!editing && (!job || drafting) && (
          <Note role="status" className="mt-4 flex items-center gap-2.5">
            <span className="bg-accent motion-safe:animate-blink h-2 w-2 shrink-0 rounded-full" />
            Drafting… (can take a minute on this PC). You can close this window; the draft
            will be waiting on the to-do.
          </Note>
        )}
        {template && !editing && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {(template.variants?.length ?? 0) > 0 && (
              <select
                aria-label="Wording of the template"
                data-testid="chaser-variant"
                value={variant ?? ""}
                onChange={(e) => setVariant(e.target.value || null)}
                className="rounded-control border-line bg-surface-elevated h-9 border px-2.5 text-[13px]"
              >
                <option value="">Main wording</option>
                {template.variants?.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
            )}
            <Button
              variant="outline"
              onClick={useTemplate}
              data-testid="chaser-use-template"
            >
              Use my template “{template.name}” now
            </Button>
          </div>
        )}

        {failed && !editing && (
          <div role="alert" className="mt-4 flex flex-col gap-2">
            <Note tone="danger">{job.error ?? "The draft failed."}</Note>
            <div>
              <Button variant="secondary" disabled={busy} onClick={draftAgain}>
                Try again
              </Button>
            </div>
          </div>
        )}

        {editing && (
          <>
            <ScrollBody className="mt-4 flex flex-col gap-3 pr-2">
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                <Field label="To (optional)">
                  <Input
                    value={to}
                    placeholder="name@deloitte.com"
                    onChange={(e) => setTo(e.target.value)}
                  />
                </Field>
                <Field label="Subject">
                  <Input
                    value={subject}
                    maxLength={150}
                    onChange={(e) => setSubject(e.target.value)}
                  />
                </Field>
              </div>
              <Field label="Message">
                <TextArea
                  ref={textRef}
                  value={text}
                  rows={9}
                  className="min-h-44 leading-relaxed"
                  onChange={(e) => setText(e.target.value)}
                />
              </Field>
              {error && <ErrorLine>{error}</ErrorLine>}
              {!mailto.ok && (
                <p className="text-ink-muted text-[12px]">{mailto.reason}</p>
              )}
              <p className="text-ink-muted text-[12px] leading-relaxed">
                The mail link only opens a new message in your mail program with this text
                filled in; you still check it and press Send yourself.
              </p>
            </ScrollBody>
            <div className="border-line mt-4 flex shrink-0 flex-wrap items-center gap-2.5 border-t pt-4">
              <Button disabled={!text.trim()} onClick={() => void copy()}>
                {copied ? <CheckIcon size={14} weight="bold" /> : <CopyIcon size={14} />}
                {copied ? "Copied" : "Copy"}
              </Button>
              {mailto.ok ? (
                <Button variant="outline" asChild>
                  {/* A mailto: link only opens an unsent compose window in the
                      user's own mail program. */}
                  <a
                    href={mailto.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid="open-mail-draft"
                  >
                    <EnvelopeSimpleIcon size={14} />
                    Open as unsent mail draft
                  </a>
                </Button>
              ) : (
                <Button variant="outline" disabled title={mailto.reason}>
                  <EnvelopeSimpleIcon size={14} />
                  Open as unsent mail draft
                </Button>
              )}
              <Button variant="ghost" disabled={busy} onClick={draftAgain}>
                Draft again
              </Button>
              {template && (
                <Button variant="ghost" onClick={useTemplate}>
                  Use my template
                </Button>
              )}
              {fromTemplate && ready && (
                <Button variant="ghost" onClick={useModelDraft}>
                  Use AI draft
                </Button>
              )}
              <Button variant="ghost" disabled={busy} onClick={() => void discard()}>
                Discard
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
