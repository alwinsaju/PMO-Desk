"use client";

import type { ParsedList } from "@/lib/pmo/listValidation";
import { Button } from "@/components/ui";
import { listFeedback } from "./listFeedbackView";

/** Live feedback under an email / domain box: what will be saved, and each
 *  refused entry with its reason. Local until the shared ValidationSummary
 *  lands. */
export function ListFeedback({
  parsed,
  noun,
  id,
}: {
  parsed: ParsedList;
  noun: { one: string; many: string };
  id?: string;
}) {
  const view = listFeedback(parsed, noun);
  if (view.accepted === null && view.rejected.length === 0) return null;
  return (
    <ul id={id} className="flex flex-col gap-1 text-[12.5px]" aria-live="polite">
      {view.accepted && <li className="text-ink-muted">{view.accepted}</li>}
      {view.rejected.map((issue) => (
        <li key={issue.value} className="text-red font-medium break-words">
          <span className="font-mono">{issue.value}</span> - {issue.reason}
        </li>
      ))}
      {view.hiddenRejected > 0 && (
        <li className="text-red font-medium">and {view.hiddenRejected} more not valid</li>
      )}
    </ul>
  );
}

/** A suggestion shown beside an empty box. It is never typed into the box for
 *  the person: they press the button, so typing cannot append to it. */
export function SuggestionRow({
  suggestion,
  onUse,
}: {
  suggestion: string;
  onUse: () => void;
}) {
  return (
    <div className="text-ink-muted flex flex-wrap items-center gap-2 text-[12.5px]">
      <span>
        Suggestion: <span className="text-ink font-mono">{suggestion}</span>
      </span>
      <Button type="button" size="sm" variant="outline" onClick={onUse}>
        Use suggestion
      </Button>
    </div>
  );
}
