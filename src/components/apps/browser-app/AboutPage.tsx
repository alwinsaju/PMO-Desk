"use client";

import { InfoIcon } from "@phosphor-icons/react";
import { MockLink } from "./MockLink";
import type { MockPageId } from "./mockPages";

interface MockPageProps {
  onNavigate: (id: MockPageId) => void;
}

/**
 * Fake "About" page — one of BrowserApp.tsx's 3 static mock pages. Links
 * back to both other pages, so every page in this trio reaches every other
 * one in at most one click.
 */
export function AboutPage({ onNavigate }: MockPageProps) {
  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4">
      <header className="flex items-center gap-2">
        <InfoIcon size={22} className="text-ink-muted" />
        <h1 className="text-ink text-xl font-semibold">About Pathfinder</h1>
      </header>
      <p className="text-ink-muted text-[13px] leading-relaxed">
        Pathfinder is a fictional search engine invented as demo content for this window —
        every page here, including this one, is static React markup rendered inside the
        Browser app. There is no network request behind any of it.
      </p>
      <p className="text-ink-muted text-[13px] leading-relaxed">
        Curious how it fits together? Read{" "}
        <MockLink onClick={() => onNavigate("wiki")}>Window managers, explained</MockLink>{" "}
        or head back to the{" "}
        <MockLink onClick={() => onNavigate("home")}>Pathfinder home page</MockLink>.
      </p>
    </div>
  );
}
