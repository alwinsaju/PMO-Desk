"use client";

import { memo, useState } from "react";
import { PushPinIcon, TrashIcon } from "@phosphor-icons/react";
import { Button, IconButton, Input, ScrollArea } from "@/components/ui";
import { noSpellcheck } from "@/lib/ui/noSpellcheck";
import { cn } from "@/lib/cn";
import {
  LIST_PAGE_SIZE,
  noteDateLabel,
  noteListEntry,
  noteTags,
  noteTitle,
  visibleNotes,
  type Note,
} from "./notesLogic";

/** The text filter box above the list: narrows the notes to those whose title or body has the words typed. */
export function NoteSearch({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="px-4 pb-2">
      <Input
        {...noSpellcheck}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && value) {
            event.preventDefault();
            event.stopPropagation();
            onChange("");
          }
        }}
        placeholder="Filter notes"
        aria-label="Filter notes"
        data-testid="notes-text-filter"
        className="h-8 text-[13px]"
      />
    </div>
  );
}

/** The tag filter chips: All, then every #tag in use with how many notes carry it. */
export function TagFilter({
  tags,
  active,
  onChange,
}: {
  tags: { tag: string; count: number }[];
  active: string | null;
  onChange: (tag: string | null) => void;
}) {
  if (tags.length === 0) return null;
  const chip = (label: string, on: boolean, onClick: () => void, key: string) => (
    <button
      key={key}
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "focus-ring rounded-chip px-2 py-0.5 text-[12px] font-semibold transition-colors",
        on
          ? "bg-accent text-accent-contrast"
          : "bg-chip text-ink-soft hover:bg-chip-strong",
      )}
    >
      {label}
    </button>
  );
  return (
    <div
      role="group"
      aria-label="Filter by tag"
      data-testid="notes-tag-filter"
      className="flex flex-wrap gap-1 px-4 pb-2"
    >
      {chip("All", active === null, () => onChange(null), "all")}
      {tags.map(({ tag, count }) =>
        chip(
          `#${tag} ${count}`,
          active === tag,
          () => onChange(active === tag ? null : tag),
          tag,
        ),
      )}
    </div>
  );
}

const NoteRow = memo(function NoteRow({
  note,
  selected,
  now,
  onSelect,
  onDelete,
  onTogglePin,
}: {
  note: Note;
  selected: boolean;
  /** Re-renders the row when the minute changes so "Just now" and "Today" stay true. */
  now: number;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onTogglePin: (id: string) => void;
}) {
  const { title, preview } = noteListEntry(note.content);
  const tags = noteTags(note.content);
  const meta = [noteDateLabel(note, new Date(now)), ...tags.map((t) => `#${t}`)]
    .filter(Boolean)
    .join(" · ");
  return (
    // The `li` is the visual row (hover fill, accent bar) so the actions under the text keep it lit.
    <li
      data-active={selected}
      data-testid="note-row"
      className={cn(
        "group row-bar rounded-control ease-smooth flex min-w-0 flex-col transition-colors duration-200",
        selected ? "bg-accent-soft" : "hover:bg-chip",
      )}
    >
      <button
        type="button"
        onClick={() => onSelect(note.id)}
        className="rounded-control focus-ring flex min-w-0 flex-col gap-0.5 px-3 pt-[10px] text-left"
      >
        {/* line-clamp, not `truncate`: nowrap would make the ScrollArea's measuring wrapper as wide as the longest note. */}
        <span className="flex min-w-0 items-center gap-1.5">
          {note.pinned && (
            <>
              <PushPinIcon
                size={12}
                weight="fill"
                aria-hidden
                className="text-accent-ink shrink-0"
              />
              <span className="sr-only">Pinned: </span>
            </>
          )}
          <span className="text-ink line-clamp-1 min-w-0 text-[14px] font-bold [overflow-wrap:anywhere]">
            {title}
          </span>
          {note.sample && (
            <span className="bg-chip text-ink-muted rounded-chip shrink-0 px-1.5 text-[10.5px] font-bold uppercase">
              Sample
            </span>
          )}
        </span>
        {preview && (
          <span className="text-ink-muted line-clamp-2 text-[12.5px] leading-snug [overflow-wrap:anywhere]">
            {preview}
          </span>
        )}
      </button>
      <div className="flex min-w-0 items-center justify-between gap-2 pr-1.5 pb-1 pl-3">
        <span className="text-ink-faint line-clamp-1 min-w-0 text-[11.5px]">{meta}</span>
        <span
          className={cn(
            "flex shrink-0 items-center opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100",
            selected && "opacity-100",
          )}
        >
          <IconButton
            aria-label={`${note.pinned ? "Unpin" : "Pin"} "${noteTitle(note.content)}"`}
            aria-pressed={note.pinned === true}
            variant="ghost"
            size="sm"
            shape="round"
            onClick={() => onTogglePin(note.id)}
            className="text-ink-muted h-[26px] w-[26px]"
          >
            <PushPinIcon size={14} weight={note.pinned ? "fill" : "regular"} />
          </IconButton>
          <IconButton
            aria-label={`Delete "${noteTitle(note.content)}"`}
            variant="ghost"
            size="sm"
            shape="round"
            onClick={() => onDelete(note.id)}
            className="text-ink-muted hover:bg-red-soft hover:text-red h-[26px] w-[26px]"
          >
            <TrashIcon size={14} />
          </IconButton>
        </span>
      </div>
    </li>
  );
});

/** The sidebar list: pinned notes first, then the rest, already narrowed by the active tag and the
 *  text filter. Only the first page of rows is drawn (thousands of rows make the window crawl). */
export function NoteList({
  pinned,
  others,
  total,
  selectedId,
  resetKey,
  now,
  onSelect,
  onDelete,
  onTogglePin,
}: {
  pinned: Note[];
  others: Note[];
  /** All notes, before filtering. */
  total: number;
  selectedId: string | null;
  /** Changes when the filters change, so the list goes back to its first page. */
  resetKey: string;
  now: number;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onTogglePin: (id: string) => void;
}) {
  const [limit, setLimit] = useState(LIST_PAGE_SIZE);
  const [seenKey, setSeenKey] = useState(resetKey);
  if (seenKey !== resetKey) {
    setSeenKey(resetKey);
    setLimit(LIST_PAGE_SIZE);
  }
  const { shown, hidden } = visibleNotes([...pinned, ...others], limit, selectedId);
  const shownPinned = shown.filter((n) => n.pinned);
  const shownOthers = shown.filter((n) => !n.pinned);
  const row = (note: Note) => (
    <NoteRow
      key={note.id}
      note={note}
      selected={note.id === selectedId}
      now={now}
      onSelect={onSelect}
      onDelete={onDelete}
      onTogglePin={onTogglePin}
    />
  );
  const heading = (text: string) => (
    <li
      aria-hidden
      className="text-ink-muted px-3 pt-2 pb-0.5 text-[11px] font-bold tracking-[0.08em] uppercase"
    >
      {text}
    </li>
  );
  return (
    <ScrollArea className="min-h-0 flex-1">
      <ul className="flex flex-col gap-1 px-2.5 pb-3">
        {shownPinned.length > 0 && heading("Pinned")}
        {shownPinned.map(row)}
        {shownPinned.length > 0 && shownOthers.length > 0 && heading("Notes")}
        {shownOthers.map(row)}
        {hidden > 0 && (
          <li className="flex justify-center px-3 py-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setLimit(shown.length + LIST_PAGE_SIZE)}
            >
              Show {Math.min(hidden, LIST_PAGE_SIZE)} more ({hidden} hidden)
            </Button>
          </li>
        )}
        {total === 0 && (
          <li className="text-ink-faint px-3 py-8 text-center text-[13px]">
            No notes yet.
          </li>
        )}
        {total > 0 && pinned.length + others.length === 0 && (
          <li className="text-ink-faint px-3 py-8 text-center text-[13px]">
            No note matches this filter.
          </li>
        )}
      </ul>
    </ScrollArea>
  );
}
