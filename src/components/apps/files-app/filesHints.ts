// What the Files app says when a key or click would do something that this sample app
// does not support, and which keys it does handle. Pure.

export type SampleAction = "open-file" | "rename" | "delete" | "context-menu";

const HINTS: Record<SampleAction, string> = {
  "open-file": "These are sample files, so there is nothing to open.",
  rename: "These are sample files, so they cannot be renamed.",
  delete: "These are sample files, so they cannot be deleted.",
  "context-menu": "These are sample files, so there is no right-click menu.",
};

export const sampleHint = (action: SampleAction): string => HINTS[action];

/** The key's meaning in the file list, or null when the Files app does not use it. */
export function filesKey(event: {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}): "up" | "rename" | "delete" | null {
  if (event.ctrlKey || event.metaKey) return null;
  if (event.key === "Backspace" && !event.altKey) return "up";
  if (event.key === "ArrowUp" && event.altKey) return "up";
  if (event.key === "F2" && !event.altKey) return "rename";
  if (event.key === "Delete" && !event.altKey) return "delete";
  return null;
}
