"use client";

import { CompassIcon } from "@phosphor-icons/react";
import { MockLink } from "./MockLink";
import type { MockPageId } from "./mockPages";

interface MockPageProps {
  onNavigate: (id: MockPageId) => void;
}

/**
 * Fake search-engine landing page — one of BrowserApp.tsx's 3 static mock
 * pages. Entirely fictional (no real product), same spirit as the App
 * Store's invented catalog of apps. The "search box" is decorative (there's
 * nothing to actually search); the two lines below are this page's only
 * links, each handed to `onNavigate` by BrowserApp.tsx.
 */
export function HomePage({ onNavigate }: MockPageProps) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-6 py-10 text-center">
      <div className="flex items-center gap-2">
        <CompassIcon size={30} weight="duotone" className="text-accent" />
        <h1 className="text-ink text-2xl font-semibold">Pathfinder</h1>
      </div>
      <div className="border-border bg-surface-elevated shadow-float-sm flex h-11 w-full items-center rounded-full border px-4">
        <span className="text-ink-faint text-[13px]">
          Search Pathfinder — try a link below
        </span>
      </div>
      <div className="flex flex-col gap-2 text-[13px]">
        <p className="text-ink-muted">
          Popular right now:{" "}
          <MockLink onClick={() => onNavigate("wiki")}>
            Window managers, explained
          </MockLink>
        </p>
        <p className="text-ink-muted">
          <MockLink onClick={() => onNavigate("about")}>About Pathfinder</MockLink>
        </p>
      </div>
    </div>
  );
}
