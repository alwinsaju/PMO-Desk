"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { CopyIcon } from "@phosphor-icons/react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
  ScrollArea,
} from "@/components/ui";
import {
  DEFAULT_RETENTION_DAYS,
  MAX_RETENTION_DAYS,
  MIN_RETENTION_DAYS,
  type PmoState,
} from "@/lib/pmo/types";
import { updateConfig } from "./api";
import { Field, TextArea } from "./parts";
import {
  buildPatch,
  formFromConfig,
  type FormText,
  type ListField,
} from "./settingsForm";

interface SettingsDialogProps {
  state: PmoState;
  open: boolean;
  onSettled: () => void;
  onOpenChange: (open: boolean) => void;
}

/** Edits config.json through GET/PUT /api/pmo/config. Everything is checked
 *  with the same zod schema the server uses, so a mistake is shown next to the
 *  field before anything is sent. */
export function SettingsDialog({
  state,
  open,
  onSettled,
  onOpenChange,
}: SettingsDialogProps) {
  const [form, setForm] = useState<FormText>(() => formFromConfig(state.config));
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const configRef = useRef(state.config);
  configRef.current = state.config;

  // Start from the stored config each time the dialog opens, not on every poll.
  useEffect(() => {
    if (!open) return;
    setForm(formFromConfig(configRef.current));
    setErrors({});
    setServerError(null);
    setSaved(false);
  }, [open]);

  const set = (patch: Partial<FormText>) => {
    setForm((current) => ({ ...current, ...patch }));
    setSaved(false);
  };
  const dirty = JSON.stringify(form) !== JSON.stringify(formFromConfig(state.config));

  async function save() {
    setServerError(null);
    const built = buildPatch(form);
    if (built.errors) return setErrors(built.errors);
    setErrors({});
    setBusy(true);
    try {
      const reply = await updateConfig(built.patch);
      if (!reply.ok) return setServerError(reply.reason);
      setForm(formFromConfig(reply.config));
      setSaved(true);
      onSettled();
    } catch {
      setServerError("Could not reach the app server.");
    } finally {
      setBusy(false);
    }
  }

  const listBox = (
    field: ListField,
    label: string,
    placeholder: string,
    rows = 3,
    hint?: ReactNode,
  ) => (
    <Field label={label}>
      <TextArea
        value={form[field]}
        rows={rows}
        disabled={busy}
        spellCheck={false}
        placeholder={placeholder}
        aria-invalid={errors[field] ? true : undefined}
        className="min-h-0 font-mono text-[12px]"
        onChange={(event) => set({ [field]: event.target.value })}
      />
      {hint && <span className="text-ink-faint text-[11px] leading-relaxed">{hint}</span>}
      <FieldError message={errors[field]} />
    </Field>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-2xl flex-col">
        <DialogTitle>PMO settings</DialogTitle>
        <DialogDescription>
          One entry per line. Changes apply to the next scan; nothing already in the queue
          is re-filtered.
        </DialogDescription>

        <ScrollArea className="mt-4 min-h-0 flex-1">
          <div className="flex flex-col gap-5 pr-3">
            <Section title="About you">
              <div className="grid grid-cols-2 gap-3">
                {listBox(
                  "names",
                  "Your names and aliases",
                  "Alwin Saju",
                  4,
                  "How the model recognises a request addressed to you (first name, nickname, ...).",
                )}
                {listBox("emails", "Your email addresses", "you@deloitte.com", 4)}
              </div>
            </Section>

            <Section title="Who is allowed in">
              {listBox(
                "allowedSenderDomains",
                "Allowed sender domains (Outlook)",
                "deloitte.com",
                2,
                "Email from any other domain is filtered. Subdomains match (us.deloitte.com matches deloitte.com).",
              )}
              {listBox(
                "allowedTenantIds",
                "Allowed Teams tenant IDs",
                "00000000-0000-0000-0000-000000000000",
                2,
                <>
                  Teams is blocked until a tenant or chat is listed.{" "}
                  <strong className="text-ink-muted">How to find your tenant ID:</strong>{" "}
                  in Power Automate open your Teams flow, then <em>My flows</em>, the
                  flow, its run history and a run; open the trigger card (For a selected
                  message) and copy the value of{" "}
                  <code className="font-mono">tenantId</code> from its outputs. The same
                  GUID appears in a Teams message link after{" "}
                  <code className="font-mono">?tenantId=</code>. Or use{" "}
                  <em>Allow this tenant</em> on a filtered Teams item.
                </>,
              )}
              {listBox(
                "teamsChatAllowlist",
                "Allowed Teams chat IDs (optional)",
                "19:xxxxxxxx@thread.v2",
                2,
                "Lets one chat in without allowing the whole tenant. The chat ID is the first part of a message link after /l/message/.",
              )}
            </Section>

            <Section title="Always blocked">
              <div className="grid grid-cols-2 gap-3">
                {listBox(
                  "blockedDomains",
                  "Blocked domains",
                  "takeda.com",
                  3,
                  "A sender or recipient on one of these is filtered, even if the sender is allowed.",
                )}
                {listBox(
                  "blockedTerms",
                  "Blocked terms",
                  "a client or project name",
                  3,
                  "Filtered if one appears in the subject or text (any case).",
                )}
              </div>
            </Section>

            <Section title="Retention">
              <Field label="Keep logs and finished items for (days)">
                <Input
                  inputMode="numeric"
                  value={form.retentionDays}
                  disabled={busy}
                  className="w-32"
                  aria-invalid={errors.retentionDays ? true : undefined}
                  onChange={(event) => set({ retentionDays: event.target.value })}
                />
                <span className="text-ink-faint text-[11px] leading-relaxed">
                  {MIN_RETENTION_DAYS} to {MAX_RETENTION_DAYS} days, default{" "}
                  {DEFAULT_RETENTION_DAYS}. After this, logs and the saved message text of
                  a closed to-do or a rejected item are deleted daily. Open to-dos keep
                  their message. Filtered records and unreadable files are cleared after
                  30 days.
                </span>
                <FieldError message={errors.retentionDays} />
              </Field>
            </Section>

            <Section title="Where things are (read only)">
              <PathRow
                label="Inbox folder"
                value={state.ingest.inboxDir}
                note="Where the flows, the Outlook script and Paste drop files. Change inboxDir in config.json (applies on the next scan), unless the environment variable AI_OS_PMO_INBOX_DIR is set."
              />
              <PathRow
                label="Data folder"
                value={state.dataDir}
                note="config.json, the queue, to-dos, logs and the audit trail live here, on this computer only."
              />
            </Section>
          </div>
        </ScrollArea>

        {serverError && (
          <p role="alert" className="text-ink mt-2 text-[12px] font-medium">
            {serverError}
          </p>
        )}
        {Object.keys(errors).length > 0 && (
          <p role="alert" className="text-ink mt-2 text-[12px] font-medium">
            Fix the highlighted fields to save.
          </p>
        )}
        <div className="mt-4 flex items-center justify-end gap-2">
          {saved && <span className="text-ink-muted mr-auto text-[12px]">Saved.</span>}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {saved ? "Close" : "Cancel"}
          </Button>
          <Button disabled={busy || !dirty} onClick={() => void save()}>
            Save settings
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-ink border-border/60 border-b pb-1 text-[12px] font-semibold tracking-wide uppercase">
        {title}
      </h3>
      {children}
    </section>
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

function PathRow({ label, value, note }: { label: string; value: string; note: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked: the path is selectable text anyway.
    }
  }
  return (
    <div className="flex flex-col gap-1">
      <span className="text-ink-faint text-[10px] font-semibold tracking-wide uppercase">
        {label}
      </span>
      <div className="flex items-center gap-2">
        <code className="border-border text-ink min-w-0 flex-1 rounded-lg border bg-neutral-50 px-3 py-1.5 font-mono text-[12px] break-all select-all">
          {value}
        </code>
        <Button variant="secondary" size="sm" onClick={() => void copy()}>
          <CopyIcon size={13} weight="bold" />
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <span className="text-ink-faint text-[11px] leading-relaxed">{note}</span>
    </div>
  );
}
