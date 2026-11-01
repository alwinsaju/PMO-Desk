"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui";
import { toast } from "@/lib/notifications/toastStore";
import { buildMailto } from "@/lib/pmo/chaser";
import { recordAlert } from "@/lib/registers/alerts";
import {
  defaultValues,
  fieldErrors,
  recordTitle,
  sanitizeValues,
  textOf,
} from "@/lib/registers/records";
import { todoSeed } from "@/lib/registers/reports";
import type { FieldValue, RegisterDef, RegisterRecord } from "@/lib/registers/types";
import { todayIso } from "@/lib/staff/dates";
import type { Person } from "@/lib/registers/timesheets";
import { useMyFirstName } from "@/components/people/useMyFirstName";
import { CopyDetailsButton } from "@/components/platform/CopyDetailsButton";
import { FieldInput } from "./FieldInput";
import { removeWithUndo } from "./removeWithUndo";
import { createTodoFrom } from "./todoBridge";
import { emailOf } from "./usePeople";
import type { RegisterState } from "./useRegister";

export type Values = Record<string, FieldValue>;

export interface ExtrasContext {
  values: Values;
  setValues: (next: Values) => void;
  record: RegisterRecord | null;
  /** Save the record as it is now (used by panels that act on a saved record). */
  saveNow: () => Promise<RegisterRecord | null>;
}

export function AlertChip({
  level,
  text,
}: {
  level: "late" | "soon" | "info";
  text: string;
}) {
  const tone =
    level === "late"
      ? "bg-red-soft text-red"
      : level === "soon"
        ? "bg-amber-soft text-amber"
        : "bg-chip text-ink-soft";
  return (
    <span
      data-testid="record-alert"
      data-level={level}
      className={`${tone} inline-block rounded-full px-2 py-0.5 text-[11.5px] font-semibold`}
    >
      {text}
    </span>
  );
}

/** Add or edit one record: its fields, an alert if it needs attention, and the actions that go with it. */
export function RecordDialog({
  def,
  record,
  state,
  people,
  names,
  onClose,
  renderExtras,
}: {
  def: RegisterDef;
  record: RegisterRecord | null;
  state: RegisterState;
  people: readonly Person[];
  names: readonly string[];
  onClose: () => void;
  renderExtras?: (ctx: ExtrasContext) => ReactNode;
}) {
  const today = todayIso();
  const [values, setValues] = useState<Values>(() => ({
    ...defaultValues(def, today),
    ...(record?.values ?? {}),
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ reason: string; detail?: string } | null>(null);
  const [attempted, setAttempted] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const me = useMyFirstName();
  const problems = useMemo(() => fieldErrors(def, values), [def, values]);
  const problemCount = Object.keys(problems).length;

  const draftRecord: RegisterRecord = {
    id: record?.id ?? "rg_000000000000",
    createdAt: record?.createdAt ?? "",
    updatedAt: record?.updatedAt ?? "",
    values,
    todoId: record?.todoId,
  };
  const alert = recordAlert(def, draftRecord, { today, config: state.config });

  // The marked fields are in the scrolling body; bring the first one into view and focus it.
  const showFirstProblem = () => {
    const first = bodyRef.current?.querySelector<HTMLElement>("[aria-invalid=true]");
    first?.scrollIntoView({ block: "center" });
    first?.focus({ preventScroll: true });
  };

  const saveNow = async (): Promise<RegisterRecord | null> => {
    const check = sanitizeValues(def, values);
    if (!check.ok) {
      setAttempted(true);
      setError(null);
      requestAnimationFrame(showFirstProblem);
      return null;
    }
    setBusy(true);
    setError(null);
    const reply = await state.save([
      { id: record?.id, values: check.values, todoId: record?.todoId },
    ]);
    setBusy(false);
    if (!reply.ok) {
      setError({ reason: reply.reason, detail: reply.detail });
      return null;
    }
    return (
      reply.items.find((i) => i.id === record?.id) ??
      [...reply.items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ??
      null
    );
  };

  const save = async () => {
    if (await saveNow()) onClose();
  };

  const remove = async () => {
    if (!record) return;
    setBusy(true);
    const reply = await removeWithUndo(def, state, record);
    setBusy(false);
    if (!reply.ok) setError({ reason: reply.reason, detail: reply.detail });
    else onClose();
  };

  const makeTodo = async () => {
    const saved = await saveNow();
    if (!saved) return;
    setBusy(true);
    const made = await createTodoFrom(todoSeed(def, saved), people);
    if (!made.ok) {
      setBusy(false);
      setError({ reason: made.reason });
      return;
    }
    const reply = await state.save([
      { id: saved.id, values: saved.values, todoId: made.todoId },
    ]);
    setBusy(false);
    if (!reply.ok) setError({ reason: reply.reason, detail: reply.detail });
    else {
      toast({ tone: "success", message: "Made a to-do in PMO To-Do." });
      onClose();
    }
  };

  const owner = def.ownerKey ? textOf(draftRecord, def.ownerKey) : "";
  const ownerEmail = owner ? emailOf(people, owner) : "";
  const chaser = ownerEmail
    ? buildMailto({
        to: ownerEmail,
        subject: `${def.title}: ${recordTitle(def, draftRecord)}`,
        body: `Hi ${owner.split(" ")[0]},\n\nCould you give me an update on “${recordTitle(def, draftRecord)}”?${alert ? ` (${alert.text})` : ""}\n\nThanks,\n${me}`.trimEnd(),
      })
    : null;
  const canChase = record !== null && chaser?.ok === true;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] max-w-[720px] flex-col">
        <DialogTitle>
          {record ? `Edit ${def.noun}` : `Add ${def.noun}`}
          {alert && (
            <span className="ml-2 align-middle">
              <AlertChip level={alert.level} text={alert.text} />
            </span>
          )}
        </DialogTitle>
        <DialogDescription>
          {def.title}. Everything stays on this computer.
        </DialogDescription>
        {/* Only the fields scroll; the buttons below stay in view. */}
        <div
          ref={bodyRef}
          className="scroll-thin -mx-2 mt-3 grid min-h-0 flex-1 grid-cols-2 content-start gap-3 overflow-y-auto px-2 py-1"
        >
          {def.fields.map((field) => (
            <FieldInput
              key={field.key}
              field={field}
              value={values[field.key]}
              onChange={(v) => setValues((cur) => ({ ...cur, [field.key]: v }))}
              people={names}
              error={problems[field.key]}
              showErrorNow={attempted}
            />
          ))}
          {renderExtras && (
            <div className="col-span-2">
              {renderExtras({ values, setValues, record, saveNow })}
            </div>
          )}
        </div>
        {error && (
          <p role="alert" className="text-red mt-2 text-[13px]">
            {error.reason}
            {error.detail && (
              <CopyDetailsButton
                message={error.reason}
                detail={error.detail}
                where={def.title}
              />
            )}
          </p>
        )}
        <div className="mt-4 flex shrink-0 flex-wrap items-center gap-2">
          {record && (
            <Button
              variant="destructive-quiet"
              size="sm"
              disabled={busy}
              onClick={() => void remove()}
            >
              Delete
            </Button>
          )}
          {record &&
            !record.todoId &&
            def.extras !== "governance" &&
            def.extras !== "minutes" && (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void makeTodo()}
              >
                Make a to-do
              </Button>
            )}
          {record?.todoId && def.extras !== "governance" && (
            <span className="text-ink-muted text-[12.5px]" data-testid="todo-made">
              A to-do was made
            </span>
          )}
          {canChase && chaser?.ok && (
            <Button variant="outline" size="sm" asChild>
              <a href={chaser.url}>Chase {owner.split(" ")[0]} (unsent mail)</a>
            </Button>
          )}
          <span className="flex-1" />
          {attempted && problemCount > 0 && (
            <span className="text-red text-[12.5px]">
              {problemCount === 1
                ? "Fix the marked field to save."
                : `Fix the ${problemCount} marked fields to save.`}
            </span>
          )}
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={() => void save()}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
