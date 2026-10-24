import { Badge, type BadgeVariant } from "@/components/ui";
import { STATE_LABEL } from "./taskPresenter";
import type { TaskState } from "./types";

// Each state's status badge (UI kit `Badge`, with its leading dot): "working"
// and "finishing" are the one state where an agent is genuinely working right
// now, so they take the accent (`accent`, dot blinking); the two human gates
// are amber (`warning`, dot blinking — it's waiting on you); an error is red
// (`danger`); idle is the plain neutral chip. The label text is always spelled
// out too, so nothing depends on color perception.
const TONE: Record<TaskState, { variant: BadgeVariant; pulse: boolean }> = {
  resting: { variant: "neutral", pulse: false },
  working: { variant: "accent", pulse: true },
  finishing: { variant: "accent", pulse: true },
  awaiting_review: { variant: "warning", pulse: true },
  awaiting_send: { variant: "warning", pulse: true },
  error: { variant: "danger", pulse: false },
};

interface TaskStateBadgeProps {
  state: TaskState;
  className?: string;
}

/** State badge for a task card/detail header — label text from STATE_LABEL,
 *  tone per the table above. A fixed minimum width, so a card header doesn't
 *  shift when a state change swaps "Running" for "Needs review". */
export function TaskStateBadge({ state, className }: TaskStateBadgeProps) {
  const { variant, pulse } = TONE[state];
  return (
    <Badge variant={variant} dot pulse={pulse} fixedWidth={116} className={className}>
      {STATE_LABEL[state]}
    </Badge>
  );
}
