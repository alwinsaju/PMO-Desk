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
  CalendarIcon,
  ClipboardTextIcon,
  FilmSlateIcon,
  ImageIcon,
  KanbanIcon,
  ListChecksIcon,
  LockKeyIcon,
  PaintBrushIcon,
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
];
