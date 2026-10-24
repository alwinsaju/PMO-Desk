"use client";

import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import type { MockPageId } from "./mockPages";

interface MockPageProps {
  onNavigate: (id: MockPageId) => void;
}

/** Banner gradients for the quick-link cards, default look vs the Deloitte
 *  brand palette (picked by the `brand-dl:` variant, no JS branching). */
const quickLinks: {
  id: Exclude<MockPageId, "home">;
  title: string;
  sub: string;
  banner: string;
}[] = [
  {
    id: "wiki",
    title: "Window managers, explained",
    sub: "How windows get placed and stacked",
    banner:
      "bg-[linear-gradient(135deg,#3d4fd6,#3dd6a3)] brand-dl:bg-[linear-gradient(145deg,#86bc25,#63c631)]",
  },
  {
    id: "about",
    title: "About Pathfinder",
    sub: "What this little search engine is",
    banner:
      "bg-[linear-gradient(135deg,#8fd8cc,#6aa0e8)] brand-dl:bg-[linear-gradient(145deg,#00a3e0,#3fc3ec)]",
  },
];

/**
 * Fake search-engine landing page — one of BrowserApp.tsx's 3 static mock
 * pages. Entirely fictional (no real product), same spirit as the App
 * Store's invented catalog of apps. The "search box" is decorative (there's
 * nothing to actually search); the two quick-link cards below it are this
 * page's only links, each handed to `onNavigate` by BrowserApp.tsx.
 */
export function HomePage({ onNavigate }: MockPageProps) {
  return (
    <div className="@container flex flex-col">
      <div className="px-gutter pt-[72px] pb-[26px] text-center">
        <h1 className="font-headline from-ink to-accent-ink bg-linear-to-br bg-clip-text text-[58px] leading-[1.1] tracking-[-0.045em] text-transparent">
          Pathfinder
        </h1>
        <p className="text-ink-muted mt-2 text-[16px]">Search the web, find your way.</p>
        <div className="rounded-bar bg-field border-line-strong text-ink-muted shadow-float-sm mx-auto mt-[26px] flex h-[52px] w-full max-w-[560px] items-center gap-3 border px-5 text-[15px]">
          <MagnifyingGlassIcon size={18} className="shrink-0" />
          <span className="truncate">Search or type a URL</span>
        </div>
      </div>

      <section
        aria-label="Popular right now"
        className="mx-auto grid w-full max-w-[640px] grid-cols-1 gap-3.5 px-12 pt-[30px] pb-10 @min-[560px]:grid-cols-2"
      >
        {quickLinks.map((link, i) => (
          <button
            key={link.id}
            type="button"
            onClick={() => onNavigate(link.id)}
            style={{ animationDelay: `${i * 60}ms` }}
            className={cn(
              "spot rounded-card bg-card border-line transition-ui flex flex-col gap-3 border p-[18px] text-left",
              "motion-safe:animate-rise hover:shadow-float-sm",
              "focus-visible:ring-focus outline-none focus-visible:ring-2",
            )}
          >
            <span aria-hidden className={cn("rounded-tile h-[84px]", link.banner)} />
            <span className="text-ink text-[14.5px] font-semibold">{link.title}</span>
            <span className="text-ink-muted -mt-2 text-[12.5px]">{link.sub}</span>
          </button>
        ))}
      </section>
    </div>
  );
}
