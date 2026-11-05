"use client";

import { MagnifyingGlassIcon, XIcon } from "@phosphor-icons/react";
import { IconButton } from "@/components/ui";
import { highlightParts } from "@/lib/search/highlight";
import { noSpellcheck } from "@/lib/ui/noSpellcheck";
import { pathOf, searchSettings, type SettingEntry } from "@/lib/settings/settingsIndex";

/** The "Search settings" box at the top of the Settings window. */
export function SettingsSearchBox({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="border-line bg-chip rounded-control focus-within:border-accent flex min-w-48 flex-1 items-center gap-2 border px-3">
      <MagnifyingGlassIcon size={16} className="text-ink-muted shrink-0" aria-hidden />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && value) {
            e.preventDefault();
            e.stopPropagation();
            onChange("");
          }
        }}
        aria-label="Search settings"
        placeholder="Search settings"
        {...noSpellcheck}
        className="text-ink placeholder:text-ink-muted h-9 min-w-0 flex-1 bg-transparent text-[13.5px] outline-none [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <IconButton aria-label="Clear search" size="sm" onClick={() => onChange("")}>
          <XIcon size={14} />
        </IconButton>
      )}
    </div>
  );
}

function Marked({ text, query }: { text: string; query: string }) {
  return highlightParts(text, query).map((part, i) =>
    part.match ? (
      <mark key={i} className="bg-amber-soft text-ink rounded-[3px] px-px">
        {part.text}
      </mark>
    ) : (
      <span key={i}>{part.text}</span>
    ),
  );
}

/** The settings that match: each row names where it lives and jumps there when chosen. */
export function SettingsSearchResults({
  query,
  onPick,
}: {
  query: string;
  onPick: (entry: SettingEntry) => void;
}) {
  const found = searchSettings(query);
  if (found.length === 0) {
    return (
      <p role="status" className="text-ink-muted py-8 text-center text-[13px]">
        No setting matches “{query.trim()}”. Try a shorter word, like “backup” or “lock”.
      </p>
    );
  }
  return (
    <div>
      <p role="status" className="text-ink-muted pb-2 text-[12.5px]">
        {found.length === 1 ? "1 setting matches" : `${found.length} settings match`}
      </p>
      <ul className="flex flex-col gap-2">
        {found.map((item) => (
          <li key={item.id}>
            {item.elsewhere ? (
              <div className="border-line bg-card rounded-control flex w-full flex-col gap-0.5 border px-4 py-3 text-left">
                <span className="text-ink-muted text-[11.5px] font-bold tracking-[0.06em] uppercase">
                  Not in this window: {pathOf(item)}
                </span>
                <span className="text-ink text-[14px] font-semibold">
                  <Marked text={item.title} query={query} />
                </span>
                <span className="text-ink-muted text-[12.5px]">
                  <Marked text={item.hint} query={query} />
                </span>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => onPick(item)}
                className="border-line bg-card hover:bg-chip rounded-control focus-ring flex w-full flex-col gap-0.5 border px-4 py-3 text-left"
              >
                <span className="text-ink-muted text-[11.5px] font-bold tracking-[0.06em] uppercase">
                  {pathOf(item)}
                </span>
                <span className="text-ink text-[14px] font-semibold">
                  <Marked text={item.title} query={query} />
                </span>
                <span className="text-ink-muted text-[12.5px]">
                  <Marked text={item.hint} query={query} />
                </span>
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
