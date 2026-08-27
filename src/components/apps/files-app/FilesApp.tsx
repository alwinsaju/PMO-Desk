"use client";

import { useState } from "react";
import { ArrowUpIcon, CaretRightIcon } from "@phosphor-icons/react";
import { IconButton, ScrollArea } from "@/components/ui";
import { cn } from "@/lib/cn";
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
 * by id. Navigating (via double-click, Enter, or a breadcrumb segment)
 * always clears the current selection, since the previously selected node
 * generally doesn't exist in the new folder's children.
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

  return (
    <div data-window-id={windowId} className="flex h-full w-full flex-col">
      <div className="border-border/60 flex items-center gap-1 border-b p-2">
        <IconButton
          aria-label="Go to parent folder"
          variant="ghost"
          size="sm"
          disabled={path.length <= 1}
          onClick={goUp}
        >
          <ArrowUpIcon size={15} />
        </IconButton>
        <nav
          aria-label="Breadcrumb"
          className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto font-mono text-[12.5px]"
        >
          {path.map((folder, index) => {
            const isLast = index === path.length - 1;
            return (
              <span key={folder.id} className="flex shrink-0 items-center gap-1">
                {index > 0 && <CaretRightIcon size={10} className="text-ink-faint" />}
                {isLast ? (
                  <span className="text-ink rounded-control px-1.5 py-0.5 font-medium">
                    {folder.name}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => goToIndex(index)}
                    className="text-ink-muted rounded-control ease-standard hover:text-ink px-1.5 py-0.5 transition-colors duration-150 hover:bg-neutral-100"
                  >
                    {folder.name}
                  </button>
                )}
              </span>
            );
          })}
        </nav>
      </div>

      <div
        className={cn(
          "text-ink-faint border-border/60 grid gap-3 border-b px-4 py-1.5 text-[11px] font-medium tracking-wide uppercase",
          FILE_ROW_GRID,
        )}
      >
        <span>Name</span>
        <span>Modified</span>
        <span className="text-right">Size</span>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <ul className="flex flex-col gap-0.5 p-2">
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
            <li className="text-ink-faint px-3 py-6 text-center text-[13px]">
              This folder is empty.
            </li>
          )}
        </ul>
      </ScrollArea>

      <div className="border-border/60 text-ink-faint flex items-center justify-between gap-3 border-t px-3 py-1.5 text-[11px]">
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
