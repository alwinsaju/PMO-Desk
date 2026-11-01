"use client";

import { ToolboxIcon } from "@phosphor-icons/react";
import { toolApps } from "@/components/taskbar/pinnedApps";
import { useRegisterSummaries } from "@/components/apps/toolkit/summariesStore";
import { Empty, Widget } from "./widgets";

/** What is late or due soon across the PMO toolkit's tools; each line opens that tool. */
export function RegistersWidget({ onOpen }: { onOpen: (toolId: string) => void }) {
  const summaries = useRegisterSummaries((s) => s.summaries);
  const loaded = useRegisterSummaries((s) => s.loaded);
  const rows = toolApps
    .map((tool) => ({ tool, summary: summaries[tool.id] }))
    .filter((r) => r.summary && (r.summary.late > 0 || r.summary.soon > 0))
    .sort(
      (a, b) => b.summary!.late - a.summary!.late || b.summary!.soon - a.summary!.soon,
    );
  const late = rows.reduce((n, r) => n + r.summary!.late, 0);
  return (
    <Widget
      title="PMO toolkit"
      icon={ToolboxIcon}
      count={late || undefined}
      testId="registers-widget"
    >
      {!loaded ? (
        <Empty neutral>Looking at your tools…</Empty>
      ) : rows.length === 0 ? (
        <Empty>Nothing in your PMO tools is late or due soon.</Empty>
      ) : (
        <ul className="flex flex-col gap-1">
          {rows.map(({ tool, summary }) => (
            <li key={tool.id}>
              <button
                type="button"
                onClick={() => onOpen(tool.id)}
                className="hover:bg-chip focus-visible:ring-focus rounded-control flex w-full items-center gap-2 px-2 py-1 text-left text-[13px] outline-none focus-visible:ring-2"
              >
                <span className="text-ink min-w-0 flex-1 truncate">{tool.title}</span>
                {summary!.late > 0 && (
                  <span className="text-red font-semibold">{summary!.late} late</span>
                )}
                {summary!.soon > 0 && (
                  <span className="text-amber font-semibold">{summary!.soon} soon</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Widget>
  );
}
