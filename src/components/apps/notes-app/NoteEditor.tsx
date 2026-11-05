"use client";

import {
  useLayoutEffect,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import {
  CheckIcon,
  WarningIcon,
  CodeBlockIcon,
  LinkIcon,
  ListBulletsIcon,
  ListChecksIcon,
  TableIcon,
  TextBIcon,
  TextHIcon,
} from "@phosphor-icons/react";
import { Button, IconButton } from "@/components/ui";
import { applyFormat, toggleCheck, type NoteFormat } from "./noteFormat";
import { cn } from "@/lib/cn";
import { useSaveStatus } from "@/lib/uiState/useSaveStatus";
import {
  emptyHistory,
  historyKey,
  recordChange,
  redo,
  undo,
  type ChangeKind,
  type NoteHistory,
  type Snapshot,
} from "./noteHistory";
import { NotePreview } from "./NotePreview";
import { noteSaveIndicator, spellcheckEnabled, wordCount } from "./notesLogic";

const FORMATS: { kind: NoteFormat; label: string; Glyph: typeof TextBIcon }[] = [
  { kind: "heading", label: "Heading", Glyph: TextHIcon },
  { kind: "bold", label: "Bold (Ctrl+B)", Glyph: TextBIcon },
  { kind: "bullet", label: "Bullet list", Glyph: ListBulletsIcon },
  { kind: "check", label: "Checklist", Glyph: ListChecksIcon },
  { kind: "link", label: "Link", Glyph: LinkIcon },
  { kind: "code", label: "Code block", Glyph: CodeBlockIcon },
  { kind: "table", label: "Table", Glyph: TableIcon },
];

/** The note's text area with a formatting toolbar, a word count and a Saved indicator.
 *  The note stays plain text; the toolbar only inserts simple markdown markers (see noteFormat.ts).
 *  Preview shows the same text rendered (noteMarkdown.ts), read-only; Edit goes back to the box. */
export function NoteEditor({
  content,
  editorRef,
  onChange,
}: {
  content: string;
  editorRef: RefObject<HTMLTextAreaElement | null>;
  onChange: (content: string) => void;
}) {
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const previewing = mode === "preview";
  const selection = useRef<{ start: number; end: number } | null>(null);
  const indicator = noteSaveIndicator(useSaveStatus("notes"));

  // Own undo history: the browser's is lost whenever a toolbar action rewrites the text.
  const history = useRef<NoteHistory>(emptyHistory());
  const lastEmitted = useRef(content);
  const lastSelection = useRef({ start: 0, end: 0 });
  useEffect(() => {
    // Text that changed from outside (Restore previous version, the assistant) starts a fresh history.
    if (content !== lastEmitted.current) {
      history.current = emptyHistory();
      lastEmitted.current = content;
    }
  }, [content]);

  // The new text is in the box only after React renders it; then the selection can be put back.
  useLayoutEffect(() => {
    const wanted = selection.current;
    const el = editorRef.current;
    if (!wanted || !el) return;
    selection.current = null;
    el.focus();
    el.setSelectionRange(wanted.start, wanted.end);
  }, [content, editorRef]);

  // Back in Edit the box is new, so put the cursor in it.
  const wasPreviewing = useRef(false);
  useEffect(() => {
    if (wasPreviewing.current && !previewing) editorRef.current?.focus();
    wasPreviewing.current = previewing;
  }, [previewing, editorRef]);

  const snapshot = (el: HTMLTextAreaElement): Snapshot => ({
    text: el.value,
    start: el.selectionStart,
    end: el.selectionEnd,
  });

  const change = (next: string, kind: ChangeKind, before: Snapshot) => {
    history.current = recordChange(history.current, before, kind, Date.now());
    lastEmitted.current = next;
    onChange(next);
  };

  const step = (direction: "undo" | "redo") => {
    const el = editorRef.current;
    if (!el) return;
    const result = (direction === "undo" ? undo : redo)(history.current, snapshot(el));
    if (!result) return;
    history.current = result.history;
    lastEmitted.current = result.snapshot.text;
    selection.current = { start: result.snapshot.start, end: result.snapshot.end };
    onChange(result.snapshot.text);
  };

  // Undo from the right-click menu arrives as an input event, not a key press.
  const stepRef = useRef(step);
  useLayoutEffect(() => {
    stepRef.current = step;
  });
  useEffect(() => {
    const el = editorRef.current;
    if (!el || previewing) return;
    const onBeforeInput = (event: InputEvent) => {
      if (event.inputType !== "historyUndo" && event.inputType !== "historyRedo") return;
      event.preventDefault();
      stepRef.current(event.inputType === "historyUndo" ? "undo" : "redo");
    };
    el.addEventListener("beforeinput", onBeforeInput);
    return () => el.removeEventListener("beforeinput", onBeforeInput);
  }, [previewing, editorRef]);

  const format = (kind: NoteFormat) => {
    const el = editorRef.current;
    if (!el) return;
    const before = snapshot(el);
    const edit = applyFormat(el.value, el.selectionStart, el.selectionEnd, kind);
    if (edit.text === el.value) {
      el.setSelectionRange(edit.start, edit.end);
      return;
    }
    selection.current = { start: edit.start, end: edit.end };
    change(edit.text, "format", before);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const el = event.currentTarget;
    const historyAction = historyKey(event);
    if (historyAction) {
      event.preventDefault();
      step(historyAction);
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "b") {
      event.preventDefault();
      format("bold");
    } else if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      const at = el.selectionStart;
      const from = el.value.lastIndexOf("\n", at - 1) + 1;
      const nl = el.value.indexOf("\n", at);
      const to = nl === -1 ? el.value.length : nl;
      const flipped = toggleCheck(el.value.slice(from, to));
      if (flipped === null) return;
      event.preventDefault();
      const before = snapshot(el);
      selection.current = { start: el.selectionStart, end: el.selectionEnd };
      change(el.value.slice(0, from) + flipped + el.value.slice(to), "format", before);
    }
  };

  const words = wordCount(content);
  return (
    <>
      <div className="px-gutter flex flex-wrap items-center gap-x-3 gap-y-1 pb-1">
        <div role="toolbar" aria-label="Formatting" className="flex items-center gap-0.5">
          {FORMATS.map(({ kind, label, Glyph }) => (
            <IconButton
              key={kind}
              size="sm"
              aria-label={label}
              disabled={previewing}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => format(kind)}
            >
              <Glyph />
            </IconButton>
          ))}
        </div>
        <div
          role="group"
          aria-label="Note view"
          className="ml-auto flex items-center gap-0.5"
        >
          {(["edit", "preview"] as const).map((view) => (
            <Button
              key={view}
              type="button"
              size="sm"
              variant={mode === view ? "secondary" : "ghost"}
              aria-pressed={mode === view}
              onClick={() => setMode(view)}
            >
              {view === "edit" ? "Edit" : "Preview"}
            </Button>
          ))}
        </div>
      </div>
      {previewing ? (
        <NotePreview content={content} />
      ) : (
        <textarea
          ref={editorRef}
          value={content}
          onChange={(event) =>
            change(event.target.value, "type", {
              text: content,
              ...lastSelection.current,
            })
          }
          onSelect={(event) => {
            lastSelection.current = {
              start: event.currentTarget.selectionStart,
              end: event.currentTarget.selectionEnd,
            };
          }}
          onKeyDown={onKeyDown}
          placeholder="Start typing…"
          aria-label="Note content"
          spellCheck={spellcheckEnabled(content)}
          className="text-ink placeholder:text-ink-faint px-gutter min-h-0 flex-1 resize-none bg-transparent pt-1.5 pb-3 text-[16px] leading-[1.7] outline-none"
        />
      )}
      <div className="text-ink-muted px-gutter border-line flex items-center justify-between gap-3 border-t py-1.5 text-[12px]">
        <span data-testid="note-word-count">
          {words} {words === 1 ? "word" : "words"}
        </span>
        {!previewing && (
          <span className="hidden sm:inline">Ctrl+Enter ticks a checklist item</span>
        )}
        <span
          role="status"
          data-testid="note-saved"
          title={indicator.detail}
          className={cn(
            "flex items-center gap-1",
            indicator.kind === "error" && "text-red font-semibold",
          )}
        >
          {indicator.kind === "error" ? (
            <WarningIcon size={12} weight="bold" aria-hidden />
          ) : indicator.kind === "saved" ? (
            <CheckIcon size={12} weight="bold" aria-hidden />
          ) : null}
          {indicator.text}
          {indicator.detail && <span className="sr-only">. {indicator.detail}</span>}
        </span>
      </div>
    </>
  );
}
