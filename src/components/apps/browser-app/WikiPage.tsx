"use client";

import { BookOpenTextIcon } from "@phosphor-icons/react";
import { MockLink } from "./MockLink";
import type { MockPageId } from "./mockPages";

interface MockPageProps {
  onNavigate: (id: MockPageId) => void;
}

/**
 * Fake wiki article — one of BrowserApp.tsx's 3 static mock pages. Links to
 * "about" inline and back to "home" in the footer, so clicking through
 * from HomePage and back exercises both the address bar and the in-page
 * `MockLink`s.
 */
export function WikiPage({ onNavigate }: MockPageProps) {
  return (
    <article className="mx-auto flex max-w-lg flex-col gap-4">
      <header className="flex items-center gap-2">
        <BookOpenTextIcon size={22} className="text-ink-muted" />
        <h1 className="text-ink text-xl font-semibold">Window managers, explained</h1>
      </header>
      <p className="text-ink-muted text-[13px] leading-relaxed">
        A window manager is the layer of an operating system responsible for the placement
        and appearance of windows — deciding how they get moved, resized, stacked,
        minimized, and closed. Most desktop environments keep this concern separate from
        individual applications, so any app can be dragged or resized the same way as any
        other.
      </p>
      <p className="text-ink-muted text-[13px] leading-relaxed">
        Browser-based desktop environments reimplement a small version of this idea
        entirely in the DOM — tracking each window&rsquo;s position, size, and focus order
        in ordinary application state instead of talking to a real OS compositor.
      </p>
      <p className="text-ink-muted text-[13px] leading-relaxed">
        See also:{" "}
        <MockLink onClick={() => onNavigate("about")}>About Pathfinder</MockLink>.
      </p>
      <footer className="border-border/60 mt-2 border-t pt-3">
        <MockLink onClick={() => onNavigate("home")}>← Back to Pathfinder home</MockLink>
      </footer>
    </article>
  );
}
