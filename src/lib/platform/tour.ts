// The guided tour: a short walk through the apps. Pure; the overlay opens each app as it goes.

export interface TourStep {
  id: string;
  title: string;
  text: string;
  /** The app to open while this step shows (none = stay on the desktop). */
  appId?: string;
}

export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: "welcome",
    title: "Welcome to PMO Desk",
    text: "Everything here stays on this computer, and nothing is sent without your approval. This takes about a minute.",
  },
  {
    id: "bar",
    title: "The command bar",
    text: "Press Ctrl+Space and type what you want: “what's overdue?”, “chase Sam on the release plan”, “when is Ana back?”.",
  },
  {
    id: "dashboard",
    title: "Dashboard",
    text: "What needs you today, on one screen. Customise the cards from the button at the top.",
    appId: "dashboard",
  },
  {
    id: "todo",
    title: "PMO To-Do",
    text: "Messages become to-dos after you approve them. Type in the box at the top to add one yourself.",
    appId: "pmo-todo",
  },
  {
    id: "tasks",
    title: "Tasks",
    text: "Run the weekly reports. Each one prepares a draft, waits for your review, and only then asks to send.",
    appId: "tasks",
  },
  {
    id: "staff",
    title: "Staff Management",
    text: "The directory, the shift roster and time off, with leave approvals and cover checks in Insights.",
    appId: "staff",
  },
  {
    id: "templates",
    title: "Templates",
    text: "Edit the wording of emails and reports once; tasks and apps use it.",
    appId: "templates",
  },
  {
    id: "settings",
    title: "Settings, backup and help",
    text: "Back up your data, see the activity log, switch profile and open help for any app.",
    appId: "settings",
  },
];

export const tourLength = TOUR_STEPS.length;

export const stepAt = (index: number): TourStep | null =>
  index >= 0 && index < TOUR_STEPS.length ? TOUR_STEPS[index]! : null;

/** The label for the progress line: "Step 3 of 8". */
export const progressText = (index: number): string =>
  `Step ${Math.min(index + 1, tourLength)} of ${tourLength}`;
