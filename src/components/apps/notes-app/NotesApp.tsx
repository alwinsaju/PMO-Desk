"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { NotePencilIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { IconButton, ScrollArea } from "@/components/ui";
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
      <div className="border-border/60 flex w-56 shrink-0 flex-col border-r">
        <div className="border-border/60 flex items-center justify-between border-b p-2.5">
          <span className="text-ink-muted px-1 text-[12px] font-semibold tracking-wide uppercase">
            Notes
          </span>
          <IconButton
            aria-label="New note"
            variant="ghost"
            size="sm"
            onClick={handleCreate}
          >
            <PlusIcon size={15} />
          </IconButton>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <ul className="flex flex-col gap-0.5 p-1.5">
            {notes.map((note) => {
              const isSelected = note.id === selectedId;
              return (
                <li key={note.id} className="group relative min-w-0">
                  <button
                    type="button"
                    onClick={() => setSelectedId(note.id)}
                    className={cn(
                      "rounded-control ease-standard flex w-full min-w-0 flex-col gap-0.5 px-2.5 py-2 pr-8 text-left transition-colors duration-150 outline-none",
                      "focus-visible:ring-accent focus-visible:ring-2",
                      isSelected ? "bg-accent-subtle" : "hover:bg-neutral-100",
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
                    {/* Selected state uses text-accent-800/700 rather than
                      text-ink/text-ink-faint — same convention every other
                      bg-accent-subtle consumer already follows (Badge,
                      PresenceAvatars, TaskStateBadge, Dropdown/ContextMenu).
                      accent-subtle is one of the accent-* tokens, which are
                      deliberately NOT redefined per-theme (see tokens.css),
                      so it stays a light mint tint in dark mode too — pairing
                      it with text-ink (which DOES invert to near-white in
                      dark mode) made the selected row's title unreadable
                      there (~1:1 contrast). accent-800/700 are themselves
                      theme-invariant, so they stay legible against
                      accent-subtle in both themes (~11:1 / ~9:1). */}
                    <span
                      className={cn(
                        "line-clamp-1 text-[13px] font-semibold",
                        isSelected ? "text-accent-800" : "text-ink",
                      )}
                    >
                      {noteTitle(note)}
                    </span>
                    <span
                      className={cn(
                        "line-clamp-1 text-[12px]",
                        isSelected ? "text-accent-700" : "text-ink-faint",
                      )}
                    >
                      {note.updatedLabel} — {notePreview(note)}
                    </span>
                  </button>
                  <IconButton
                    aria-label={`Delete "${noteTitle(note)}"`}
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(note.id)}
                    className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  >
                    <TrashIcon size={13} />
                  </IconButton>
                </li>
              );
            })}
            {notes.length === 0 && (
              <li className="text-ink-faint px-3 py-6 text-center text-[13px]">
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
            <div className="border-border/60 text-ink-faint flex items-center border-b px-4 py-2 text-[12px]">
              {selectedNote.updatedLabel}
            </div>
            <textarea
              value={selectedNote.content}
              onChange={(event) => handleChangeContent(event.target.value)}
              placeholder="Start typing…"
              aria-label="Note content"
              className="text-ink placeholder:text-ink-faint min-h-0 flex-1 resize-none bg-transparent p-5 text-[14px] leading-relaxed outline-none"
            />
          </motion.div>
        ) : (
          <div className="text-ink-faint flex flex-1 flex-col items-center justify-center gap-3 text-center text-sm">
            <NotePencilIcon size={28} />
            <p>No note selected</p>
            <button
              type="button"
              onClick={handleCreate}
              className="text-accent text-[13px] font-medium hover:underline"
            >
              Create a note
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
