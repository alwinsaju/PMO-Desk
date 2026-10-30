// "Show me": the link under an answer that opens the app behind it, already filtered.
// Pure: it only decides where to go; the command bar does the opening.
import type { LocalIntent } from "@/lib/ai-runtime/localIntent";
import type { PmoIntent } from "@/lib/ai-runtime/pmoIntent";

export type ShowMeTarget =
  | { app: "pmo-todo"; filter: "open" | "today" | "overdue" | "waiting" }
  | { app: "staff" }
  | { app: "tasks"; taskId: string | null };

export interface ShowMe {
  label: string;
  target: ShowMeTarget;
}

export function showMeFor(
  intent: PmoIntent | LocalIntent | null | undefined,
): ShowMe | null {
  if (!intent) return null;
  switch (intent.kind) {
    case "pmo_status": {
      const filter = {
        overdue: "overdue",
        chasers: "waiting",
        open: "open",
        summary: "today",
      }[intent.topic] as "open" | "today" | "overdue" | "waiting";
      return { label: "Show me in PMO To-Do", target: { app: "pmo-todo", filter } };
    }
    case "changes":
      return {
        label: "Show me in PMO To-Do",
        target: { app: "pmo-todo", filter: "open" },
      };
    case "whos_off":
    case "person_back":
    case "person_shift":
      return { label: "Show me in Staff", target: { app: "staff" } };
    case "run_info":
      return {
        label: "Show me in Tasks",
        target: { app: "tasks", taskId: intent.taskId },
      };
    default:
      return null;
  }
}
