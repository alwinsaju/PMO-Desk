"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowCounterClockwiseIcon,
  CaretDownIcon,
  CheckIcon,
  ClipboardTextIcon,
  ClockCounterClockwiseIcon,
  CopyIcon,
  DotsThreeIcon,
  FloppyDiskIcon,
  SlidersHorizontalIcon,
  TextBIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import {
  Button,
  ChipInput,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  FormField,
  IconButton,
  Input,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import { toast } from "@/lib/notifications/toastStore";
import { copyToClipboard } from "@/lib/ui/copyToClipboard";
import {
  joinRecipients,
  recipientError,
  splitRecipients,
  tidyRecipients,
} from "@/lib/templates/recipients";
import { boldSegments, snippetsFrom } from "@/lib/templates/render";
import { MailPreview } from "./MailPreview";
import { TARGETS, targetLabel } from "@/lib/templates/targets";
import { starterById } from "@/lib/templates/starters";
import {
  KIND_LABEL,
  LIMITS,
  type Template,
  type TemplateInput,
} from "@/lib/templates/types";
import type { TemplateErrors } from "@/lib/templates/library";
import {
  Field,
  FieldError,
  Note,
  ScrollBody,
  SectionLabel,
  Segmented,
  TextArea,
} from "../pmo-todo-app/parts";
import {
  NEW_DRAFT_ID,
  clearDraft,
  isDraftKept,
  loadDraft,
  saveDraft,
  type DraftStorage,
} from "./draftAutosave";
import { PlaceholderPalette } from "./PlaceholderPalette";
import {
  holderOf,
  insertAt,
  isDirty,
  offeredPlaceholders,
  placeGroups,
  previewBodyOf,
  previewOf,
  problems,
  saveBlockedMessage,
  toInput,
  toggleWrap,
  withKind,
  withPlace,
  wordingOf,
  type Draft,
} from "./templateForm";

const browserStorage = (): DraftStorage | null => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
};

/** A draft kept from an unsaved edit of this template (or of a new one), if it still applies and
 *  differs. A new form that starts from something (a copy) is not replaced by an old new-template draft. */
function restoredDraft(template: Template | null, seed: Draft): Draft | null {
  if (!template) {
    if (isDirty(seed, null)) return null;
    const kept = loadDraft(browserStorage(), NEW_DRAFT_ID, "", Date.now());
    return kept && kept.kind === seed.kind && isDirty(kept, null) ? kept : null;
  }
  const kept = loadDraft(browserStorage(), template.id, template.updatedAt, Date.now());
  return kept && isDirty(kept, template) ? kept : null;
}

/** Where an edit is kept: the template's id, or one shared slot for a template not saved yet. */
const draftSlot = (template: Template | null) => template?.id ?? NEW_DRAFT_ID;

interface TemplateEditorProps {
  /** The template being edited; null for a new one (then `seed` is the starting form). */
  template: Template | null;
  seed: Draft;
  /** Every saved template, to say who has a place now. */
  templates: readonly Template[];
  busy: boolean;
  error: string | null;
  /** Per-field refusals from the server's last answer. */
  serverFields: Record<string, string> | null;
  onDirtyChange: (dirty: boolean) => void;
  onSave: (input: TemplateInput) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onOpenExtras: () => void;
  onOpenVersions: () => void;
  /** The list asked (E or Enter on a row) for focus to move into the first field. */
  focusRequested?: boolean;
  /** Called once the request has been acted on, so the next one is a new request. */
  onFocusHandled?: () => void;
}

const KIND_OPTIONS = (["email", "report"] as const).map((value) => ({
  value,
  label: KIND_LABEL[value],
}));

/**
 * The form for one template: wording on the left, where it is used and a live
 * preview on the right. The form holds its own draft; the parent hears only whether
 * it is changed, and gets the input when Save is pressed. Remounted (by `key`) for
 * each template, so nothing leaks from one to the next.
 */
export function TemplateEditor({
  template,
  seed,
  templates,
  busy,
  error,
  serverFields,
  onDirtyChange,
  onSave,
  onDuplicate,
  onDelete,
  onOpenExtras,
  onOpenVersions,
  focusRequested = false,
  onFocusHandled,
}: TemplateEditorProps) {
  const [draft, setDraft] = useState<Draft>(() => restoredDraft(template, seed) ?? seed);
  // A draft kept from an earlier, unsaved edit was put back; say so and let it be dropped.
  const [restored, setRestored] = useState(() => draft !== seed);
  const [attempted, setAttempted] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  // Runs after this render is in the DOM (also for an editor that has just mounted for the
  // template that was picked), so the field exists and is shown.
  useEffect(() => {
    if (!focusRequested) return;
    nameRef.current?.focus();
    onFocusHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new request matters
  }, [focusRequested]);

  const change = (next: Draft) => {
    setDraft(next);
    onDirtyChange(isDirty(next, template));
  };

  // Tell the parent about a restored draft, and keep what is typed so a close does not lose it.
  useEffect(() => {
    onDirtyChange(isDirty(draft, template));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, for the draft the form started with
  }, []);
  useEffect(() => {
    const storage = browserStorage();
    if (isDirty(draft, template)) {
      saveDraft(
        storage,
        draftSlot(template),
        draft,
        template?.updatedAt ?? "",
        Date.now(),
      );
    } else {
      clearDraft(storage, draftSlot(template));
    }
  }, [draft, template]);

  const discardRestored = () => {
    clearDraft(browserStorage(), draftSlot(template));
    setDraft(seed);
    setRestored(false);
    setAttempted(false);
    onDirtyChange(false);
  };

  const errors = useMemo(() => problems(draft), [draft]);
  const shown = visibleErrors(errors, draft, attempted);
  const snippets = useMemo(() => snippetsFrom(templates), [templates]);
  const preview = useMemo(() => previewOf(draft, snippets), [draft, snippets]);
  const [mailLayout, setMailLayout] = useState(false);
  const tokens = useMemo(() => offeredPlaceholders(draft), [draft]);
  const dirty = isDirty(draft, template);
  const starter = starterById(draft.starterId);
  const isEmail = draft.kind === "email";

  const insertToken = (name: string) => {
    const area = bodyRef.current;
    const at = area
      ? [area.selectionStart, area.selectionEnd]
      : [draft.body.length, draft.body.length];
    const out = insertAt(draft.body, at[0], at[1], `{{${name}}}`);
    change({ ...draft, body: out.value });
    requestAnimationFrame(() => {
      area?.focus();
      area?.setSelectionRange(out.caret, out.caret);
    });
  };

  const makeBold = () => {
    const area = bodyRef.current;
    const at = area
      ? [area.selectionStart, area.selectionEnd]
      : [draft.body.length, draft.body.length];
    const out = toggleWrap(draft.body, at[0], at[1]);
    change({ ...draft, body: out.value });
    requestAnimationFrame(() => {
      area?.focus();
      area?.setSelectionRange(out.start, out.end);
    });
  };

  const save = () => {
    setAttempted(true);
    if (Object.keys(errors).length === 0) onSave(toInput(draft));
  };
  // Beside Save, where it is always in view: why a Save was refused (this form's own check or the server's).
  const refusal = error ?? (attempted ? saveBlockedMessage(errors) : null);

  // Copies what is typed now (unsaved edits included) with its {{placeholders}}, not the example preview.
  const copyWording = async () => {
    const text = wordingOf(draft);
    if (!text) {
      toast({ tone: "warning", message: "There is no wording to copy yet." });
      return;
    }
    if (await copyToClipboard(text)) {
      toast({
        tone: "success",
        message: "Copied the wording with its {{placeholders}}.",
      });
    } else {
      toast({
        tone: "danger",
        message:
          "Could not copy to the clipboard. Select the text in the Message box and press Ctrl+C instead.",
      });
    }
  };

  const restoreOriginal = () => {
    if (!starter) return;
    change({ ...draft, ...starter, id: draft.id, usedBy: draft.usedBy });
  };

  const fieldError = (field: keyof TemplateErrors) =>
    shown[field] ?? serverFields?.[field];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="border-line flex shrink-0 flex-wrap items-center gap-2 border-b px-5 py-3">
        <h2 className="text-ink min-w-0 flex-1 truncate text-[16px] font-bold">
          {template ? template.name : "New template"}
        </h2>
        {template && (
          <Button
            variant="outline"
            size="sm"
            onClick={onOpenVersions}
            disabled={busy}
            data-testid="template-versions"
          >
            <ClockCounterClockwiseIcon size={14} />
            Versions
            {(template.history?.length ?? 0) > 0 ? ` (${template.history?.length})` : ""}
          </Button>
        )}
        {template && (
          <Button
            variant="outline"
            size="sm"
            onClick={onOpenExtras}
            disabled={busy}
            data-testid="template-extras"
          >
            <SlidersHorizontalIcon size={14} />
            Tags, wordings, test…
            <CaretDownIcon size={12} weight="bold" />
          </Button>
        )}
        {/* Always rendered so the live region exists before the text appears. */}
        <span
          role="status"
          data-testid="template-draft-kept"
          className="text-ink-muted flex items-center gap-1 text-[12px]"
        >
          {isDraftKept(true, dirty) && (
            <>
              <CheckIcon size={12} weight="bold" aria-hidden />
              Draft kept
            </>
          )}
        </span>
        <Button
          size="sm"
          onClick={save}
          disabled={busy || !dirty}
          data-testid="template-save"
        >
          <FloppyDiskIcon size={14} />
          {busy ? "Saving…" : "Save"}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              aria-label="More actions"
              variant="outline"
              size="sm"
              data-testid="template-more"
            >
              <DotsThreeIcon weight="bold" />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() => void copyWording()}
              data-testid="template-copy-wording"
            >
              <ClipboardTextIcon size={14} />
              Copy wording
            </DropdownMenuItem>
            {starter && (
              <DropdownMenuItem disabled={busy} onSelect={restoreOriginal}>
                <ArrowCounterClockwiseIcon size={14} />
                Restore original wording
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              disabled={busy || !dirty}
              onSelect={discardRestored}
              data-testid="template-discard"
            >
              <ArrowCounterClockwiseIcon size={14} />
              Discard changes
            </DropdownMenuItem>
            {template && (
              <DropdownMenuItem disabled={busy} onSelect={onDuplicate}>
                <CopyIcon size={14} />
                Duplicate
              </DropdownMenuItem>
            )}
            {template && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={busy}
                  onSelect={onDelete}
                  className="text-red"
                  data-testid="template-delete"
                >
                  <TrashIcon size={14} />
                  Delete template
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        {refusal && (
          <p
            role="alert"
            data-testid="template-refusal"
            className="text-red w-full text-[12.5px] leading-snug"
          >
            {refusal}
          </p>
        )}
      </header>

      <ScrollBody className="@container px-5 py-4">
        {restored && (
          <Note tone="accent" className="mb-4 flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1">
              Your unsaved changes from last time are back.
            </span>
            <Button variant="ghost" size="sm" onClick={discardRestored}>
              Discard them
            </Button>
          </Note>
        )}
        <div className="grid grid-cols-1 gap-6 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
          <div className="flex min-w-0 flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 @xl:grid-cols-[minmax(0,1fr)_auto]">
              <Field label="Name">
                <Input
                  ref={nameRef}
                  value={draft.name}
                  maxLength={LIMITS.name}
                  placeholder="Aging report email"
                  aria-invalid={!!fieldError("name")}
                  onChange={(e) => change({ ...draft, name: e.target.value })}
                  data-testid="template-name"
                />
                <FieldError message={fieldError("name")} />
              </Field>
              <Field label="Type">
                <Segmented
                  value={draft.kind}
                  options={KIND_OPTIONS}
                  onChange={(kind) => change(withKind(draft, kind))}
                />
                <FieldError message={fieldError("kind")} />
              </Field>
            </div>

            <Field label="Description (optional)">
              <Input
                value={draft.description}
                maxLength={LIMITS.description}
                placeholder="What it is for"
                onChange={(e) => change({ ...draft, description: e.target.value })}
              />
            </Field>

            {isEmail && (
              <div className="flex flex-col gap-4">
                {(["to", "cc"] as const).map((field) => (
                  <FormField
                    key={field}
                    label={field === "to" ? "To" : "Cc"}
                    error={fieldError(field)}
                    showErrorNow
                    hint="Separate people with a semicolon. Leave blank to keep the task's own."
                  >
                    {(control) => (
                      <ChipInput
                        {...control}
                        values={splitRecipients(draft[field])}
                        onChange={(list) =>
                          change({
                            ...draft,
                            [field]: joinRecipients(tidyRecipients(list)),
                          })
                        }
                        validate={recipientError}
                        separators={["semicolon", "newline"]}
                        noun="recipient"
                        inputMode="email"
                        placeholder={
                          draft[field] ? undefined : "Name <name@company.com>; ..."
                        }
                      />
                    )}
                  </FormField>
                ))}
              </div>
            )}

            <Field label={isEmail ? "Subject" : "Title line"}>
              <Input
                value={draft.subject}
                maxLength={LIMITS.subject}
                placeholder={
                  isEmail ? "Aging Incidents | {{date_subject}}" : "{{title}}: {{period}}"
                }
                aria-invalid={!!fieldError("subject")}
                onChange={(e) => change({ ...draft, subject: e.target.value })}
              />
              <FieldError message={fieldError("subject")} />
            </Field>

            <div className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <SectionLabel>{isEmail ? "Message" : "Report layout"}</SectionLabel>
                <div
                  role="toolbar"
                  aria-label="Formatting"
                  className="flex items-center gap-1.5"
                >
                  {isEmail && (
                    <IconButton
                      aria-label="Bold (Ctrl+B)"
                      title="Bold (Ctrl+B)"
                      variant="outline"
                      size="sm"
                      onClick={makeBold}
                      data-testid="format-bold"
                    >
                      <TextBIcon weight="bold" />
                    </IconButton>
                  )}
                  <PlaceholderPalette tokens={tokens} onPick={insertToken} />
                </div>
              </div>
              <TextArea
                ref={bodyRef}
                value={draft.body}
                rows={12}
                maxLength={LIMITS.body}
                aria-label={isEmail ? "Message" : "Report layout"}
                aria-invalid={!!fieldError("body")}
                className="min-h-56 font-mono text-[13px] leading-relaxed"
                onChange={(e) => change({ ...draft, body: e.target.value })}
                onKeyDown={(e) => {
                  if (
                    isEmail &&
                    (e.ctrlKey || e.metaKey) &&
                    e.key.toLowerCase() === "b"
                  ) {
                    e.preventDefault();
                    makeBold();
                  }
                }}
                data-testid="template-body"
              />
              <FieldError message={fieldError("body")} />
              <p className="text-ink-muted text-[12px] leading-relaxed">
                Leave a blank line between paragraphs. Select words and press Bold to make
                them bold in an email (<code>**two stars**</code>). A value that is
                missing stays as you typed it, so you can spot it in the draft.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <SectionLabel>Used by</SectionLabel>
              <p className="text-ink-muted text-[12px] leading-relaxed">
                Choose which tasks and apps use this{" "}
                {KIND_LABEL[draft.kind].toLowerCase()} template. Each place uses one
                template, so choosing a place another template has moves it here.
              </p>
              {placeGroups(draft.kind).map((group) => (
                <fieldset key={group.heading} className="flex flex-col gap-1">
                  <legend className="text-ink-soft mb-1 text-[12.5px] font-semibold">
                    {group.heading}
                  </legend>
                  {group.targets.map((target) => {
                    const holder = holderOf(templates, target.key, draft.id);
                    const checked = draft.usedBy.includes(target.key);
                    return (
                      <label
                        key={target.key}
                        className="border-line bg-card rounded-control flex cursor-pointer items-start gap-3 border px-3 py-2"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) =>
                            change(withPlace(draft, target.key, e.target.checked))
                          }
                          className="accent-accent mt-0.5 h-4 w-4 shrink-0"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="text-ink block text-[13.5px] font-semibold">
                            {targetLabel(target)}
                          </span>
                          {holder && (
                            <span
                              className={cn(
                                "block text-[12px]",
                                checked ? "text-amber" : "text-ink-muted",
                              )}
                            >
                              {checked
                                ? `Replaces “${holder.name}”, which uses it now.`
                                : `Now uses “${holder.name}”.`}
                            </span>
                          )}
                        </span>
                      </label>
                    );
                  })}
                </fieldset>
              ))}
              <FieldError message={fieldError("usedBy")} />
            </div>
          </div>

          <aside
            aria-label="Preview"
            className="flex min-w-0 flex-col gap-2 @3xl:sticky @3xl:top-0 @3xl:self-start"
          >
            <div className="flex items-center justify-between gap-2">
              <SectionLabel>Preview with example values</SectionLabel>
              {isEmail && (
                <span className="flex gap-1" role="group" aria-label="Preview layout">
                  <Button
                    size="sm"
                    variant={mailLayout ? "ghost" : "secondary"}
                    onClick={() => setMailLayout(false)}
                  >
                    Plain
                  </Button>
                  <Button
                    size="sm"
                    variant={mailLayout ? "secondary" : "ghost"}
                    onClick={() => setMailLayout(true)}
                    data-testid="preview-mail-layout"
                  >
                    Mail layout
                  </Button>
                </span>
              )}
            </div>
            {isEmail && mailLayout && (
              <MailPreview
                from="You"
                to={preview.to}
                cc={preview.cc}
                subject={preview.subject}
                body={draft.body.trim() ? previewBodyOf(draft, snippets) : ""}
              />
            )}
            <div
              className={`border-line bg-card rounded-card flex flex-col gap-3 border p-4 ${isEmail && mailLayout ? "hidden" : ""}`}
            >
              {isEmail && (preview.to || preview.cc) && (
                <dl className="text-ink-muted grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
                  {preview.to && (
                    <>
                      <dt className="font-semibold">To</dt>
                      <dd className="text-ink-soft break-words">{preview.to}</dd>
                    </>
                  )}
                  {preview.cc && (
                    <>
                      <dt className="font-semibold">Cc</dt>
                      <dd className="text-ink-soft break-words">{preview.cc}</dd>
                    </>
                  )}
                </dl>
              )}
              <p className="text-ink text-[14px] font-bold break-words">
                {preview.subject || (
                  <span className="text-ink-muted font-normal">
                    {isEmail ? "(no subject: the task keeps its own)" : "(no title line)"}
                  </span>
                )}
              </p>
              <div className="border-line text-ink-soft border-t pt-3 text-[13.5px] leading-relaxed break-words whitespace-pre-wrap">
                {draft.body.trim() ? (
                  boldSegments(previewBodyOf(draft, snippets)).map((part, index) =>
                    part.bold ? (
                      <strong key={index}>{part.text}</strong>
                    ) : (
                      <span key={index}>{part.text}</span>
                    ),
                  )
                ) : (
                  <span className="text-ink-muted">The message appears here.</span>
                )}
              </div>
            </div>
            <p className="text-ink-muted text-[12px] leading-relaxed">
              {draft.usedBy.length > 0
                ? `Example values from ${draft.usedBy
                    .map((key) => TARGETS.find((t) => t.key === key)?.label)
                    .filter(Boolean)
                    .join(", ")}.`
                : "Example values. Choose where it is used to see that place's values."}
            </p>
          </aside>
        </div>
      </ScrollBody>
    </div>
  );
}

/** Errors to show now: all after a Save attempt; before that, only the ones that are
 *  about what was typed (not "this is still empty"). */
function visibleErrors(
  errors: TemplateErrors,
  draft: Draft,
  attempted: boolean,
): TemplateErrors {
  if (attempted) return errors;
  const out: TemplateErrors = {};
  if (errors.body && draft.body.trim()) out.body = errors.body;
  if (errors.usedBy) out.usedBy = errors.usedBy;
  if (errors.subject) out.subject = errors.subject;
  if (errors.to) out.to = errors.to;
  if (errors.cc) out.cc = errors.cc;
  return out;
}
