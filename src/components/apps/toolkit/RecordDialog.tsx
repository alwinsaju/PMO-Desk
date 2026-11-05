"use client";

import {
  Fragment,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
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
import { formSections } from "@/lib/registers/layout";
import {
  applyFieldChange,
  defaultValues,
  fieldErrors,
  recordTitle,
  sanitizeValues,
  textOf,
} from "@/lib/registers/records";
import { duplicateValues } from "@/lib/registers/duplicate";
import { suggestSpecFor } from "@/lib/registers/registerSuggest";
import { recordText } from "@/lib/registers/recordText";
import { afterSave, versionFields, type Seen } from "@/lib/registers/versionChain";
import { recordWarnings } from "@/lib/registers/warnings";
import { todoSeed } from "@/lib/registers/reports";
import type { FieldValue, RegisterDef, RegisterRecord } from "@/lib/registers/types";
import { todayIso } from "@/lib/staff/dates";
import type { Person } from "@/lib/registers/timesheets";
import { useMyFirstName } from "@/components/people/useMyFirstName";
import { CopyDetailsButton } from "@/components/platform/CopyDetailsButton";
import { FieldInput } from "./FieldInput";
import { RecordHistory } from "./RecordHistory";
import { removeWithUndo } from "./removeWithUndo";
import { SuggestControl } from "./SuggestControl";
import { createTodoFrom } from "./todoBridge";
import { useProjectNames } from "./useProjectNames";
import { emailOf } from "./usePeople";
import type { RegisterState } from "./useRegister";
import type { RegisterReply } from "./registersApi";

export type Values = Record<string, FieldValue>;

export interface ExtrasContext {
  values: Values;
  setValues: (next: Values) => void;
  record: RegisterRecord | null;
  /** Save the record as it is now (used by panels that act on a saved record). */
  saveNow: () => Promise<RegisterRecord | null>;
  /** Save the open record with exactly these values. It sends the version this form last saw and remembers the one the server returns, so a panel and the form's own Save never refuse each other. */
  saveRecord: (
    values: Values,
    todoId?: string,
  ) => Promise<RegisterReply<{ items: RegisterRecord[] }>>;
  /** Change fields whose new value a panel has already saved itself (e.g. a count of to-dos made), so closing the form does not ask about them. */
  commit: (partial: Values) => void;
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
  initialValues,
  onDuplicate,
  repair = false,
}: {
  def: RegisterDef;
  record: RegisterRecord | null;
  state: RegisterState;
  people: readonly Person[];
  names: readonly string[];
  onClose: () => void;
  renderExtras?: (ctx: ExtrasContext) => ReactNode;
  /** Field values a new record starts with (a duplicate); ignored when editing a record. */
  initialValues?: Values;
  /** Duplicate: the parent opens a new, unsaved record with these values. */
  onDuplicate?: (values: Values) => void;
  /** The record is one that fails the checks: saving fixes it in place. It cannot be deleted, duplicated or turned into a to-do from here. */
  repair?: boolean;
}) {
  const today = todayIso();
  const [values, setValues] = useState<Values>(() => ({
    ...defaultValues(def, today),
    ...(record?.values ?? initialValues ?? {}),
  }));
  /** What the form held when it opened, key by key, to tell whether anything was typed. */
  const baseline = useRef<Values>(values);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const dirty = Object.keys(values).some(
    (key) => JSON.stringify(values[key]) !== JSON.stringify(baseline.current[key]),
  );
  const commit = (partial: Values) => {
    baseline.current = { ...baseline.current, ...partial };
    setValues((cur) => ({ ...cur, ...partial }));
  };
  /** The version of the saved record this form last saw: the one it opened with, then the one each save here returned. */
  const seen = useRef<Seen>({
    base: record?.updatedAt || undefined,
    todoId: record?.todoId,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ reason: string; detail?: string } | null>(null);
  const [attempted, setAttempted] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const me = useMyFirstName();
  const projects = useProjectNames(def.fields.some((f) => f.suggest === "projects"));
  const problems = useMemo(() => fieldErrors(def, values), [def, values]);
  const warnings = useMemo(
    () => recordWarnings(def, values, state.items, record?.id ?? null, today),
    [def, values, state.items, record?.id, today],
  );
  const problemCount = Object.keys(problems).length;
  const sections = useMemo(() => formSections(def), [def]);
  // Change requests (impact note) and lessons (Category) get a "Suggest" button; no other register does.
  const suggestSpec = suggestSpecFor(def);
  const suggestControl = suggestSpec && (
    <SuggestControl
      tool={def.id}
      spec={suggestSpec}
      values={values}
      disabled={busy}
      onApply={(value) => setValues((cur) => ({ ...cur, [suggestSpec.field]: value }))}
    />
  );

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

  const requestClose = () => {
    if (dirty && !busy) setConfirmDiscard(true);
    else onClose();
  };

  const saveRecord: ExtrasContext["saveRecord"] = async (vals, todoId) => {
    const reply = await state.save([
      {
        id: record?.id,
        values: vals,
        ...versionFields(seen.current, record !== null, todoId),
      },
    ]);
    if (reply.ok && record)
      seen.current = afterSave(seen.current, record.id, reply.items);
    return reply;
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
    const reply = await saveRecord(check.values);
    setBusy(false);
    if (!reply.ok) {
      setError({ reason: reply.reason, detail: reply.detail });
      return null;
    }
    baseline.current = values;
    return (
      reply.items.find((i) => i.id === record?.id) ??
      [...reply.items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ??
      null
    );
  };

  const save = async () => {
    if (await saveNow()) onClose();
  };

  /** Enter in a one-line box saves, like the Save button; in a multi-line box, a list or a button it keeps its usual meaning. */
  const submitOnEnter = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.nativeEvent.isComposing ||
      target.tagName !== "INPUT" ||
      ["checkbox", "radio", "button", "submit"].includes(
        (target as HTMLInputElement).type,
      )
    ) {
      return;
    }
    event.preventDefault();
    if (!busy) void save();
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
    const reply = await saveRecord(saved.values, made.todoId);
    setBusy(false);
    if (!reply.ok) setError({ reason: reply.reason, detail: reply.detail });
    else {
      toast({ tone: "success", message: "Made a to-do in PMO To-Do." });
      onClose();
    }
  };

  /** Copy the record as it is in the form now, as plain text for an email or minutes. */
  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(recordText(def, draftRecord, alert?.text).text);
      toast({ tone: "success", message: "Copied." });
    } catch {
      toast({ tone: "danger", message: "Could not copy to the clipboard." });
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
    <Dialog open onOpenChange={(open) => !open && requestClose()}>
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
          onKeyDown={submitOnEnter}
          className="scroll-thin -mx-2 mt-3 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2 py-1"
        >
          {sections.map((section) => (
            <fieldset key={section.title} className="min-w-0" data-testid="form-section">
              <legend className="text-ink-muted mb-2 text-[11.5px] font-bold tracking-[0.06em] uppercase">
                {section.title}
              </legend>
              <div className="grid grid-cols-2 content-start gap-3">
                {section.fields.map((field) => (
                  <Fragment key={field.key}>
                    <FieldInput
                      field={field}
                      value={values[field.key]}
                      onChange={(v) =>
                        setValues((cur) =>
                          applyFieldChange(def, cur, field.key, v, today),
                        )
                      }
                      people={names}
                      projects={projects}
                      error={problems[field.key]}
                      warning={warnings[field.key]}
                      showErrorNow={attempted}
                    />
                    {suggestSpec?.placement === "after-field" &&
                      field.key === suggestSpec.field &&
                      suggestControl}
                  </Fragment>
                ))}
                {suggestSpec?.placement === "end-of-section" &&
                  section.fields.some((f) => f.key === suggestSpec.field) &&
                  suggestControl}
              </div>
            </fieldset>
          ))}
          {renderExtras && (
            <div>
              {renderExtras({ values, setValues, record, saveNow, saveRecord, commit })}
            </div>
          )}
          {record && !repair && <RecordHistory def={def} recordId={record.id} />}
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
        {confirmDiscard && (
          <div
            role="alertdialog"
            aria-label="Discard your changes?"
            className="bg-amber-soft rounded-control mt-2 flex shrink-0 flex-wrap items-center gap-2 px-3 py-2 text-[13px]"
          >
            <span className="text-ink flex-1 font-medium">
              You have typed changes that are not saved. Close without saving them?
            </span>
            <Button size="sm" variant="outline" onClick={() => setConfirmDiscard(false)}>
              Keep editing
            </Button>
            <Button size="sm" variant="destructive-quiet" onClick={onClose}>
              Discard changes
            </Button>
          </div>
        )}
        <div className="mt-4 flex shrink-0 flex-wrap items-center gap-2">
          {record && !repair && (
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
            !repair &&
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
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void copyText()}
          >
            Copy as text
          </Button>
          {record && !repair && onDuplicate && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => onDuplicate(duplicateValues(def, { values }))}
            >
              Duplicate
            </Button>
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
          <Button variant="outline" onClick={requestClose}>
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
