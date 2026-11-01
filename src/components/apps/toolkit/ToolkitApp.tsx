"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeftIcon } from "@phosphor-icons/react";
import { useWindowContext } from "@/components/window-manager";
import { toolApps } from "@/components/taskbar/pinnedApps";
import { Badge, Button } from "@/components/ui";
import type { RegisterSummary } from "@/lib/registers/alerts";
import { registerById } from "@/lib/registers/defs";
import { groupTools } from "@/lib/registers/layout";
import { fetchSummaries } from "./registersApi";
import { toolComponent } from "./tools";

const REFRESH_MS = 30_000;

/** The PMO Toolkit: one card per tool with how many items are open and late. A tool opens
 *  in this same window, with a Back button, so it never sits half over its parent. */
export function ToolkitApp({ windowId }: { windowId: string }) {
  const [summaries, setSummaries] = useState<Record<string, RegisterSummary>>({});
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const open = toolApps.find((tool) => tool.id === openId) ?? null;
  useWindowContext(windowId, open?.title ?? null);

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
              void load();
            }}
          >
            <ArrowLeftIcon size={14} weight="bold" />
            All tools
          </Button>
        </div>
        <div className="min-h-0 flex-1">
          <Tool windowId={windowId} />
        </div>
      </div>
    );
  }

  return (
    <div
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
      <div className="flex flex-col gap-6">
        {groupTools(toolApps).map((group) => (
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
                  <li key={tool.id}>
                    <button
                      type="button"
                      data-testid={`tool-card-${tool.id}`}
                      onClick={() => setOpenId(tool.id)}
                      className="border-line bg-card hover:bg-chip focus-ring rounded-card flex h-full w-full items-start gap-3 border px-4 py-3 text-left transition-colors"
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
