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
export const FILE_ROW_GRID = "grid-cols-[1fr_112px_88px]";

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
 * One row in the current folder's listing — icon, name (in `font-mono`, per
 * ARCHITECTURE.md's note that IBM Plex Mono is reserved for file names/
 * paths), last-modified date, and size. The whole row is a single `<button>`
 * (no nested interactive elements): a plain click selects it, a double
 * click or Enter activates it — for a folder, activating navigates into it;
 * for a file, activating is a deliberate no-op (there's nothing to open).
 */
export function FileRow({ node, isSelected, onSelect, onActivate }: FileRowProps) {
  const Glyph = kindIcons[node.type === "folder" ? "folder" : node.kind];

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        onDoubleClick={onActivate}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onActivate();
          }
        }}
        className={cn(
          "rounded-control ease-standard grid w-full items-center gap-3 px-2.5 py-1.5 text-left transition-colors duration-150 outline-none",
          FILE_ROW_GRID,
          "focus-visible:ring-accent focus-visible:ring-2",
          isSelected ? "bg-accent-subtle" : "hover:bg-neutral-100",
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
        <span className="flex min-w-0 items-center gap-2.5">
          <Glyph
            size={17}
            weight={node.type === "folder" ? "fill" : "regular"}
            className={cn(
              "ease-standard shrink-0 transition-colors duration-150",
              isSelected ? "text-accent-800" : "text-ink-muted",
            )}
          />
          <span className="text-ink line-clamp-1 font-mono text-[13px]">{node.name}</span>
        </span>
        <span className="text-ink-faint line-clamp-1 text-[12px]">
          {node.modifiedLabel}
        </span>
        <span className="text-ink-faint line-clamp-1 text-right text-[12px]">
          {node.type === "file" ? node.sizeLabel : "—"}
        </span>
      </button>
    </li>
  );
}
