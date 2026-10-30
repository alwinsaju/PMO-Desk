"use client";

import { useEffect, useMemo, useState } from "react";
import { EnvelopeSimpleIcon } from "@phosphor-icons/react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
} from "@/components/ui";
import { fetchState } from "../pmo-todo-app/api";
import { buildMailto } from "@/lib/pmo/chaser";
import { cleanTags } from "@/lib/templates/library";
import { renderFields, snippetsFrom, stripBold } from "@/lib/templates/render";
import { sampleValues } from "@/lib/templates/targets";
import type { Template, TemplateInput, TemplateVariant } from "@/lib/templates/types";
import { saveTemplate } from "./api";
import { Field, TextArea } from "../pmo-todo-app/parts";

const inputOf = (t: Template, extra: Partial<TemplateInput> = {}): TemplateInput => ({
  name: t.name,
  kind: t.kind,
  description: t.description,
  subject: t.subject,
  to: t.to,
  cc: t.cc,
  body: t.body,
  usedBy: t.usedBy,
  ...(t.starterId ? { starterId: t.starterId } : {}),
  ...extra,
});

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const changedFields = (
  a: Template,
  v: Template["history"] extends (infer V)[] | undefined ? V : never,
) =>
  (["name", "description", "subject", "to", "cc", "body"] as const).filter(
    (f) => a[f] !== v[f],
  );

/**
 * The parts of a template that sit beside its main wording: tags, other wordings for other readers, earlier
 * saved versions (with restore) and a test draft to yourself. Each saves on its own, straight to the saved
 * template, so the main editor's unsaved text is never touched.
 */
export function TemplateExtrasDialog({
  template,
  templates,
  open,
  onOpenChange,
  onChanged,
}: {
  template: Template;
  templates: readonly Template[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const [tags, setTags] = useState((template.tags ?? []).join(", "));
  const [variants, setVariants] = useState<TemplateVariant[]>(template.variants ?? []);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [myEmail, setMyEmail] = useState("");

  useEffect(() => {
    if (!open) return;
    setTags((template.tags ?? []).join(", "));
    setVariants(template.variants ?? []);
    setMessage(null);
    void fetchState()
      .then((s) => setMyEmail(s.config.me.emails[0] ?? ""))
      .catch(() => setMyEmail(""));
  }, [open, template]);

  const snippets = useMemo(() => snippetsFrom(templates), [templates]);

  const persist = async (extra: Partial<TemplateInput>, done: string) => {
    setBusy(true);
    setMessage(null);
    const reply = await saveTemplate(template.id, inputOf(template, extra)).catch(
      () => null,
    );
    setBusy(false);
    if (!reply || !reply.ok) {
      setMessage(reply ? reply.reason : "Could not reach the app server.");
      return;
    }
    setMessage(done);
    onChanged();
  };

  const test = useMemo(() => {
    const values = sampleValues(template.usedBy.length > 0 ? template.usedBy : []);
    const r = renderFields(
      { subject: template.subject, to: "", cc: "", body: stripBold(template.body) },
      values,
      snippets,
    );
    return buildMailto({ to: myEmail, subject: `[Test] ${r.subject}`, body: r.body });
  }, [template, snippets, myEmail]);

  const setVariant = (i: number, patch: Partial<TemplateVariant>) =>
    setVariants((list) => list.map((v, at) => (at === i ? { ...v, ...patch } : v)));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="scroll-thin max-h-[88vh] max-w-2xl overflow-y-auto">
        <DialogTitle>More for “{template.name}”</DialogTitle>
        <DialogDescription>
          Tags, other wordings, earlier versions and a test draft. Each part saves by
          itself.
        </DialogDescription>

        <section className="mt-4 flex flex-col gap-2" aria-label="Tags">
          <Field label="Tags (comma-separated)">
            <div className="flex gap-2">
              <Input
                id="tpl-tags"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="client, weekly"
              />
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void persist({ tags: cleanTags(tags.split(",")) }, "Tags saved.")
                }
              >
                Save tags
              </Button>
            </div>
          </Field>
        </section>

        {template.kind !== "snippet" && (
          <section
            className="mt-5 flex flex-col gap-3"
            aria-label="Other wordings"
            data-testid="variants"
          >
            <h3 className="text-ink text-[14px] font-bold">Other wordings</h3>
            <p className="text-ink-muted text-[12.5px]">
              For example one for the client and one for the team. Where a template is
              used you can pick the wording; the main one is the default.
            </p>
            {variants.map((v, i) => (
              <div
                key={v.id}
                className="border-line rounded-card flex flex-col gap-2 border p-3"
              >
                <Input
                  aria-label={`Wording ${i + 1} label`}
                  value={v.label}
                  placeholder="Label, e.g. Client"
                  onChange={(e) => setVariant(i, { label: e.target.value })}
                />
                <Input
                  aria-label={`Wording ${i + 1} subject`}
                  value={v.subject}
                  placeholder="Subject (blank = same as the main one)"
                  onChange={(e) => setVariant(i, { subject: e.target.value })}
                />
                <TextArea
                  aria-label={`Wording ${i + 1} message`}
                  value={v.body}
                  className="min-h-24"
                  onChange={(e) => setVariant(i, { body: e.target.value })}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  className="self-start"
                  onClick={() => setVariants((l) => l.filter((_, at) => at !== i))}
                >
                  Remove
                </Button>
              </div>
            ))}
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={variants.length >= 5}
                onClick={() =>
                  setVariants((l) => [
                    ...l,
                    {
                      id: `v${Date.now().toString(36)}`,
                      label: "",
                      subject: "",
                      body: template.body,
                    },
                  ])
                }
              >
                Add a wording
              </Button>
              <Button
                size="sm"
                disabled={busy}
                onClick={() => void persist({ variants }, "Wordings saved.")}
              >
                Save wordings
              </Button>
            </div>
          </section>
        )}

        <section
          className="mt-5 flex flex-col gap-2"
          aria-label="Earlier versions"
          data-testid="history"
        >
          <h3 className="text-ink text-[14px] font-bold">Earlier versions</h3>
          {(template.history ?? []).length === 0 ? (
            <p className="text-ink-muted text-[12.5px]">
              No earlier versions yet. One is kept each time the wording changes.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {(template.history ?? []).map((v) => (
                <li
                  key={v.at}
                  className="border-line flex flex-wrap items-center gap-3 rounded-[8px] border px-3 py-2 text-[12.5px]"
                  data-testid="history-row"
                >
                  <span className="text-ink min-w-0 flex-1">
                    {when(v.at)} · changed since:{" "}
                    {changedFields(template, v).join(", ") || "nothing"}
                    <span className="text-ink-muted block truncate">
                      {v.subject || "(no subject)"}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void persist(
                        {
                          name: v.name,
                          description: v.description,
                          subject: v.subject,
                          to: v.to,
                          cc: v.cc,
                          body: v.body,
                        },
                        "Restored. The current wording was kept as an earlier version.",
                      )
                    }
                  >
                    Restore
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {template.kind === "email" && (
          <section className="mt-5 flex flex-col gap-2" aria-label="Test draft">
            <h3 className="text-ink text-[14px] font-bold">Send a test to yourself</h3>
            <p className="text-ink-muted text-[12.5px]">
              Opens an unsent draft in your mail program with example values filled in
              {myEmail ? ` (to ${myEmail})` : ""}. Nothing is sent from here.
            </p>
            {test.ok ? (
              <Button variant="outline" className="self-start" asChild>
                <a href={test.url} data-testid="test-send">
                  <EnvelopeSimpleIcon size={14} />
                  Open test draft
                </a>
              </Button>
            ) : (
              <p className="text-ink-muted text-[12.5px]">{test.reason}</p>
            )}
          </section>
        )}

        {message && (
          <p role="status" className="text-ink mt-4 text-[13px]">
            {message}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
