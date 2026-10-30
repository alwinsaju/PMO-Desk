// The task folders the command bar can prepare by name. `id` is the Tasks engine's
// task id (the folder name under tasks/); `aliases` are how people say it. Pure.

export interface KnownTask {
  id: string;
  /** The name shown in replies ("Aging Report"). */
  label: string;
  aliases: readonly string[];
}

export const KNOWN_TASKS: readonly KnownTask[] = [
  {
    id: "weekly-aging-report",
    label: "Aging Report",
    aliases: ["weekly aging report", "aging report", "aging incidents", "aging"],
  },
  {
    id: "weekly-backlog-report",
    label: "Backlog Report",
    aliases: ["weekly backlog report", "backlog report", "backlog incidents", "backlog"],
  },
  {
    id: "monthly-report-deck",
    label: "Monthly Report Deck",
    aliases: ["monthly report deck", "monthly report", "monthly deck", "monthly pack"],
  },
  {
    id: "deployment-dep-weekend-mailer",
    label: "Deployment & DEP Weekend Mailer",
    aliases: [
      "deployment and dep weekend mailer",
      "deployment dep weekend mailer",
      "deployment weekend mailer",
      "deployment mailer",
      "weekend mailer",
      "dep weekend mailer",
      "deployment and poc details",
      "weekend deployment",
    ],
  },
  {
    id: "december-disconnect",
    label: "December Disconnect",
    aliases: ["december disconnect", "winter disconnect"],
  },
  {
    id: "shift-roster",
    label: "Shift Roster",
    aliases: ["shift roster", "shift rota", "roster workbook"],
  },
];

export const KNOWN_TASK_IDS: readonly string[] = KNOWN_TASKS.map((task) => task.id);

const norm = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9&]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const taskById = (id: string): KnownTask | undefined =>
  KNOWN_TASKS.find((task) => task.id === id);

/**
 * The task a phrase names: an exact id, or the task whose longest alias appears in
 * the text as whole words ("prepare this week's aging report" -> Aging Report).
 */
export function findTask(text: string): KnownTask | null {
  const exact = taskById(text.trim());
  if (exact) return exact;
  const haystack = ` ${norm(text)} `;
  let best: { task: KnownTask; length: number } | null = null;
  for (const task of KNOWN_TASKS) {
    for (const alias of task.aliases) {
      if (haystack.includes(` ${norm(alias)} `) && (!best || alias.length > best.length)) {
        best = { task, length: alias.length };
      }
    }
  }
  return best?.task ?? null;
}
