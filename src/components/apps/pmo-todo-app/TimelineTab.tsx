"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui";
import type { HistoryEntry, Todo } from "@/lib/pmo/types";
import { OriginalMessage } from "./OriginalMessage";
import { HISTORY_LABEL } from "./queueView";

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  });

/** The to-do's timeline, newest first: where it came from, messages linked by
 *  approved updates, waiting started/cleared, due-date and status changes, and
 *  "chaser drafted" notes. A linked message opens inline, as it arrived. */
export function TimelineTab({ todo }: { todo: Todo }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const entries: HistoryEntry[] = [...(todo.history ?? [])].reverse();

  if (entries.length === 0) {
    return (
      <p className="text-ink-faint text-[13px]">
        Nothing recorded yet. Messages in the same conversation and changes to waiting,
        the due date or the status will appear here.
      </p>
    );
  }

  return (
    <ol className="flex flex-col pr-3" aria-label="Timeline">
      {entries.map((entry, index) => {
        const opened = openId === entry.id;
        return (
          <li key={entry.id} className="relative flex gap-3 pb-4 pl-1">
            <span className="flex flex-col items-center">
              <span
                className={cn(
                  "mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full",
                  entry.kind === "message" ? "bg-accent" : "bg-neutral-300",
                )}
              />
              {index < entries.length - 1 && (
                <span className="bg-border mt-1 w-px flex-1" aria-hidden />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-ink-faint text-[11px]">
                <span className="text-ink-muted font-semibold tracking-wide uppercase">
                  {HISTORY_LABEL[entry.kind]}
                </span>
                {" · "}
                {when(entry.at)}
                {entry.from ? ` · ${entry.from}` : ""}
              </p>
              <p className="text-ink mt-0.5 text-[13px] leading-relaxed break-words whitespace-pre-wrap">
                {entry.text}
              </p>
              {entry.intakeId && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-1 -ml-3"
                    aria-expanded={opened}
                    onClick={() => setOpenId(opened ? null : entry.id)}
                  >
                    {opened ? "Hide message" : "Open message"}
                  </Button>
                  {opened && (
                    <div className="border-border/60 mt-1 flex h-64 flex-col rounded-lg border p-3">
                      <OriginalMessage
                        intakeId={entry.intakeId}
                        className="flex min-h-0 flex-1 flex-col"
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
