"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowClockwiseIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  LockSimpleIcon,
} from "@phosphor-icons/react";
import { IconButton, ScrollArea } from "@/components/ui";
import { cn } from "@/lib/cn";
import { initialMockPage, mockPageMeta, type MockPageId } from "./mockPages";
import { HomePage } from "./HomePage";
import { WikiPage } from "./WikiPage";
import { AboutPage } from "./AboutPage";
import { UrlPage } from "./UrlPage";
import { LoadBar } from "../web-app/EmbedStates";

/** One history entry is either one of the 3 static "Pathfinder" mock
 *  pages, or a real url the address bar (or a real page's own link)
 *  navigated to. Both kinds share the exact same back/forward/reload
 *  history stack below — there is no separate mock-only vs. url-only
 *  history, so e.g. home -> a real site -> back correctly lands you on
 *  home again either way. */
type NavEntry = { kind: "mock"; id: MockPageId } | { kind: "url"; url: string };

interface NavState {
  history: NavEntry[];
  index: number;
}

const RELOAD_DURATION_MS = 400;

/** Reverse lookup for typing one of the mock pages' own fake urls (e.g.
 *  "pathfinder://about") straight into the address bar — keeps that
 *  inside the mock pages instead of trying (and failing) to load
 *  "pathfinder://about" as a real iframe src. */
function findMockPageByUrl(value: string): MockPageId | null {
  const match = (Object.keys(mockPageMeta) as MockPageId[]).find(
    (id) => mockPageMeta[id].url === value,
  );
  return match ?? null;
}

/** Turns whatever a person actually types into an address bar into a
 *  loadable url: left alone if it already has a scheme (covers real
 *  `https://…` urls as well as the mock pages' own `pathfinder://…`
 *  ones), otherwise assumed to be a bare host/path and given `https://` —
 *  the same assumption every real browser's address bar makes for e.g.
 *  "en.wikipedia.org/wiki/Cat". Returns null for blank input. */
function normalizeAddressInput(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/**
 * Root Browser window — matches the `AppComponent` contract
 * (`ComponentType<{ windowId: string }>`) and is registered under "browser"
 * in `index.ts`. Real browser chrome (back/forward/reload + a real,
 * editable address bar) around two kinds of content sharing one history
 * stack: the 3 static "Pathfinder" mock pages authored as plain React
 * (HomePage/WikiPage/AboutPage, unchanged from before — still the default
 * home page) and, new, any real url typed into the address bar, rendered
 * by `UrlPage.tsx` using the exact sandboxed-iframe-with-graceful-fallback
 * approach `WebAppWindow.tsx` uses for the App Store's real web apps (see
 * `src/lib/useEmbeddableUrl.ts`, shared by both rather than duplicated).
 *
 * `nav` is a single state object (history stack + current index) rather
 * than two separate `useState`s, so a click that both truncates forward
 * history and appends a new page can never observe an inconsistent
 * in-between state.
 */
export function BrowserApp({ windowId }: { windowId: string }) {
  const [nav, setNav] = useState<NavState>({
    history: [{ kind: "mock", id: initialMockPage }],
    index: 0,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const reloadTimeoutRef = useRef<number | null>(null);
  // Populated as each real url's embeddability gets resolved, so
  // revisiting one via back/forward (or retyping it) shows it instantly
  // instead of re-running the header check. Plain ref, not state: nothing
  // needs to re-render when this fills in, only future lookups need it.
  const embedCacheRef = useRef<Map<string, boolean>>(new Map());

  useEffect(() => {
    return () => {
      if (reloadTimeoutRef.current !== null) {
        window.clearTimeout(reloadTimeoutRef.current);
      }
    };
  }, []);

  const currentEntry = nav.history[nav.index];
  const currentUrl =
    currentEntry.kind === "mock" ? mockPageMeta[currentEntry.id].url : currentEntry.url;
  const canGoBack = nav.index > 0;
  const canGoForward = nav.index < nav.history.length - 1;

  const [addressDraft, setAddressDraft] = useState(currentUrl);
  // The address bar shows whatever was typed while it's being edited, but
  // snaps back to the real current url whenever navigation happens through
  // any OTHER means (back/forward, reload, a mock page's own in-page
  // links) — same as a real browser's omnibox.
  useEffect(() => {
    setAddressDraft(currentUrl);
  }, [currentUrl]);

  function pushEntry(entry: NavEntry) {
    setNav((prev) => ({
      history: [...prev.history.slice(0, prev.index + 1), entry],
      index: prev.index + 1,
    }));
  }

  function navigateMock(id: MockPageId) {
    pushEntry({ kind: "mock", id });
  }

  function navigateToAddress(raw: string) {
    const normalized = normalizeAddressInput(raw);
    if (!normalized) return;
    const mockId = findMockPageByUrl(normalized);
    pushEntry(mockId ? { kind: "mock", id: mockId } : { kind: "url", url: normalized });
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
    // Mock pages are static React with nothing to actually reload — the
    // spin above is the whole effect, same as before. A real url instead
    // gets a genuine reload: bumping this remounts UrlPage (see its `key`
    // below), which throws away its iframe and starts a fresh load.
    if (currentEntry.kind === "url") setReloadNonce((n) => n + 1);
  }

  const handleEmbeddableResolved = useCallback((url: string, embeddable: boolean) => {
    embedCacheRef.current.set(url, embeddable);
  }, []);

  return (
    <div data-window-id={windowId} className="flex h-full w-full flex-col">
      <div className="px-gutter flex items-center gap-1.5 pt-1 pb-3">
        <IconButton
          aria-label="Back"
          variant="ghost"
          disabled={!canGoBack}
          onClick={goBack}
        >
          <ArrowLeftIcon size={18} />
        </IconButton>
        <IconButton
          aria-label="Forward"
          variant="ghost"
          disabled={!canGoForward}
          onClick={goForward}
        >
          <ArrowRightIcon size={18} />
        </IconButton>
        <IconButton aria-label="Reload page" variant="ghost" onClick={reload}>
          <ArrowClockwiseIcon size={18} className={cn(isLoading && "animate-spin")} />
        </IconButton>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            navigateToAddress(addressDraft);
          }}
          className={cn(
            "rounded-bar bg-chip ease-smooth ml-1.5 flex h-[38px] min-w-0 flex-1 items-center gap-2.5 px-4 transition-[background-color,box-shadow] duration-200",
            "hover:shadow-[inset_0_0_0_1px_var(--color-line-strong)]",
            "focus-within:bg-field focus-within:shadow-[inset_0_0_0_1px_var(--color-focus),0_0_0_4px_var(--color-accent-soft)]",
          )}
        >
          <LockSimpleIcon size={14} className="text-ink-muted shrink-0" />
          <input
            value={addressDraft}
            onChange={(event) => setAddressDraft(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            onKeyDown={(event) => {
              // Handled explicitly rather than left to the form's native
              // implicit-submit-on-Enter alone — preventDefault here also
              // suppresses that native submission, so this is still the
              // only place Enter triggers a navigation from, not a second,
              // redundant one.
              if (event.key === "Enter") {
                event.preventDefault();
                navigateToAddress(addressDraft);
              } else if (event.key === "Escape") {
                setAddressDraft(currentUrl);
              }
            }}
            onBlur={() => setAddressDraft(currentUrl)}
            aria-label="Address"
            spellCheck={false}
            autoComplete="off"
            className="text-ink-soft placeholder:text-ink-faint min-w-0 flex-1 bg-transparent font-mono text-[12.5px] outline-none"
          />
        </form>
      </div>

      {/* Page area. The loading bar hugs its top edge (right under the
          toolbar): a real url's own check/iframe load draws it inside
          UrlPage, a reload of a static mock page draws it here. */}
      <div className="border-line relative min-h-0 flex-1 border-t">
        {currentEntry.kind === "mock" ? (
          <>
            {isLoading && <LoadBar />}
            <ScrollArea className="h-full">
              <div
                className={cn(
                  "transition-opacity duration-150",
                  isLoading && "opacity-40",
                )}
              >
                {currentEntry.id === "home" && <HomePage onNavigate={navigateMock} />}
                {currentEntry.id === "wiki" && <WikiPage onNavigate={navigateMock} />}
                {currentEntry.id === "about" && <AboutPage onNavigate={navigateMock} />}
              </div>
            </ScrollArea>
          </>
        ) : (
          <UrlPage
            key={`${currentEntry.url}::${reloadNonce}`}
            url={currentEntry.url}
            knownEmbeddable={embedCacheRef.current.get(currentEntry.url)}
            onEmbeddableResolved={handleEmbeddableResolved}
          />
        )}
      </div>
    </div>
  );
}
