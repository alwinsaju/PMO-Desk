"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { ArrowLeftIcon, PlusIcon, PushPinIcon } from "@phosphor-icons/react";
import { useWindowContext } from "@/components/window-manager";
import { toolApps } from "@/components/taskbar/pinnedApps";
import { Badge, Button, IconButton, Input } from "@/components/ui";
import type { RegisterSummary } from "@/lib/registers/alerts";
import { REGISTER_IDS, registerById } from "@/lib/registers/defs";
import { groupTools } from "@/lib/registers/layout";
import { noSpellcheck } from "@/lib/ui/noSpellcheck";
import { handleRowKey } from "../rowNav";
import { fetchSummaries } from "./registersApi";
import { quickAddLabel, supportsQuickAdd } from "./toolkitQuickAdd";
import { toolComponent } from "./tools";
import {
  arrangeGroups,
  browserStorage,
  filterTools,
  loadToolkitMemory,
  saveLastTool,
  savePinned,
  togglePin,
} from "./toolkitView";

const REFRESH_MS = 30_000;
const TOOL_IDS = toolApps.map((tool) => tool.id);

/** The PMO Toolkit: one card per tool with how many items are open and late. A tool opens
 *  in this same window, with a Back button, so it never sits half over its parent. */
export function ToolkitApp({ windowId }: { windowId: string }) {
  const [summaries, setSummaries] = useState<Record<string, RegisterSummary>>({});
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  /** Set when the open tool was reached through a tile's plus button. Read once, by the tool
   *  as it mounts; the Back button clears it so the next open starts clean. */
  const [addOnOpen, setAddOnOpen] = useState(false);
  const [query, setQuery] = useState("");
  // Pins and the last-opened tool are per-viewer conveniences kept in this browser's
  // localStorage. They are read after mount so the first render matches the server's.
  const [pinned, setPinned] = useState<string[]>([]);
  const [lastId, setLastId] = useState<string | null>(null);
  const open = toolApps.find((tool) => tool.id === openId) ?? null;
  useWindowContext(windowId, open?.title ?? null);

  useEffect(() => {
    const memory = loadToolkitMemory(browserStorage(), TOOL_IDS);
    setPinned(memory.pinned);
    setLastId(memory.last);
  }, []);

  /** `adding`: open the tool with its Add dialog already showing (the tile's plus button). */
  const openTool = (id: string, adding = false) => {
    setOpenId(id);
    setAddOnOpen(adding && supportsQuickAdd(id, REGISTER_IDS));
    setLastId(id);
    saveLastTool(browserStorage(), id);
  };
  const pinTool = (id: string) => {
    const next = togglePin(pinned, id);
    setPinned(next);
    savePinned(browserStorage(), next);
  };

  const groups = useMemo(() => {
    const entries = toolApps.map((tool) => ({
      ...tool,
      blurb: registerById(tool.id)?.blurb,
    }));
    return arrangeGroups(groupTools(filterTools(entries, query)), pinned);
  }, [query, pinned]);
  const lastTool = toolApps.find((tool) => tool.id === lastId) ?? null;
  const gridRef = useRef<HTMLDivElement>(null);

  /** J/K, Home/End and E move between the tiles in the order shown (the arrows are left
   *  alone: in a grid they would mean a row or a column). Enter already opens a tile. */
  const handleTileKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(
      gridRef.current?.querySelectorAll<HTMLElement>("[data-tool-tile]") ?? [],
    );
    const row = (event.target as HTMLElement).closest("li");
    const current = row?.querySelector<HTMLElement>("[data-tool-tile]") ?? null;
    handleRowKey(event, items, current, { arrows: false });
  };

  const load = useCallback(async () => {
    const reply = await fetchSummaries();
    if (reply.ok) {
      setSummaries(Object.fromEntries(reply.summaries.map((s) => [s.id, s])));
      setError(null);
    } else setError(reply.reason);
  }, []);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  if (open) {
    const Tool = toolComponent(open.id);
    return (
      <div className="flex h-full w-full flex-col" data-testid="toolkit-open-tool">
        <div className="px-6 pt-1 pb-1">
          <Button
            variant="ghost"
            size="sm"
            data-testid="toolkit-back"
            onClick={() => {
              setOpenId(null);
              setAddOnOpen(false);
              void load();
            }}
          >
            <ArrowLeftIcon size={14} weight="bold" />
            All tools
          </Button>
        </div>
        <div className="min-h-0 flex-1">
          <Tool windowId={windowId} startAdding={addOnOpen} />
        </div>
      </div>
    );
  }

  return (
    <div
      ref={gridRef}
      onKeyDown={handleTileKey}
      data-window-id={windowId}
      data-testid="toolkit"
      className="scroll-thin h-full w-full overflow-y-auto px-6 pb-6"
    >
      <p className="text-ink-muted mb-4 max-w-2xl text-[13px]">
        Small tools for the PMO routine. Each keeps its records on this computer, tells
        you what is late or due soon, and can turn an item into a to-do. Nothing is sent
        without you.
      </p>
      {error && (
        <p role="alert" className="text-red mb-3 text-[13px]">
          {error}
        </p>
      )}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input
          {...noSpellcheck}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && query) {
              event.preventDefault();
              event.stopPropagation();
              setQuery("");
            }
          }}
          placeholder="Filter tools"
          aria-label="Filter tools"
          data-testid="toolkit-filter"
          className="h-8 max-w-xs text-[13px]"
        />
        {lastTool && !query && (
          <Button
            variant="ghost"
            size="sm"
            data-testid="toolkit-resume"
            onClick={() => openTool(lastTool.id)}
          >
            Last opened: {lastTool.title}
          </Button>
        )}
      </div>
      {groups.length === 0 && (
        <p
          role="status"
          data-testid="toolkit-empty"
          className="text-ink-muted text-[13px]"
        >
          No tools match &ldquo;{query.trim()}&rdquo;. Clear the filter to see all{" "}
          {toolApps.length} tools.
        </p>
      )}
      <div className="flex flex-col gap-6">
        {groups.map((group) => (
          <section key={group.title} aria-labelledby={`toolkit-group-${group.title}`}>
            <h2
              id={`toolkit-group-${group.title}`}
              className="text-ink-muted mb-2 text-[11.5px] font-bold tracking-[0.06em] uppercase"
            >
              {group.title}
            </h2>
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
              {group.tools.map((tool) => {
                const Glyph = tool.icon;
                const summary = summaries[tool.id];
                return (
                  <li key={tool.id} className="relative">
                    <IconButton
                      size="sm"
                      aria-label={
                        pinned.includes(tool.id)
                          ? `Unpin ${tool.title}`
                          : `Pin ${tool.title} to the top`
                      }
                      aria-pressed={pinned.includes(tool.id)}
                      data-testid={`tool-pin-${tool.id}`}
                      onClick={() => pinTool(tool.id)}
                      className="absolute top-1.5 right-1.5"
                    >
                      <PushPinIcon
                        weight={pinned.includes(tool.id) ? "fill" : "regular"}
                      />
                    </IconButton>
                    <button
                      type="button"
                      data-tool-tile
                      data-testid={`tool-card-${tool.id}`}
                      onClick={() => openTool(tool.id)}
                      className="border-line bg-card hover:bg-chip focus-ring rounded-card flex h-full w-full items-start gap-3 border py-3 pr-11 pl-4 text-left transition-colors"
                    >
                      <span
                        aria-hidden
                        className="bg-accent-soft text-accent-ink grid h-9 w-9 shrink-0 place-items-center rounded-lg"
                      >
                        <Glyph size={20} weight="duotone" />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col gap-1">
                        <span className="text-ink text-[14px] font-semibold">
                          {tool.title}
                        </span>
                        <span className="text-ink-muted text-[12.5px] leading-snug">
                          {registerById(tool.id)?.blurb}
                        </span>
                        <span
                          className="mt-1 flex flex-wrap items-center gap-1.5"
                          data-testid={`tool-count-${tool.id}`}
                        >
                          <Badge variant={summary?.open ? "accent" : "neutral"}>
                            {summary ? `${summary.open} open` : "…"}
                          </Badge>
                          {summary && summary.late > 0 && (
                            <Badge variant="danger">{summary.late} late</Badge>
                          )}
                          {summary && summary.soon > 0 && (
                            <Badge variant="warning">{summary.soon} soon</Badge>
                          )}
                        </span>
                      </span>
                    </button>
                    {supportsQuickAdd(tool.id, REGISTER_IDS) && (
                      <IconButton
                        size="sm"
                        aria-label={quickAddLabel(tool.title)}
                        data-testid={`tool-add-${tool.id}`}
                        onClick={() => openTool(tool.id, true)}
                        className="absolute right-1.5 bottom-1.5"
                      >
                        <PlusIcon weight="bold" />
                      </IconButton>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
