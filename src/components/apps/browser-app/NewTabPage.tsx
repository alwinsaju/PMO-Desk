"use client";

import { useState } from "react";
import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { Button, Input } from "@/components/ui";
import { noSpellcheck } from "@/lib/ui/noSpellcheck";
import type { RecentSite } from "./browserRecents";
import type { NavEntry } from "./browserTabs";

const SHORTCUTS: { title: string; sub: string; entry: NavEntry }[] = [
  {
    title: "Pathfinder",
    sub: "The built-in search page",
    entry: { kind: "mock", id: "home" },
  },
  {
    title: "Window managers",
    sub: "A short article",
    entry: { kind: "mock", id: "wiki" },
  },
  {
    title: "Wikipedia",
    sub: "The free encyclopedia",
    entry: { kind: "url", url: "https://en.wikipedia.org/wiki/Main_Page" },
  },
  {
    title: "GitHub",
    sub: "Code hosting",
    entry: { kind: "url", url: "https://github.com/" },
  },
];

function Tile({
  label,
  sub,
  onOpen,
  testId,
}: {
  label: string;
  sub: string;
  onOpen: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid={testId}
      className="border-line bg-card hover:bg-chip focus-ring rounded-card flex w-full items-center gap-3 border px-3 py-2.5 text-left transition-colors"
    >
      <span
        aria-hidden
        className="bg-accent-soft text-accent-ink grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[15px] font-bold"
      >
        {label.charAt(0).toUpperCase()}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-ink truncate text-[13.5px] font-semibold">{label}</span>
        <span className="text-ink-muted truncate text-[12px]">{sub}</span>
      </span>
    </button>
  );
}

/** What a new tab shows: a search box, a few shortcuts and the sites visited most recently. */
export function NewTabPage({
  recents,
  onOpen,
  onSearch,
  onClearRecents,
}: {
  recents: readonly RecentSite[];
  onOpen: (entry: NavEntry) => void;
  onSearch: (text: string) => void;
  onClearRecents: () => void;
}) {
  const [text, setText] = useState("");
  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-7 px-6 py-10">
      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          onSearch(text);
        }}
      >
        <Input
          {...noSpellcheck}
          value={text}
          onChange={(event) => setText(event.target.value)}
          aria-label="Search or type a web address"
          placeholder="Search or type a web address"
          data-testid="newtab-search"
        />
        <Button type="submit" disabled={!text.trim()}>
          <MagnifyingGlassIcon size={16} weight="bold" />
          Go
        </Button>
      </form>

      <section aria-labelledby="newtab-shortcuts">
        <h2
          id="newtab-shortcuts"
          className="text-ink-muted mb-2 text-[11.5px] font-bold tracking-[0.06em] uppercase"
        >
          Shortcuts
        </h2>
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {SHORTCUTS.map((shortcut) => (
            <li key={shortcut.title}>
              <Tile
                label={shortcut.title}
                sub={shortcut.sub}
                testId={`shortcut-${shortcut.title}`}
                onOpen={() => onOpen(shortcut.entry)}
              />
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="newtab-recents">
        <div className="mb-2 flex items-center justify-between">
          <h2
            id="newtab-recents"
            className="text-ink-muted text-[11.5px] font-bold tracking-[0.06em] uppercase"
          >
            Recent sites
          </h2>
          {recents.length > 0 && (
            <Button variant="ghost" size="sm" onClick={onClearRecents}>
              Clear
            </Button>
          )}
        </div>
        {recents.length === 0 ? (
          <p className="text-ink-muted text-[13px]" data-testid="recents-empty">
            Sites you open will appear here.
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {recents.map((site) => (
              <li key={site.host}>
                <Tile
                  label={site.host}
                  sub={new URL(site.url).pathname.replace(/\/$/, "") || "Home page"}
                  testId={`recent-${site.host}`}
                  onOpen={() => onOpen({ kind: "url", url: site.url })}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
