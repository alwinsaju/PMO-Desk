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
} from "@/components/ui";
import {
  DEFAULT_REPORT_TITLE,
  DEFAULT_RETENTION_DAYS,
  MAX_CHASER_DAYS,
  MAX_LEAD_WORKING_DAYS,
  MAX_REPORT_TITLE_CHARS,
  MAX_RETENTION_DAYS,
  MIN_RETENTION_DAYS,
  type PmoState,
} from "@/lib/pmo/types";
import { updateConfig } from "./api";
import { ErrorLine, Field, FieldError, FilterPill, ScrollBody, TextArea } from "./parts";
import { NotificationStatus } from "./RemindersNotice";
import { useRemindersStore } from "./remindersStore";
import {
  buildPatch,
  formFromConfig,
  type FormText,
  type ListField,
  type RemindersForm,
} from "./settingsForm";

const WEEKDAYS = [
  { day: 1, label: "Mon" },
  { day: 2, label: "Tue" },
  { day: 3, label: "Wed" },
  { day: 4, label: "Thu" },
  { day: 5, label: "Fri" },
  { day: 6, label: "Sat" },
  { day: 0, label: "Sun" },
];

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
  const desktop = useRemindersStore((s) => s.desktop);
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
  const setReminders = (patch: Partial<RemindersForm>) =>
    set({ reminders: { ...form.reminders, ...patch } });
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
      {hint && <span className="text-ink-muted text-[12px] leading-relaxed">{hint}</span>}
      <FieldError message={errors[field]} />
    </Field>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-full max-w-2xl flex-col px-[30px] pt-7 pb-6">
        <DialogTitle className="shrink-0">PMO settings</DialogTitle>
        <DialogDescription className="shrink-0">
          One entry per line. Changes apply to the next scan; nothing already in the queue
          is re-filtered.
        </DialogDescription>

        <ScrollBody className="mt-4 pr-2">
          <div className="flex flex-col gap-7">
            <Section title="About you">
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                {listBox(
                  "names",
                  "Your names and aliases",
                  "Pat Example",
                  4,
                  "How the model recognises a request addressed to you (first name, nickname, ...).",
                )}
                {listBox("emails", "Your email addresses", "you@company.com", 4)}
              </div>
            </Section>

            <Section title="Who is allowed in">
              {listBox(
                "allowedSenderDomains",
                "Allowed sender domains (Outlook)",
                "company.com",
                2,
                "Email from any other domain is filtered. Subdomains match (us.company.com matches company.com).",
              )}
              {listBox(
                "allowedTenantIds",
                "Allowed Teams tenant IDs",
                "00000000-0000-0000-0000-000000000000",
                2,
                <>
                  Teams is blocked until a tenant or chat is listed.{" "}
                  <strong className="text-ink-soft">How to find your tenant ID:</strong>{" "}
                  the Teams flow sends it (Recipe B), so the easiest way is{" "}
                  <em>Allow this tenant</em> on a filtered Teams item. It is also in a
                  Teams message link after <code className="font-mono">?tenantId=</code>,
                  and in the flow&apos;s run history (the trigger card, under{" "}
                  <code className="font-mono">ChannelData</code>, <em>Tenant</em>,{" "}
                  <code className="font-mono">Id</code>).
                </>,
              )}
              {listBox(
                "teamsChatAllowlist",
                "Allowed Teams chat IDs (optional)",
                "19:xxxxxxxx@thread.v2",
                2,
                <>
                  Lets one chat in without allowing the whole tenant (useful when the flow
                  cannot supply a tenant ID). The value is the{" "}
                  <strong className="text-ink-soft">Conversation ID</strong> the flow
                  sends, something like{" "}
                  <code className="font-mono">19:...@thread.v2</code> or{" "}
                  <code className="font-mono">19:...@unq.gbl.spaces</code>. It is shown on
                  a filtered Teams item in the Filtered tab, next to{" "}
                  <em>Allow this chat</em>. Each chat is listed on its own.
                </>,
              )}
            </Section>

            <Section title="Always blocked">
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                {listBox(
                  "blockedDomains",
                  "Blocked domains",
                  "other-company.example",
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
                <span className="text-ink-muted text-[12px] leading-relaxed">
                  {MIN_RETENTION_DAYS} to {MAX_RETENTION_DAYS} days, default{" "}
                  {DEFAULT_RETENTION_DAYS}. After this, logs and the saved message text of
                  a closed to-do or a rejected item are deleted daily. Open to-dos keep
                  their message. Filtered records and unreadable files are cleared after
                  30 days.
                </span>
                <FieldError message={errors.retentionDays} />
              </Field>
            </Section>

            <Section title="Weekly report">
              <p className="text-ink-muted text-[12px] leading-relaxed">
                The heading of the Reports tab&apos;s weekly status. The report covers the
                to-dos in this app only, and nothing in it is sent anywhere.
              </p>
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                <Field label="Report title">
                  <Input
                    value={form.reportTitle}
                    disabled={busy}
                    maxLength={MAX_REPORT_TITLE_CHARS}
                    placeholder={DEFAULT_REPORT_TITLE}
                    aria-invalid={errors["report.title"] ? true : undefined}
                    onChange={(event) => set({ reportTitle: event.target.value })}
                  />
                  <FieldError message={errors["report.title"]} />
                </Field>
                <Field label="Project name (optional)">
                  <Input
                    value={form.reportProject}
                    disabled={busy}
                    maxLength={MAX_REPORT_TITLE_CHARS}
                    placeholder="Shown before the title"
                    aria-invalid={errors["report.projectName"] ? true : undefined}
                    onChange={(event) => set({ reportProject: event.target.value })}
                  />
                  <FieldError message={errors["report.projectName"]} />
                </Field>
              </div>
              <span className="text-ink-muted text-[12px] leading-relaxed">
                Saved reports are kept on this computer until you delete them; they are
                never purged by the retention setting above.
              </span>
            </Section>

            <Section title="Reminders">
              <p className="text-ink-muted text-[12px] leading-relaxed">
                Reminders are shown on this computer only; nothing is sent to anyone. A
                to-do is reminded when it is due tomorrow (once), overdue (at the start of
                the working day, then every working day), or when you are waiting on
                someone and nothing has changed for a few working days.
              </p>
              <CheckRow
                checked={form.reminders.enabled}
                disabled={busy}
                onChange={(enabled) => setReminders({ enabled })}
                label="Remind me about to-dos that need attention"
              />
              <CheckRow
                checked={form.reminders.hideDetails}
                disabled={busy}
                onChange={(hideDetails) => setReminders({ hideDetails })}
                label="Hide task details in notifications"
                hint={
                  'On (recommended): a notification only says "PMO To-Do: N items need attention", so a title never shows on a shared screen or in the notification centre. Off: it shows the task title.'
                }
              />
              <CheckRow
                checked={form.reminders.quietOutsideHours}
                disabled={busy}
                onChange={(quietOutsideHours) => setReminders({ quietOutsideHours })}
                label="Stay quiet outside working hours"
                hint="Held reminders appear when the working day starts."
              />
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
                <Field label="Day starts">
                  <Input
                    type="time"
                    value={form.reminders.workStart}
                    disabled={busy}
                    aria-invalid={errors["reminders.workStart"] ? true : undefined}
                    onChange={(event) => setReminders({ workStart: event.target.value })}
                  />
                  <FieldError message={errors["reminders.workStart"]} />
                </Field>
                <Field label="Day ends">
                  <Input
                    type="time"
                    value={form.reminders.workEnd}
                    disabled={busy}
                    aria-invalid={errors["reminders.workEnd"] ? true : undefined}
                    onChange={(event) => setReminders({ workEnd: event.target.value })}
                  />
                  <FieldError message={errors["reminders.workEnd"]} />
                </Field>
                <Field label="Time zone">
                  <Input
                    value={form.reminders.timeZone}
                    disabled={busy}
                    spellCheck={false}
                    aria-invalid={errors["reminders.timeZone"] ? true : undefined}
                    onChange={(event) => setReminders({ timeZone: event.target.value })}
                  />
                  <FieldError message={errors["reminders.timeZone"]} />
                </Field>
              </div>
              <Field label="Working days">
                <div
                  className="flex flex-wrap gap-1.5"
                  role="group"
                  aria-label="Working days"
                >
                  {WEEKDAYS.map(({ day, label }) => {
                    const on = form.reminders.workDays.includes(day);
                    return (
                      <FilterPill
                        key={day}
                        active={on}
                        disabled={busy}
                        onClick={() =>
                          setReminders({
                            workDays: on
                              ? form.reminders.workDays.filter((d) => d !== day)
                              : [...form.reminders.workDays, day],
                          })
                        }
                      >
                        {label}
                      </FilterPill>
                    );
                  })}
                </div>
                <FieldError message={errors["reminders.workDays"]} />
              </Field>
              <Field label="Heads-up before a due date (working days)">
                <Input
                  inputMode="numeric"
                  value={form.reminders.leadWorkingDays}
                  disabled={busy}
                  className="w-32"
                  aria-invalid={errors["reminders.leadWorkingDays"] ? true : undefined}
                  onChange={(event) =>
                    setReminders({ leadWorkingDays: event.target.value })
                  }
                />
                <span className="text-ink-muted text-[12px] leading-relaxed">
                  0 to {MAX_LEAD_WORKING_DAYS}. With 1, an item due on a Monday is
                  reminded on the Friday before. 0 sends no heads-up, only the reminder on
                  the due day.
                </span>
                <FieldError message={errors["reminders.leadWorkingDays"]} />
              </Field>
              <Field label="Chase after (working days without an update)">
                <Input
                  inputMode="numeric"
                  value={form.reminders.chaserDays}
                  disabled={busy}
                  className="w-32"
                  aria-invalid={errors["reminders.chaserDays"] ? true : undefined}
                  onChange={(event) => setReminders({ chaserDays: event.target.value })}
                />
                <span className="text-ink-muted text-[12px] leading-relaxed">
                  1 to {MAX_CHASER_DAYS}. Only to-dos with &quot;waiting on&quot; filled
                  in get a chaser, and again after each further stretch of the same
                  length.
                </span>
                <FieldError message={errors["reminders.chaserDays"]} />
              </Field>
              <CheckRow
                checked={form.reminders.digest}
                disabled={busy}
                onChange={(digest) => setReminders({ digest })}
                label="Morning digest of all open to-dos"
                hint="One summary when the working day starts. Off by default."
              />
              <CheckRow
                checked={form.reminders.keepRunningInTray}
                disabled={busy}
                onChange={(keepRunningInTray) => setReminders({ keepRunningInTray })}
                label="Keep running in the tray so reminders still fire"
                hint={
                  desktop
                    ? "Desktop app: closing the window hides AI OS to the system tray instead of quitting. Use the tray icon's Quit to exit completely. Off by default."
                    : "Desktop app only; it has no effect in a browser. When on, closing the window hides AI OS to the tray instead of quitting. Off by default."
                }
              />
              <NotificationStatus attention={state.attention.count} />
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
        </ScrollBody>

        {serverError && <ErrorLine className="mt-3 shrink-0">{serverError}</ErrorLine>}
        {Object.keys(errors).length > 0 && (
          <ErrorLine className="mt-3 shrink-0">
            Fix the highlighted fields to save.
          </ErrorLine>
        )}
        <div className="border-line mt-4 flex shrink-0 items-center justify-end gap-2.5 border-t pt-4">
          {saved && (
            <span className="text-success mr-auto text-[13px] font-semibold">Saved.</span>
          )}
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
    <section className="flex flex-col gap-3.5">
      <h3 className="text-ink-muted border-line border-b pb-2 text-[11px] font-bold tracking-[0.08em] uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

function CheckRow({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-start gap-3">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="accent-accent focus-visible:ring-focus mt-0.5 h-4 w-4 shrink-0 focus-visible:ring-2"
      />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-ink text-[13.5px] font-medium">{label}</span>
        {hint && (
          <span className="text-ink-muted text-[12px] leading-relaxed">{hint}</span>
        )}
      </span>
    </label>
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
    <div className="flex flex-col gap-1.5">
      <span className="text-ink-muted text-[11px] font-bold tracking-[0.08em] uppercase">
        {label}
      </span>
      <div className="flex items-center gap-2">
        <code className="bg-chip text-ink rounded-control min-w-0 flex-1 px-3.5 py-2 font-mono text-[12px] break-all select-all">
          {value}
        </code>
        <Button variant="secondary" size="sm" onClick={() => void copy()}>
          <CopyIcon size={13} weight="bold" />
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <span className="text-ink-muted text-[12px] leading-relaxed">{note}</span>
    </div>
  );
}
