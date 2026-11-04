// The keyboard shortcuts of PMO Desk, for the shortcut sheet (Settings > Shortcuts, or press ?).
// One list so the sheet cannot drift from what is documented here; the handlers live next to
// the features (focusKeys.ts, windowSnap.ts, windowSwitch.ts, listKeys.ts, GlobalSearch).

export interface Shortcut {
  keys: string;
  action: string;
}

export interface ShortcutGroup {
  title: string;
  shortcuts: readonly Shortcut[];
}

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  {
    title: "Everywhere",
    shortcuts: [
      { keys: "Ctrl+K", action: "Search everything" },
      { keys: "Ctrl+Space", action: "Jump to the command bar" },
      { keys: "Ctrl+,", action: "Open Settings" },
      { keys: "?", action: "Show this list" },
      {
        keys: "Ctrl+Shift+Space",
        action:
          "Quick capture from any program (desktop app, off until turned on in Quick settings)",
      },
    ],
  },
  {
    title: "Windows",
    shortcuts: [
      { keys: "Ctrl+W", action: "Close the window" },
      { keys: "Ctrl+M", action: "Minimise the window" },
      {
        keys: "Ctrl+Tab",
        action: "Switch window (hold Ctrl, press Tab again to walk the list)",
      },
      { keys: "Ctrl+Alt+Left / Right", action: "Snap to the left or right half" },
      { keys: "Ctrl+Alt+7 / 9 / 1 / 3", action: "Snap to a corner" },
      { keys: "Ctrl+Alt+Up / Down", action: "Maximise / restore" },
      {
        keys: "Drag to a screen edge",
        action: "Snap to a half (a corner near the ends)",
      },
    ],
  },
  {
    title: "Command bar",
    shortcuts: [
      { keys: "Up / Down", action: "Earlier and later commands" },
      { keys: "Tab", action: "Accept the first completion" },
      { keys: "Esc", action: "Dismiss an answer" },
      {
        keys: "/",
        action:
          "Slash commands: /todo buy milk Fri, /open staff, /overdue (type / to see them)",
      },
    ],
  },
  {
    title: "Notes",
    shortcuts: [
      { keys: "Ctrl+B", action: "Bold the selected text" },
      {
        keys: "Ctrl+Enter",
        action: "Tick or untick the checklist item under the cursor",
      },
    ],
  },
  {
    title: "PMO To-Do list",
    shortcuts: [
      { keys: "J / K", action: "Move down / up" },
      { keys: "E or Enter", action: "Open the to-do" },
      { keys: "D", action: "Mark done (with Undo)" },
      { keys: "S", action: "Snooze" },
    ],
  },
];

/** Every shortcut as one line of text, for searching the sheet. */
export const allShortcuts = (): Shortcut[] =>
  SHORTCUT_GROUPS.flatMap((g) => [...g.shortcuts]);

/** Shortcuts that match what was typed (any word of the key or the action). */
export function filterShortcuts(query: string): ShortcutGroup[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...SHORTCUT_GROUPS];
  return SHORTCUT_GROUPS.map((group) => ({
    title: group.title,
    shortcuts: group.shortcuts.filter((s) => {
      const text = `${s.keys} ${s.action} ${group.title}`.toLowerCase();
      return words.every((w) => text.includes(w));
    }),
  })).filter((group) => group.shortcuts.length > 0);
}
