"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { CheckIcon, FileXlsIcon, UploadSimpleIcon } from "@phosphor-icons/react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Tooltip,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import { getInputs, prepare, saveParams, uploadInput } from "./api";
import { SectionLabel, SeverityChip } from "./GateParts";
import {
  acceptAttr,
  applyUpload,
  canPrepare,
  cleanupNote,
  defaultChoice,
  emptyFileHint,
  fileInputs,
  formatBytes,
  formatUploaded,
  hasPrepare,
  holidaySourceLine,
  isChoosable,
  isOnFile,
  isOptionalFile,
  isPresent,
  missingRequired,
  prepareAfterIds,
  selectChoices,
  selectInputs,
  startDescription,
  uploadInvalidatesCheck,
  validateFile,
  type SelectChoice,
} from "./startForm";
import { refusalText } from "./taskPresenter";
import type { ActionResult, InputStatus, OptionsFile, Task, TaskInputDef } from "./types";

interface StartTaskDialogProps {
  task: Task;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The real start call (useTaskAction.start); resolves with the backend's
   *  reply, or null if it couldn't be reached. */
  onStart: () => Promise<ActionResult | null>;
}

type CheckState = "idle" | "checking" | "done" | "failed";

/**
 * Run form for a task that declares `inputs`: upload each file (drag-drop or
 * choose, replaceable), run the task's read-only `prepare` once the required
 * files are there ("Check inputs"), then pick from the options it produced —
 * disabled choices stay visible with their reason — and Start. Start saves
 * the selections (POST params) and only then starts the task; it is enabled
 * strictly by `missingRequired`. Tasks without inputs never reach this
 * dialog and keep their one-click Run.
 */
export function StartTaskDialog({
  task,
  open,
  onOpenChange,
  onStart,
}: StartTaskDialogProps) {
  const [statuses, setStatuses] = useState<InputStatus[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "failed">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [fileErrors, setFileErrors] = useState<Record<string, string>>({});
  const [options, setOptions] = useState<OptionsFile | null>(null);
  const [check, setCheck] = useState<CheckState>("idle");
  const [checkError, setCheckError] = useState<string | null>(null);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  // Guards async results from a previous opening of the dialog, and (for
  // `checkSeq`) from a superseded `prepare` call.
  const session = useRef(0);
  const checkSeq = useRef(0);
  // The freshest statuses, for completions that land between renders (two
  // uploads can finish back to back).
  const statusesRef = useRef<InputStatus[]>([]);

  const files = useMemo(() => fileInputs(task), [task]);
  const selects = useMemo(() => selectInputs(task), [task]);

  const choicesByInput = useMemo(() => {
    const out: Record<string, SelectChoice[]> = {};
    for (const input of selects) out[input.id] = selectChoices(options, input.optionsKey);
    return out;
  }, [selects, options]);

  useEffect(() => {
    statusesRef.current = statuses;
  }, [statuses]);

  const missing = missingRequired(task, statuses, selections, choicesByInput);
  const afterIds = prepareAfterIds(task);
  const ready = canPrepare(task, statuses);
  const uploading = Object.values(busy).some(Boolean);

  // Fresh state every time the dialog opens: files already on the backend
  // are shown as uploaded, but options are always recomputed (a file may
  // have changed since the last check), so Start can't ride on stale ones.
  useEffect(() => {
    if (!open) return;
    const mine = ++session.current;
    checkSeq.current += 1;
    statusesRef.current = [];
    setStatuses([]);
    setLoadState("loading");
    setLoadError(null);
    setBusy({});
    setFileErrors({});
    setOptions(null);
    setCheck("idle");
    setCheckError(null);
    setSelections({});
    setStarting(false);
    setStartError(null);
    void getInputs(task.id).then((reply) => {
      if (session.current !== mine) return;
      if (reply.ok && reply.inputs) {
        setStatuses(reply.inputs);
        setLoadState("ready");
      } else {
        setLoadError(reply.reason ?? "Couldn't read this task's inputs.");
        setLoadState("failed");
      }
    });
  }, [open, task.id]);

  const runCheck = useCallback(async () => {
    const mine = session.current;
    const seq = ++checkSeq.current;
    setCheck("checking");
    setCheckError(null);
    const reply = await prepare(task.id);
    if (session.current !== mine || checkSeq.current !== seq) return;
    if (!reply.ok || !reply.options) {
      setOptions(null);
      setCheck("failed");
      setCheckError(
        [reply.reason ?? "The check didn't produce any options.", reply.stderr_tail]
          .filter(Boolean)
          .join("\n"),
      );
      return;
    }
    setOptions(reply.options);
    setCheck("done");
    setSelections((current) => {
      const next = { ...current };
      for (const input of selects) {
        const choices = selectChoices(reply.options, input.optionsKey);
        if (!isChoosable(choices, next[input.id])) {
          const preset = defaultChoice(reply.options, choices);
          if (preset) next[input.id] = preset;
          else delete next[input.id];
        }
      }
      return next;
    });
  }, [task.id, selects]);

  const upload = async (input: TaskInputDef, file: File) => {
    const problem = validateFile(input, file);
    if (problem) {
      setFileErrors((e) => ({ ...e, [input.id]: problem }));
      return;
    }
    const mine = session.current;
    setFileErrors((e) => {
      const rest = { ...e };
      delete rest[input.id];
      return rest;
    });
    setBusy((b) => ({ ...b, [input.id]: true }));
    const reply = await uploadInput(task.id, input.id, file);
    if (session.current !== mine) return;
    setBusy((b) => ({ ...b, [input.id]: false }));
    if (!reply.ok) {
      setFileErrors((e) => ({ ...e, [input.id]: reply.reason ?? "The upload failed." }));
      return;
    }
    const next = applyUpload(statusesRef.current, input, reply, file);
    statusesRef.current = next;
    setStatuses(next);
    // Changing a file `prepare` reads invalidates what it produced.
    if (uploadInvalidatesCheck(task, input)) {
      checkSeq.current += 1;
      setOptions(null);
      setCheck("idle");
      setCheckError(null);
      setSelections({});
      if (canPrepare(task, next)) void runCheck();
    }
  };

  const start = async () => {
    const mine = session.current;
    setStarting(true);
    setStartError(null);
    const params: Record<string, string> = {};
    for (const input of selects) {
      if (selections[input.id]) params[input.id] = selections[input.id];
    }
    if (Object.keys(params).length > 0) {
      const saved = await saveParams(task.id, params);
      if (session.current !== mine) return;
      if (!saved.ok) {
        setStarting(false);
        setStartError(saved.reason ?? "The selection couldn't be saved.");
        return;
      }
    }
    const result = await onStart();
    if (session.current !== mine) return;
    setStarting(false);
    if (result === null) {
      setStartError("Couldn't reach the backend.");
    } else if (!result.ok) {
      const needs = result.missing?.length
        ? ` Missing: ${result.missing.join(", ")}.`
        : "";
      setStartError(`${refusalText(result)}${needs}`);
    } else {
      onOpenChange(false);
    }
  };

  const problems = options?.problems ?? [];
  const sourceLine = holidaySourceLine(options);
  const canStart =
    loadState === "ready" && missing.length === 0 && !uploading && !starting;

  return (
    <Dialog open={open} onOpenChange={(next) => !starting && onOpenChange(next)}>
      <DialogContent className="scroll-thin flex max-h-[85vh] max-w-xl flex-col overflow-y-auto px-[30px] pt-7 pb-6">
        <DialogTitle>Run {task.displayName}</DialogTitle>
        <DialogDescription>{startDescription(task)}</DialogDescription>

        {loadState === "loading" && (
          <p className="text-ink-muted mt-4 text-[13px]">
            Reading what&apos;s already uploaded…
          </p>
        )}
        {loadState === "failed" && (
          <p className="text-red bg-red-soft rounded-control mt-4 px-3.5 py-2.5 text-[13px]">
            {loadError}
          </p>
        )}

        {loadState === "ready" && (
          <div className="mt-5 flex flex-col gap-5">
            <section className="flex flex-col gap-2" aria-label="Files">
              <SectionLabel>Files</SectionLabel>
              {files.map((input) => (
                <FileInput
                  key={input.id}
                  input={input}
                  status={statuses.find((s) => s.id === input.id)}
                  busy={Boolean(busy[input.id])}
                  disabled={starting}
                  error={fileErrors[input.id]}
                  onFile={(file) => upload(input, file)}
                />
              ))}
            </section>

            {hasPrepare(task) && (
              <section className="flex flex-col gap-2" aria-label="Check inputs">
                <div className="flex items-center justify-between gap-3">
                  <SectionLabel>Check</SectionLabel>
                  <Button
                    variant={check === "done" ? "outline" : "solid"}
                    disabled={!ready || check === "checking" || uploading || starting}
                    onClick={runCheck}
                  >
                    {check === "checking"
                      ? "Checking…"
                      : check === "done"
                        ? "Check again"
                        : "Check inputs"}
                  </Button>
                </div>
                <p className="text-ink-muted text-[13px]" aria-live="polite">
                  {check === "checking"
                    ? "Reading the files — this can take up to a minute."
                    : check === "done"
                      ? "Inputs checked."
                      : ready
                        ? "Check the files to see which cycles can be built."
                        : `Upload ${afterIds
                            .filter((id) => !isPresent(statuses, id))
                            .map((id) => files.find((f) => f.id === id)?.label ?? id)
                            .join(" and ")} first.`}
                </p>
                {check === "failed" && checkError && (
                  <pre className="rounded-control bg-red-soft text-red px-3.5 py-2.5 font-mono text-[11.5px] whitespace-pre-wrap">
                    {checkError}
                  </pre>
                )}
                {sourceLine && <p className="text-ink-muted text-xs">{sourceLine}</p>}
                {problems.length > 0 && (
                  <ul className="flex flex-col gap-1.5" aria-label="Problems found">
                    {problems.map((problem, index) => (
                      <li key={index} className="flex items-start gap-2">
                        <SeverityChip severity={problem.severity} />
                        <span className="text-ink text-[13px] break-words">
                          {problem.message}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            {selects.map((input) => (
              <ChoiceGroup
                key={input.id}
                input={input}
                choices={choicesByInput[input.id] ?? []}
                checked={check === "done"}
                value={selections[input.id]}
                onChange={(value) => setSelections((s) => ({ ...s, [input.id]: value }))}
              />
            ))}
          </div>
        )}

        {loadState === "ready" && cleanupNote(task) && (
          <p className="text-ink-muted mt-4 text-xs">{cleanupNote(task)}</p>
        )}

        {startError && (
          <p
            className="text-red bg-red-soft rounded-control mt-4 px-3.5 py-2.5 text-[13px]"
            role="alert"
          >
            Couldn&apos;t start: {startError}
          </p>
        )}

        <div className="mt-6 flex items-center justify-between gap-3">
          <p className="text-ink-muted min-w-0 text-xs" aria-live="polite">
            {loadState === "ready" && missing.length > 0
              ? `Still needed: ${missing.join(", ")}`
              : ""}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="ghost"
              disabled={starting}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button disabled={!canStart} onClick={start}>
              {starting ? "Starting…" : "Start"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FileInput({
  input,
  status,
  busy,
  disabled,
  error,
  onFile,
}: {
  input: TaskInputDef;
  status: InputStatus | undefined;
  busy: boolean;
  disabled: boolean;
  error: string | undefined;
  onFile: (file: File) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const present = Boolean(status?.present);
  // A persist file already on disk: a compact "On file" row (still a drop
  // target and replaceable) that counts as satisfied; no empty drop zone.
  const kept = isOnFile(input, status);
  const uploaded = formatUploaded(status?.modified);
  const accept = (input.accept ?? []).join(" / ");
  const emptyHint = emptyFileHint(input, status);

  const take = (list: FileList | null | undefined) => {
    const file = list?.[0];
    if (file) onFile(file);
    if (picker.current) picker.current.value = "";
  };

  return (
    <div className="flex flex-col gap-1">
      <div
        onDragOver={(event) => {
          if (disabled || busy) return;
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (!disabled && !busy) take(event.dataTransfer.files);
        }}
        className={cn(
          "rounded-card flex items-center gap-3 border transition-colors duration-200",
          kept ? "px-4 py-3" : "px-4 py-3.5",
          dragging
            ? "border-focus bg-accent-soft border-solid"
            : present
              ? "border-line bg-card border-solid"
              : "border-line-strong border-dashed",
        )}
      >
        <span
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
            present ? "bg-success-soft text-success" : "text-ink-muted bg-chip",
          )}
        >
          {present ? (
            <CheckIcon size={14} weight="bold" aria-hidden />
          ) : (
            <UploadSimpleIcon size={14} weight="bold" aria-hidden />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-ink text-[13.5px] font-semibold">
            {input.label}
            <span className="text-ink-muted ml-1.5 text-[11.5px] font-normal">
              {input.required ? "Required" : null}
              {accept ? `${input.required ? " · " : ""}${accept}` : ""}
            </span>
            {isOptionalFile(input) && (
              <span className="bg-chip text-ink-muted rounded-chip ml-2 px-2 py-0.5 align-[1px] text-[10.5px] font-semibold">
                Optional
              </span>
            )}
            {kept && (
              <span className="bg-success-soft text-success rounded-chip ml-2 px-2 py-0.5 align-[1px] text-[10.5px] font-semibold">
                On file
              </span>
            )}
          </p>
          {busy ? (
            <p className="text-ink-muted text-[12.5px]">Uploading…</p>
          ) : present ? (
            <p className="text-ink-muted flex items-center gap-1.5 text-[12.5px]">
              <FileXlsIcon size={13} weight="bold" aria-hidden className="shrink-0" />
              <span className="min-w-0 truncate">{status?.filename ?? "Uploaded"}</span>
              {status?.size != null && (
                <span className="text-ink-muted shrink-0">
                  {formatBytes(status.size)}
                </span>
              )}
              <span className="text-ink-muted shrink-0">
                · uploaded{uploaded ? ` ${uploaded}` : ""}
              </span>
            </p>
          ) : (
            <>
              <p className="text-ink-muted text-[12.5px]">
                Drop the file here, or choose it.
              </p>
              {emptyHint && <p className="text-ink-muted text-xs">{emptyHint}</p>}
            </>
          )}
        </div>
        <input
          ref={picker}
          type="file"
          accept={acceptAttr(input)}
          className="hidden"
          aria-label={`Choose ${input.label}`}
          onChange={(event) => take(event.target.files)}
        />
        <Button
          variant="outline"
          disabled={disabled || busy}
          onClick={() => picker.current?.click()}
          aria-label={present ? `Replace ${input.label}` : undefined}
          className="shrink-0"
        >
          {present ? "Replace" : "Choose file"}
        </Button>
      </div>
      {error && (
        <p className="text-red text-[12.5px]" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function ChoiceGroup({
  input,
  choices,
  checked,
  value,
  onChange,
}: {
  input: TaskInputDef;
  choices: SelectChoice[];
  /** `prepare` has run, so an empty list means "nothing available". */
  checked: boolean;
  value: string | undefined;
  onChange: (value: string) => void;
}) {
  // Arrow keys move through the enabled choices only (roving selection).
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const step =
      event.key === "ArrowDown" || event.key === "ArrowRight"
        ? 1
        : event.key === "ArrowUp" || event.key === "ArrowLeft"
          ? -1
          : 0;
    if (!step) return;
    const enabled = choices.filter((c) => c.enabled);
    if (enabled.length === 0) return;
    event.preventDefault();
    const index = enabled.findIndex((c) => c.id === value);
    const next = enabled[(index + step + enabled.length) % enabled.length];
    onChange(next.id);
    event.currentTarget
      .querySelector<HTMLButtonElement>(`[data-choice="${CSS.escape(next.id)}"]`)
      ?.focus();
  };
  const tabbable = isChoosable(choices, value)
    ? value
    : choices.find((c) => c.enabled)?.id;

  return (
    <section className="flex flex-col gap-2" aria-label={input.label}>
      <SectionLabel>{input.label}</SectionLabel>
      {choices.length === 0 ? (
        <p className="text-ink-muted text-[13px]">
          {checked
            ? "Nothing can be built from these files."
            : "Appears after the inputs have been checked."}
        </p>
      ) : (
        <div
          role="radiogroup"
          aria-label={input.label}
          onKeyDown={move}
          className="flex flex-col gap-1.5"
        >
          {choices.map((choice) => {
            const selected = choice.enabled && choice.id === value;
            const row = (
              <button
                key={choice.id}
                type="button"
                role="radio"
                data-choice={choice.id}
                aria-checked={selected}
                aria-disabled={!choice.enabled}
                tabIndex={choice.id === tabbable ? 0 : -1}
                onClick={() => choice.enabled && onChange(choice.id)}
                className={cn(
                  "rounded-card flex w-full items-start gap-3 border px-4 py-3 text-left transition-[background-color,border-color] duration-200",
                  "focus-visible:ring-focus focus-visible:ring-2 focus-visible:outline-none",
                  selected
                    ? "border-focus bg-accent-soft"
                    : choice.enabled
                      ? "border-line bg-card hover:bg-chip"
                      : "border-line bg-chip cursor-not-allowed",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                    selected ? "border-accent-ink" : "border-line-strong",
                    !choice.enabled && "opacity-50",
                  )}
                >
                  {selected && <span className="bg-accent-ink h-2 w-2 rounded-full" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "block text-[13.5px] font-semibold",
                      choice.enabled ? "text-ink" : "text-ink-muted",
                    )}
                  >
                    {choice.label}
                    {!choice.enabled && (
                      <span className="text-ink-muted ml-1.5 text-[11.5px] font-normal">
                        Unavailable
                      </span>
                    )}
                  </span>
                  {choice.reason && (
                    <span className="text-ink-muted block text-xs break-words">
                      {choice.reason}
                    </span>
                  )}
                </span>
              </button>
            );
            // The reason is always visible as text; the tooltip is the extra
            // hover/focus affordance on a disabled choice.
            return !choice.enabled && choice.reason ? (
              <Tooltip key={choice.id} label={choice.reason} side="top">
                {row}
              </Tooltip>
            ) : (
              row
            );
          })}
        </div>
      )}
    </section>
  );
}
