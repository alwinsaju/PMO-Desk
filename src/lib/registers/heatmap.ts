// The count grid above a register (RAID: impact x likelihood). Pure; see registerView.test.mjs.
import { isOpen, textOf } from "./records.ts";
import type { RegisterDef, RegisterRecord } from "./types.ts";

export interface HeatCell {
  row: string;
  col: string;
  count: number;
  tone: "success" | "warning" | "danger";
}

export interface Heatmap {
  rows: string[];
  cols: string[];
  /** One array per row, highest first. */
  cells: HeatCell[][];
  total: number;
  /** Open records the grid cannot place because one of the two fields is blank. */
  unplaced: number;
}

/** Open records counted per (row, column) of the definition's `heat` fields; null without one. */
export function heatmap(
  def: RegisterDef,
  items: readonly RegisterRecord[],
): Heatmap | null {
  if (!def.heat) return null;
  const optionsOf = (key: string) => def.fields.find((f) => f.key === key)?.options ?? [];
  const colOptions = [...optionsOf(def.heat.cols)];
  const rowOptions = [...optionsOf(def.heat.rows)];
  const open = items.filter((item) => isOpen(def, item));
  const cells = rowOptions
    .map((row, rowRank) => ({ row, rowRank }))
    .reverse()
    .map(({ row, rowRank }) =>
      colOptions.map((col, colRank): HeatCell => {
        const score =
          ((rowRank + 1) * (colRank + 1)) / (rowOptions.length * colOptions.length);
        return {
          row,
          col,
          count: open.filter(
            (i) => textOf(i, def.heat!.rows) === row && textOf(i, def.heat!.cols) === col,
          ).length,
          tone: score <= 0.25 ? "success" : score <= 0.5 ? "warning" : "danger",
        };
      }),
    );
  return {
    rows: [...rowOptions].reverse(),
    cols: colOptions,
    cells,
    total: cells.flat().reduce((sum, c) => sum + c.count, 0),
    unplaced: open.length - cells.flat().reduce((sum, c) => sum + c.count, 0),
  };
}
