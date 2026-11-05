"use client";

import { useEffect, useState } from "react";
import { WarningIcon } from "@phosphor-icons/react";
import { useEmployees } from "@/lib/staff/staffStore";
import {
  attachmentWarning,
  checkRecipients,
  internalDomains,
  type Recipients,
} from "@/lib/tasks/recipientCheck";
import { useTasksPrefs } from "@/lib/tasks/tasksPrefsStore";
import { getDraftSummary } from "./api";
import {
  draftSummaryLines,
  parseDraftSummary,
  RECIPIENTS_LOADING,
  RECIPIENTS_UNREADABLE,
} from "./draftSummary";
import type { DraftSummary } from "./types";

/** What the Outlook draft will do: its recipients, plus warnings when they changed since the last confirmed
 *  send, include an outside address or carry large attachments. A failed read only warns; it never blocks. */
export function RecipientReview({
  taskId,
  onSummary,
}: {
  taskId: string;
  onSummary?: (summary: DraftSummary | null) => void;
}) {
  const [lines, setLines] = useState<string[]>([RECIPIENTS_LOADING]);
  const [summary, setSummary] = useState<DraftSummary | null>(null);
  const employees = useEmployees();
  const previous = useTasksPrefs((s) => s.recipients[taskId] ?? null);

  useEffect(() => {
    let cancelled = false;
    getDraftSummary(taskId)
      .then((reply) => parseDraftSummary(reply))
      .catch(() => null)
      .then((next) => {
        if (cancelled) return;
        setSummary(next);
        setLines(draftSummaryLines(next));
        onSummary?.(next);
      });
    return () => {
      cancelled = true;
    };
    // onSummary is a setter from the parent: it does not need to restart the read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  const unreadable = lines[0] === RECIPIENTS_UNREADABLE;
  const warnings = summary
    ? checkRecipients(
        { to: summary.to, cc: summary.cc },
        previous,
        internalDomains(employees.map((e) => e.deloitteEmail)),
      )
    : [];
  const attach = summary
    ? attachmentWarning(summary.attachments.map((name) => ({ name })))
    : null;
  const notes = summary?.notes ?? [];

  return (
    <>
      <ul
        aria-live="polite"
        className={`${unreadable ? "text-amber" : "text-ink"} mt-3 flex flex-col gap-1 text-[13px]`}
      >
        {lines.map((line) => (
          <li key={line} className="break-words">
            {line}
          </li>
        ))}
      </ul>
      {(warnings.length > 0 || attach || notes.length > 0) && (
        <ul
          data-testid="recipient-warnings"
          className="bg-amber-soft text-amber rounded-control mt-3 flex flex-col gap-1.5 px-3 py-2.5 text-[12.5px] font-medium"
        >
          {[...notes, ...warnings.map((w) => w.text), ...(attach ? [attach] : [])].map(
            (text) => (
              <li key={text} className="flex items-start gap-2">
                <WarningIcon size={14} weight="fill" className="mt-0.5 shrink-0" />
                <span className="break-words">{text}</span>
              </li>
            ),
          )}
        </ul>
      )}
    </>
  );
}

export const toRecipients = (summary: DraftSummary): Recipients => ({
  to: summary.to,
  cc: summary.cc,
});
