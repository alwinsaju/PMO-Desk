// In-app help: for each app, what it is for and its three most common tasks. Static on
// purpose, so it is the same offline and reviewable. Pure.

export interface HelpTask {
  title: string;
  steps: string[];
}

export interface AppHelp {
  appId: string;
  title: string;
  summary: string;
  tasks: [HelpTask, HelpTask, HelpTask];
}

export const APP_HELP: readonly AppHelp[] = [
  {
    appId: "dashboard",
    title: "Dashboard",
    summary:
      "What needs you today, on one screen. It only reads; each card opens the app behind it.",
    tasks: [
      {
        title: "See what to do first",
        steps: [
          "Open the Today card.",
          "Work down the list: overdue first, then due today.",
        ],
      },
      {
        title: "Choose which cards you see",
        steps: [
          "Press Customise.",
          "Show, hide, move or widen cards.",
          "Save a named layout to switch back.",
        ],
      },
      {
        title: "Share the screen in a meeting",
        steps: ["Press Export.", "Choose PNG or PDF and pick where to save it."],
      },
    ],
  },
  {
    appId: "pmo-todo",
    title: "PMO To-Do",
    summary:
      "Messages become to-dos only after you approve them. Reminders and chasers keep things moving.",
    tasks: [
      {
        title: "Add a to-do quickly",
        steps: [
          "Type in the box at the top, for example “Send deck to Priya Fri”.",
          "Press Enter.",
        ],
      },
      {
        title: "Chase someone",
        steps: [
          "Open the to-do.",
          "Press Chaser to get a draft.",
          "Copy or open it unsent, then send it yourself.",
        ],
      },
      {
        title: "Plan the week",
        steps: ["Press Plan week.", "Tick the five to keep.", "They are added to Today."],
      },
    ],
  },
  {
    appId: "tasks",
    title: "Tasks",
    summary:
      "Runs the report and mailing tasks through prepare, review and approve. Nothing is sent without you.",
    tasks: [
      {
        title: "Run a weekly report",
        steps: [
          "Pick the task and press Run.",
          "Add its files.",
          "Review what it prepared, then confirm.",
        ],
      },
      {
        title: "Schedule a reminder",
        steps: [
          "Open the Schedule tab.",
          "Pick the days.",
          "Turn on self-preparing if you want it ready for review.",
        ],
      },
      {
        title: "Find out why a run failed",
        steps: [
          "Open the History tab.",
          "Open the run.",
          "Read the plain-words reason and the suggested fix.",
        ],
      },
    ],
  },
  {
    appId: "staff",
    title: "Staff Management",
    summary:
      "The one list of people: directory, shift roster, time off and offboarded people.",
    tasks: [
      {
        title: "Approve or reject leave",
        steps: [
          "Open Insights or the Dashboard card.",
          "Check the cover warning.",
          "Approve or reject; the reply opens unsent.",
        ],
      },
      {
        title: "See who is working",
        steps: [
          "Open the Shift roster.",
          "Use Day, Week or Month.",
          "Approved time off shows on the grid.",
        ],
      },
      {
        title: "Add several leave days at once",
        steps: ["Open Time off and add.", "Type dates like “5–7 Nov, 12 Nov”.", "Save."],
      },
    ],
  },
  {
    appId: "templates",
    title: "Templates",
    summary:
      "The wording of emails and reports, edited in one place and used by tasks and apps.",
    tasks: [
      {
        title: "Change a message's wording",
        steps: [
          "Pick the template.",
          "Edit the text; the preview updates.",
          "It saves by itself.",
        ],
      },
      {
        title: "Use a template somewhere",
        steps: ["Open the template.", "Tick the task or app under “Used by”."],
      },
      {
        title: "Go back to an earlier wording",
        steps: [
          "Open More on the template.",
          "Choose Versions.",
          "Press Restore on the one you want.",
        ],
      },
    ],
  },
  {
    appId: "files",
    title: "Files",
    summary: "Browse the files in the PMO Desk folders on this computer.",
    tasks: [
      {
        title: "Open a folder",
        steps: [
          "Double-click a folder to go in.",
          "Use the breadcrumb at the top to go back.",
        ],
      },
      { title: "Go up one level", steps: ["Press “Go to parent folder”."] },
      { title: "Jump to a place", steps: ["Pick one under Places on the left."] },
    ],
  },
  {
    appId: "notes",
    title: "Notes",
    summary: "A simple notepad that the command bar can also write to.",
    tasks: [
      {
        title: "Write a note",
        steps: ["Press “New note”.", "Type in the note; it saves by itself."],
      },
      {
        title: "Find a note",
        steps: ["Use the list on the left.", "Click a title to open it."],
      },
      {
        title: "Ask the command bar to add one",
        steps: ["Focus Notes.", "Ask the bar to create a note with your text."],
      },
    ],
  },
  {
    appId: "browser",
    title: "Browser",
    summary: "Opens web pages inside PMO Desk. Some sites refuse to be shown in a frame.",
    tasks: [
      {
        title: "Open a site",
        steps: ["Type the address in the Address box.", "Press Enter."],
      },
      { title: "Go back or forward", steps: ["Use the Back and Forward arrows."] },
      { title: "Refresh a page", steps: ["Press “Reload page”."] },
    ],
  },
  {
    appId: "app-store",
    title: "App Store",
    summary: "Add extra apps to the dock.",
    tasks: [
      { title: "Find an app", steps: ["Type in “Search apps”."] },
      { title: "Add an app", steps: ["Open it in the list.", "Press its add button."] },
      { title: "Use it", steps: ["Open it from the dock after adding."] },
    ],
  },
  {
    appId: "settings",
    title: "Settings",
    summary:
      "Start-up, focus, the command bar, notifications, shortcuts, your data and updates.",
    tasks: [
      {
        title: "Back up your data",
        steps: ["Open the Data tab.", "Press Back up and choose where to save."],
      },
      {
        title: "See what happened",
        steps: ["Open the Activity tab.", "Filter by action or search."],
      },
      {
        title: "Send a diagnostics file",
        steps: ["Open the About tab.", "Press Create diagnostics file."],
      },
    ],
  },
];

export function helpFor(appId: string | null | undefined): AppHelp | null {
  return APP_HELP.find((h) => h.appId === appId) ?? null;
}

export const GENERAL_HELP: readonly string[] = [
  "Press Ctrl+K to search everything, Ctrl+Space to ask the command bar, and ? for the shortcut list.",
  "Nothing is ever sent for you: drafts open unsent and tasks stop at a review step.",
  "Everything stays on this computer. Back it up from Settings > Data.",
];
