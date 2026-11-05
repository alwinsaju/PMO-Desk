"use client";

import { WarningCircleIcon } from "@phosphor-icons/react";
import { attentionLines, type AttentionId } from "@/lib/pmo/attentionView";

/** The notices above already word these, so the box leaves them out. */
export const SAID_BY_NOTICES: readonly AttentionId[] = [
  "queuePaused",
  "modelMissing",
  "badTimeZone",
];

/** Unreadable records, held-back files and repeats, in plain words. (There is no "Show
 *  folder" button: the desktop bridge has no way to open a folder.) */
export function AttentionBox({ lines }: { lines: ReturnType<typeof attentionLines> }) {
  if (lines.length === 0) return null;
  return (
    <div
      aria-label="Needs attention"
      className="rounded-card bg-amber-soft text-ink-soft px-4 py-2.5 text-[13px] leading-snug"
    >
      <p className="text-ink flex items-center gap-2 font-semibold">
        <WarningCircleIcon size={16} weight="fill" className="text-amber shrink-0" />
        Needs attention
      </p>
      <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-6 break-words">
        {lines.map((line) => (
          <li key={line.id}>{line.text}</li>
        ))}
      </ul>
    </div>
  );
}
