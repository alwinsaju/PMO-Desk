// Search across Settings: every setting a person might look for, with the tab and section it lives in.
// Pure. The Settings window shows the matches and jumps to the row; `settingsIndex.test.mjs` checks that
// each id here is still a `settingId` in the screens.

export type SettingsTabId =
  | "general"
  | "notifications"
  | "shortcuts"
  | "accessibility"
  | "data"
  | "activity"
  | "help"
  | "about";

export const TAB_TITLES: Readonly<Record<SettingsTabId, string>> = {
  general: "General",
  notifications: "Notifications",
  shortcuts: "Shortcuts",
  accessibility: "Accessibility",
  data: "Data",
  activity: "Activity",
  help: "Help",
  about: "About",
};

export interface SettingEntry {
  /** The row's `settingId`. */
  id: string;
  tab: SettingsTabId;
  section: string;
  title: string;
  hint: string;
  /** Other words people may type. */
  keywords: string;
}

const entry = (
  id: string,
  tab: SettingsTabId,
  section: string,
  title: string,
  hint: string,
  keywords = "",
): SettingEntry => ({ id, tab, section, title, hint, keywords });

export const SETTINGS_INDEX: readonly SettingEntry[] = [
  entry(
    "profile",
    "general",
    "Profile",
    "How you use PMO Desk",
    "Which cards and defaults suit your role.",
    "role persona dashboard",
  ),
  entry(
    "desktop-widget",
    "general",
    "Lock screen and desktop",
    "Who's out today on the desktop",
    "A small card behind your windows.",
    "widget leave time off",
  ),
  entry(
    "instant-unlock",
    "general",
    "Lock screen and desktop",
    "Skip the lock screen",
    "Open straight to the desktop.",
    "login startup welcome",
  ),
  entry(
    "lock-summary",
    "general",
    "Lock screen and desktop",
    "Show what needs you on the lock screen",
    "A line under the clock: how many things need you and what they are.",
    "summary attention badge",
  ),
  entry(
    "auto-recur",
    "general",
    "To-dos",
    "Repeating to-dos create the next one",
    "When you close a repeating to-do, the next round is created at once.",
    "recurring repeat todo",
  ),
  entry(
    "focus-mode",
    "general",
    "Focus",
    "Focus mode",
    "Hide the dock and hold back notices for 25 minutes.",
    "do not disturb quiet",
  ),
  entry(
    "confirm-create_todo",
    "general",
    "The command bar asks first",
    "Creating a to-do from the command bar",
    "Show an “Are you sure?” card before it happens.",
    "confirm ask",
  ),
  entry(
    "confirm-todo_done",
    "general",
    "The command bar asks first",
    "Marking a to-do done from the command bar",
    "Show an “Are you sure?” card before it happens.",
    "confirm ask complete",
  ),
  entry(
    "confirm-todo_snooze",
    "general",
    "The command bar asks first",
    "Snoozing a to-do from the command bar",
    "Show an “Are you sure?” card before it happens.",
    "confirm ask postpone",
  ),
  entry(
    "command-history",
    "general",
    "Command history",
    "Command history",
    "What you asked the command bar.",
    "prompts clear log",
  ),
  entry(
    "notification-history",
    "notifications",
    "Everything shown this session",
    "Notification list",
    "Every notice shown this session.",
    "toast alerts clear",
  ),
  entry(
    "shortcut-list",
    "shortcuts",
    "Keyboard shortcuts",
    "Keyboard shortcuts",
    "Filter the list of shortcuts.",
    "keys hotkeys ctrl",
  ),
  entry(
    "reduce-motion",
    "accessibility",
    "Display",
    "Reduce motion",
    "No animation or easing.",
    "animation accessibility",
  ),
  entry(
    "high-contrast",
    "accessibility",
    "Display",
    "High contrast",
    "Stronger text, clearer borders and a thick keyboard focus ring.",
    "contrast focus",
  ),
  entry(
    "colour-blind-roster",
    "accessibility",
    "Display",
    "Colour-blind-safe roster",
    "The shift roster uses colours that stay apart, plus a pattern.",
    "colorblind colour blind shifts",
  ),
  entry(
    "data-folder",
    "data",
    "Where your data lives",
    "Data folder",
    "Where PMO Desk keeps your data on this computer.",
    "location path files storage open",
  ),
  entry(
    "storage",
    "data",
    "Where your data lives",
    "Storage used",
    "How much space your data takes.",
    "disk size space meter",
  ),
  entry(
    "backup-now",
    "data",
    "Back up and restore",
    "Back up now",
    "One zip with everything above.",
    "export save zip",
  ),
  entry(
    "last-backup",
    "data",
    "Back up and restore",
    "Last backup",
    "When your data was last backed up.",
    "when date",
  ),
  entry(
    "restore",
    "data",
    "Back up and restore",
    "Restore from a backup",
    "Replace your current data with a backup's.",
    "import recover",
  ),
  entry(
    "export-json",
    "data",
    "Export for audits",
    "Export JSON",
    "To-dos, people, time off and templates in one file.",
    "audit data",
  ),
  entry(
    "export-csv",
    "data",
    "Export for audits",
    "Export Excel (CSV)",
    "One CSV file per list, in a zip.",
    "audit spreadsheet",
  ),
  entry(
    "activity-log",
    "activity",
    "Everything PMO Desk did on your behalf",
    "Activity log",
    "A timeline of what PMO Desk did for you.",
    "audit history timeline",
  ),
  entry(
    "guided-tour",
    "help",
    "Get started",
    "Guided tour",
    "A one-minute walk through the main apps.",
    "tutorial intro",
  ),
  entry(
    "sample-data",
    "help",
    "Get started",
    "Sample data",
    "Adds a few made-up to-dos, people and leave.",
    "demo example",
  ),
  entry(
    "app-help",
    "help",
    "Help for each app",
    "Help for each app",
    "Short guides to every app.",
    "guide manual",
  ),
  entry(
    "updates",
    "about",
    "Updates",
    "Check for updates",
    "Off by default; reads one small file about once a day.",
    "upgrade version release",
  ),
  entry(
    "diagnostics",
    "about",
    "Support",
    "Diagnostics file",
    "Versions, counts and the end of the logs, with private details removed.",
    "support logs problem report",
  ),
  entry(
    "version",
    "about",
    "PMO Desk",
    "Version",
    "Which version is running.",
    "about build",
  ),
];

const norm = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

function score(item: SettingEntry, words: readonly string[]): number {
  const title = norm(item.title);
  const section = norm(`${item.section} ${TAB_TITLES[item.tab]}`);
  const rest = norm(`${item.hint} ${item.keywords}`);
  let total = 0;
  for (const word of words) {
    let points = 0;
    if (title.split(" ").some((w) => w.startsWith(word))) points = 4;
    else if (title.includes(word)) points = 3;
    else if (section.includes(word)) points = 2;
    else if (rest.includes(word)) points = 1;
    if (points === 0) return 0;
    total += points;
  }
  return total;
}

/** Settings matching every typed word, best first (ties keep the order of the list). An empty query matches nothing. */
export function searchSettings(
  query: string,
  index: readonly SettingEntry[] = SETTINGS_INDEX,
): SettingEntry[] {
  const words = norm(query).split(" ").filter(Boolean);
  if (words.length === 0) return [];
  return index
    .map((item, order) => ({ item, order, points: score(item, words) }))
    .filter((r) => r.points > 0)
    .sort((a, b) => b.points - a.points || a.order - b.order)
    .map((r) => r.item);
}

/** "General › Lock screen and desktop". */
export const pathOf = (item: SettingEntry): string =>
  item.section === TAB_TITLES[item.tab]
    ? TAB_TITLES[item.tab]
    : `${TAB_TITLES[item.tab]} › ${item.section}`;
