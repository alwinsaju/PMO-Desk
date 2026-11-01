"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeftIcon } from "@phosphor-icons/react";
import { useWindowContext } from "@/components/window-manager";
import { toolApps } from "@/components/taskbar/pinnedApps";
import { Button } from "@/components/ui";
import type { RegisterSummary } from "@/lib/registers/alerts";
import { registerById } from "@/lib/registers/defs";
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
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
        {toolApps.map((tool) => {
          const Glyph = tool.icon;
          const summary = summaries[tool.id];
          return (
            <li key={tool.id}>
              <button
                type="button"
                data-testid={`tool-card-${tool.id}`}
                onClick={() => setOpenId(tool.id)}
                className="border-line bg-card hover:bg-chip rounded-card flex h-full w-full flex-col gap-2 border px-4 py-3 text-left transition-colors"
              >
                <span className="flex items-center gap-2">
                  <Glyph size={20} className="text-accent shrink-0" />
                  <span className="text-ink text-[14px] font-semibold">{tool.title}</span>
                </span>
                <span className="text-ink-muted text-[12.5px] leading-snug">
                  {registerById(tool.id)?.blurb}
                </span>
                <span
                  className="text-ink-soft mt-auto text-[12.5px]"
                  data-testid={`tool-count-${tool.id}`}
                >
                  {summary ? `${summary.open} open` : "…"}
                  {summary && summary.late > 0 && (
                    <span className="text-red font-semibold"> · {summary.late} late</span>
                  )}
                  {summary && summary.soon > 0 && (
                    <span className="text-amber font-semibold">
                      {" "}
                      · {summary.soon} soon
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
