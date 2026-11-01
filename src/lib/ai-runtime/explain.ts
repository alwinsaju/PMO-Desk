// "Explain this screen": what the focused app is for and what to do in it, in a few plain
// lines. Static on purpose (a small model would guess); live numbers are added by the caller.

const DESCRIPTIONS: Readonly<Record<string, string>> = {
  "pmo-todo":
    "PMO To-Do turns messages into to-dos you approve. Review Queue holds proposals waiting for you, To-Do is your list (Today, Overdue, Waiting...), Filtered shows what was screened out, and Reports writes the weekly status. Type a line in the box at the top of To-Do to add one; J/K move, E opens, D marks done.",
  staff:
    "Staff Management keeps the directory, time off, the shift roster and offboarded people. Use Time off to approve or add leave, and the roster to see who works which shift.",
  tasks:
    "Tasks runs your report and mailing tasks. Pick a task, press Run, add its files, review what it prepared, and only then confirm. Nothing is sent without your approval.",
  dashboard:
    "The Dashboard shows what needs you today: open to-dos, chasers that are due, report status and who is out this week or next. Each card opens the app behind it.",
  templates:
    "Templates holds the wording of emails and reports. Pick one, edit it, and tick where it is used (a task or a PMO slot). The preview shows example values; nothing is sent from here.",
  notes:
    "Notes is a simple notepad. The AI can create, update or delete notes while this window is focused.",
  files: "Files browses the files on this computer's PMO Desk folders.",
  browser: "Browser opens web pages inside PMO Desk.",
  "app-store": "App Store lists extra apps you can add to the dock.",
};

/** The description for an app id, or null when there is none (a web app, an unknown id). */
export function explainApp(appId: string | null, title?: string): string | null {
  if (!appId) return null;
  const text = DESCRIPTIONS[appId];
  return text ? `${title || appId}: ${text}` : null;
}

export const EXPLAIN_NOTHING =
  'No app is focused. Open one from the dock, or ask me something like "what\'s overdue?".';

export const EXPLAIN_UNKNOWN = "I don't have a description for this window yet.";
