"use client";

import { useMemo, useState } from "react";
import { CheckIcon, CopyIcon, EnvelopeSimpleIcon } from "@phosphor-icons/react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui";
import { buildMailto } from "@/lib/pmo/chaser";
import {
  blockedState,
  dependentsOf,
  escalationSuggestion,
  escalationText,
  handoffNote,
  wouldCycle,
} from "@/lib/pmo/pmoViews";
import type { TodoPatch } from "@/lib/pmo/todoLogic";
import type { PmoConfig, ReminderPrefs, Todo } from "@/lib/pmo/types";
import { useEmployees } from "@/lib/staff/staffStore";
import { Field, Note, TextArea } from "./parts";
import { useTemplateText } from "../templates-app/useTemplateText";
import { formatDay } from "./queueView";

const SELECT =
  "rounded-control border-line bg-surface-elevated text-ink focus-visible:ring-focus h-9 w-full border px-2.5 text-[13px] outline-none focus-visible:ring-2";

const myName = (me: PmoConfig["me"]) => me.names[0] ?? "";

/** "Blocked by": the open to-dos this one waits for. A warning appears when a blocker is late or due after this one. */
export function BlockedByField({
  todo,
  all,
  today,
  busy,
  apply,
}: {
  todo: Todo;
  all: readonly Todo[];
  today: string;
  busy: boolean;
  apply: (patch: TodoPatch) => Promise<boolean>;
}) {
  const state = blockedState(todo, all, today);
  // Every open to-do is tested for a loop, so keep the result until the list changes.
  const candidates = useMemo(
    () =>
      all.filter(
        (t) =>
          t.status === "open" &&
          !todo.blockedBy.includes(t.id) &&
          !wouldCycle(todo.id, t.id, all),
      ),
    [all, todo.id, todo.blockedBy],
  );
  const dependents = dependentsOf(todo, all);

  return (
    <Field label="Blocked by">
      {state.blockers.length > 0 && (
        <ul className="mb-2 flex flex-col gap-1.5" data-testid="blockers">
          {state.blockers.map((b) => (
            <li
              key={b.id}
              className="bg-chip rounded-control flex items-center justify-between gap-2 px-2.5 py-1.5 text-[13px]"
            >
              <span className="min-w-0 truncate">
                {b.title}
                {b.dueAt ? ` · due ${formatDay(b.dueAt, today)}` : ""}
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() =>
                  void apply({ blockedBy: todo.blockedBy.filter((id) => id !== b.id) })
                }
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      {state.atRisk && (
        <Note tone="warning" className="mb-2 text-[12.5px]">
          A blocker is overdue or due after this to-do, so this date may slip.
        </Note>
      )}
      <select
        aria-label="Add a blocker"
        className={SELECT}
        disabled={busy || candidates.length === 0}
        value=""
        onChange={(e) => {
          if (e.target.value)
            void apply({ blockedBy: [...todo.blockedBy, e.target.value] });
        }}
      >
        <option value="">
          {candidates.length === 0 ? "No other open to-dos" : "Add a blocker…"}
        </option>
        {candidates.map((t) => (
          <option key={t.id} value={t.id}>
            {t.title}
          </option>
        ))}
      </select>
      {dependents.length > 0 && (
        <p className="text-ink-muted mt-1.5 text-[12px]" data-testid="dependents">
          Blocking {dependents.length}: {dependents.map((d) => d.title).join(", ")}
        </p>
      )}
    </Field>
  );
}

/** After several chasers with no reply, suggest an escalation. The mail opens unsent. */
export function EscalationNote({
  todo,
  nowIso,
  prefs,
  me,
}: {
  todo: Todo;
  nowIso: string;
  prefs: ReminderPrefs;
  me: PmoConfig["me"];
}) {
  const escalationTpl = useTemplateText("app:pmo-todo:escalation");
  const suggestion = escalationSuggestion(todo, new Date(nowIso), prefs);
  if (!suggestion) return null;
  const text = escalationTpl.fill(
    {
      title: todo.title,
      waiting_on: todo.waitingOn ?? "a reply",
      due: todo.dueAt ?? "",
      my_name: myName(me),
    },
    escalationText(todo, myName(me)),
  );
  const mailto = buildMailto({ subject: text.subject, body: text.body });
  return (
    <Note
      tone="warning"
      className="flex flex-wrap items-center justify-between gap-2"
      data-testid="escalation"
    >
      <p className="text-ink text-[13px] font-semibold">{suggestion}</p>
      {mailto.ok ? (
        <Button variant="outline" size="sm" asChild>
          <a href={mailto.url} onClick={escalationTpl.used}>
            <EnvelopeSimpleIcon size={14} />
            Open escalation as unsent mail
          </a>
        </Button>
      ) : (
        <span className="text-ink-muted text-[12px]">{mailto.reason}</span>
      )}
    </Note>
  );
}

/** Hand a to-do to a teammate from the Staff directory: sets the owner and gives a note to send yourself. */
export function HandoffDialog({
  todo,
  me,
  open,
  busy,
  apply,
  onOpenChange,
}: {
  todo: Todo;
  me: PmoConfig["me"];
  open: boolean;
  busy: boolean;
  apply: (patch: TodoPatch) => Promise<boolean>;
  onOpenChange: (open: boolean) => void;
}) {
  const employees = useEmployees();
  const [pick, setPick] = useState("");
  const [copied, setCopied] = useState(false);
  const person = employees.find((e) => e.id === pick) ?? null;
  const name = person ? `${person.firstName} ${person.lastName}`.trim() : "";
  const handoffTpl = useTemplateText("app:pmo-todo:handoff", open);
  const builtIn = person
    ? {
        subject: `Handover: ${todo.title}`,
        body: handoffNote(todo, person.firstName, myName(me)),
      }
    : null;
  const filled =
    person && builtIn
      ? handoffTpl.fill(
          {
            first_name: person.firstName,
            title: todo.title,
            due: todo.dueAt ?? "",
            priority: todo.priority,
            stage: todo.checkpoints.find((c) => c.state === "pending")?.label ?? "",
            waiting_on: todo.waitingOn ?? "",
            background: todo.description.trim(),
            still_to_do: todo.actionItems
              .filter((a) => !a.done)
              .map((a) => `- ${a.text}`)
              .join("\n"),
            my_name: myName(me),
          },
          builtIn,
        )
      : null;
  const note = filled?.body ?? "";
  const mailto = person
    ? buildMailto({
        to: person.deloitteEmail,
        subject: filled?.subject ?? `Handover: ${todo.title}`,
        body: note,
      })
    : null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(note);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const assign = async () => {
    if (!person) return;
    const done = await apply({
      owner: { name, email: person.deloitteEmail, isMe: false },
    });
    if (done) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[520px]">
        <DialogTitle>Hand over this to-do</DialogTitle>
        <DialogDescription>
          Choose a teammate. This sets them as the owner. Nothing is sent: copy the note
          or open it as an unsent mail.
        </DialogDescription>
        <div className="mt-3 flex flex-col gap-3">
          <Field label="Hand over to">
            <select
              aria-label="Hand over to"
              className={SELECT}
              value={pick}
              onChange={(e) => setPick(e.target.value)}
            >
              <option value="">
                {employees.length === 0 ? "No one in the Staff directory" : "Choose…"}
              </option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {`${e.firstName} ${e.lastName}`.trim()}
                </option>
              ))}
            </select>
          </Field>
          {person && (
            <TextArea
              aria-label="Handover note"
              readOnly
              value={note}
              className="min-h-40"
            />
          )}
        </div>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button variant="outline" disabled={!person} onClick={() => void copy()}>
            {copied ? <CheckIcon size={14} weight="bold" /> : <CopyIcon size={14} />}
            {copied ? "Copied" : "Copy note"}
          </Button>
          {mailto?.ok && (
            <Button variant="outline" asChild>
              <a href={mailto.url} onClick={handoffTpl.used}>
                <EnvelopeSimpleIcon size={14} />
                Open as unsent mail
              </a>
            </Button>
          )}
          <Button disabled={!person || busy} onClick={() => void assign()}>
            Make them the owner
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
