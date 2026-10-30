"use client";

import { useEffect, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
} from "@/components/ui";
import { toast } from "@/lib/notifications/toastStore";
import { fetchLibrary } from "../templates-app/api";
import { Field, NativeSelect, TextArea } from "../pmo-todo-app/parts";
import { createMailer, type MailerAnswers } from "./packsApi";
import { PackErrorLine, type PackErrorState } from "./PackErrorLine";

const EMPTY: MailerAnswers = {
  name: "",
  to: "",
  cc: "",
  subject: "",
  body: "",
  templateName: "",
  tableType: "xlsx",
  columns: [],
  attachTable: false,
};

/** Answers a person can give without knowing about packs: who, what to say, and what table to send. */
export function MailerWizardDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [answers, setAnswers] = useState<MailerAnswers>(EMPTY);
  const [columns, setColumns] = useState("");
  const [templates, setTemplates] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<PackErrorState | null>(null);

  useEffect(() => {
    void (async () => {
      const reply = await fetchLibrary().catch(() => null);
      if (reply?.ok) {
        setTemplates(
          reply.templates.filter((t) => t.kind === "email").map((t) => t.name),
        );
      }
    })();
  }, []);

  const set = <K extends keyof MailerAnswers>(key: K, value: MailerAnswers[K]) =>
    setAnswers((a) => ({ ...a, [key]: value }));

  const create = async () => {
    setBusy(true);
    setError(null);
    const reply = await createMailer({
      ...answers,
      columns: columns
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean),
    });
    setBusy(false);
    if (!reply.ok) {
      setError({ reason: reply.reason, detail: reply.detail });
      return;
    }
    toast({
      tone: "success",
      message: `Created “${reply.pack.name}”. Find it under Workflows.`,
    });
    onCreated();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[640px]">
        <DialogTitle>New mailer from a table</DialogTitle>
        <DialogDescription>
          Each run takes a table you upload, makes an email draft with it, and stops for
          your review. Nothing is sent without your approval.
        </DialogDescription>
        <div className="mt-3 flex max-h-[60vh] flex-col gap-3 overflow-y-auto pr-1">
          <Field label="Name">
            <Input
              value={answers.name}
              onChange={(e) => set("name", e.target.value)}
              aria-label="Mailer name"
              placeholder="Weekly vendor mail"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="To">
              <Input
                value={answers.to}
                onChange={(e) => set("to", e.target.value)}
                aria-label="To"
                placeholder="team@example.com"
              />
            </Field>
            <Field label="Cc">
              <Input
                value={answers.cc}
                onChange={(e) => set("cc", e.target.value)}
                aria-label="Cc"
              />
            </Field>
          </div>
          <Field label="Wording from a template">
            <NativeSelect
              value={answers.templateName}
              onChange={(e) => set("templateName", e.target.value)}
              aria-label="Template"
            >
              <option value="">None: write it below</option>
              {templates.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Subject">
            <Input
              value={answers.subject}
              onChange={(e) => set("subject", e.target.value)}
              aria-label="Subject"
              placeholder="Vendors: {{rows}} items on {{date}}"
            />
          </Field>
          <Field label="Message">
            <TextArea
              rows={5}
              value={answers.body}
              onChange={(e) => set("body", e.target.value)}
              aria-label="Message"
              placeholder={"Hello,\n\nHere are the {{rows}} items.\n\nThanks"}
            />
          </Field>
          <p className="text-ink-muted text-[12px]">
            Use {"{{rows}}"}, {"{{date}}"} and {"{{columns}}"} in the subject and message.
            A template chosen above wins; this wording is the fallback.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="The table is">
              <NativeSelect
                value={answers.tableType}
                onChange={(e) => set("tableType", e.target.value as "xlsx" | "csv")}
                aria-label="Table type"
              >
                <option value="xlsx">An Excel file (.xlsx)</option>
                <option value="csv">A CSV file (.csv)</option>
              </NativeSelect>
            </Field>
            <Field label="Columns to show (optional)">
              <Input
                value={columns}
                onChange={(e) => setColumns(e.target.value)}
                aria-label="Columns"
                placeholder="Vendor, Amount"
              />
            </Field>
          </div>
          <label className="text-ink-soft flex items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              checked={answers.attachTable}
              onChange={(e) => set("attachTable", e.target.checked)}
            />
            Also attach the table to the email
          </label>
          {error && <PackErrorLine error={error} />}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={busy || answers.name.trim().length < 3}
            onClick={() => void create()}
          >
            {busy ? "Creating…" : "Create mailer"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
