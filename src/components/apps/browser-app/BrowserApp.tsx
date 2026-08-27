"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowClockwiseIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  LockSimpleIcon,
} from "@phosphor-icons/react";
import { IconButton, ScrollArea } from "@/components/ui";
import { cn } from "@/lib/cn";
import { mockPageMeta, type MockPageId } from "./mockPages";
import { HomePage } from "./HomePage";
import { WikiPage } from "./WikiPage";
import { AboutPage } from "./AboutPage";

interface NavState {
  history: MockPageId[];
  index: number;
}

const RELOAD_DURATION_MS = 400;

/**
 * Root Browser window — matches the `AppComponent` contract
 * (`ComponentType<{ windowId: string }>`) and is registered under "browser"
 * in `index.ts`. A fake browser chrome (back/forward/reload + a read-only
 * address bar) around 3 static "mock page" templates authored as plain
 * React (HomePage/WikiPage/AboutPage) — deliberately not real iframes or
 * any cross-origin embedding, per this package's brief.
 *
 * `nav` is a single state object (history stack + current index) rather
 * than two separate `useState`s, so a click that both truncates forward
 * history and appends a new page can never observe an inconsistent
 * in-between state.
 */
export function BrowserApp({ windowId }: { windowId: string }) {
  const [nav, setNav] = useState<NavState>({ history: ["home"], index: 0 });
  const [isLoading, setIsLoading] = useState(false);
  const reloadTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (reloadTimeoutRef.current !== null) {
        window.clearTimeout(reloadTimeoutRef.current);
      }
    };
  }, []);

  const currentPage = nav.history[nav.index];
  const canGoBack = nav.index > 0;
  const canGoForward = nav.index < nav.history.length - 1;

  function navigate(id: MockPageId) {
    setNav((prev) => ({
      history: [...prev.history.slice(0, prev.index + 1), id],
      index: prev.index + 1,
    }));
  }

  function goBack() {
    setNav((prev) => ({ ...prev, index: Math.max(0, prev.index - 1) }));
  }

  function goForward() {
    setNav((prev) => ({
      ...prev,
      index: Math.min(prev.history.length - 1, prev.index + 1),
    }));
  }

  function reload() {
    setIsLoading(true);
    if (reloadTimeoutRef.current !== null) window.clearTimeout(reloadTimeoutRef.current);
    reloadTimeoutRef.current = window.setTimeout(() => {
      setIsLoading(false);
    }, RELOAD_DURATION_MS);
  }

  return (
    <div data-window-id={windowId} className="flex h-full w-full flex-col">
      <div className="border-border/60 flex items-center gap-1.5 border-b p-2">
        <IconButton
          aria-label="Back"
          variant="ghost"
          size="sm"
          disabled={!canGoBack}
          onClick={goBack}
        >
          <ArrowLeftIcon size={16} />
        </IconButton>
        <IconButton
          aria-label="Forward"
          variant="ghost"
          size="sm"
          disabled={!canGoForward}
          onClick={goForward}
        >
          <ArrowRightIcon size={16} />
        </IconButton>
        <IconButton aria-label="Reload page" variant="ghost" size="sm" onClick={reload}>
          <ArrowClockwiseIcon size={15} className={cn(isLoading && "animate-spin")} />
        </IconButton>
        <div className="border-border bg-surface ml-1 flex h-8 min-w-0 flex-1 items-center gap-2 rounded-full border px-3.5">
          <LockSimpleIcon size={11} weight="fill" className="text-ink-faint shrink-0" />
          <span className="text-ink-muted truncate font-mono text-[12px]">
            {mockPageMeta[currentPage].url}
          </span>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div
          className={cn("p-8 transition-opacity duration-150", isLoading && "opacity-40")}
        >
          {currentPage === "home" && <HomePage onNavigate={navigate} />}
          {currentPage === "wiki" && <WikiPage onNavigate={navigate} />}
          {currentPage === "about" && <AboutPage onNavigate={navigate} />}
        </div>
      </ScrollArea>
    </div>
  );
}
