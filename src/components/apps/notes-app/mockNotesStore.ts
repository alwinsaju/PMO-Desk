/**
 * Plain, framework-agnostic note shape + initial mock data. No live
 * component/icon values live here, so this file never needs "use client"
 * itself — same split as `files-app/mockFileSystem.ts`.
 *
 * A note has no separate `title` field: like most plain-text notes apps,
 * its title is just the first line of `content` (see `noteTitle` below), so
 * there's nothing to keep in sync when the content is edited.
 */

export interface Note {
  id: string;
  content: string;
  updatedLabel: string;
}

/** The note's display title — its content's first non-empty line, or a
 *  fallback for a brand-new, still-empty note. */
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

export const initialNotes: Note[] = [
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
