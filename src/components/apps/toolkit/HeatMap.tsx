"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { heatmap, type HeatCell } from "@/lib/registers/heatmap";
import type { RegisterDef, RegisterRecord } from "@/lib/registers/types";
import { readSetting, writeSetting } from "../staff-app/localSetting";

const toneClass = {
  success: "bg-success-soft text-success",
  warning: "bg-amber-soft text-amber",
  danger: "bg-red-soft text-red",
} as const;

export interface HeatSelection {
  row: string;
  col: string;
}

/** Open records counted by the definition's two level fields (RAID: impact x likelihood).
 *  A cell filters the list to its records; clicking it again clears the filter. */
export function HeatMap({
  def,
  items,
  selected,
  onSelect,
}: {
  def: RegisterDef;
  items: readonly RegisterRecord[];
  selected: HeatSelection | null;
  onSelect: (next: HeatSelection | null) => void;
}) {
  // On a short window the grid would leave no room for the list, so it starts folded there. A choice is remembered.
  const [folded, setFolded] = useState(() => {
    const saved = readSetting(`register-heat:${def.id}`);
    return saved ? saved === "folded" : window.innerHeight < 760;
  });
  const fold = (next: boolean) => {
    setFolded(next);
    writeSetting(`register-heat:${def.id}`, next ? "folded" : "open");
  };
  const map = heatmap(def, items);
  if (!map || !def.heat) return null;
  const label = (key: string) => def.fields.find((f) => f.key === key)?.label ?? key;
  const rowLabel = label(def.heat.rows);
  const colLabel = label(def.heat.cols);
  const filtering = selected ? ` · filtered to ${selected.row} ${selected.col}` : "";

  if (folded) {
    return (
      <section
        aria-label={`${rowLabel} by ${colLabel.toLowerCase()}, open ${def.title} items`}
        data-testid="register-heatmap"
        className="mx-6 mb-2 flex flex-wrap items-center gap-2"
      >
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={false}
          onClick={() => fold(false)}
        >
          Show heat map
        </Button>
        <span className="text-ink-muted text-[12px]">
          {map.total} open{filtering}
        </span>
        {selected && (
          <Button variant="ghost" size="sm" onClick={() => onSelect(null)}>
            Clear heat-map filter
          </Button>
        )}
      </section>
    );
  }

  return (
    <section
      aria-label={`${rowLabel} by ${colLabel.toLowerCase()}, open ${def.title} items`}
      data-testid="register-heatmap"
      className="border-line bg-card rounded-card mx-6 mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 border px-4 py-3"
    >
      <div className="max-w-52">
        <p className="text-ink text-[13px] font-semibold">Heat map</p>
        <p className="text-ink-muted text-[12px]">
          {map.total} open. Rows are {rowLabel.toLowerCase()}, columns{" "}
          {colLabel.toLowerCase()}. Select a cell to filter the list.
        </p>
        {map.unplaced > 0 && (
          <p className="text-ink-muted mt-1 text-[12px]" data-testid="heat-unplaced">
            {map.unplaced} more open {map.unplaced === 1 ? "item has" : "items have"} no{" "}
            {rowLabel.toLowerCase()} or {colLabel.toLowerCase()} set, so{" "}
            {map.unplaced === 1 ? "it is" : "they are"} not in the grid.
          </p>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="mt-1"
          aria-expanded
          onClick={() => fold(true)}
        >
          Hide heat map
        </Button>
      </div>
      <div className="grid grid-cols-[auto_repeat(3,3.5rem)] items-center gap-1 text-center text-[11.5px]">
        <span className="text-ink-muted col-span-full pl-[2.75rem] text-left font-semibold">
          {colLabel} →
        </span>
        <span />
        {map.cols.map((col) => (
          <span key={col} className="text-ink-muted">
            {col}
          </span>
        ))}
        {map.cells.map((row, index) => (
          <HeatRow
            key={map.rows[index]}
            label={map.rows[index]}
            rowLabel={rowLabel}
            colLabel={colLabel}
            cells={row}
            selected={selected}
            onSelect={onSelect}
          />
        ))}
      </div>
    </section>
  );
}

function HeatRow({
  label,
  rowLabel,
  colLabel,
  cells,
  selected,
  onSelect,
}: {
  label: string;
  rowLabel: string;
  colLabel: string;
  cells: HeatCell[];
  selected: HeatSelection | null;
  onSelect: (next: HeatSelection | null) => void;
}) {
  return (
    <>
      <span className="text-ink-muted pr-1 text-right">{label}</span>
      {cells.map((cell) => {
        const on = selected?.row === cell.row && selected.col === cell.col;
        return (
          <button
            key={cell.col}
            type="button"
            disabled={cell.count === 0 && !on}
            aria-pressed={on}
            aria-label={`${rowLabel} ${cell.row}, ${colLabel.toLowerCase()} ${cell.col}: ${cell.count} open`}
            data-testid={`heat-${cell.row}-${cell.col}`}
            onClick={() => onSelect(on ? null : { row: cell.row, col: cell.col })}
            className={cn(
              "focus-ring h-9 rounded-md text-[14px] font-semibold transition-colors",
              toneClass[cell.tone],
              cell.count === 0 && "opacity-40",
              on && "ring-ink ring-2",
            )}
          >
            {cell.count}
          </button>
        );
      })}
    </>
  );
}
