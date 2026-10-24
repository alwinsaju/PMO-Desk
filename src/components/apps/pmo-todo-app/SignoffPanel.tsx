"use client";

import { useState } from "react";
import { SealCheckIcon, WarningIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { Checkpoint, ReminderPrefs, Todo } from "@/lib/pmo/types";
import { confirmSignoffConditions, recordSignoff, revokeSignoff } from "./api";
import { OriginalMessage } from "./OriginalMessage";
import { Chip, Field, Segmented, TextArea } from "./parts";
import {
  OUTCOME_CHOICES,
  conditionsField,
  emptyRecordForm,
  evidenceOptions,
  recordFormProblem,
  revokeProblem,
  signoffPanelView,
  type RecordForm,
  type StampView,
} from "./signoffUi";

interface SignoffPanelProps {
  todo: Todo;
  checkpoint: Checkpoint;
  prefs: ReminderPrefs;
  nowIso: string;
  /** The to-do is open: a closed one shows its sign-off and offers nothing. */
  open: boolean;
  onRequest: () => void;
  onSettled: () => void;
}

const inputClass =
  "rounded-control border-border bg-surface-elevated text-ink focus-visible:ring-accent h-9 w-full border px-2.5 text-[13px] outline-none focus-visible:ring-2";

/**
 * Everything about one sign-off step: the state in plain words, the immutable
 * stamp (who recorded it, when, on what evidence), and the few things a person
 * can do next. The server enforces every rule and stamps identity and time; this
 * only asks. Nothing here sends anything.
 */
export function SignoffPanel({
  todo,
  checkpoint,
  prefs,
  nowIso,
  open,
  onRequest,
  onSettled,
}: SignoffPanelProps) {
  const view = signoffPanelView(todo, checkpoint, new Date(nowIso), prefs, open);
  const [mode, setMode] = useState<"idle" | "record" | "revoke" | "conditions">("idle");
  const [form, setForm] = useState<RecordForm>(emptyRecordForm());
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<{ ok: boolean; reason?: string }>) => {
    setBusy(true);
    setError(null);
    try {
      const reply = await action();
      if (!reply.ok) {
        setError(reply.reason ?? "That did not work.");
        return false;
      }
      setMode("idle");
      setForm(emptyRecordForm());
      setReason("");
      onSettled();
      return true;
    } catch {
      setError("Could not reach the app server.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const formProblem = recordFormProblem(form);
  const field = conditionsField(form.outcome);
  const evidence = evidenceOptions(todo);

  return (
    <div
      data-testid="signoff-panel"
      data-state={view.state}
      className="border-border bg-surface-elevated mt-1 flex w-full basis-full flex-col gap-2.5 rounded-lg border px-3 py-2.5"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <SealCheckIcon size={15} className="text-ink-muted shrink-0" />
        <p
          className={cn(
            "text-ink min-w-0 text-[13px] font-semibold break-words",
            view.state === "skipped" && "text-ink-muted font-medium",
          )}
        >
          {view.headline}
        </p>
        {view.chase && <Chip tone="accent">Time to chase</Chip>}
      </div>
      <p className="text-ink-muted text-[12px]">
        {view.approverLine}
        {view.requestedLine ? ` · ${view.requestedLine}` : ""}
      </p>

      {view.said && (
        <p className="text-ink text-[12px] break-words whitespace-pre-wrap">
          <span className="text-ink-faint block text-[10px] font-semibold tracking-wide uppercase">
            {view.said.label}
          </span>
          {view.said.text}
        </p>
      )}

      {view.stamp && <StampBlock stamp={view.stamp} confirmed={view.confirmedLine} />}

      {view.next && <p className="text-ink-faint text-[11px]">{view.next}</p>}

      {view.previous.length > 0 && (
        <details className="text-[11px]">
          <summary className="text-ink-muted hover:text-ink cursor-pointer select-none">
            Earlier records ({view.previous.length})
          </summary>
          <ul className="text-ink-muted mt-1 flex flex-col gap-1">
            {view.previous.map((line, index) => (
              <li key={index} className="break-words">
                {line}
              </li>
            ))}
          </ul>
        </details>
      )}

      {mode === "idle" && (
        <div className="flex flex-wrap gap-2">
          {view.actions.request && (
            <Button size="sm" variant="secondary" disabled={busy} onClick={onRequest}>
              {view.actions.request}
            </Button>
          )}
          {view.actions.record && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => setMode("record")}
            >
              Record sign-off
            </Button>
          )}
          {view.actions.confirmConditions && (
            <Button size="sm" disabled={busy} onClick={() => setMode("conditions")}>
              Conditions are met
            </Button>
          )}
          {view.actions.revoke && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => setMode("revoke")}
            >
              Revoke…
            </Button>
          )}
        </div>
      )}

      {mode === "record" && (
        <form
          className="border-border flex flex-col gap-2.5 border-t pt-2.5"
          onSubmit={(event) => {
            event.preventDefault();
            if (formProblem) return;
            void run(() =>
              recordSignoff(todo.id, {
                checkpointId: checkpoint.id,
                outcome: form.outcome,
                conditions: form.conditions,
                note: form.note,
                intakeId: form.intakeId || null,
              }),
            );
          }}
        >
          <Field label="Outcome">
            <Segmented
              value={form.outcome}
              onChange={(outcome) => setForm({ ...form, outcome })}
              options={OUTCOME_CHOICES}
            />
          </Field>
          {field.shown && (
            <Field label={field.label}>
              <TextArea
                value={form.conditions}
                rows={3}
                maxLength={1000}
                onChange={(e) => setForm({ ...form, conditions: e.target.value })}
              />
            </Field>
          )}
          <Field label="Where it came from (evidence)">
            <input
              value={form.note}
              maxLength={500}
              placeholder="e.g. email from Priya, 26 Oct"
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              className={inputClass}
            />
          </Field>
          {evidence.length > 1 && (
            <Field label="Link a message (optional)">
              <select
                value={form.intakeId}
                onChange={(e) => setForm({ ...form, intakeId: e.target.value })}
                className={inputClass}
              >
                {evidence.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <p className="text-ink-faint text-[11px]">
            The record is stamped with your Windows user name and the time by the server.
            It cannot be edited afterwards; the only way to undo it is Revoke, with a
            reason.
            {form.outcome === "approved_with_conditions" &&
              " The step stays open until you confirm the conditions are met."}
            {(form.outcome === "changes_requested" || form.outcome === "rejected") &&
              " The Draft step is reopened."}
          </p>
          {error && <ErrorLine text={error} />}
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              size="sm"
              disabled={busy || !!formProblem}
              title={formProblem ?? undefined}
            >
              Record
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setMode("idle");
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}

      {mode === "conditions" && (
        <div className="border-border flex flex-col gap-2 border-t pt-2.5">
          <p className="text-ink text-[12px]">
            Confirm that every condition above is met? That completes the sign-off step.
          </p>
          {error && <ErrorLine text={error} />}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={busy}
              onClick={() =>
                void run(() => confirmSignoffConditions(todo.id, checkpoint.id))
              }
            >
              Yes, they are met
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => setMode("idle")}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {mode === "revoke" && (
        <form
          className="border-border flex flex-col gap-2 border-t pt-2.5"
          onSubmit={(event) => {
            event.preventDefault();
            if (revokeProblem(reason)) return;
            void run(() => revokeSignoff(todo.id, reason.trim(), checkpoint.id));
          }}
        >
          <p className="text-ink flex items-start gap-1.5 text-[12px]">
            <WarningIcon size={13} weight="fill" className="mt-0.5 shrink-0" />
            Revoking keeps the old record in the history and the audit log, and sends this
            step back to &ldquo;not requested&rdquo;. A reason is required.
          </p>
          <Field label="Reason">
            <TextArea
              value={reason}
              rows={2}
              maxLength={300}
              onChange={(e) => setReason(e.target.value)}
              data-testid="signoff-revoke-reason"
            />
          </Field>
          {error && <ErrorLine text={error} />}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={busy || !!revokeProblem(reason)}>
              Revoke sign-off
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setMode("idle");
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}

      {mode === "idle" && error && <ErrorLine text={error} />}
    </div>
  );
}

function ErrorLine({ text }: { text: string }) {
  return (
    <p role="alert" className="text-ink text-[12px] font-medium">
      {text}
    </p>
  );
}

/** The immutable record: who signed off, who recorded it and when, on what evidence. */
function StampBlock({
  stamp,
  confirmed,
}: {
  stamp: StampView;
  confirmed: string | null;
}) {
  const [showMessage, setShowMessage] = useState(false);
  return (
    <div
      data-testid="signoff-stamp"
      className="border-border rounded-md border bg-neutral-50 px-2.5 py-2 text-[12px]"
    >
      <p className="text-ink break-words">
        {stamp.signedBy ? (
          <>
            {stamp.label} <strong className="font-semibold">{stamp.signedBy}</strong>
          </>
        ) : (
          stamp.label
        )}
        <span className="text-ink-muted">
          {" · "}
          recorded by {stamp.recordedBy}, {stamp.recordedAt}
        </span>
      </p>
      <p className="text-ink-muted mt-0.5 break-words">
        Evidence: {stamp.evidenceNote || "a linked message"}
        {stamp.evidenceLink && (
          <>
            {" · "}
            <a
              href={stamp.evidenceLink}
              target="_blank"
              rel="noopener noreferrer"
              className="text-ink underline underline-offset-2"
            >
              open the link
            </a>
          </>
        )}
        {!stamp.evidenceLink && stamp.evidenceLinkText && ` · ${stamp.evidenceLinkText}`}
      </p>
      {confirmed && <p className="text-ink-muted mt-0.5 break-words">{confirmed}</p>}
      {stamp.evidenceIntakeId && (
        <>
          <button
            type="button"
            onClick={() => setShowMessage((v) => !v)}
            aria-expanded={showMessage}
            className="text-ink-muted hover:text-ink focus-visible:ring-accent mt-1 rounded text-[12px] underline-offset-2 outline-none hover:underline focus-visible:ring-2"
          >
            {showMessage ? "Hide the message" : "Open the message"}
          </button>
          {showMessage && (
            <div className="border-border mt-1 flex h-56 flex-col rounded-lg border p-3">
              <OriginalMessage
                intakeId={stamp.evidenceIntakeId}
                className="flex min-h-0 flex-1 flex-col"
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
