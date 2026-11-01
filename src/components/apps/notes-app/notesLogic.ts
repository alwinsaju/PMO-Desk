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

/** Title length in the sidebar list, where rows are narrower than a window title. */
export const LIST_TITLE_MAX_CHARS = 30;
const PREVIEW_MAX_CHARS = 120;

/** Splits the first non-empty line at a word boundary within `max` chars: the
 *  part that fits (with "…" when cut) and the spill-over that moves to the preview. */
function splitFirstLine(
  content: string,
  max: number,
): { title: string; spill: string; rest: string } {
  const text = content ?? "";
  const match = /[^\r\n]*\S[^\r\n]*/.exec(text);
  const collapsed = (match?.[0] ?? "").replace(/\s+/g, " ").trim();
  const rest = match ? text.slice(match.index + match[0].length) : "";
  if (collapsed.length <= max) return { title: collapsed, spill: "", rest };
  const wordEnd = collapsed.lastIndexOf(" ", max - 1);
  // No usable space (one long token or URL): cut mid-word rather than show nothing.
  const cut = wordEnd >= Math.floor(max / 2) ? wordEnd : max - 1;
  return {
    title: `${collapsed.slice(0, cut).trimEnd()}…`,
    spill: collapsed.slice(cut).trim(),
    rest,
  };
}

/** First non-empty line, whitespace collapsed, cut at a word boundary. */
export function noteTitle(content: string, max = TITLE_MAX_CHARS): string {
  return splitFirstLine(content, max).title || UNTITLED_NOTE;
}

/** What the title line did not show plus everything after it, collapsed to one
 *  short line. Empty for a note that is only its title. */
export function notePreview(content: string, titleMax = TITLE_MAX_CHARS): string {
  const { spill, rest } = splitFirstLine(content, titleMax);
  const preview = `${spill} ${rest}`
    .replace(/\s+/g, " ")
    .trim()
    // A leading list marker would read as a stray dash after the title.
    .replace(/^[-*•]\s+/, "");
  return preview.length > PREVIEW_MAX_CHARS
    ? `${preview.slice(0, PREVIEW_MAX_CHARS - 1).trimEnd()}…`
    : preview;
}

/** Title and preview for a sidebar row. */
export function noteListEntry(content: string): { title: string; preview: string } {
  return {
    title: noteTitle(content, LIST_TITLE_MAX_CHARS),
    preview: notePreview(content, LIST_TITLE_MAX_CHARS),
  };
}

/** The date shown for a note; samples have none, so they never look stale. */
export function noteDateLabel(note: Pick<Note, "sample" | "updatedLabel">): string {
  return note.sample ? "" : note.updatedLabel;
}

/** Date and preview as one subtitle line, skipping whichever part is empty. */
export function noteSubtitle(date: string, preview: string): string {
  return [date, preview].filter(Boolean).join(" — ");
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
