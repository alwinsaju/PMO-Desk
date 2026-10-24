"use client";

import { ArticleLayout, ArticleParagraph } from "./ArticleLayout";
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
    <ArticleLayout kicker="About" title="About Pathfinder">
      <ArticleParagraph>
        Pathfinder is a fictional search engine invented as demo content for this window —
        every page here, including this one, is static React markup rendered inside the
        Browser app. There is no network request behind any of it.
      </ArticleParagraph>
      <ArticleParagraph>
        Curious how it fits together? Read{" "}
        <MockLink onClick={() => onNavigate("wiki")}>Window managers, explained</MockLink>{" "}
        or head back to the{" "}
        <MockLink onClick={() => onNavigate("home")}>Pathfinder home page</MockLink>.
      </ArticleParagraph>
    </ArticleLayout>
  );
}
