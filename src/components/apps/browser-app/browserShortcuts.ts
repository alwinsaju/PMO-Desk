// Keyboard shortcuts of the Browser app, as pure decisions. Ctrl+Tab is left alone:
// it switches windows everywhere in PMO Desk, so tabs use Ctrl+Page Down / Up.

export type BrowserShortcut =
  | "focus-address"
  | "back"
  | "forward"
  | "reload"
  | "new-tab"
  | "next-tab"
  | "previous-tab"
  | "close-tab";

export function browserShortcut(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): BrowserShortcut | null {
  const key = event.key.toLowerCase();
  const command = event.ctrlKey || event.metaKey;
  if (event.altKey && !command && !event.shiftKey) {
    if (key === "arrowleft") return "back";
    if (key === "arrowright") return "forward";
    return null;
  }
  if (event.altKey) return null;
  if (key === "f5" && !command) return "reload";
  if (!command) return null;
  if (event.shiftKey) return null;
  switch (key) {
    case "l":
      return "focus-address";
    case "r":
      return "reload";
    case "t":
      return "new-tab";
    case "w":
      return "close-tab";
    case "pagedown":
      return "next-tab";
    case "pageup":
      return "previous-tab";
    default:
      return null;
  }
}
