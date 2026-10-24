"use client";

import {
  ArchiveIcon,
  FileCodeIcon,
  FileIcon,
  FilePdfIcon,
  FileTextIcon,
  FolderIcon,
  ImageIcon,
  MusicNotesIcon,
  TableIcon,
  type Icon,
} from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import type { FileKind, FileSystemNode } from "./mockFileSystem";

/** Shared grid template for both the column header row (FilesApp.tsx) and
 *  every FileRow, so the two always stay pixel-aligned from one definition
 *  instead of two copies of the same magic column widths. */
export const FILE_ROW_GRID = "grid-cols-[1fr_120px_84px]";

const kindIcons: Record<"folder" | FileKind, Icon> = {
  folder: FolderIcon,
  document: FileTextIcon,
  image: ImageIcon,
  code: FileCodeIcon,
  pdf: FilePdfIcon,
  audio: MusicNotesIcon,
  archive: ArchiveIcon,
  spreadsheet: TableIcon,
  text: FileIcon,
};

interface FileRowProps {
  node: FileSystemNode;
  isSelected: boolean;
  onSelect: () => void;
  onActivate: () => void;
}

/**
 * One row in the current folder's listing — icon tile, name (in `font-mono`,
 * per ARCHITECTURE.md's note that IBM Plex Mono is reserved for file names/
 * paths), last-modified date, and size. The whole row is a single `<button>`
 * (no nested interactive elements): a plain click selects it, a double
 * click or Enter activates it — for a folder, activating navigates into it;
 * for a file, activating is a deliberate no-op (there's nothing to open).
 * Hover and selection both slide the accent bar in (`row-bar`).
 */
export function FileRow({ node, isSelected, onSelect, onActivate }: FileRowProps) {
  const isFolder = node.type === "folder";
  const Glyph = kindIcons[isFolder ? "folder" : node.kind];

  return (
    <li>
      <button
        type="button"
        data-active={isSelected}
        onClick={onSelect}
        onDoubleClick={onActivate}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onActivate();
          }
        }}
        className={cn(
          "row-bar rounded-control ease-smooth grid h-13 w-full items-center gap-3 px-3.5 text-left transition-colors duration-200",
          FILE_ROW_GRID,
          "focus-visible:ring-focus outline-none focus-visible:ring-2 focus-visible:ring-inset",
          isSelected ? "bg-accent-soft" : "hover:bg-chip",
        )}
      >
        {/* line-clamp-1 (not `truncate`) throughout this row: `truncate`'s
            `white-space: nowrap` gives text a min-content width equal to
            its full unwrapped width, which the ScrollArea's internal
            content-measuring wrapper (`display: table`) then honors as a
            hard floor — inflating the whole list to its widest cell and
            pushing rows out of view horizontally (no `min-w-0` upstream
            fixes that, only avoiding `nowrap` does). See NotesApp.tsx for
            where this first surfaced. */}
        <span className="flex min-w-0 items-center gap-3.5">
          {/* Folder tiles carry the accent tint, files stay neutral. */}
          <span
            className={cn(
              "rounded-control ease-smooth grid h-[34px] w-[34px] shrink-0 place-items-center transition-colors duration-200",
              isFolder ? "bg-accent-soft text-accent-ink" : "bg-chip text-ink-soft",
            )}
          >
            <Glyph size={18} weight={isFolder ? "fill" : "regular"} />
          </span>
          {/* The selected fill is the translucent `accent-soft` tint, so the
              plain ink tokens stay readable on it in every theme x brand
              combination. File names stay in `font-mono` (technical text). */}
          <span className="text-ink line-clamp-1 font-mono text-[13.5px] font-medium">
            {node.name}
          </span>
        </span>
        <span className="text-ink-muted line-clamp-1 text-[12.5px]">
          {node.modifiedLabel}
        </span>
        <span className="text-ink-muted line-clamp-1 text-right text-[12.5px]">
          {node.type === "file" ? node.sizeLabel : "—"}
        </span>
      </button>
    </li>
  );
}
