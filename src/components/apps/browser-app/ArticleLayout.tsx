"use client";

import type { ReactNode } from "react";

interface ArticleLayoutProps {
  /** Small uppercase label above the title ("Encyclopedia", "About"). */
  kicker: string;
  title: string;
  children: ReactNode;
}

/**
 * Shared reading layout for the Browser's article-style mock pages (Wiki,
 * About): a 760px column with an accent kicker, a headline, a gradient
 * cover banner and relaxed 16px body copy. The cover is the one place the
 * Deloitte brand differs structurally from the default (green -> neon -> blue
 * instead of the indigo -> violet -> mint gradient), hence the `brand-dl:`.
 */
export function ArticleLayout({ kicker, title, children }: ArticleLayoutProps) {
  return (
    <article className="mx-auto flex max-w-[760px] flex-col px-7 pt-9 pb-[60px]">
      <span className="text-accent-ink text-[12px] font-bold tracking-[0.1em] uppercase">
        {kicker}
      </span>
      <h1 className="font-headline text-ink mt-1 mb-1.5 text-[40px] leading-[1.1] tracking-[-0.035em]">
        {title}
      </h1>
      <div
        aria-hidden
        className="rounded-surface brand-dl:bg-[linear-gradient(120deg,#86bc25,#86eb22_45%,#00a3e0)] mt-5 h-[190px] bg-[linear-gradient(120deg,#3d4fd6,#8a5bff_40%,#3dd6a3_80%)] opacity-90"
      />
      {children}
    </article>
  );
}

/** One paragraph of article body copy. */
export function ArticleParagraph({ children }: { children: ReactNode }) {
  return <p className="text-ink-soft mt-3.5 text-[16px] leading-[1.75]">{children}</p>;
}
