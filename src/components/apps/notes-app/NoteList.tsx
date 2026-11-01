"use client";

import { PushPinIcon, TrashIcon } from "@phosphor-icons/react";
import { IconButton, ScrollArea } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  filterByTag,
  noteDateLabel,
  noteListEntry,
  noteTags,
  noteTitle,
  orderNotes,
  type Note,
} from "./notesLogic";

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

function NoteRow({
  note,
  selected,
  onSelect,
  onDelete,
  onTogglePin,
}: {
  note: Note;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onTogglePin: () => void;
}) {
  const { title, preview } = noteListEntry(note.content);
  const tags = noteTags(note.content);
  const meta = [noteDateLabel(note), ...tags.map((t) => `#${t}`)]
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
        onClick={onSelect}
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
            onClick={onTogglePin}
            className="text-ink-muted h-[26px] w-[26px]"
          >
            <PushPinIcon size={14} weight={note.pinned ? "fill" : "regular"} />
          </IconButton>
          <IconButton
            aria-label={`Delete "${noteTitle(note.content)}"`}
            variant="ghost"
            size="sm"
            shape="round"
            onClick={onDelete}
            className="text-ink-muted hover:bg-red-soft hover:text-red h-[26px] w-[26px]"
          >
            <TrashIcon size={14} />
          </IconButton>
        </span>
      </div>
    </li>
  );
}

/** The sidebar list: pinned notes first, then the rest, narrowed by the active tag. */
export function NoteList({
  notes,
  selectedId,
  tag,
  onSelect,
  onDelete,
  onTogglePin,
}: {
  notes: Note[];
  selectedId: string | null;
  tag: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onTogglePin: (id: string) => void;
}) {
  const { pinned, others } = orderNotes(filterByTag(notes, tag));
  const row = (note: Note) => (
    <NoteRow
      key={note.id}
      note={note}
      selected={note.id === selectedId}
      onSelect={() => onSelect(note.id)}
      onDelete={() => onDelete(note.id)}
      onTogglePin={() => onTogglePin(note.id)}
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
        {pinned.length > 0 && heading("Pinned")}
        {pinned.map(row)}
        {pinned.length > 0 && others.length > 0 && heading("Notes")}
        {others.map(row)}
        {notes.length === 0 && (
          <li className="text-ink-faint px-3 py-8 text-center text-[13px]">
            No notes yet.
          </li>
        )}
        {notes.length > 0 && pinned.length + others.length === 0 && (
          <li className="text-ink-faint px-3 py-8 text-center text-[13px]">
            No note has this tag.
          </li>
        )}
      </ul>
    </ScrollArea>
  );
}
