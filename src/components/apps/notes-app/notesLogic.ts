// Pure note logic (no React, no zustand) so it is unit-testable; notesStore.ts
// applies these functions to state.
import type { SaveStatus } from "@/lib/uiState/saveStatus";

export interface Note {
  id: string;
  content: string;
  /** When the note was last changed, as an ISO date-time; shown as a date at render. */
  updatedAt?: string;
  /** Fixed text used by sample notes and by notes saved before `updatedAt` existed. */
  updatedLabel?: string;
  /** Demo note shipped with the app; removed by "Clear samples". */
  sample?: boolean;
  /** Earlier bodies replaced by the AI assistant, oldest first. */
  revisions?: string[];
  /** Kept at the top of the list. */
  pinned?: boolean;
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

/** Hides the simple formatting markers (`# `, `- [ ] `, `**`) so a title or preview reads as text. */
function withoutMarkers(content: string): string {
  return (content ?? "")
    .replace(/^[ \t]*(?:#{1,3}[ \t]+|-[ \t]\[[ xX]\][ \t]+)/gm, "")
    .replace(/\*\*/g, "");
}

/** Splits the first non-empty line at a word boundary within `max` chars: the
 *  part that fits (with "…" when cut) and the spill-over that moves to the preview. */
function splitFirstLine(
  content: string,
  max: number,
): { title: string; spill: string; rest: string } {
  const text = withoutMarkers(content);
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
export function noteDateLabel(
  note: Pick<Note, "sample" | "updatedAt" | "updatedLabel">,
  now: Date = new Date(),
): string {
  if (note.sample) return "";
  if (note.updatedAt) {
    const formatted = formatNoteDate(note.updatedAt, now);
    if (formatted) return formatted;
  }
  // Older notes were stamped with a fixed "Just now" that never changed: no date is known.
  if (!note.updatedLabel || note.updatedLabel === LEGACY_NOW_LABEL) return "Date unknown";
  return note.updatedLabel;
}

const LEGACY_NOW_LABEL = "Just now";
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const DAY_MS = 86_400_000;

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** "Just now", "Today, 14:05", "Yesterday, 09:30", "Nov 5, 14:05" or "Nov 5, 2025"; null if `iso` is not a date. */
export function formatNoteDate(iso: string, now: Date): string | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const time = `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
  const days = Math.round((startOfDay(now) - startOfDay(at)) / DAY_MS);
  if (days === 0) {
    return Math.abs(now.getTime() - at.getTime()) < 60_000
      ? "Just now"
      : `Today, ${time}`;
  }
  if (days === 1) return `Yesterday, ${time}`;
  const day = `${MONTHS[at.getMonth()]} ${at.getDate()}`;
  return at.getFullYear() === now.getFullYear()
    ? `${day}, ${time}`
    : `${day}, ${at.getFullYear()}`;
}

/** Pushes `previous` onto the history, capped to the newest MAX_REVISIONS. */
export function pushRevision(
  revisions: string[] | undefined,
  previous: string,
): string[] {
  const history = revisions ?? [];
  if (!previous.trim() || history[history.length - 1] === previous) return history;
  return [...history, previous].slice(-MAX_REVISIONS);
}

/** AI-authored update: replaces the body but keeps the previous one. */
export function updateNoteByAssistant(note: Note, content: string, at: string): Note {
  if (note.content === content) return note;
  const { updatedLabel, ...rest } = note;
  void updatedLabel;
  return {
    ...rest,
    content,
    updatedAt: at,
    revisions: pushRevision(note.revisions, note.content),
  };
}

/** Human edit: replaces the body; an edited sample stops being a sample. */
export function updateNoteByUser(note: Note, content: string, at: string): Note {
  const { sample, updatedLabel, ...rest } = note;
  void sample;
  void updatedLabel;
  return { ...rest, content, updatedAt: at };
}

export function canRestoreRevision(
  note: Pick<Note, "revisions"> | null | undefined,
): boolean {
  return Boolean(note?.revisions && note.revisions.length > 0);
}

/** Brings back the newest saved body (itself not kept as a revision). */
export function restorePreviousRevision(note: Note, at: string): Note {
  const revisions = note.revisions ?? [];
  if (revisions.length === 0) return note;
  const { updatedLabel, ...rest } = note;
  void updatedLabel;
  return {
    ...rest,
    content: revisions[revisions.length - 1],
    updatedAt: at,
    revisions: revisions.slice(0, -1),
  };
}

export function togglePinned(note: Note): Note {
  const { pinned, ...rest } = note;
  return pinned ? rest : { ...note, pinned: true };
}

/** Pinned notes first; each group keeps the list's own order (newest first). */
export function orderNotes(notes: readonly Note[]): {
  pinned: Note[];
  others: Note[];
} {
  return {
    pinned: notes.filter((n) => n.pinned),
    others: notes.filter((n) => !n.pinned),
  };
}

const TAG = /(?:^|\s)#([\p{L}][\p{L}\p{N}_-]*)/gu;

/** `#tags` written anywhere in a note, lower-case and unique ("# Heading" with a space is not a tag). */
export function noteTags(content: string): string[] {
  const found = new Set<string>();
  for (const match of (content ?? "").matchAll(TAG)) found.add(match[1].toLowerCase());
  return [...found];
}

/** Tags and searchable text per note object. A note is replaced, never changed in
 *  place, so an untouched note is not re-scanned on every keystroke in another one. */
const derived = new WeakMap<object, { tags: string[]; text: string }>();

function derive(note: Pick<Note, "content">): { tags: string[]; text: string } {
  let entry = derived.get(note);
  if (!entry) {
    entry = {
      tags: noteTags(note.content),
      text: withoutMarkers(note.content).toLowerCase(),
    };
    derived.set(note, entry);
  }
  return entry;
}

/** Every tag in use with how many notes carry it, most used first. */
export function tagCounts(notes: readonly Note[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const note of notes) {
    for (const tag of derive(note).tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export function filterByTag(notes: readonly Note[], tag: string | null): Note[] {
  return tag ? notes.filter((n) => derive(n).tags.includes(tag)) : [...notes];
}

/** True when every word typed is in the note's title or body, ignoring case and formatting
 *  markers. A blank query matches every note. */
export function noteMatchesText(note: Pick<Note, "content">, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const { text } = derive(note);
  return words.every((word) => text.includes(word));
}

/** How many list rows to draw at first and per "Show more"; thousands of rows make the window crawl. */
export const LIST_PAGE_SIZE = 100;

/** The first `limit` notes of the ordered list, widened to include the selected one. */
export function visibleNotes<T extends Pick<Note, "id">>(
  ordered: readonly T[],
  limit: number,
  selectedId: string | null,
): { shown: T[]; hidden: number } {
  const at = selectedId === null ? -1 : ordered.findIndex((n) => n.id === selectedId);
  const count = Math.min(ordered.length, Math.max(limit, at + 1));
  return { shown: ordered.slice(0, count), hidden: ordered.length - count };
}

/** Notes carrying `tag` (when set) whose text matches `query` (when not blank); both must hold. */
export function filterNotes(
  notes: readonly Note[],
  tag: string | null,
  query: string,
): Note[] {
  return filterByTag(notes, tag).filter((n) => noteMatchesText(n, query));
}

export interface SaveIndicator {
  kind: "saving" | "saved" | "error";
  text: string;
  /** Plain-language explanation, shown as a tooltip and read out by screen readers. */
  detail?: string;
}

/** What the editor footer says about saving; "Saved" only once the server has the text. */
export function noteSaveIndicator(status: SaveStatus): SaveIndicator {
  if (status.state === "saving") return { kind: "saving", text: "Saving…" };
  if (status.state === "saved") return { kind: "saved", text: "Saved" };
  if (status.failure === "too-large") {
    return {
      kind: "error",
      text: "Not saved: too big",
      detail:
        "Your notes are too big to save. Shorten the longest note or delete old ones. Your latest changes are kept in this window.",
    };
  }
  if (status.failure === "rejected") {
    return {
      kind: "error",
      text: "Not saved",
      detail:
        "PMO Desk could not save your notes. Your latest changes are kept on this computer and will be tried again after your next edit.",
    };
  }
  return {
    kind: "error",
    text: status.willRetry ? "Not saved yet, retrying" : "Not saved",
    detail:
      "PMO Desk can't reach its data folder right now. Your changes are kept and will be saved as soon as it can.",
  };
}

export function wordCount(content: string): number {
  const words = withoutMarkers(content)
    .replace(/^[ \t]*[-•][ \t]+/gm, "")
    .match(/\S+/g);
  return words ? words.length : 0;
}

/** Above this the browser's spell checker is turned off for the note: checking a very
 *  long text keeps the app busy (about 36 s to quit at 600 KB, minutes at 1.5 MB). */
export const SPELLCHECK_MAX_CHARS = 50_000;

export function spellcheckEnabled(content: string): boolean {
  return content.length <= SPELLCHECK_MAX_CHARS;
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
      "Welcome to Notes\n\nNotes are saved on this computer, in PMO Desk's local data folder, and are kept between sessions. These sample notes are demo content — remove them any time with Clear samples. Create your own with the + button.",
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
