"use client";

import { useRef, useState } from "react";
import {
  CheckIcon,
  CopyIcon,
  EnvelopeSimpleIcon,
  SparkleIcon,
} from "@phosphor-icons/react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
} from "@/components/ui";
import { buildMailto } from "@/lib/pmo/chaser";
import { approverEmail, signoffOf } from "@/lib/pmo/signoff";
import { buildSignoffTemplate, myFirstName } from "@/lib/pmo/signoffRequest";
import type { Checkpoint, ChaserJob, PmoConfig, Todo } from "@/lib/pmo/types";
import { discardSignoffDraft, requestSignoff, startSignoffDraft } from "./api";
import { ErrorLine, Field, Note, QuickChip, ScrollBody, TextArea } from "./parts";
import { approverSuggestions } from "./signoffUi";

interface SignoffRequestDialogProps {
  todo: Todo;
  /** The sign-off checkpoint this request is for; null closes the dialog. */
  checkpoint: Checkpoint | null;
  /** The AI-improved text for this to-do (polled state), if one was started. */
  job: ChaserJob | undefined;
  me: PmoConfig["me"];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSettled: () => void;
}

/**
 * Prepare a sign-off request, as text. The deterministic template appears at once
 * (no model); "Improve with AI" optionally asks the LOCAL model for a better
 * version, offered next to the person's text, never over it. NOTHING here sends
 * anything: Copy puts the text on the clipboard and the mail link is a plain
 * mailto: that opens an unsent compose window in the person's own mail program.
 * "Mark as requested" is the only thing that moves the checkpoint (the app
 * cannot know the request was sent, so the person says so). The model's text is
 * untrusted and only ever shown inside a <textarea> (plain text, never HTML).
 */
export function SignoffRequestDialog({
  todo,
  checkpoint,
  job,
  me,
  open,
  onOpenChange,
  onSettled,
}: SignoffRequestDialogProps) {
  const [seededFor, setSeededFor] = useState<string | null>(null);
  const [approver, setApprover] = useState("");
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [edited, setEdited] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The AI job this dialog started, and the ones the person already dealt with.
  const [startedJob, setStartedJob] = useState<string | null>(null);
  const [handledJob, setHandledJob] = useState<string | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const templateFor = (who: string) =>
    buildSignoffTemplate({ todo, approver: who, myName: myFirstName(me) });

  // Seed once each time the dialog opens for a checkpoint (not on every poll,
  // which would overwrite what the person is typing).
  const seedKey = open && checkpoint ? `${todo.id}:${checkpoint.id}` : null;
  if (seedKey && seedKey !== seededFor) {
    const saved = signoffOf(checkpoint!).approver ?? "";
    const template = templateFor(saved);
    setSeededFor(seedKey);
    setApprover(saved);
    setTo(template.to ?? "");
    setSubject(template.subject);
    setText(template.text);
    setEdited(false);
    setCopied(false);
    setError(null);
    setStartedJob(null);
    setHandledJob(null);
  }
  if (!open && seededFor !== null) setSeededFor(null);

  if (!checkpoint) return null;

  const changeApprover = (value: string) => {
    setApprover(value);
    // Until the person edits the message, it follows the approver they name.
    if (!edited) {
      const template = templateFor(value);
      setText(template.text);
      setTo(template.to ?? "");
    } else if (!to.trim() || to === approverEmail(approver)) {
      setTo(approverEmail(value) ?? "");
    }
  };

  const improve = async () => {
    setBusy(true);
    setError(null);
    try {
      const reply = await startSignoffDraft(todo.id, approver.trim() || null);
      if (!reply.ok) setError(reply.reason);
      else setStartedJob(reply.job.id);
      onSettled();
    } catch {
      setError("Could not reach the app server.");
    } finally {
      setBusy(false);
    }
  };

  const useImproved = () => {
    if (!job || job.status !== "ready") return;
    setText(job.text ?? "");
    if (job.subject) setSubject(job.subject);
    if (job.to && !to.trim()) setTo(job.to);
    setEdited(true);
    setHandledJob(job.id);
    void discardSignoffDraft(todo.id).then(onSettled);
  };

  const keepMine = () => {
    if (!job) return;
    setHandledJob(job.id);
    void discardSignoffDraft(todo.id).then(onSettled);
  };

  const markRequested = async () => {
    setBusy(true);
    setError(null);
    try {
      const reply = await requestSignoff(todo.id, {
        checkpointId: checkpoint.id,
        approver: approver.trim() || null,
      });
      if (!reply.ok) {
        setError(reply.reason);
        return;
      }
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
  const mine = job && job.id === startedJob;
  const drafting = mine && job.status === "drafting";
  const failed = mine && job.status === "failed";
  const improved = mine && job.status === "ready" && job.id !== handledJob;
  const alreadyRequested = !!signoffOf(checkpoint).requestedAt;
  const suggestions = approverSuggestions(todo, approver);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-full max-w-xl flex-col px-[30px] pt-7 pb-6"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <DialogTitle className="shrink-0">Request sign-off</DialogTitle>
        <DialogDescription className="shrink-0 text-[13px]">
          This only writes the request. This app never sends anything: copy it, send it
          yourself, then click &ldquo;Mark as requested&rdquo;.
        </DialogDescription>

        <ScrollBody className="mt-4 flex flex-col gap-3 pr-2">
          <Field label="Who must sign off">
            <Input
              value={approver}
              placeholder="Name or name@deloitte.com"
              maxLength={200}
              onChange={(e) => changeApprover(e.target.value)}
              data-testid="signoff-approver"
            />
            {suggestions.length > 0 && (
              <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px]">
                <span className="text-ink-muted font-medium">Quick pick:</span>
                {suggestions.map((value) => (
                  <QuickChip key={value} onClick={() => changeApprover(value)}>
                    {value}
                  </QuickChip>
                ))}
              </span>
            )}
            {!approver.trim() && (
              <span className="text-ink-muted mt-1 text-[12px]">
                Name the approver to get chaser reminders and to recognise their reply.
              </span>
            )}
          </Field>
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
          {drafting && (
            <Note role="status" className="flex items-center gap-2.5">
              <span className="bg-accent motion-safe:animate-blink h-2 w-2 shrink-0 rounded-full" />
              Drafting&hellip; (can take a minute on this PC). You can keep editing; your
              text is not touched.
            </Note>
          )}
          {failed && (
            <Note tone="danger" role="alert">
              {job.error ?? "The improved version failed."} Your text is unchanged.
            </Note>
          )}
          {improved && (
            <Note
              tone="accent"
              data-testid="signoff-improved"
              className="flex flex-col gap-2.5"
            >
              <p className="text-ink text-[13px] font-semibold">
                An improved version is ready (written by the local model; read it first).
              </p>
              <p className="text-ink-soft scroll-thin max-h-32 overflow-y-auto text-[12.5px] leading-relaxed break-words whitespace-pre-wrap">
                {job.text}
              </p>
              <div className="flex gap-2">
                <Button size="sm" onClick={useImproved}>
                  Use it
                </Button>
                <Button size="sm" variant="ghost" onClick={keepMine}>
                  Keep mine
                </Button>
              </div>
            </Note>
          )}

          <Field label="Message">
            <TextArea
              ref={textRef}
              value={text}
              rows={9}
              className="min-h-40 leading-relaxed"
              data-testid="signoff-text"
              onChange={(e) => {
                setText(e.target.value);
                setEdited(true);
              }}
            />
          </Field>

          {error && <ErrorLine>{error}</ErrorLine>}
          {!mailto.ok && <p className="text-ink-muted text-[12px]">{mailto.reason}</p>}
          <p className="text-ink-muted text-[12px] leading-relaxed">
            &ldquo;Mark as requested&rdquo; records that you sent it (the app cannot
            tell), starts the wait for a reply
            {approver.trim() ? ` on ${approver.trim()}` : ""} and ticks &ldquo;Sent for
            sign-off&rdquo;. The mail link only opens an unsent message in your mail
            program.
          </p>
        </ScrollBody>

        <div className="border-line mt-4 flex shrink-0 flex-wrap items-center gap-2.5 border-t pt-4">
          <Button variant="outline" disabled={!text.trim()} onClick={() => void copy()}>
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
                <span className="hidden sm:inline">Open as unsent mail draft</span>
                <span className="sm:hidden">Mail draft</span>
              </a>
            </Button>
          ) : (
            <Button variant="outline" disabled title={mailto.reason}>
              <EnvelopeSimpleIcon size={14} />
              <span className="hidden sm:inline">Open as unsent mail draft</span>
              <span className="sm:hidden">Mail draft</span>
            </Button>
          )}
          <Button
            variant="ghost"
            disabled={busy || drafting}
            onClick={() => void improve()}
            data-testid="signoff-improve"
          >
            <SparkleIcon size={14} />
            {drafting ? "Improving…" : "Improve with AI"}
          </Button>
          <Button
            className="ml-auto"
            disabled={busy}
            onClick={() => void markRequested()}
            data-testid="signoff-mark-requested"
          >
            {alreadyRequested ? "Mark as requested again" : "Mark as requested"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
