"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { NotePencilIcon, PlusIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui";
import { easeStandard } from "@/lib/motion";
import {
  UNDO_WINDOW_MS,
  canRestoreRevision,
  filterByTag,
  hasSamples,
  noteDateLabel,
  orderNotes,
  tagCounts,
  undoNoticeText,
} from "./notesLogic";
import { NoteEditor } from "./NoteEditor";
import { NoteList, TagFilter } from "./NoteList";
import { useNotesStore } from "./notesStore";

/**
 * Root Notes window — matches the `AppComponent` contract
 * (`ComponentType<{ windowId: string }>`) and is registered under "notes"
 * in `index.ts`. Sidebar list + single editor pane. Notes themselves
 * (create/update/delete/list) are read/written through the shared,
 * persisted `notesStore` — see that file's doc comment for why: it's also
 * the store the AI command route acts on when the Notes app is focused, so
 * every open Notes window and the AI see the exact same data.
 *
 * `selectedId` (which note THIS window's editor pane is showing) stays
 * local component state on purpose — a per-window UI concern, not data, so
 * multiple open Notes windows can browse/edit independently even though
 * they now share the same underlying notes.
 */
export function NotesApp({ windowId }: { windowId: string }) {
  const notes = useNotesStore((s) => s.notes);
  const createNote = useNotesStore((s) => s.createNote);
  const updateNote = useNotesStore((s) => s.updateNote);
  const deleteNote = useNotesStore((s) => s.deleteNote);
  const lastDeleted = useNotesStore((s) => s.lastDeleted);
  const undoDelete = useNotesStore((s) => s.undoDelete);
  const dismissUndo = useNotesStore((s) => s.dismissUndo);
  const restoreRevision = useNotesStore((s) => s.restoreRevision);
  const clearSamples = useNotesStore((s) => s.clearSamples);
  const togglePin = useNotesStore((s) => s.togglePin);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const focusEditorForRef = useRef<string | null>(null);

  const tags = tagCounts(notes);
  // A tag nobody uses any more filters nothing out.
  const activeTag = tags.some((t) => t.tag === tag) ? tag : null;
  const { pinned, others } = orderNotes(filterByTag(notes, activeTag));

  // Falls back to the first listed note when nothing (or a vanished note) is
  // selected, which also covers notes that arrive after async hydration.
  const selectedNote =
    notes.find((note) => note.id === selectedId) ?? pinned[0] ?? others[0] ?? null;
  const selectedNoteId = selectedNote?.id ?? null;

  useEffect(() => {
    if (selectedNoteId && focusEditorForRef.current === selectedNoteId) {
      focusEditorForRef.current = null;
      editorRef.current?.focus();
    }
  }, [selectedNoteId]);

  useEffect(() => {
    if (!lastDeleted) return;
    const remaining = UNDO_WINDOW_MS - (Date.now() - lastDeleted.at);
    if (remaining <= 0) {
      dismissUndo();
      return;
    }
    const timer = setTimeout(dismissUndo, remaining);
    return () => clearTimeout(timer);
  }, [lastDeleted, dismissUndo]);

  function handleCreate() {
    const note = createNote("");
    focusEditorForRef.current = note.id;
    setTag(null);
    setSelectedId(note.id);
  }

  function handleChangeContent(content: string) {
    if (!selectedNoteId) return;
    updateNote(selectedNoteId, content);
  }

  return (
    <div data-window-id={windowId} className="flex h-full w-full">
      <div className="border-line flex w-[270px] shrink-0 flex-col border-r">
        <div className="flex items-center justify-between px-3 pt-1 pb-2 pl-4">
          <span className="text-ink-muted text-[12px] font-bold tracking-[0.08em] uppercase">
            Notes
          </span>
          <div className="flex items-center gap-1">
            {hasSamples(notes) && (
              <Button type="button" variant="ghost" size="sm" onClick={clearSamples}>
                Clear samples
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label="New note"
              title="New note"
              onClick={handleCreate}
            >
              <PlusIcon size={14} weight="bold" aria-hidden />
              New
            </Button>
          </div>
        </div>
        <TagFilter tags={tags} active={activeTag} onChange={setTag} />
        <NoteList
          notes={notes}
          selectedId={selectedNoteId}
          tag={activeTag}
          onSelect={setSelectedId}
          onDelete={deleteNote}
          onTogglePin={togglePin}
        />
        {lastDeleted && (
          <p
            role="status"
            className="text-ink-soft border-line flex items-center justify-between gap-2 border-t px-4 py-2 text-[12.5px]"
          >
            <span>{undoNoticeText(lastDeleted)}</span>
            <Button type="button" variant="ghost" size="sm" onClick={undoDelete}>
              Undo
            </Button>
          </p>
        )}
        <p className="text-ink-faint border-line border-t px-4 py-2 text-[11.5px]">
          Notes are saved on this computer.
        </p>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {selectedNote ? (
          // Keyed by the selected note so switching in the sidebar gives
          // the editor pane a brief fade rather than an instant content
          // swap — kept quick since this fires on every click through the
          // list. Plain mount animation (no animated exit): the previous
          // note's text is simply gone the instant the new one mounts,
          // same as before this existed.
          <motion.div
            key={selectedNote.id}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.12, ease: easeStandard }}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="text-ink-muted px-gutter flex items-center justify-between gap-3 pt-3 pb-2 text-[12.5px]">
              <span>{noteDateLabel(selectedNote) || "Sample note"}</span>
              {canRestoreRevision(selectedNote) && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => restoreRevision(selectedNote.id)}
                >
                  Restore previous version
                </Button>
              )}
            </div>
            <NoteEditor
              content={selectedNote.content}
              editorRef={editorRef}
              onChange={handleChangeContent}
            />
          </motion.div>
        ) : (
          <div className="text-ink-muted flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm">
            <span className="bg-chip text-ink-muted rounded-tile inline-flex h-14 w-14 items-center justify-center">
              <NotePencilIcon size={26} />
            </span>
            <p className="text-ink font-semibold">No note selected</p>
            <Button type="button" onClick={handleCreate}>
              Create a note
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
