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
  ListBulletsIcon,
  ListChecksIcon,
  TextBIcon,
  TextHIcon,
} from "@phosphor-icons/react";
import { IconButton } from "@/components/ui";
import { applyFormat, toggleCheck, type NoteFormat } from "./noteFormat";
import { wordCount } from "./notesLogic";

const SAVING_MS = 700;

const FORMATS: { kind: NoteFormat; label: string; Glyph: typeof TextBIcon }[] = [
  { kind: "heading", label: "Heading", Glyph: TextHIcon },
  { kind: "bold", label: "Bold (Ctrl+B)", Glyph: TextBIcon },
  { kind: "bullet", label: "Bullet list", Glyph: ListBulletsIcon },
  { kind: "check", label: "Checklist", Glyph: ListChecksIcon },
];

/** The note's text area with a formatting toolbar, a word count and a Saved indicator.
 *  The note stays plain text; the toolbar only inserts simple markers (see noteFormat.ts). */
export function NoteEditor({
  content,
  editorRef,
  onChange,
}: {
  content: string;
  editorRef: RefObject<HTMLTextAreaElement | null>;
  onChange: (content: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const selection = useRef<{ start: number; end: number } | null>(null);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  // The new text is in the box only after React renders it; then the selection can be put back.
  useLayoutEffect(() => {
    const wanted = selection.current;
    const el = editorRef.current;
    if (!wanted || !el) return;
    selection.current = null;
    el.focus();
    el.setSelectionRange(wanted.start, wanted.end);
  }, [content, editorRef]);

  const change = (next: string) => {
    onChange(next);
    setSaving(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setSaving(false), SAVING_MS);
  };

  const format = (kind: NoteFormat) => {
    const el = editorRef.current;
    if (!el) return;
    const edit = applyFormat(el.value, el.selectionStart, el.selectionEnd, kind);
    selection.current = { start: edit.start, end: edit.end };
    change(edit.text);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const el = event.currentTarget;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "b") {
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
      selection.current = { start: el.selectionStart, end: el.selectionEnd };
      change(el.value.slice(0, from) + flipped + el.value.slice(to));
    }
  };

  const words = wordCount(content);
  return (
    <>
      <div
        role="toolbar"
        aria-label="Formatting"
        className="px-gutter flex items-center gap-0.5 pb-1"
      >
        {FORMATS.map(({ kind, label, Glyph }) => (
          <IconButton
            key={kind}
            size="sm"
            aria-label={label}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => format(kind)}
          >
            <Glyph />
          </IconButton>
        ))}
      </div>
      <textarea
        ref={editorRef}
        value={content}
        onChange={(event) => change(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Start typing…"
        aria-label="Note content"
        className="text-ink placeholder:text-ink-faint px-gutter min-h-0 flex-1 resize-none bg-transparent pt-1.5 pb-3 text-[16px] leading-[1.7] outline-none"
      />
      <div className="text-ink-muted px-gutter border-line flex items-center justify-between gap-3 border-t py-1.5 text-[12px]">
        <span data-testid="note-word-count">
          {words} {words === 1 ? "word" : "words"}
        </span>
        <span className="hidden sm:inline">Ctrl+Enter ticks a checklist item</span>
        <span role="status" data-testid="note-saved" className="flex items-center gap-1">
          {saving ? (
            "Saving…"
          ) : (
            <>
              <CheckIcon size={12} weight="bold" aria-hidden />
              Saved
            </>
          )}
        </span>
      </div>
    </>
  );
}
