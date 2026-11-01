import * as React from "react";
import { cn } from "@/lib/cn";
import {
  addedHeadline,
  summaryLines,
  type SummaryGroup,
  type SummaryTone,
} from "./validationSummaryLogic";

export type { SummaryGroup, SummaryTone };
export { addedHeadline };

export interface ValidationSummaryProps extends React.HTMLAttributes<HTMLUListElement> {
  /** The result line, e.g. `addedHeadline(3, "person", "people")`. */
  headline: React.ReactNode;
  /** Groups of values that were skipped or rejected; empty groups are hidden. */
  groups?: readonly SummaryGroup[];
  /** How many values to list per group before "and N more". */
  limit?: number;
}

/**
 * Live "what will happen" list under a multi-line input: "3 new people will
 * be added / Already on the roster, skipped: a@x.com / Not an email address:
 * bad". Announced politely as it changes.
 */
export function ValidationSummary({
  headline,
  groups = [],
  limit,
  className,
  ...props
}: ValidationSummaryProps) {
  return (
    <ul
      aria-live="polite"
      className={cn("text-ink-muted flex flex-col gap-1 text-[12.5px]", className)}
      {...props}
    >
      <li>{headline}</li>
      {summaryLines(groups, limit).map((line) => (
        <li key={line.text} className={cn(line.tone === "error" && "text-red")}>
          {line.text}
        </li>
      ))}
    </ul>
  );
}
