"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { NOT_SET, donutArcs, type Slice } from "@/lib/staff/insightsData";

const PALETTE = [
  { bg: "bg-accent", stroke: "stroke-accent" },
  { bg: "bg-info", stroke: "stroke-info" },
  { bg: "bg-amber", stroke: "stroke-amber" },
  { bg: "bg-success-dot", stroke: "stroke-success-dot" },
  { bg: "bg-red", stroke: "stroke-red" },
] as const;
const UNSET = { bg: "bg-ink-faint", stroke: "stroke-ink-faint" } as const;

const colourOf = (slice: Slice, index: number) =>
  slice.label === NOT_SET ? UNSET : PALETTE[index % PALETTE.length];

const percent = (share: number) => `${Math.round(share * 100)}%`;

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section
      aria-label={title}
      className="border-line bg-card rounded-card flex min-w-0 flex-col gap-3 border px-4 py-3.5"
    >
      <h4 className="text-ink text-[13.5px] font-bold">{title}</h4>
      {children}
    </section>
  );
}

/** Horizontal bars, each as long as its count against the biggest group. */
export function BarChartCard({
  title,
  slices,
}: {
  title: string;
  slices: readonly Slice[];
}) {
  const biggest = Math.max(1, ...slices.map((s) => s.count));
  return (
    <Card title={title}>
      {slices.length === 0 ? (
        <p className="text-ink-muted text-[13px]">Nobody yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {slices.map((slice, index) => (
            <li
              key={slice.label}
              className="flex items-center gap-3 text-[12.5px]"
              title={`${slice.label}: ${slice.count} (${percent(slice.share)})`}
            >
              <span className="text-ink-soft w-[110px] shrink-0 truncate font-medium">
                {slice.label}
              </span>
              <span className="bg-chip h-2.5 flex-1 overflow-hidden rounded-full">
                <span
                  className={cn("block h-full rounded-full", colourOf(slice, index).bg)}
                  style={{ width: `${(slice.count / biggest) * 100}%` }}
                />
              </span>
              <span className="text-ink w-[52px] shrink-0 text-right font-bold">
                {slice.count}
                <span className="text-ink-muted ml-1 font-normal">
                  {percent(slice.share)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** A ring split by share, with the total in the middle and a key beside it. */
export function DonutCard({
  title,
  slices,
  total,
}: {
  title: string;
  slices: readonly Slice[];
  total: number;
}) {
  const arcs = donutArcs(slices);
  return (
    <Card title={title}>
      {slices.length === 0 ? (
        <p className="text-ink-muted text-[13px]">Nobody yet.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-4">
          <svg
            viewBox="0 0 44 44"
            role="img"
            aria-label={slices
              .map((s) => `${s.label} ${s.count} (${percent(s.share)})`)
              .join(", ")}
            className="h-[112px] w-[112px] shrink-0 -rotate-90"
          >
            <circle
              cx="22"
              cy="22"
              r="16"
              pathLength={100}
              fill="none"
              strokeWidth="7"
              className="stroke-chip"
            />
            {slices.map((slice, index) => (
              <circle
                key={slice.label}
                cx="22"
                cy="22"
                r="16"
                pathLength={100}
                fill="none"
                strokeWidth="7"
                strokeDasharray={`${arcs[index].length} ${100 - arcs[index].length}`}
                strokeDashoffset={-arcs[index].offset}
                className={colourOf(slice, index).stroke}
              />
            ))}
            <text
              x="22"
              y="22"
              textAnchor="middle"
              dominantBaseline="central"
              transform="rotate(90 22 22)"
              className="fill-ink text-[9px] font-bold"
            >
              {total}
            </text>
          </svg>
          <ul className="flex min-w-0 flex-1 flex-col gap-1.5 text-[12.5px]">
            {slices.map((slice, index) => (
              <li key={slice.label} className="flex items-center gap-2">
                <span
                  aria-hidden
                  className={cn(
                    "h-2.5 w-2.5 shrink-0 rounded-full",
                    colourOf(slice, index).bg,
                  )}
                />
                <span className="text-ink-soft truncate font-medium">{slice.label}</span>
                <span className="text-ink ml-auto font-bold">
                  {slice.count}
                  <span className="text-ink-muted ml-1 font-normal">
                    {percent(slice.share)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
