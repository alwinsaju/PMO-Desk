// Wire contract for POST /api/ai/command (route.ts). A plain, side-effect-
// free types module — not a route itself (Next's App Router only treats an
// exact `route.ts` filename as an endpoint, see tasks-engine/shared.ts for
// the same pattern) — imported by both route.ts (the server side) and
// CommandBar.tsx (the one client caller), the same way tasks-app/types.ts
// is shared between that app's api.ts and its UI.
import type { AiAppId } from "@/lib/ai-runtime/windowIntent";

/** Existing note context sent up for the "focused app is Notes" case — id +
 *  title ONLY, never full content, so the model can reference a specific
 *  note by id for update_note/delete_note without a separate "list notes"
 *  round-trip. See route.ts's doc comment for why that trade-off was made. */
export interface AiCommandRequestNote {
  id: string;
  title: string;
}

/** A live window the AI may target with a window-management action. */
export interface AiCommandRequestWindow {
  id: string;
  appId: string;
  title: string;
}

export interface AiCommandRequest {
  /** Raw text typed into the command bar, verbatim. */
  prompt: string;
  /** The window that was focused at submit time. */
  focusedApp: { id: string; title: string };
  /** Only ever populated when `focusedApp.id === "notes"`. */
  notes?: AiCommandRequestNote[];
  /** Current windows, used only to resolve a window-management target. */
  windows: AiCommandRequestWindow[];
}

export type NoteToolName = "create_note" | "update_note" | "delete_note";
export type WindowToolName =
  "open_app" | "focus_window" | "minimize_window" | "maximize_window" | "close_window";
/** PMO tools: answered from the Staff roster and the PMO to-dos by code (whos_off,
 *  pmo_status), or turned into an action for the bar (prepare_task). */
export type PmoToolName = "whos_off" | "pmo_status" | "prepare_task";

export type AiCommandAppId = AiAppId;

/** A validated tool-call decision — by the time this reaches the client,
 *  the route has already checked `name` against a fixed allowlist and
 *  `arguments` against a shape (and, for update/delete, that the `id`
 *  actually matches a note the client just told it about). The client
 *  still owns re-checking existence against its own live store immediately
 *  before applying (see CommandBar.tsx) — the notes list can move between
 *  request and response since real inference isn't instant. */
export type AiCommandAction =
  | { type: "action"; name: "create_note"; arguments: { content: string } }
  | { type: "action"; name: "update_note"; arguments: { id: string; content: string } }
  | { type: "action"; name: "delete_note"; arguments: { id: string } }
  | { type: "action"; name: "open_app"; arguments: { appId: AiCommandAppId } }
  | { type: "action"; name: "focus_window"; arguments: { id: string } }
  | { type: "action"; name: "minimize_window"; arguments: { id: string } }
  | { type: "action"; name: "maximize_window"; arguments: { id: string } }
  | { type: "action"; name: "close_window"; arguments: { id: string } }
  /** Open the Tasks app with that task's Run form ready. Starts nothing by itself. */
  | { type: "action"; name: "prepare_task"; arguments: { taskId: string } };

export type AiCommandErrorKind = "unreachable" | "timeout" | "malformed";

export type AiCommandResult =
  | AiCommandAction
  | { type: "message"; text: string }
  | { type: "error"; kind: AiCommandErrorKind; message: string };
