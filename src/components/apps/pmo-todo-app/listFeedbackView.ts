// What the live feedback under an email / domain box says: what will be saved
// and which entries are refused, and why. Pure, so it is tested without React;
// the Staff "Add employees" dialog is the pattern (accepted count, then the
// rejected entries in red).
import type { ParsedList } from "../../../lib/pmo/listValidation.ts";

export interface ListFeedbackView {
  /** "2 domains will be saved: a.com, b.com", or null when nothing is valid. */
  accepted: string | null;
  rejected: { value: string; reason: string }[];
  /** Rejected entries past the display limit. */
  hiddenRejected: number;
}

const SHOWN = 6;

export function listFeedback(
  parsed: ParsedList,
  noun: { one: string; many: string },
): ListFeedbackView {
  const count = parsed.valid.length;
  const names =
    parsed.valid.length > SHOWN
      ? `${parsed.valid.slice(0, SHOWN).join(", ")} and ${count - SHOWN} more`
      : parsed.valid.join(", ");
  return {
    accepted:
      count === 0
        ? null
        : `${count} ${count === 1 ? noun.one : noun.many} will be saved: ${names}`,
    rejected: parsed.invalid.slice(0, SHOWN),
    hiddenRejected: Math.max(0, parsed.invalid.length - SHOWN),
  };
}

export const DOMAIN_NOUN = { one: "domain", many: "domains" };
export const EMAIL_NOUN = { one: "address", many: "addresses" };
