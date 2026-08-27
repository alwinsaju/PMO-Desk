import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * No `"use client"` here, deliberately — same reasoning as
 * `installedAppsStore.ts` / `pinnedAppsStore.ts` (see ARCHITECTURE.md's
 * third gotcha). This file imports only `zustand`/`zustand/middleware` and
 * plain local types, so it's safe to evaluate anywhere; every actual
 * consumer (NotesApp, CommandBar) is already a Client Component / client-
 * only code path in its own right.
 *
 * This is the shared, persisted source of truth for every note — genuinely
 * shared (every open Notes window reads/writes the same data, replacing the
 * old per-instance `useState` that used to live in NotesApp.tsx, seeded
 * from this file's `initialNotes`) and genuinely persisted (survives
 * closing the window and reloading the page, via `persist` + `localStorage`)
 * — the exact same shape as `installedAppsStore.ts`/`pinnedAppsStore.ts`.
 *
 * The reason this needed to happen at all: a real AI action needs a real,
 * addressable place to act on. `src/app/api/ai/command/route.ts` decides
 * *that* a note should be created/updated/deleted; CommandBar.tsx is the
 * one place that then actually calls `createNote`/`updateNote`/`deleteNote`
 * below, after validating the model's decision — the same public contract
 * any other feature code would use, no special-casing. This is the
 * intended cross-directory integration point (mirrors
 * `installedAppsStore.ts`'s own doc comment about being "the intended
 * cross-directory contract" for install state) — CommandBar importing this
 * store directly is deliberate, not a layering violation.
 *
 * A note has no separate `title` field, same convention as the mock data
 * this replaces: its title is just the first line of `content` (see
 * `noteTitle` below), so there's nothing to keep in sync when the content
 * is edited — `createNote`/`updateNote` both only ever take `content`.
 */
export interface Note {
  id: string;
  content: string;
  updatedLabel: string;
}

/** The note's display title — its content's first non-empty line, or a
 *  fallback for a brand-new, still-empty note. Also what the AI command
 *  route's "existing notes" context uses (id + THIS, never full content —
 *  see route.ts) so the model can reference a specific note by id. */
export function noteTitle(note: Pick<Note, "content">): string {
  const firstLine = note.content.split("\n")[0]?.trim();
  return firstLine || "New Note";
}

/** Every line after the first, collapsed to one line, for the sidebar's
 *  preview snippet. */
export function notePreview(note: Pick<Note, "content">): string {
  const [, ...rest] = note.content.split("\n");
  const preview = rest.join(" ").trim();
  return preview || "No additional text";
}

/**
 * Seed data for a brand-new browser profile that has never persisted its
 * own notes yet — i.e. this only ever matters on the very first load.
 * `persist` (below) writes real state to `localStorage` the moment any
 * note action fires, and every load after that hydrates from THAT instead
 * — same mechanism as every other persisted store in this codebase (see
 * `installedAppsStore.ts`), so a returning user's own notes always win over
 * this seed rather than being clobbered by it on every reload.
 */
const initialNotes: Note[] = [
  {
    id: "welcome",
    content:
      "Welcome to Notes\n\nThis is a mock notes app — everything you type is kept in memory for this window only, and nothing leaves your browser tab. Select a note on the left, or create a new one with the + button.",
    updatedLabel: "Aug 25, 2026",
  },
  {
    id: "grocery-list",
    content: "Grocery list\n\nOats\nCoffee\nSpinach\nLemon\nOlive oil\nRice",
    updatedLabel: "Aug 22, 2026",
  },
  {
    id: "book-notes",
    content:
      "Reading notes — Project Hail Mary\n\nLoved the pacing on the chemistry problem-solving chapters. Worth rereading the coma-recovery opening once I've finished the rest.",
    updatedLabel: "Aug 18, 2026",
  },
  {
    id: "standup",
    content:
      "Standup talking points\n\n- Shipped the window drag/resize perf pass\n- Next: write up the app-registry gotchas\n- Blocked on: nothing right now",
    updatedLabel: "Aug 12, 2026",
  },
];

function generateNoteId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `note-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export interface NotesStoreState {
  notes: Note[];
  /** Prepends a new note and returns it. `content` is required (pass ""
   *  for the sidebar's "+" empty-note affordance) — there's no separate
   *  title parameter, per this file's title-from-first-line convention. */
  createNote: (content: string) => Note;
  /** Replaces a note's entire content (not a merge/append) — matches the
   *  textarea's own plain onChange semantics from before this was lifted
   *  into a store. No-ops if `id` doesn't match an existing note. */
  updateNote: (id: string, content: string) => void;
  /** No-ops if `id` doesn't match an existing note. */
  deleteNote: (id: string) => void;
}

export const useNotesStore = create<NotesStoreState>()(
  persist(
    (set) => ({
      notes: initialNotes,

      createNote: (content) => {
        const note: Note = {
          id: generateNoteId(),
          content,
          updatedLabel: "Just now",
        };
        set((state) => ({ notes: [note, ...state.notes] }));
        return note;
      },

      updateNote: (id, content) => {
        set((state) => ({
          notes: state.notes.map((note) =>
            note.id === id ? { ...note, content, updatedLabel: "Just now" } : note,
          ),
        }));
      },

      deleteNote: (id) => {
        set((state) => ({ notes: state.notes.filter((note) => note.id !== id) }));
      },
    }),
    {
      name: "notes-app:notes",
      partialize: (state) => ({ notes: state.notes }),
    },
  ),
);

/**
 * Plain (non-hook) reads/actions for call sites outside a component render
 * — mirrors `installedAppsStore.ts`'s `isAppInstalled`/`installApp`/
 * `uninstallApp`. CommandBar.tsx is the intended external caller: it reads
 * `getNotes()` to build the AI command route's "existing notes" context,
 * and calls `createNote`/`updateNote`/`deleteNote` after a validated
 * tool-call decision comes back. A component that needs to re-render on
 * note changes should select reactively via `useNotesStore` instead (see
 * NotesApp.tsx).
 */
export function getNotes(): Note[] {
  return useNotesStore.getState().notes;
}

export function createNote(content: string): Note {
  return useNotesStore.getState().createNote(content);
}

export function updateNote(id: string, content: string): void {
  useNotesStore.getState().updateNote(id, content);
}

export function deleteNote(id: string): void {
  useNotesStore.getState().deleteNote(id);
}
