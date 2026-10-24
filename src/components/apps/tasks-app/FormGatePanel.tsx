"use client";

import {
  memo,
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { flushSync } from "react-dom";
import { CheckIcon } from "@phosphor-icons/react";
import { Badge, Button, ScrollArea } from "@/components/ui";
import { saveForm } from "./api";
import { FilterChip, GateNote, NativeSelect, SearchField } from "./GateParts";
import {
  answersToSave,
  dateFormatHint,
  effectiveAnswers,
  filterFields,
  groupFields,
  hasUserEdits,
  isAnswered,
  isEdited,
  isTextField,
  localPending,
  TEXT_MAX_CHARS,
} from "./formGate";
import { notifyGateChanged, type GateData } from "./useGateData";
import type { FormAnswers, FormField } from "./types";

interface FormGatePanelProps {
  taskId: string;
  gate: GateData;
  /** Staged-but-unsaved edits exist (drives the dialog's close guard). */
  onDirtyChange?: (dirty: boolean) => void;
  /** Lets the dialog's close guard save the staged answers (resolves true
   *  once persisted). Populated only while this panel is mounted. */
  saveRef?: RefObject<(() => Promise<boolean>) | null>;
}

/**
 * The "Answer questions" panel for a `form` gate: ask-me.json rendered as
 * compact rows grouped by `group` (Ask-me / Unclassified / New people / PTO
 * matches / Availability exceptions), a select per `select` field with
 * defaults preselected and an input box per `text` field (the schema's
 * description is its placeholder; a date field gets a non-blocking format
 * hint), a search box and a "Needs answer" filter so ~20 fields stay
 * manageable, and Save. Approve
 * lives in the action bar below the tabs and stays disabled until the
 * backend's own `pending` list is empty — Save is what empties it.
 */
/** Rows mounted before the first paint; the rest follow in a low-priority
 *  transition so opening a 50-question form shows up immediately. */
const FIRST_PAINT_ROWS = 14;

export const FormGatePanel = memo(function FormGatePanel({
  taskId,
  gate,
  onDirtyChange,
  saveRef,
}: FormGatePanelProps) {
  const form = gate.form;
  const [edits, setEdits] = useState<FormAnswers>({});
  const [query, setQuery] = useState("");
  // Typing stays instant; the filtered list re-renders in the background.
  const deferredQuery = useDeferredValue(query);
  const [onlyPending, setOnlyPending] = useState(false);
  const [revealAll, setRevealAll] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const idPrefix = useId();

  const schema = form?.schema;
  const saved = form?.answers;

  const effective = useMemo(
    () => (schema && saved ? effectiveAnswers(schema, saved, edits) : {}),
    [schema, saved, edits],
  );
  const toSave = useMemo(
    () => (schema && saved ? answersToSave(schema, saved, effective, edits) : {}),
    [schema, saved, effective, edits],
  );
  const dirty = schema && saved ? hasUserEdits(schema, saved, edits) : false;
  const pendingLocal = useMemo(
    () => (schema ? localPending(schema, effective) : []),
    [schema, effective],
  );
  const needsSave = Object.keys(toSave).length > 0;

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  // Unmounting drops anything staged, so it can no longer be "unsaved".
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  const save = useCallback(async (): Promise<boolean> => {
    if (Object.keys(toSave).length === 0) return true;
    setSaving(true);
    setSaveError(null);
    const reply = await saveForm(taskId, toSave);
    setSaving(false);
    if (!reply.ok) {
      setSaveError(reply.reason ?? "the backend rejected the save");
      return false;
    }
    setEdits({});
    gate.refetch();
    notifyGateChanged(taskId);
    return true;
  }, [taskId, toSave, gate]);

  useEffect(() => {
    if (!saveRef) return;
    saveRef.current = save;
    return () => {
      saveRef.current = null;
    };
  }, [saveRef, save]);

  const handleChange = useCallback((id: string, value: string) => {
    setEdits((current) => ({ ...current, [id]: value }));
  }, []);

  // First paint shows the first rows only; the remainder is mounted by a
  // transition (interruptible) right after, so the dialog opens at once.
  const hasForm = Boolean(schema && saved);
  useEffect(() => {
    if (!hasForm || revealAll) return;
    // After the first paint (rAF); the timeout covers a page that is not
    // painting (hidden window), so the rest of the rows still arrive.
    let done = false;
    const reveal = () => {
      if (done) return;
      done = true;
      startTransition(() => setRevealAll(true));
    };
    const frame = requestAnimationFrame(reveal);
    const timer = setTimeout(reveal, 120);
    return () => {
      done = true;
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [hasForm, revealAll]);

  const visible = useMemo(
    () =>
      schema
        ? filterFields(schema.fields, { query: deferredQuery, onlyPending }, effective)
        : [],
    [schema, deferredQuery, onlyPending, effective],
  );
  const groups = useMemo(() => {
    const shown = revealAll ? visible : visible.slice(0, FIRST_PAINT_ROWS);
    return groupFields(shown);
  }, [visible, revealAll]);

  if (gate.status === "loading" || gate.status === "idle") {
    return <GateNote>Loading questions…</GateNote>;
  }
  if (!form || !schema || !saved) {
    return <GateNote>{gate.error ?? "The questions aren't available yet."}</GateNote>;
  }

  const required = schema.fields.filter((f) => f.required).length;
  const unsavedDefaults = needsSave && !dirty;

  const focusNextPending = () => {
    // The target may be in the part that has not mounted yet.
    if (!revealAll) flushSync(() => setRevealAll(true));
    const el = listRef.current?.querySelector<HTMLSelectElement>(
      '[data-pending="true"] select, [data-pending="true"] input',
    );
    el?.focus();
    el?.scrollIntoView({ block: "center" });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-ink-muted text-[13px]" aria-live="polite">
          {required === 0 ? (
            "No required questions."
          ) : pendingLocal.length === 0 ? (
            <>
              <span className="text-ink font-semibold">All {required}</span> required
              answered
              {needsSave ? " — save to record them" : ""}
            </>
          ) : (
            <>
              <span className="text-ink font-semibold">{pendingLocal.length}</span> of{" "}
              {required} required still need an answer
            </>
          )}
        </p>
        <Button onClick={save} disabled={!needsSave || saving}>
          {saving ? "Saving…" : needsSave ? "Save answers" : "Saved"}
        </Button>
      </div>

      {unsavedDefaults && (
        <p className="text-ink-muted text-xs">
          Preselected answers are suggestions — Save records them as your answers.
        </p>
      )}
      {saveError && (
        <p className="text-red text-[13px]">Couldn&apos;t save: {saveError}</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Search people, questions…"
          label="Search questions"
          className="min-w-[10rem] flex-1"
        />
        <FilterChip active={!onlyPending} onClick={() => setOnlyPending(false)}>
          All {schema.fields.length}
        </FilterChip>
        <FilterChip active={onlyPending} onClick={() => setOnlyPending(true)}>
          Needs answer {pendingLocal.length}
        </FilterChip>
        {pendingLocal.length > 0 && (
          <Button variant="ghost" onClick={focusNextPending}>
            Next unanswered
          </Button>
        )}
      </div>

      <ScrollArea className="border-line bg-card rounded-card h-[min(22rem,46vh)] border">
        <div ref={listRef} className="flex flex-col">
          {groups.length === 0 ? (
            <GateNote>No questions match.</GateNote>
          ) : (
            groups.map(({ group, fields }) => (
              <section key={group} aria-label={group}>
                <h4 className="text-ink-muted border-line bg-pop sticky top-0 z-10 flex items-center justify-between border-b px-4 py-2 text-[11px] font-bold tracking-[0.08em] uppercase backdrop-blur-md">
                  <span>{group}</span>
                  <span className="text-ink-muted font-normal normal-case">
                    {fields.length}
                  </span>
                </h4>
                <ul className="divide-line divide-y">
                  {fields.map((field) => (
                    <FieldRow
                      key={field.id}
                      field={field}
                      domId={`${idPrefix}-${field.id}`}
                      value={effective[field.id] ?? ""}
                      savedValue={saved[field.id]}
                      edited={isEdited(field, edits[field.id], saved[field.id])}
                      willSave={field.id in toSave}
                      onChange={handleChange}
                    />
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
});

const FieldRow = memo(function FieldRow({
  field,
  domId,
  value,
  savedValue,
  edited,
  willSave,
  onChange,
}: {
  field: FormField;
  domId: string;
  value: string;
  savedValue: string | undefined;
  edited: boolean;
  /** Save would send this field (an unsaved edit or required default). */
  willSave: boolean;
  /** Stable across renders: receives the field id along with the new value. */
  onChange: (id: string, value: string) => void;
}) {
  const pending = Boolean(field.required) && !isAnswered(field, value);
  const isSaved =
    isAnswered(field, savedValue) &&
    (isTextField(field)
      ? value.trim() === (savedValue ?? "").trim()
      : savedValue === value);
  const hint = dateFormatHint(field, value);
  const hintId = `${domId}-hint`;
  return (
    <li
      data-pending={pending}
      className="grid grid-cols-1 items-center gap-x-4 gap-y-1.5 px-4 py-2.5 [contain-intrinsic-size:auto_3.5rem] [content-visibility:auto] sm:grid-cols-[minmax(0,1fr)_minmax(9rem,15rem)]"
    >
      <div className="min-w-0">
        <label
          htmlFor={domId}
          className="text-ink block text-[13.5px] font-semibold break-words"
        >
          {field.label}
          {field.required && (
            <span className="text-ink-muted ml-0.5" title="Required">
              <span aria-hidden>*</span>
              <span className="sr-only"> (required)</span>
            </span>
          )}
        </label>
        {field.description && (
          <p className="text-ink-muted text-xs break-words">{field.description}</p>
        )}
        {hint && (
          <p id={hintId} role="status" className="text-amber text-xs break-words">
            {hint}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">
        {field.type === "select" ? (
          <NativeSelect
            id={domId}
            value={value}
            onChange={(event) => onChange(field.id, event.target.value)}
            aria-invalid={pending || undefined}
          >
            {!value && <option value="">Choose…</option>}
            {(field.options ?? []).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </NativeSelect>
        ) : (
          <input
            id={domId}
            type="text"
            value={value}
            onChange={(event) => onChange(field.id, event.target.value)}
            placeholder={field.description || undefined}
            maxLength={TEXT_MAX_CHARS}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={pending || hint ? true : undefined}
            aria-describedby={hint ? hintId : undefined}
            className="rounded-control border-line-strong bg-field text-ink placeholder:text-ink-muted focus-visible:border-focus focus-visible:shadow-field-focus h-9 w-full border px-3.5 text-[13px] transition-[border-color,box-shadow] duration-[250ms] focus-visible:outline-none"
          />
        )}
        <span className="flex w-11 shrink-0 justify-end">
          {pending ? (
            <Badge variant="warning" className="h-5 px-2 text-[10.5px]">
              Needs
            </Badge>
          ) : isSaved && !edited ? (
            <CheckIcon
              size={13}
              weight="bold"
              className="text-success"
              aria-label="Saved"
            />
          ) : edited || willSave ? (
            <span className="bg-accent h-2 w-2 rounded-full" title="Not saved yet" />
          ) : null}
        </span>
      </div>
    </li>
  );
});
