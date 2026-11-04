"use client";

import { GaugeIcon, TrafficSignalIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import type { PortfolioRag, Scorecard } from "@/lib/dashboard/insights";
import { Chip } from "../pmo-todo-app/parts";
import { Empty, Widget } from "./widgets";

const RAG_TILES = [
  { key: "red", label: "Red", tone: "bg-red-soft text-red" },
  { key: "amber", label: "Amber", tone: "bg-amber-soft text-amber" },
  { key: "green", label: "Green", tone: "bg-success-soft text-success" },
] as const;

/** How many projects are Red, Amber and Green, from the status-report register; the Red and Amber ones are
 *  listed with what is off. `rag` is null until the register has been read; `failed` means it could not be. */
export function PortfolioRagWidget({
  rag,
  failed,
  onOpen,
}: {
  rag: PortfolioRag | null;
  failed: boolean;
  onOpen: () => void;
}) {
  const worrying = rag?.projects.filter((p) => p.rag !== "Green") ?? [];
  return (
    <Widget
      title="Portfolio RAG"
      icon={TrafficSignalIcon}
      count={rag && rag.total > 0 ? rag.red + rag.amber || undefined : undefined}
      countTone={rag && rag.red > 0 ? "danger" : "warning"}
      openLabel="Open status reports"
      onOpen={onOpen}
      testId="rag-widget"
    >
      {rag === null ? (
        <Empty neutral>
          {failed
            ? "Could not read the status report register."
            : "Reading the status reports…"}
        </Empty>
      ) : rag.total === 0 ? (
        <Empty neutral>
          No active projects in the status report register yet. Add one there to see its
          colour here.
        </Empty>
      ) : (
        <>
          <ul className="grid grid-cols-3 gap-2" aria-label="Projects by overall status">
            {RAG_TILES.map((t) => (
              <li
                key={t.key}
                className={cn(
                  "rounded-card flex flex-col items-center gap-0.5 px-2 py-2.5",
                  t.tone,
                )}
              >
                <span className="text-[24px] leading-none font-bold tabular-nums">
                  {rag[t.key]}
                </span>
                <span className="text-[12px] font-semibold">{t.label}</span>
              </li>
            ))}
          </ul>
          {worrying.length > 0 && (
            <ul className="flex flex-col gap-1">
              {worrying.slice(0, 5).map((p) => (
                <li key={p.id} className="flex items-center gap-2 text-[13px]">
                  <Chip tone={p.rag === "Red" ? "danger" : "warning"}>{p.rag}</Chip>
                  <span className="text-ink min-w-0 flex-1 truncate" title={p.project}>
                    {p.project}
                  </span>
                  <span className="text-ink-muted shrink-0 text-[12px]">
                    {p.which.join(", ")}
                  </span>
                </li>
              ))}
              {worrying.length > 5 && (
                <li className="text-ink-muted text-[12px]">
                  and {worrying.length - 5} more
                </li>
              )}
            </ul>
          )}
          <p className="text-ink-muted text-[11.5px]">
            A project takes the worst of its schedule, budget and scope. Closed projects
            are left out
            {rag.collapsed > 0
              ? `; ${rag.collapsed} older row${rag.collapsed === 1 ? "" : "s"} for a project already counted ${rag.collapsed === 1 ? "is" : "are"} not counted again`
              : ""}
            .
          </p>
        </>
      )}
    </Widget>
  );
}

const STATE_TEXT = {
  late: "text-red",
  soon: "text-amber",
  clear: "text-ink-muted",
} as const;

/** Late and soon per register, for the registers that have an alert rule. Reads the counts the toolkit
 *  already keeps fresh, so it needs no fetch of its own. `loaded` is false until the first answer. */
export function ScorecardWidget({
  card,
  loaded,
  onOpen,
}: {
  card: Scorecard;
  loaded: boolean;
  onOpen: (toolId: string) => void;
}) {
  return (
    <Widget
      title="PMO health scorecard"
      icon={GaugeIcon}
      count={loaded ? `${card.clear} of ${card.rows.length} clear` : undefined}
      countTone={card.late > 0 ? "danger" : card.soon > 0 ? "warning" : "success"}
      testId="scorecard-widget"
    >
      {!loaded ? (
        <Empty neutral>Looking at your tools…</Empty>
      ) : (
        <>
          <ul className="flex flex-col gap-1">
            {card.rows.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => onOpen(row.id)}
                  className="hover:bg-chip focus-visible:ring-focus rounded-control flex w-full items-center gap-2 px-2 py-1 text-left text-[13px] outline-none focus-visible:ring-2"
                >
                  <span className="text-ink min-w-0 flex-1 truncate">{row.title}</span>
                  {row.state === "clear" ? (
                    <span className={cn("text-[12.5px]", STATE_TEXT.clear)}>Clear</span>
                  ) : (
                    <>
                      {row.late > 0 && (
                        <span className={cn("font-semibold", STATE_TEXT.late)}>
                          {row.late} late
                        </span>
                      )}
                      {row.soon > 0 && (
                        <span className={cn("font-semibold", STATE_TEXT.soon)}>
                          {row.soon} soon
                        </span>
                      )}
                    </>
                  )}
                </button>
              </li>
            ))}
          </ul>
          <p className="text-ink-muted text-[11.5px]">
            Only the {card.rows.length} tools that have alert rules are counted; the other
            tools never flag anything as late. This is not the Report health card, which
            scores Tasks reports.
          </p>
        </>
      )}
    </Widget>
  );
}
