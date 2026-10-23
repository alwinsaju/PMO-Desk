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
 * framework-agnostic data — a different split from `pinnedApps.ts`, whose
 * `builtInApps` entries carry their icon component directly.
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
 * "Open" (see AppCard.tsx) only ever flip `installedAppsStore`'s shared
 * install state, never a real install or purchase.
 */
export const appCatalog: AppListing[] = [
  // Productivity
  {
    id: "taskflow",
    name: "Taskflow",
    tagline: "Kanban boards for fast-moving teams",
    developer: "Northwind Software",
    category: "productivity",
    icon: "Kanban",
  },
  {
    id: "sched",
    name: "Sched",
    tagline: "Smart calendar & scheduling",
    developer: "Loop Labs",
    category: "productivity",
    icon: "Calendar",
  },
  {
    id: "ledger-lite",
    name: "Ledger Lite",
    tagline: "Effortless personal budgeting",
    developer: "Pennywise Studio",
    category: "productivity",
    icon: "Wallet",
  },
  {
    id: "listly",
    name: "Listly",
    tagline: "Checklists & daily routines",
    developer: "Tidy Rabbit",
    category: "productivity",
    icon: "ListChecks",
    featured: true,
  },

  // Creativity
  {
    id: "pixel-loom",
    name: "Pixel Loom",
    tagline: "Layer-based image editing",
    developer: "Loom & Co.",
    category: "creativity",
    icon: "Image",
  },
  {
    id: "palette",
    name: "Palette",
    tagline: "Vector design & quick mockups",
    developer: "Studio Ochre",
    category: "creativity",
    icon: "PaintBrush",
  },
  {
    id: "waveform-studio",
    name: "Waveform Studio",
    tagline: "Multitrack audio editing",
    developer: "Loud Cloud Audio",
    category: "creativity",
    icon: "Waveform",
  },
  {
    id: "storyboard",
    name: "Storyboard",
    tagline: "Quick video edits & captions",
    developer: "Reel Good Media",
    category: "creativity",
    icon: "FilmSlate",
    featured: true,
  },

  // Utilities
  {
    id: "vault",
    name: "Vault",
    tagline: "Encrypted password manager",
    developer: "Ironkey Systems",
    category: "utilities",
    icon: "LockKey",
    featured: true,
  },
  {
    id: "netpulse",
    name: "NetPulse",
    tagline: "Wi-Fi & network diagnostics",
    developer: "Signal & Co.",
    category: "utilities",
    icon: "WifiHigh",
  },
  {
    id: "clip-stack",
    name: "Clip Stack",
    tagline: "Clipboard history, searchable",
    developer: "Tidy Rabbit",
    category: "utilities",
    icon: "ClipboardText",
  },
  {
    id: "quick-convert",
    name: "Quick Convert",
    tagline: "Batch file conversion",
    developer: "Northwind Software",
    category: "utilities",
    icon: "ArrowsClockwise",
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
    developer: "Google",
    category: "productivity",
    icon: "EnvelopeSimple",
    url: "https://mail.google.com/",
    embeddable: false,
  },
  {
    id: "google-docs",
    name: "Google Docs",
    tagline: "Real-time collaborative documents",
    developer: "Google",
    category: "productivity",
    icon: "FileText",
    url: "https://docs.google.com/",
    embeddable: false,
  },
  {
    id: "slack",
    name: "Slack",
    tagline: "Team messaging and channels",
    developer: "Slack Technologies",
    category: "productivity",
    icon: "ChatCircleText",
    url: "https://slack.com/",
    embeddable: false,
  },
  {
    id: "notion",
    name: "Notion",
    tagline: "Docs, wikis, and project trackers in one workspace",
    developer: "Notion Labs, Inc.",
    category: "productivity",
    icon: "Notebook",
    url: "https://notion.so/",
    embeddable: false,
  },
  {
    id: "linkedin",
    name: "LinkedIn",
    tagline: "Professional networking",
    developer: "LinkedIn Corporation",
    category: "productivity",
    icon: "UsersThree",
    url: "https://www.linkedin.com/",
    embeddable: false,
  },
  {
    id: "github",
    name: "GitHub",
    tagline: "Where the world builds software",
    developer: "GitHub, Inc.",
    category: "utilities",
    icon: "Code",
    url: "https://github.com/",
    embeddable: false,
  },
  {
    id: "figma",
    name: "Figma",
    tagline: "Collaborative interface design",
    developer: "Figma, Inc.",
    category: "creativity",
    icon: "PaintBrush",
    url: "https://www.figma.com/embed?embed_host=share&url=https%3A%2F%2Fwww.figma.com%2Fcommunity%2Ffile%2F1172289121975046091%2Fcommunity-files",
    embeddable: true,
  },
  {
    id: "youtube",
    name: "YouTube",
    tagline: "Video, embedded the way it's meant to be",
    developer: "Google",
    category: "creativity",
    icon: "PlayCircle",
    url: "https://www.youtube.com/embed/jNQXAC9IVRw",
    embeddable: true,
    featured: true,
  },
  {
    id: "wikipedia",
    name: "Wikipedia",
    tagline: "The free encyclopedia",
    developer: "Wikimedia Foundation",
    category: "utilities",
    icon: "BookOpenText",
    url: "https://en.wikipedia.org/wiki/Cat",
    embeddable: true,
    featured: true,
  },
];
