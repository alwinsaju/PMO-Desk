// Which Settings tab each field lives on, so a tab can show that it holds a
// mistake and Save can take the person to it. Pure (see settingsTabs.test.mjs).

export const SETTINGS_TABS = [
  { id: "me", label: "Me" },
  { id: "senders", label: "Senders" },
  { id: "reminders", label: "Reminders" },
  { id: "teams", label: "Teams (advanced)" },
] as const;
export type SettingsTabId = (typeof SETTINGS_TABS)[number]["id"];

/** The tab a form field (or an error key such as "reminders.workStart") is on. */
export function tabOfField(key: string): SettingsTabId {
  if (key.startsWith("reminders.")) return "reminders";
  switch (key) {
    case "allowedSenderDomains":
    case "blockedDomains":
    case "blockedTerms":
    case "retentionDays":
      return "senders";
    case "allowedTenantIds":
    case "teamsChatAllowlist":
      return "teams";
    default:
      // names, emails and the weekly report heading.
      return "me";
  }
}

/** The tabs that hold any of `fields`, in tab order and without repeats. */
export function tabsWithProblems(fields: readonly string[]): SettingsTabId[] {
  const found = new Set(fields.map(tabOfField));
  return SETTINGS_TABS.map((tab) => tab.id).filter((id) => found.has(id));
}
