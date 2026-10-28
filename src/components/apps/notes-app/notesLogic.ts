// Pure note logic (no React, no zustand) so it is unit-testable; notesStore.ts
// applies these functions to state.

export interface Note {
  id: string;
  content: string;
  updatedLabel: string;
  /** Demo note shipped with the app; removed by "Clear samples". */
  sample?: boolean;
  /** Earlier bodies replaced by the AI assistant, oldest first. */
  revisions?: string[];
}

export type DeletedBy = "user" | "assistant";

export interface DeletedNote {
  note: Note;
  index: number;
  by: DeletedBy;
  at: number;
}

export const MAX_REVISIONS = 5;
export const UNDO_WINDOW_MS = 10_000;
export const TITLE_MAX_CHARS = 60;
export const UNTITLED_NOTE = "Untitled note";

/** First non-empty line, whitespace collapsed, capped at 60 chars. */
export function noteTitle(content: string): string {
  const firstLine = /[^\r\n]*\S[^\r\n]*/.exec(content ?? "")?.[0] ?? "";
  const collapsed = firstLine.replace(/\s+/g, " ").trim();
  if (!collapsed) return UNTITLED_NOTE;
  if (collapsed.length <= TITLE_MAX_CHARS) return collapsed;
  return `${collapsed.slice(0, TITLE_MAX_CHARS - 1).trimEnd()}…`;
}

/** Everything after the title line, collapsed to one short line. */
export function notePreview(content: string): string {
  const text = content ?? "";
  const match = /[^\r\n]*\S[^\r\n]*/.exec(text);
  const rest = match ? text.slice(match.index + match[0].length) : "";
  const preview = rest.replace(/\s+/g, " ").trim();
  if (!preview) return "No additional text";
  return preview.length > 120 ? `${preview.slice(0, 119).trimEnd()}…` : preview;
}

/** Appends `previous` to the history, capped to the newest MAX_REVISIONS. */
export function pushRevision(
  revisions: string[] | undefined,
  previous: string,
): string[] {
  const history = revisions ?? [];
  if (!previous.trim() || history[history.length - 1] === previous) return history;
  return [...history, previous].slice(-MAX_REVISIONS);
}

/** AI-authored update: replaces the body but keeps the previous one. */
export function updateNoteByAssistant(note: Note, content: string, label: string): Note {
  if (note.content === content) return note;
  return {
    ...note,
    content,
    updatedLabel: label,
    revisions: pushRevision(note.revisions, note.content),
  };
}

/** Human edit: replaces the body; an edited sample stops being a sample. */
export function updateNoteByUser(note: Note, content: string, label: string): Note {
  const { sample, ...rest } = note;
  void sample;
  return { ...rest, content, updatedLabel: label };
}

export function canRestoreRevision(
  note: Pick<Note, "revisions"> | null | undefined,
): boolean {
  return Boolean(note?.revisions && note.revisions.length > 0);
}

/** Brings back the newest saved body (itself not kept as a revision). */
export function restorePreviousRevision(note: Note, label: string): Note {
  const revisions = note.revisions ?? [];
  if (revisions.length === 0) return note;
  return {
    ...note,
    content: revisions[revisions.length - 1],
    updatedLabel: label,
    revisions: revisions.slice(0, -1),
  };
}

export function removeNote(
  notes: Note[],
  id: string,
  by: DeletedBy,
  at: number,
): { notes: Note[]; deleted: DeletedNote | null } {
  const index = notes.findIndex((n) => n.id === id);
  if (index === -1) return { notes, deleted: null };
  return {
    notes: notes.filter((n) => n.id !== id),
    deleted: { note: notes[index], index, by, at },
  };
}

export function restoreDeleted(notes: Note[], deleted: DeletedNote): Note[] {
  if (notes.some((n) => n.id === deleted.note.id)) return notes;
  const next = [...notes];
  next.splice(Math.min(Math.max(deleted.index, 0), next.length), 0, deleted.note);
  return next;
}

export function isUndoActive(deleted: DeletedNote | null, now: number): boolean {
  return deleted !== null && now - deleted.at >= 0 && now - deleted.at < UNDO_WINDOW_MS;
}

export function undoNoticeText(deleted: DeletedNote): string {
  return deleted.by === "assistant" ? "Deleted by the assistant." : "Note deleted.";
}

export const SAMPLE_NOTES: readonly Note[] = [
  {
    id: "welcome",
    sample: true,
    content:
      "Welcome to Notes\n\nNotes are saved on this computer, in AI OS's local data folder, and are kept between sessions. These sample notes are demo content — remove them any time with Clear samples. Create your own with the + button.",
    updatedLabel: "Aug 25, 2026",
  },
  {
    id: "grocery-list",
    sample: true,
    content: "Grocery list\n\nOats\nCoffee\nSpinach\nLemon\nOlive oil\nRice",
    updatedLabel: "Aug 22, 2026",
  },
  {
    id: "book-notes",
    sample: true,
    content:
      "Reading notes — Project Hail Mary\n\nLoved the pacing on the chemistry problem-solving chapters. Worth rereading the coma-recovery opening once I've finished the rest.",
    updatedLabel: "Aug 18, 2026",
  },
  {
    id: "standup",
    sample: true,
    content:
      "Standup talking points\n\n- Shipped the window drag/resize perf pass\n- Next: write up the app-registry gotchas\n- Blocked on: nothing right now",
    updatedLabel: "Aug 12, 2026",
  },
];

export function hasSamples(notes: Note[]): boolean {
  return notes.some((n) => n.sample);
}

export function clearSamples(notes: Note[]): Note[] {
  return hasSamples(notes) ? notes.filter((n) => !n.sample) : notes;
}

export interface SeedableNotesState {
  notes: Note[];
  samplesSeeded: boolean;
}

/** Adds the sample notes exactly once, on the very first run. */
export function seedFirstRun(state: SeedableNotesState): SeedableNotesState {
  if (state.samplesSeeded) return state;
  return {
    notes: [...state.notes, ...SAMPLE_NOTES.map((n) => ({ ...n }))],
    samplesSeeded: true,
  };
}

/** v0 persisted `{notes}` with the samples baked in and no flag: keep the
 *  user's notes, tag untouched samples, and mark seeding as done. */
export function migrateNotesState(persisted: unknown): SeedableNotesState {
  const raw = (persisted as { notes?: unknown } | null)?.notes;
  const notes = Array.isArray(raw) ? (raw as Note[]) : [];
  return {
    samplesSeeded: true,
    notes: notes.map((note) => {
      const sample = SAMPLE_NOTES.find((s) => s.id === note.id);
      return sample && note.updatedLabel === sample.updatedLabel ? { ...sample } : note;
    }),
  };
}
