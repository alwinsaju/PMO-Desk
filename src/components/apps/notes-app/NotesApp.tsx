"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { NotePencilIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { Button, IconButton, ScrollArea } from "@/components/ui";
import { cn } from "@/lib/cn";
import { easeStandard } from "@/lib/motion";
import { noteTitle, notePreview, useNotesStore } from "./notesStore";

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

  const [selectedId, setSelectedId] = useState<string | null>(
    () => useNotesStore.getState().notes[0]?.id ?? null,
  );

  const selectedNote = notes.find((note) => note.id === selectedId) ?? null;

  function handleCreate() {
    const note = createNote("");
    setSelectedId(note.id);
  }

  function handleChangeContent(content: string) {
    if (!selectedId) return;
    updateNote(selectedId, content);
  }

  function handleDelete(id: string) {
    const remaining = notes.filter((note) => note.id !== id);
    deleteNote(id);
    if (selectedId === id) setSelectedId(remaining[0]?.id ?? null);
  }

  return (
    <div data-window-id={windowId} className="flex h-full w-full">
      <div className="border-line flex w-[270px] shrink-0 flex-col border-r">
        <div className="flex items-center justify-between px-3 pt-1 pb-2 pl-4">
          <span className="text-ink-muted text-[12px] font-bold tracking-[0.08em] uppercase">
            Notes
          </span>
          <IconButton aria-label="New note" variant="ghost" onClick={handleCreate}>
            <PlusIcon size={18} />
          </IconButton>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <ul className="flex flex-col gap-1 px-2.5 pb-3">
            {notes.map((note) => {
              const isSelected = note.id === selectedId;
              return (
                // The `li` is the visual row (hover fill, accent bar), so the
                // delete button that floats over its corner keeps the row
                // lit while it is hovered instead of dropping the highlight.
                <li
                  key={note.id}
                  data-active={isSelected}
                  className={cn(
                    "group row-bar rounded-control ease-smooth relative min-w-0 transition-colors duration-200",
                    isSelected ? "bg-accent-soft" : "hover:bg-chip",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedId(note.id)}
                    className={cn(
                      "rounded-control flex w-full min-w-0 flex-col gap-px px-3 py-[11px] pr-10 text-left",
                      "focus-visible:ring-focus outline-none focus-visible:ring-2 focus-visible:ring-inset",
                    )}
                  >
                    {/* line-clamp-1 (not `truncate`) deliberately: `truncate`'s
                      `white-space: nowrap` makes this text's min-content
                      width equal its full unwrapped width, which the
                      ScrollArea's internal content-measuring wrapper
                      (`display: table`) then honors as a hard floor —
                      inflating the whole list to the widest note's natural
                      text width and pushing every row's text out of view,
                      no `min-w-0` upstream fixes that. `line-clamp-1` still
                      allows normal wrapping for min-content purposes, so it
                      clips to one line without the blowup. */}
                    {/* The selected fill is the translucent `accent-soft`
                      tint, so plain ink tokens stay readable on it in every
                      theme x brand combination. */}
                    <span className="text-ink line-clamp-1 text-[14px] font-semibold">
                      {noteTitle(note)}
                    </span>
                    <span className="text-ink-muted line-clamp-1 text-[12.5px]">
                      {note.updatedLabel} — {notePreview(note)}
                    </span>
                  </button>
                  <IconButton
                    aria-label={`Delete "${noteTitle(note)}"`}
                    variant="ghost"
                    size="sm"
                    shape="round"
                    onClick={() => handleDelete(note.id)}
                    className="text-ink-muted hover:bg-red-soft hover:text-red absolute top-2 right-2 h-[26px] w-[26px] opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  >
                    <TrashIcon size={14} />
                  </IconButton>
                </li>
              );
            })}
            {notes.length === 0 && (
              <li className="text-ink-faint px-3 py-8 text-center text-[13px]">
                No notes yet.
              </li>
            )}
          </ul>
        </ScrollArea>
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
            <div className="text-ink-muted px-gutter pt-3 pb-2 text-[12.5px]">
              {selectedNote.updatedLabel}
            </div>
            <textarea
              value={selectedNote.content}
              onChange={(event) => handleChangeContent(event.target.value)}
              placeholder="Start typing…"
              aria-label="Note content"
              className="text-ink placeholder:text-ink-faint px-gutter min-h-0 flex-1 resize-none bg-transparent pt-1.5 pb-7 text-[16px] leading-[1.7] outline-none"
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
