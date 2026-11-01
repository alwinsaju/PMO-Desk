// One wording for the same thing everywhere. Import these instead of typing
// the label again, so "To-do" never turns into "Todo" or "Task" in another app.

export const TERMS = {
  todo: "To-do",
  todos: "To-dos",
  timeOff: "Time off",
  // A count of everything vs. the part still waiting: never call the total
  // "Requested", it reads like "Pending".
  total: "Total",
  pending: "Pending",
  approved: "Approved",
  declined: "Declined",
  outlook: "Outlook",
  teams: "Teams",
  manual: "Manual",
  raidLog: "RAID log",
  retry: "Retry",
  copyDetails: "Copy details",
  copied: "Copied",
} as const;

export type Term = (typeof TERMS)[keyof typeof TERMS];

export function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return count === 1 ? singular : plural;
}

/** "1 to-do", "3 to-dos", "0 people". */
export function countOf(count: number, singular: string, plural?: string) {
  return `${count} ${pluralize(count, singular, plural)}`;
}
