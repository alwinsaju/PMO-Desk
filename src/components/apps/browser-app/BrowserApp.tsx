"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowClockwiseIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  GlobeSimpleIcon,
  LockSimpleIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { IconButton, ScrollArea } from "@/components/ui";
import { useWindowContext } from "@/components/window-manager";
import { cn } from "@/lib/cn";
import { noSpellcheck } from "@/lib/ui/noSpellcheck";
import { readSetting, writeSetting } from "../staff-app/localSetting";
import { RECENTS_KEY, addRecent, parseRecents, type RecentSite } from "./browserRecents";
import {
  activeTab,
  closeTab,
  createTabs,
  currentEntry,
  entryAddress,
  goBack,
  goForward,
  openTab,
  pushEntry,
  reloadTab,
  selectTab,
  updateTab,
  type NavEntry,
  type Tab,
  type TabsState,
} from "./browserTabs";
import { TabStrip } from "./TabStrip";
import { initialMockPage, mockPageMeta, type MockPageId } from "./mockPages";
import { addressSecurity, hostnameOf } from "./embedFailure";
import { HomePage } from "./HomePage";
import { NewTabPage } from "./NewTabPage";
import { WikiPage } from "./WikiPage";
import { AboutPage } from "./AboutPage";
import { UrlPage } from "./UrlPage";
import { SearchOpenedPage } from "./SearchOpenedPage";
import { resolveBrowserInput } from "./resolveBrowserInput";
import { LoadBar } from "../web-app/EmbedStates";

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

/** A search runs in the OS browser: search engines refuse to be framed. */
function openInOsBrowser(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

/** Padlock for https only; a warning for plain http; a globe for the app's own pages. */
function AddressIcon({ url }: { url: string }) {
  const security = addressSecurity(url);
  const className = "text-ink-muted shrink-0";
  if (security === "secure") {
    return (
      <LockSimpleIcon size={14} className={className} aria-label="Secure connection" />
    );
  }
  if (security === "insecure") {
    return (
      <WarningIcon size={14} className="text-amber shrink-0" aria-label="Not secure" />
    );
  }
  return <GlobeSimpleIcon size={14} className={className} aria-hidden />;
}

/**
 * Root Browser window — matches the `AppComponent` contract
 * (`ComponentType<{ windowId: string }>`) and is registered under "browser"
 * in `index.ts`. Tabs (each with its own back/forward history, see
 * `browserTabs.ts`) around real browser chrome and an editable address bar.
 * A tab shows the 3 static "Pathfinder" mock pages, the new-tab page
 * (shortcuts and recent sites) or any real url typed into the address bar,
 * rendered by `UrlPage.tsx` with the same sandboxed-iframe-with-graceful-
 * fallback approach `WebAppWindow.tsx` uses for the App Store's real web
 * apps (see `src/lib/useEmbeddableUrl.ts`).
 *
 * Every tab stays mounted (inactive ones hidden), so a page keeps its state
 * while another tab is in front. All tabs live in one state object so a click
 * that truncates forward history and appends a page cannot be observed half done.
 */
export function BrowserApp({ windowId }: { windowId: string }) {
  const nextTabId = useRef(1);
  const [tabsState, setTabsState] = useState<TabsState>(() =>
    createTabs("tab-0", { kind: "mock", id: initialMockPage }),
  );
  const [recents, setRecents] = useState<RecentSite[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const reloadTimeoutRef = useRef<number | null>(null);
  const addressRef = useRef<HTMLInputElement>(null);
  // Populated as each real url's embeddability gets resolved, so
  // revisiting one via back/forward (or retyping it) shows it instantly
  // instead of re-running the header check. Plain ref, not state: nothing
  // needs to re-render when this fills in, only future lookups need it.
  const embedCacheRef = useRef<Map<string, boolean>>(new Map());

  useEffect(() => {
    setRecents(parseRecents(readSetting(RECENTS_KEY)));
    return () => {
      if (reloadTimeoutRef.current !== null) {
        window.clearTimeout(reloadTimeoutRef.current);
      }
    };
  }, []);

  const tab = activeTab(tabsState);
  const entry = currentEntry(tab);
  const currentUrl = entryAddress(entry);
  const canGoBack = tab.index > 0;
  const canGoForward = tab.index < tab.history.length - 1;
  useWindowContext(windowId, entry.kind === "url" ? hostnameOf(entry.url) : null);

  const [addressDraft, setAddressDraft] = useState(currentUrl);
  const [addressError, setAddressError] = useState<string | null>(null);
  // The address bar shows whatever was typed while it's being edited, but
  // snaps back to the real current url whenever navigation happens through
  // any OTHER means (back/forward, reload, a mock page's own in-page
  // links, another tab) — same as a real browser's omnibox.
  useEffect(() => {
    setAddressDraft(currentUrl);
    setAddressError(null);
  }, [currentUrl, tab.id]);
  useEffect(() => {
    if (entry.kind === "newtab") addressRef.current?.focus();
  }, [entry.kind, tab.id]);

  const changeActive = (change: (t: Tab) => Tab) =>
    setTabsState((s) => updateTab(s, s.activeId, change));

  function navigate(next: NavEntry) {
    if (next.kind === "url") {
      const list = addRecent(recents, next.url, Date.now());
      setRecents(list);
      writeSetting(RECENTS_KEY, JSON.stringify(list));
    }
    changeActive((t) => pushEntry(t, next));
  }

  function navigateToAddress(raw: string) {
    const mockId = findMockPageByUrl(raw.trim());
    if (mockId) {
      setAddressError(null);
      navigate({ kind: "mock", id: mockId });
      return;
    }
    const input = resolveBrowserInput(raw);
    if (input.kind === "empty") return;
    if (input.kind === "blocked") {
      setAddressError(input.reason);
      return;
    }
    setAddressError(null);
    if (input.kind === "search") {
      openInOsBrowser(input.url);
      navigate({ kind: "search", url: input.url, query: input.query });
      return;
    }
    navigate({ kind: "url", url: input.url });
  }

  function reload() {
    setIsLoading(true);
    if (reloadTimeoutRef.current !== null) window.clearTimeout(reloadTimeoutRef.current);
    reloadTimeoutRef.current = window.setTimeout(() => {
      setIsLoading(false);
    }, RELOAD_DURATION_MS);
    // Mock pages are static React with nothing to actually reload — the
    // spin above is the whole effect. A real url instead gets a genuine
    // reload: bumping the count remounts UrlPage (see its `key` below),
    // which throws away its iframe and starts a fresh load.
    if (entry.kind === "url") changeActive(reloadTab);
  }

  const handleEmbeddableResolved = useCallback((url: string, embeddable: boolean) => {
    // Only successes are cached: a refusal's reason is shown from a fresh check.
    if (embeddable) embedCacheRef.current.set(url, true);
  }, []);

  const clearRecents = () => {
    setRecents([]);
    writeSetting(RECENTS_KEY, "[]");
  };

  const renderPage = (t: Tab) => {
    const page = currentEntry(t);
    if (page.kind === "newtab") {
      return (
        <ScrollArea className="h-full">
          <NewTabPage
            recents={recents}
            onOpen={navigate}
            onSearch={navigateToAddress}
            onClearRecents={clearRecents}
          />
        </ScrollArea>
      );
    }
    if (page.kind === "mock") {
      return (
        <>
          {isLoading && t.id === tab.id && <LoadBar />}
          <ScrollArea className="h-full">
            <div
              className={cn(
                "transition-opacity duration-150",
                isLoading && t.id === tab.id && "opacity-40",
              )}
            >
              {page.id === "home" && (
                <HomePage onNavigate={(id) => navigate({ kind: "mock", id })} />
              )}
              {page.id === "wiki" && (
                <WikiPage onNavigate={(id) => navigate({ kind: "mock", id })} />
              )}
              {page.id === "about" && (
                <AboutPage onNavigate={(id) => navigate({ kind: "mock", id })} />
              )}
            </div>
          </ScrollArea>
        </>
      );
    }
    if (page.kind === "search") {
      return (
        <SearchOpenedPage
          query={page.query}
          onOpenAgain={() => openInOsBrowser(page.url)}
        />
      );
    }
    return (
      <UrlPage
        key={`${page.url}::${t.reloads}`}
        url={page.url}
        knownEmbeddable={embedCacheRef.current.get(page.url)}
        onEmbeddableResolved={handleEmbeddableResolved}
        onRetry={() => setTabsState((s) => updateTab(s, t.id, reloadTab))}
      />
    );
  };

  return (
    <div data-window-id={windowId} className="flex h-full w-full flex-col">
      <TabStrip
        state={tabsState}
        onSelect={(id) => setTabsState((s) => selectTab(s, id))}
        onClose={(id) =>
          setTabsState((s) => closeTab(s, id, `tab-${nextTabId.current++}`))
        }
        onNew={() =>
          setTabsState((s) =>
            openTab(s, `tab-${nextTabId.current++}`, { kind: "newtab" }),
          )
        }
      />
      <div className="px-gutter flex items-center gap-1.5 pt-1 pb-3">
        <IconButton
          aria-label="Back"
          variant="ghost"
          disabled={!canGoBack}
          onClick={() => changeActive(goBack)}
        >
          <ArrowLeftIcon size={18} />
        </IconButton>
        <IconButton
          aria-label="Forward"
          variant="ghost"
          disabled={!canGoForward}
          onClick={() => changeActive(goForward)}
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
          <AddressIcon url={currentUrl} />
          <input
            ref={addressRef}
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
            placeholder="Search or type a web address"
            {...noSpellcheck}
            className="text-ink-soft placeholder:text-ink-faint min-w-0 flex-1 bg-transparent font-mono text-[12.5px] outline-none"
          />
        </form>
      </div>
      {addressError && (
        <p role="alert" className="text-red px-gutter pb-2 text-[12.5px]">
          {addressError}
        </p>
      )}

      {/* Page area. The loading bar hugs its top edge (right under the
          toolbar): a real url's own check/iframe load draws it inside
          UrlPage, a reload of a static mock page draws it here. */}
      <div className="border-line relative min-h-0 flex-1 border-t">
        {tabsState.tabs.map((t) => (
          <div
            key={t.id}
            hidden={t.id !== tabsState.activeId}
            role="tabpanel"
            aria-labelledby={`browser-tab-${t.id}`}
            className="relative h-full"
          >
            {renderPage(t)}
          </div>
        ))}
      </div>
    </div>
  );
}
