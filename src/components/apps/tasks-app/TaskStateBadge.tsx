import { cn } from "@/lib/cn";
import { STATE_LABEL } from "./taskPresenter";
import type { TaskState } from "./types";

// Communicated with the neutral scale's own contrast + a leading dot,
// never a second hue — this product reserves its one accent color for
// AI/interactive moments (see ARCHITECTURE.md's "The ONE accent color").
// "working"/"finishing" are the one state that genuinely IS an AI/worker
// actively doing something right now, so that's the one legitimate accent
// use here — the same reasoning ARCHITECTURE.md gives for the AI-controlled
// window ring. Every other state leans on value contrast + a dot color
// instead of inventing a second (e.g. red/amber) accent.
const DOT_CLASS: Record<TaskState, string> = {
  resting: "bg-neutral-400",
  working: "bg-accent animate-pulse",
  finishing: "bg-accent animate-pulse",
  awaiting_review: "bg-ink",
  awaiting_send: "bg-ink",
  error: "bg-white",
};

const PILL_CLASS: Record<TaskState, string> = {
  resting: "bg-neutral-100 text-ink-muted",
  working: "bg-accent-subtle text-accent-800",
  finishing: "bg-accent-subtle text-accent-800",
  awaiting_review: "bg-neutral-150 text-ink",
  awaiting_send: "bg-neutral-150 text-ink",
  error: "bg-ink text-white",
};

interface TaskStateBadgeProps {
  state: TaskState;
  className?: string;
}

/** Small state pill for a task card/detail header — label text from
 *  STATE_LABEL, color treatment per the rules above. */
export function TaskStateBadge({ state, className }: TaskStateBadgeProps) {
  return (
    <span
      className={cn(
        "rounded-pill ease-standard inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium whitespace-nowrap transition-colors duration-150",
        PILL_CLASS[state],
        className,
      )}
    >
      <span
        className={cn(
          "ease-standard h-1.5 w-1.5 shrink-0 rounded-full transition-colors duration-150",
          DOT_CLASS[state],
        )}
      />
      {STATE_LABEL[state]}
    </span>
  );
}
