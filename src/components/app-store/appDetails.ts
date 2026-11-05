// What the App Store's detail sheet says about each app. The catalog is a sample, so this is sample
// copy too: sizes are made-up figures, and real web apps have nothing to download.
import type { AppListing } from "./types.ts";

export interface AppDetails {
  description: string;
  /** "What it does", as short points. */
  does: readonly string[];
  /** Size in MB for a sample app; real web apps have none. */
  sizeMb?: number;
}

export const appDetails: Record<string, AppDetails> = {
  taskflow: {
    description:
      "Taskflow lays work out as boards of cards that move from column to column, so a team sees who is doing what at a glance.",
    does: [
      "Boards with draggable cards",
      "Assign owners and due dates",
      "Filter by person or label",
    ],
    sizeMb: 62,
  },
  sched: {
    description:
      "Sched keeps your calendar in one place and suggests meeting times that suit everyone invited.",
    does: [
      "Day, week and month views",
      "Suggests free meeting slots",
      "Reminders before events",
    ],
    sizeMb: 48,
  },
  "ledger-lite": {
    description:
      "Ledger Lite tracks what comes in and goes out, sorted into categories you choose, with a simple monthly summary.",
    does: [
      "Log income and spending",
      "Monthly budget by category",
      "Export a summary to CSV",
    ],
    sizeMb: 35,
  },
  listly: {
    description:
      "Listly is for checklists you repeat: morning routines, packing lists, the Friday wrap-up.",
    does: [
      "Reusable checklists",
      "Daily and weekly repeats",
      "Tick items off with one click",
    ],
    sizeMb: 21,
  },
  "pixel-loom": {
    description:
      "Pixel Loom edits photos and images in layers, so a change never overwrites the original.",
    does: ["Layers and masks", "Crop, resize and colour tools", "Export as PNG or JPG"],
    sizeMb: 184,
  },
  palette: {
    description: "Palette draws sharp vector shapes and turns them into quick mockups.",
    does: ["Vector shapes and text", "Reusable colour palettes", "Export as SVG or PNG"],
    sizeMb: 96,
  },
  "waveform-studio": {
    description:
      "Waveform Studio records and edits audio on several tracks at once, from a voice memo to a podcast.",
    does: ["Multitrack recording", "Trim, fade and mix", "Noise clean-up"],
    sizeMb: 140,
  },
  storyboard: {
    description:
      "Storyboard trims video clips, joins them and adds captions without a steep learning curve.",
    does: ["Trim and join clips", "Add captions", "Export for sharing"],
    sizeMb: 210,
  },
  vault: {
    description:
      "Vault keeps passwords encrypted behind one master password and fills them in when you need them.",
    does: [
      "Encrypted password storage",
      "Generates strong passwords",
      "Flags reused passwords",
    ],
    sizeMb: 28,
  },
  netpulse: {
    description:
      "NetPulse shows how healthy your Wi-Fi and network connection are, and where a slowdown comes from.",
    does: ["Signal and speed checks", "Finds slow spots", "Keeps a short history"],
    sizeMb: 18,
  },
  "clip-stack": {
    description:
      "Clip Stack remembers what you copied, so an earlier snippet is a search away instead of lost.",
    does: ["Clipboard history", "Search past clips", "Pin the ones you reuse"],
    sizeMb: 12,
  },
  "quick-convert": {
    description:
      "Quick Convert changes a whole folder of files from one format to another in one go.",
    does: ["Batch conversion", "Images, audio and documents", "Keeps the original files"],
    sizeMb: 54,
  },
  gmail: {
    description: "Google's email service, opened as the real website.",
    does: ["Read and send email", "Search your mail", "Labels and filters"],
  },
  "google-docs": {
    description:
      "Documents you write together at the same time, opened as the real website.",
    does: [
      "Write and format documents",
      "Edit with others live",
      "Comment and suggest changes",
    ],
  },
  slack: {
    description:
      "Team messaging in channels and direct messages, opened as the real website.",
    does: [
      "Channels for each topic",
      "Direct messages and calls",
      "Share files with a team",
    ],
  },
  notion: {
    description:
      "Docs, wikis and project trackers in one workspace, opened as the real website.",
    does: ["Pages and databases", "Wikis for a team", "Task boards"],
  },
  linkedin: {
    description: "Professional networking and jobs, opened as the real website.",
    does: ["Keep in touch with colleagues", "Follow companies", "Find jobs"],
  },
  github: {
    description:
      "Where code lives: repositories, issues and reviews, opened as the real website.",
    does: ["Host code repositories", "Track issues", "Review changes"],
  },
  figma: {
    description:
      "Collaborative interface design. This opens Figma's public community page.",
    does: [
      "Browse community design files",
      "View shared designs",
      "Copy ideas into your own work",
    ],
  },
  youtube: {
    description: "Video, shown with YouTube's embedded player. This opens a sample clip.",
    does: ["Watch the sample video", "Pause, seek and go full screen"],
  },
  wikipedia: {
    description: "The free encyclopedia, opened as the real website.",
    does: [
      "Read articles on almost anything",
      "Follow links between topics",
      "Search the whole site",
    ],
  },
};

const FALLBACK: AppDetails = { description: "", does: [] };

export function detailsFor(app: Pick<AppListing, "id" | "tagline">): AppDetails {
  const found = appDetails[app.id];
  return found ?? { ...FALLBACK, description: app.tagline };
}

/** "184 MB", or what to say when there is nothing to download. */
export function sizeLabel(app: Pick<AppListing, "url">, details: AppDetails): string {
  // A sample app has nothing to download: its figure is made up, so it is labelled as an example.
  if (details.sizeMb !== undefined) return `${details.sizeMb} MB (example figure)`;
  return app.url ? "Nothing to download (opens the website)" : "Not listed";
}
