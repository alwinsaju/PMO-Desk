"use client";

import { useState } from "react";
import { NotePencilIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { IconButton, ScrollArea } from "@/components/ui";
import { cn } from "@/lib/cn";
import { initialNotes, noteTitle, notePreview, type Note } from "./mockNotesStore";

function createEmptyNote(): Note {
  return {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `note-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    content: "",
    updatedLabel: "Just now",
  };
}

/**
 * Root Notes window — matches the `AppComponent` contract
 * (`ComponentType<{ windowId: string }>`) and is registered under "notes"
 * in `index.ts`. Sidebar list + single editor pane, both backed by local
 * component state seeded from `mockNotesStore.ts`'s `initialNotes` — fully
 * per-instance, so multiple Notes windows never share or clobber each
 * other's edits.
 */
export function NotesApp({ windowId }: { windowId: string }) {
  const [notes, setNotes] = useState<Note[]>(initialNotes);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialNotes[0]?.id ?? null,
  );

  const selectedNote = notes.find((note) => note.id === selectedId) ?? null;

  function handleCreate() {
    const note = createEmptyNote();
    setNotes((prev) => [note, ...prev]);
    setSelectedId(note.id);
  }

  function handleChangeContent(content: string) {
    if (!selectedId) return;
    setNotes((prev) =>
      prev.map((note) =>
        note.id === selectedId ? { ...note, content, updatedLabel: "Just now" } : note,
      ),
    );
  }

  function handleDelete(id: string) {
    const remaining = notes.filter((note) => note.id !== id);
    setNotes(remaining);
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
            {notes.map((note) => (
              <li key={note.id} className="group relative min-w-0">
                <button
                  type="button"
                  onClick={() => setSelectedId(note.id)}
                  className={cn(
                    "rounded-control flex w-full min-w-0 flex-col gap-0.5 px-2.5 py-2 pr-8 text-left outline-none",
                    "focus-visible:ring-accent focus-visible:ring-2",
                    note.id === selectedId ? "bg-accent-subtle" : "hover:bg-neutral-100",
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
                  <span className="text-ink line-clamp-1 text-[13px] font-semibold">
                    {noteTitle(note)}
                  </span>
                  <span className="text-ink-faint line-clamp-1 text-[12px]">
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
            ))}
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
          <>
            <div className="border-border/60 text-ink-faint flex items-center border-b px-4 py-2 text-[12px]">
              {selectedNote.updatedLabel}
            </div>
            <textarea
              key={selectedNote.id}
              value={selectedNote.content}
              onChange={(event) => handleChangeContent(event.target.value)}
              placeholder="Start typing…"
              aria-label="Note content"
              className="text-ink placeholder:text-ink-faint min-h-0 flex-1 resize-none bg-transparent p-5 text-[14px] leading-relaxed outline-none"
            />
          </>
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
