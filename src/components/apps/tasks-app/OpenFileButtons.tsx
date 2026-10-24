"use client";

import { useState } from "react";
import { FileXlsIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { openTaskNotification } from "./api";
import { notificationFiles, openButtonLabel } from "./taskPresenter";
import type { TaskNotification } from "./types";

interface OpenFileButtonsProps {
  taskId: string;
  notification: TaskNotification;
  /** Draft-review wording ("Open draft workbook", "Open Analytics plan draft"). */
  draft?: boolean;
  /** Show the spreadsheet glyph in each button. */
  icon?: boolean;
  className?: string;
}

/**
 * One Open button per file a notification lists (report-data.json's
 * `workbook_path` plus its `extra_paths`, e.g. the main plan and the
 * Analytics plan). Each click asks the backend to open exactly that listed
 * path with the OS default app; the backend refuses anything the
 * notification doesn't list. A failed open says so and points at the output
 * folder.
 */
export function OpenFileButtons({
  taskId,
  notification,
  draft = false,
  icon = false,
  className,
}: OpenFileButtonsProps) {
  const [state, setState] = useState<Record<string, "opening" | "failed">>({});
  const files = notificationFiles(notification);
  if (files.length === 0) return null;

  const open = async (path: string) => {
    setState((current) => ({ ...current, [path]: "opening" }));
    let ok = false;
    try {
      // a single unlabelled file keeps the plain call (older backends have no `path`)
      const result = await openTaskNotification(
        taskId,
        notification.id,
        files.length === 1 && !notification.outputPaths ? undefined : path,
      );
      ok = result.ok;
    } catch {
      ok = false;
    }
    setState((current) => {
      const next = { ...current };
      if (ok) delete next[path];
      else next[path] = "failed";
      return next;
    });
  };

  const failed = files.some((file) => state[file.path] === "failed");
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {files.map((file) => (
        <Button
          key={file.path}
          variant="outline"
          className="shrink-0"
          onClick={() => void open(file.path)}
          disabled={state[file.path] === "opening"}
        >
          {icon && <FileXlsIcon size={14} weight="bold" aria-hidden />}
          {state[file.path] === "opening"
            ? "Opening…"
            : openButtonLabel(file, { count: files.length, draft })}
        </Button>
      ))}
      {failed && (
        <p className="text-ink-muted w-full text-xs" role="status">
          Couldn&apos;t open {files.length > 1 ? "that file" : "the workbook"} — open it
          from the output folder instead.
        </p>
      )}
    </div>
  );
}
