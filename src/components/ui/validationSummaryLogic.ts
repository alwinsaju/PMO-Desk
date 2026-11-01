// Pure text for ValidationSummary (see validationSummaryLogic.test.mjs).
import { pluralize } from "../../lib/ui/terms.ts";

export type SummaryTone = "muted" | "error";

export interface SummaryGroup {
  label: string;
  values: readonly string[];
  tone?: SummaryTone;
}

/** "3 new people will be added". */
export function addedHeadline(count: number, singular: string, plural?: string): string {
  return `${count} new ${pluralize(count, singular, plural)} will be added`;
}

/** "a, b, c and 2 more" once there are more than `limit` values. */
export function listValues(values: readonly string[], limit = 8): string {
  if (values.length <= limit) return values.join(", ");
  return `${values.slice(0, limit).join(", ")} and ${values.length - limit} more`;
}

export function summaryLines(
  groups: readonly SummaryGroup[],
  limit?: number,
): { text: string; tone: SummaryTone }[] {
  return groups
    .filter((group) => group.values.length > 0)
    .map((group) => ({
      text: `${group.label}: ${listValues(group.values, limit)}`,
      tone: group.tone ?? "muted",
    }));
}
