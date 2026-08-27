// This file has no component/hook of its own, but needs "use client" anyway
// — same reasoning as src/components/taskbar/pinnedApps.ts (see
// ARCHITECTURE.md's third gotcha): `appIcons` below holds live Phosphor
// icon COMPONENT VALUES, not just types. Without this directive, `pnpm
// build` fails at "Collecting page data" the moment anything reaches this
// module through a Server Component (even transitively) — `pnpm
// dev`/typecheck/lint all stay silent about it either way.
"use client";

import {
  ArrowsClockwiseIcon,
  BookOpenTextIcon,
  CalendarIcon,
  ChatCircleTextIcon,
  ClipboardTextIcon,
  CodeIcon,
  EnvelopeSimpleIcon,
  FileTextIcon,
  FilmSlateIcon,
  ImageIcon,
  KanbanIcon,
  ListChecksIcon,
  LockKeyIcon,
  NotebookIcon,
  PaintBrushIcon,
  PlayCircleIcon,
  UsersThreeIcon,
  WalletIcon,
  WaveformIcon,
  WifiHighIcon,
  type Icon,
} from "@phosphor-icons/react";
import type { AppCategory, AppIconName, AppListing } from "./types";

export const appCategories: AppCategory[] = [
  { id: "productivity", label: "Productivity" },
  { id: "creativity", label: "Creativity" },
  { id: "utilities", label: "Utilities" },
];

/**
 * Resolves each catalog entry's `icon` field to the actual Phosphor
 * component that renders it. Kept as a separate map (rather than storing
 * the component itself on each `AppListing`) so `appCatalog` stays plain,
 * framework-agnostic data — same split as `pinnedApps.ts`'s
 * `pinnedAppIcons`.
 */
export const appIcons: Record<AppIconName, Icon> = {
  Kanban: KanbanIcon,
  Calendar: CalendarIcon,
  Wallet: WalletIcon,
  ListChecks: ListChecksIcon,
  Image: ImageIcon,
  PaintBrush: PaintBrushIcon,
  Waveform: WaveformIcon,
  FilmSlate: FilmSlateIcon,
  LockKey: LockKeyIcon,
  WifiHigh: WifiHighIcon,
  ClipboardText: ClipboardTextIcon,
  ArrowsClockwise: ArrowsClockwiseIcon,
  EnvelopeSimple: EnvelopeSimpleIcon,
  FileText: FileTextIcon,
  ChatCircleText: ChatCircleTextIcon,
  Notebook: NotebookIcon,
  UsersThree: UsersThreeIcon,
  Code: CodeIcon,
  BookOpenText: BookOpenTextIcon,
  PlayCircle: PlayCircleIcon,
};

/**
 * Static mock catalog — a handful of plausible, entirely fictional apps
 * across the 3 categories above. Nothing here is a real product; "Install"/
 * "Open" (see AppCard.tsx / AppDetailView.tsx) only ever flip local
 * component state, never a real install or purchase.
 */
export const appCatalog: AppListing[] = [
  // Productivity
  {
    id: "taskflow",
    name: "Taskflow",
    tagline: "Kanban boards for fast-moving teams",
    description:
      "Taskflow turns a messy backlog into a clear set of boards your whole team can move through together. Drag cards across custom columns, assign owners, and keep every project's status visible at a glance — no setup ceremony required.",
    developer: "Northwind Software",
    category: "productivity",
    icon: "Kanban",
    rating: 4.7,
    ratingCount: 1842,
    sizeLabel: "24 MB",
    price: "Free",
  },
  {
    id: "sched",
    name: "Sched",
    tagline: "Smart calendar & scheduling",
    description:
      "Sched blends every calendar you own into one clean week view and finds meeting times everyone can actually make. Smart reminders and quiet hours keep your day realistic instead of just full.",
    developer: "Loop Labs",
    category: "productivity",
    icon: "Calendar",
    rating: 4.4,
    ratingCount: 956,
    sizeLabel: "31 MB",
    price: "Free",
  },
  {
    id: "ledger-lite",
    name: "Ledger Lite",
    tagline: "Effortless personal budgeting",
    description:
      "Ledger Lite tracks spending across accounts and sorts it into budgets automatically. Weekly digests highlight what changed so you can adjust before a small overspend becomes a big one.",
    developer: "Pennywise Studio",
    category: "productivity",
    icon: "Wallet",
    rating: 4.5,
    ratingCount: 3021,
    sizeLabel: "18 MB",
    price: "$2.99",
  },
  {
    id: "listly",
    name: "Listly",
    tagline: "Checklists & daily routines",
    description:
      "Listly is a fast, distraction-free home for every recurring checklist — packing lists, morning routines, shared groceries. Check items off from any window and they reset right on schedule.",
    developer: "Tidy Rabbit",
    category: "productivity",
    icon: "ListChecks",
    rating: 4.8,
    ratingCount: 612,
    sizeLabel: "9 MB",
    price: "Free",
    featured: true,
  },

  // Creativity
  {
    id: "pixel-loom",
    name: "Pixel Loom",
    tagline: "Layer-based image editing",
    description:
      "Pixel Loom brings non-destructive layers, masks, and adjustment stacks to quick edits and serious compositing alike. Export presets keep web, print, and social sizes one click away.",
    developer: "Loom & Co.",
    category: "creativity",
    icon: "Image",
    rating: 4.6,
    ratingCount: 2210,
    sizeLabel: "156 MB",
    price: "$6.99",
  },
  {
    id: "palette",
    name: "Palette",
    tagline: "Vector design & quick mockups",
    description:
      "Palette is a lightweight vector canvas for icons, posters, and UI mockups. Shared style libraries keep colors and type consistent across every file you start.",
    developer: "Studio Ochre",
    category: "creativity",
    icon: "PaintBrush",
    rating: 4.3,
    ratingCount: 874,
    sizeLabel: "98 MB",
    price: "Free",
  },
  {
    id: "waveform-studio",
    name: "Waveform Studio",
    tagline: "Multitrack audio editing",
    description:
      "Waveform Studio handles multitrack recording, cleanup, and mixing without a steep learning curve. Built-in noise reduction and mastering presets get a rough take to release-ready fast.",
    developer: "Loud Cloud Audio",
    category: "creativity",
    icon: "Waveform",
    rating: 4.5,
    ratingCount: 501,
    sizeLabel: "210 MB",
    price: "$9.99",
  },
  {
    id: "storyboard",
    name: "Storyboard",
    tagline: "Quick video edits & captions",
    description:
      "Storyboard trims, captions, and reorders clips in a simple timeline built for short-form video. Auto-captions and clean transitions turn a folder of takes into something shareable in minutes.",
    developer: "Reel Good Media",
    category: "creativity",
    icon: "FilmSlate",
    rating: 4.2,
    ratingCount: 388,
    sizeLabel: "134 MB",
    price: "Free",
    featured: true,
  },

  // Utilities
  {
    id: "vault",
    name: "Vault",
    tagline: "Encrypted password manager",
    description:
      "Vault stores passwords, notes, and cards behind end-to-end encryption and autofills them everywhere you need them. A built-in strength check flags weak or reused passwords before they become a problem.",
    developer: "Ironkey Systems",
    category: "utilities",
    icon: "LockKey",
    rating: 4.9,
    ratingCount: 5420,
    sizeLabel: "12 MB",
    price: "Free",
    featured: true,
  },
  {
    id: "netpulse",
    name: "NetPulse",
    tagline: "Wi-Fi & network diagnostics",
    description:
      "NetPulse watches signal strength, latency, and speed over time and flags the exact moment things went wrong. A plain-language summary makes it easy to tell your provider what's actually happening.",
    developer: "Signal & Co.",
    category: "utilities",
    icon: "WifiHigh",
    rating: 4.1,
    ratingCount: 267,
    sizeLabel: "6 MB",
    price: "Free",
  },
  {
    id: "clip-stack",
    name: "Clip Stack",
    tagline: "Clipboard history, searchable",
    description:
      "Clip Stack quietly keeps everything you copy so nothing important gets overwritten by accident. Pin frequent snippets and search past clips instantly from a single shortcut.",
    developer: "Tidy Rabbit",
    category: "utilities",
    icon: "ClipboardText",
    rating: 4.6,
    ratingCount: 733,
    sizeLabel: "4 MB",
    price: "$1.99",
  },
  {
    id: "quick-convert",
    name: "Quick Convert",
    tagline: "Batch file conversion",
    description:
      "Quick Convert turns folders of images, audio, and documents into the format you actually need, in one batch pass. Presets remember your usual output settings so repeat jobs take one click.",
    developer: "Northwind Software",
    category: "utilities",
    icon: "ArrowsClockwise",
    rating: 4.0,
    ratingCount: 190,
    sizeLabel: "15 MB",
    price: "Free",
  },

  // ---------------------------------------------------------------------
  // Real web apps — unlike everything above, these are genuine products
  // and "Open" actually opens them (see AppStoreApp.tsx's handlePrimaryAction,
  // which routes any entry with a `url` to `openWindow("web-app", ...)`
  // instead of the fictional entries' plain install-state toggle).
  //
  // `embeddable` below is NOT a guess or a runtime check — cross-origin
  // iframes can't be introspected from JS, and a blocked frame usually
  // fires no distinguishing event, so there is no reliable dynamic signal
  // to react to. Instead, each site's real response headers were checked
  // by hand (`curl -sI <url>`, following redirects, looking for
  // `X-Frame-Options` and the CSP `frame-ancestors` directive) and the
  // result hardcoded here as a static flag. Findings, checked 2026-08-27:
  //
  //   BLOCKED  mail.google.com   — X-Frame-Options: SAMEORIGIN, and the
  //                                 accounts.google.com sign-in page it
  //                                 redirects to sends DENY.
  //   BLOCKED  docs.google.com   — same Google sign-in stack as Gmail.
  //   BLOCKED  slack.com         — X-Frame-Options: SAMEORIGIN.
  //   BLOCKED  notion.so         — CSP frame-ancestors 'self' plus a short
  //                                 allowlist of Notion's own app origins.
  //   BLOCKED  linkedin.com      — X-Frame-Options: SAMEORIGIN and CSP
  //                                 frame-ancestors 'self' *.www.linkedin.com:*.
  //   BLOCKED  github.com        — X-Frame-Options: DENY and CSP
  //                                 frame-ancestors 'none' — the strictest
  //                                 of the group.
  //   ALLOWED  figma.com/embed   — the main figma.com domain itself sends
  //                                 X-Frame-Options: SAMEORIGIN (blocked),
  //                                 but Figma's own documented public embed
  //                                 pattern (`/embed?embed_host=share&url=`,
  //                                 the exact URL its own "Copy embed code"
  //                                 button generates) redirects to a
  //                                 /file/.../hf_embed viewer that sends
  //                                 NEITHER header — checked across 3
  //                                 responses in that redirect chain.
  //   ALLOWED  en.wikipedia.org  — sends neither header at all.
  //   ALLOWED  youtube.com/embed/<id> — sends neither header, in direct
  //                                 contrast to the regular /watch page
  //                                 (X-Frame-Options: SAMEORIGIN), which is
  //                                 exactly why the embed URL — never the
  //                                 watch URL — is what's used below.
  // ---------------------------------------------------------------------
  {
    id: "gmail",
    name: "Gmail",
    tagline: "Email from Google",
    description:
      "Gmail is Google's web-based email service, with fast search, spam filtering, and threaded conversations. This opens the real mail.google.com — sign in with your own Google account to use it.",
    developer: "Google",
    category: "productivity",
    icon: "EnvelopeSimple",
    rating: 4.6,
    ratingCount: 812345,
    sizeLabel: "2 MB",
    price: "Free",
    url: "https://mail.google.com/",
    embeddable: false,
  },
  {
    id: "google-docs",
    name: "Google Docs",
    tagline: "Real-time collaborative documents",
    description:
      "Google Docs is a browser-based word processor with live multi-person editing, comments, and version history. This opens the real docs.google.com — sign in with your own Google account to use it.",
    developer: "Google",
    category: "productivity",
    icon: "FileText",
    rating: 4.7,
    ratingCount: 645210,
    sizeLabel: "2 MB",
    price: "Free",
    url: "https://docs.google.com/",
    embeddable: false,
  },
  {
    id: "slack",
    name: "Slack",
    tagline: "Team messaging and channels",
    description:
      "Slack organizes team conversations into channels and DMs, with search across every message a workspace has ever sent. This opens the real slack.com — sign in to your own workspace to use it.",
    developer: "Slack Technologies",
    category: "productivity",
    icon: "ChatCircleText",
    rating: 4.6,
    ratingCount: 398120,
    sizeLabel: "3 MB",
    price: "Free",
    url: "https://slack.com/",
    embeddable: false,
  },
  {
    id: "notion",
    name: "Notion",
    tagline: "Docs, wikis, and project trackers in one workspace",
    description:
      "Notion combines notes, databases, and project boards into a single flexible workspace a team can shape to its own process. This opens the real notion.so — sign in with your own account to use it.",
    developer: "Notion Labs, Inc.",
    category: "productivity",
    icon: "Notebook",
    rating: 4.8,
    ratingCount: 275640,
    sizeLabel: "2 MB",
    price: "Free",
    url: "https://notion.so/",
    embeddable: false,
  },
  {
    id: "linkedin",
    name: "LinkedIn",
    tagline: "Professional networking",
    description:
      "LinkedIn connects you with colleagues and recruiters, tracks your resume as a living profile, and surfaces jobs matched to your experience. This opens the real linkedin.com — sign in with your own account to use it.",
    developer: "LinkedIn Corporation",
    category: "productivity",
    icon: "UsersThree",
    rating: 4.2,
    ratingCount: 903215,
    sizeLabel: "2 MB",
    price: "Free",
    url: "https://www.linkedin.com/",
    embeddable: false,
  },
  {
    id: "github",
    name: "GitHub",
    tagline: "Where the world builds software",
    description:
      "GitHub hosts Git repositories with pull requests, issues, and Actions for CI/CD, used across most of the open-source world. This opens the real github.com — sign in with your own account for private repos.",
    developer: "GitHub, Inc.",
    category: "utilities",
    icon: "Code",
    rating: 4.9,
    ratingCount: 512870,
    sizeLabel: "1 MB",
    price: "Free",
    url: "https://github.com/",
    embeddable: false,
  },
  {
    id: "figma",
    name: "Figma",
    tagline: "Collaborative interface design",
    description:
      "Figma is a browser-based design tool for interfaces and prototypes, with every collaborator's cursor visible on the canvas at once. Figma's own public embed feature is what loads here, so a shared file actually renders inline.",
    developer: "Figma, Inc.",
    category: "creativity",
    icon: "PaintBrush",
    rating: 4.8,
    ratingCount: 356900,
    sizeLabel: "3 MB",
    price: "Free",
    url: "https://www.figma.com/embed?embed_host=share&url=https%3A%2F%2Fwww.figma.com%2Fcommunity%2Ffile%2F1172289121975046091%2Fcommunity-files",
    embeddable: true,
  },
  {
    id: "youtube",
    name: "YouTube",
    tagline: "Video, embedded the way it's meant to be",
    description:
      "YouTube hosts the web's largest library of video, from full-length uploads to livestreams. This opens one video through YouTube's own embed URL — the exact pattern the site designs for iframes, unlike its regular watch page.",
    developer: "Google",
    category: "creativity",
    icon: "PlayCircle",
    rating: 4.7,
    ratingCount: 1250000,
    sizeLabel: "1 MB",
    price: "Free",
    url: "https://www.youtube.com/embed/jNQXAC9IVRw",
    embeddable: true,
    featured: true,
  },
  {
    id: "wikipedia",
    name: "Wikipedia",
    tagline: "The free encyclopedia",
    description:
      "Wikipedia is a collaboratively edited, source-cited encyclopedia covering millions of topics in dozens of languages. It places no restrictions on framing, so it opens right inside this window.",
    developer: "Wikimedia Foundation",
    category: "utilities",
    icon: "BookOpenText",
    rating: 4.6,
    ratingCount: 198450,
    sizeLabel: "1 MB",
    price: "Free",
    url: "https://en.wikipedia.org/wiki/Cat",
    embeddable: true,
    featured: true,
  },
];
