import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createServerBackedStorage } from "@/lib/persistedStorage";
import {
  clearSamples as clearSampleNotes,
  migrateNotesState,
  removeNote,
  restoreDeleted,
  restorePreviousRevision,
  seedFirstRun,
  updateNoteByAssistant,
  updateNoteByUser,
  type DeletedBy,
  type DeletedNote,
  type Note,
} from "./notesLogic";

export type { DeletedBy, DeletedNote, Note } from "./notesLogic";
export { noteTitle, notePreview } from "./notesLogic";

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
 * closing the window and reloading the page, via `persist` +
 * `createServerBackedStorage`: the server's data folder, with localStorage
 * as the immediate copy and fallback)
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
 *
 * Pure logic (titles, undo, revisions, sample seeding) lives in
 * `notesLogic.ts`; the sample notes are added exactly once, after the first
 * hydration finds `samplesSeeded` false.
 */
function generateNoteId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `note-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export interface NotesStoreState {
  notes: Note[];
  /** True once the sample notes were added (first run) — never re-seeds. */
  samplesSeeded: boolean;
  /** Last deleted note (user or assistant), restorable by `undoDelete`.
   *  In-memory only; the UI hides the offer after UNDO_WINDOW_MS. */
  lastDeleted: DeletedNote | null;
  /** Prepends a new note and returns it. `content` is required (pass ""
   *  for the sidebar's "+" empty-note affordance) — there's no separate
   *  title parameter, per this file's title-from-first-line convention. */
  createNote: (content: string) => Note;
  /** Replaces a note's entire content (not a merge/append). An update made
   *  `by: "assistant"` first saves the previous body as a revision (max 5).
   *  No-ops if `id` doesn't match an existing note. */
  updateNote: (id: string, content: string, by?: DeletedBy) => void;
  /** Soft delete: remembered in `lastDeleted`. No-ops if `id` is unknown. */
  deleteNote: (id: string, by?: DeletedBy) => void;
  undoDelete: () => void;
  dismissUndo: () => void;
  /** Puts back the newest body the assistant replaced. */
  restoreRevision: (id: string) => void;
  clearSamples: () => void;
  seedSamples: () => void;
}

export const useNotesStore = create<NotesStoreState>()(
  persist(
    (set) => ({
      notes: [],
      samplesSeeded: false,
      lastDeleted: null,

      createNote: (content) => {
        const note: Note = {
          id: generateNoteId(),
          content,
          updatedLabel: "Just now",
        };
        set((state) => ({ notes: [note, ...state.notes] }));
        return note;
      },

      updateNote: (id, content, by = "user") => {
        set((state) => ({
          notes: state.notes.map((note) => {
            if (note.id !== id) return note;
            return by === "assistant"
              ? updateNoteByAssistant(note, content, "Just now")
              : updateNoteByUser(note, content, "Just now");
          }),
        }));
      },

      deleteNote: (id, by = "user") => {
        set((state) => {
          const { notes, deleted } = removeNote(state.notes, id, by, Date.now());
          return deleted ? { notes, lastDeleted: deleted } : state;
        });
      },

      undoDelete: () => {
        set((state) =>
          state.lastDeleted
            ? { notes: restoreDeleted(state.notes, state.lastDeleted), lastDeleted: null }
            : state,
        );
      },

      dismissUndo: () =>
        set((state) => (state.lastDeleted ? { lastDeleted: null } : state)),

      restoreRevision: (id) => {
        set((state) => ({
          notes: state.notes.map((note) =>
            note.id === id ? restorePreviousRevision(note, "Just now") : note,
          ),
        }));
      },

      clearSamples: () => set((state) => ({ notes: clearSampleNotes(state.notes) })),

      seedSamples: () => set((state) => seedFirstRun(state)),
    }),
    {
      name: "notes-app:notes",
      version: 1,
      storage: createJSONStorage(() => createServerBackedStorage("notes")),
      partialize: (state) => ({ notes: state.notes, samplesSeeded: state.samplesSeeded }),
      migrate: (persisted, version) =>
        version === 0 ? migrateNotesState(persisted) : persisted,
      onRehydrateStorage: () => (state) => state?.seedSamples(),
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

export function updateNote(id: string, content: string, by: DeletedBy = "user"): void {
  useNotesStore.getState().updateNote(id, content, by);
}

export function deleteNote(id: string, by: DeletedBy = "user"): void {
  useNotesStore.getState().deleteNote(id, by);
}
