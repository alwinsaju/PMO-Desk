"use client";

import { ArticleLayout, ArticleParagraph } from "./ArticleLayout";
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
    <ArticleLayout kicker="Encyclopedia" title="Window managers, explained">
      <ArticleParagraph>
        A window manager is the layer of an operating system responsible for the placement
        and appearance of windows — deciding how they get moved, resized, stacked,
        minimized, and closed. Most desktop environments keep this concern separate from
        individual applications, so any app can be dragged or resized the same way as any
        other.
      </ArticleParagraph>
      <ArticleParagraph>
        Browser-based desktop environments reimplement a small version of this idea
        entirely in the DOM — tracking each window&rsquo;s position, size, and focus order
        in ordinary application state instead of talking to a real OS compositor.
      </ArticleParagraph>
      <ArticleParagraph>
        See also:{" "}
        <MockLink onClick={() => onNavigate("about")}>About Pathfinder</MockLink>.
      </ArticleParagraph>
      <footer className="border-line mt-8 border-t pt-4 text-[14px]">
        <MockLink onClick={() => onNavigate("home")}>← Back to Pathfinder home</MockLink>
      </footer>
    </ArticleLayout>
  );
}
