"use client";

import { useState } from "react";
import { motion } from "motion/react";
import {
  ArrowUpIcon,
  CaretRightIcon,
  FolderIcon,
  HouseSimpleIcon,
} from "@phosphor-icons/react";
import { IconButton, ScrollArea } from "@/components/ui";
import { cn } from "@/lib/cn";
import { easeStandard } from "@/lib/motion";
import { fileSystemRoot } from "./mockFileSystem";
import type { FileSystemFolder } from "./mockFileSystem";
import { FILE_ROW_GRID, FileRow } from "./FileRow";

/**
 * Root Files window — matches the `AppComponent` contract
 * (`ComponentType<{ windowId: string }>`) and is registered under "files"
 * in `index.ts`. All state (current folder, selection) is local to this
 * component instance, so multiple Files windows can browse independently.
 *
 * `path` is the stack of folders from the root down to the current one —
 * storing the actual folder objects (not ids) means both the breadcrumb and
 * "up" button are simple array operations, with no need to re-walk the tree
 * by id. Navigating (via double-click, Enter, a breadcrumb segment or the
 * sidebar) always clears the current selection, since the previously
 * selected node generally doesn't exist in the new folder's children.
 */
export function FilesApp({ windowId }: { windowId: string }) {
  const [path, setPath] = useState<FileSystemFolder[]>([fileSystemRoot]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const currentFolder = path[path.length - 1];
  const children = [...currentFolder.children].sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  const selectedNode = children.find((node) => node.id === selectedId) ?? null;

  function openFolder(folder: FileSystemFolder) {
    setPath((prev) => [...prev, folder]);
    setSelectedId(null);
  }

  function goUp() {
    setPath((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
    setSelectedId(null);
  }

  function goToIndex(index: number) {
    setPath((prev) => (index < prev.length - 1 ? prev.slice(0, index + 1) : prev));
    setSelectedId(null);
  }

  // Sidebar "places": Home plus the root's top-level folders. Jumping to one
  // is the same path-stack move as a breadcrumb click, just from the side.
  const places = [
    fileSystemRoot,
    ...fileSystemRoot.children.filter(
      (node): node is FileSystemFolder => node.type === "folder",
    ),
  ];

  function goToPlace(place: FileSystemFolder) {
    setPath(place.id === fileSystemRoot.id ? [fileSystemRoot] : [fileSystemRoot, place]);
    setSelectedId(null);
  }

  return (
    <div data-window-id={windowId} className="flex h-full w-full flex-col">
      <div className="px-gutter flex items-center gap-1.5 pt-1 pb-3">
        <IconButton
          aria-label="Go to parent folder"
          variant="ghost"
          disabled={path.length <= 1}
          onClick={goUp}
        >
          <ArrowUpIcon size={18} />
        </IconButton>
        <nav
          aria-label="Breadcrumb"
          className="scroll-thin flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto"
        >
          {path.map((folder, index) => {
            const isLast = index === path.length - 1;
            return (
              <span key={folder.id} className="flex shrink-0 items-center gap-0.5">
                {index > 0 && (
                  <CaretRightIcon size={11} weight="bold" className="text-ink-faint" />
                )}
                {isLast ? (
                  <span
                    aria-current="page"
                    className="text-ink rounded-control inline-flex h-8 items-center px-[11px] text-[13.5px] font-semibold"
                  >
                    {folder.name}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => goToIndex(index)}
                    className="text-ink-muted rounded-control ease-smooth hover:bg-chip hover:text-ink inline-flex h-8 items-center px-[11px] text-[13.5px] font-semibold transition-colors duration-200"
                  >
                    {folder.name}
                  </button>
                )}
              </span>
            );
          })}
        </nav>
        <span
          title="These files are demo content, not files on this computer"
          className="bg-chip text-ink-muted rounded-chip shrink-0 px-2.5 py-1 text-[11px] font-bold tracking-[0.06em] uppercase"
        >
          Sample files
        </span>
      </div>

      <div className="flex min-h-0 flex-1">
        <nav
          aria-label="Places"
          className="border-line flex w-[188px] shrink-0 flex-col gap-0.5 border-r px-2.5 pt-1"
        >
          {places.map((place) => {
            const isActive =
              place.id === fileSystemRoot.id
                ? path.length === 1
                : path[1]?.id === place.id;
            return (
              <button
                key={place.id}
                type="button"
                data-active={isActive}
                onClick={() => goToPlace(place)}
                className={cn(
                  "row-bar rounded-control ease-smooth flex h-[38px] w-full items-center gap-2.5 px-3 text-left text-[13.5px] font-semibold transition-colors duration-200",
                  "focus-visible:ring-focus outline-none focus-visible:ring-2 focus-visible:ring-inset",
                  isActive
                    ? "bg-accent-soft text-accent-ink"
                    : "text-ink-soft hover:bg-chip hover:text-ink",
                )}
              >
                {place.id === fileSystemRoot.id ? (
                  <HouseSimpleIcon size={17} weight={isActive ? "fill" : "regular"} />
                ) : (
                  <FolderIcon size={17} weight={isActive ? "fill" : "regular"} />
                )}
                <span className="line-clamp-1">{place.name}</span>
              </button>
            );
          })}
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          <div
            className={cn(
              "text-ink-muted border-line mr-gutter ml-1.5 grid gap-3 border-b px-3.5 pb-2 text-[11px] font-bold tracking-[0.08em] uppercase",
              FILE_ROW_GRID,
            )}
          >
            <span>Name</span>
            <span>Modified</span>
            <span className="text-right">Size</span>
          </div>

          <ScrollArea className="min-h-0 flex-1">
            {/* Keyed by the current folder so navigating (breadcrumb, "up", or
             *  double-click into a folder) gives the new listing a brief fade
             *  in rather than an instant swap — a plain mount animation, not an
             *  animated exit, so the previous folder's rows still disappear
             *  the instant the new ones mount, same as before this existed. */}
            <motion.ul
              key={currentFolder.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.15, ease: easeStandard }}
              className="pr-gutter flex flex-col gap-0.5 pt-1.5 pb-3 pl-1.5"
            >
              {children.map((node) => (
                <FileRow
                  key={node.id}
                  node={node}
                  isSelected={node.id === selectedId}
                  onSelect={() => setSelectedId(node.id)}
                  onActivate={() => {
                    if (node.type === "folder") openFolder(node);
                  }}
                />
              ))}
              {children.length === 0 && (
                <li className="flex flex-col items-center gap-2 px-3 py-12 text-center">
                  <span className="bg-chip text-ink-muted rounded-tile inline-flex h-12 w-12 items-center justify-center">
                    <FolderIcon size={22} />
                  </span>
                  <span className="text-ink-muted text-[13px]">
                    This folder is empty.
                  </span>
                </li>
              )}
            </motion.ul>
          </ScrollArea>
        </div>
      </div>

      <div className="border-line text-ink-muted px-gutter flex items-center justify-between gap-3 border-t py-2 text-[12px]">
        <span className="shrink-0">
          {children.length} item{children.length === 1 ? "" : "s"}
        </span>
        {selectedNode && (
          <span className="min-w-0 flex-1 truncate text-right font-mono">
            {selectedNode.name}
            {selectedNode.type === "file" && ` — ${selectedNode.sizeLabel}`}
          </span>
        )}
      </div>
    </div>
  );
}
