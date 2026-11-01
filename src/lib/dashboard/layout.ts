// Which Dashboard cards show, in what order and how wide, and the saved layouts you can switch between. Pure.

export const WIDGET_IDS = [
  "today",
  "todos",
  "chasers",
  "reports",
  "staff",
  "away",
  "workload",
  "aging",
  "signoff",
  "health",
  "week",
  "registers",
] as const;
export type WidgetId = (typeof WIDGET_IDS)[number];

export const WIDGET_TITLE: Record<WidgetId, string> = {
  today: "Today",
  todos: "Open to-dos",
  chasers: "Overdue chasers",
  reports: "Reports",
  staff: "Staff to act on",
  away: "Who's out",
  workload: "Workload by person",
  aging: "How long to-dos have sat",
  signoff: "Sign-off pipeline",
  health: "Report health",
  week: "This week vs last",
  registers: "PMO toolkit",
};

export interface Layout {
  order: WidgetId[];
  hidden: WidgetId[];
  /** Spans both columns. */
  wide: WidgetId[];
}

export interface SavedLayout {
  name: string;
  layout: Layout;
}

/** The cards people see until they change anything: the originals first, the new ones after. */
export const DEFAULT_LAYOUT: Layout = {
  order: [...WIDGET_IDS],
  hidden: ["workload", "aging", "signoff", "health", "week", "registers"],
  wide: ["today"],
};

const isId = (v: unknown): v is WidgetId => WIDGET_IDS.includes(v as WidgetId);

export function sanitizeLayout(value: unknown): Layout {
  const raw =
    typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const list = (v: unknown): WidgetId[] =>
    Array.isArray(v) ? [...new Set(v.filter(isId))] : [];
  const order = list(raw.order);
  // A card missing from a stored order (added in a later version) goes last.
  for (const id of WIDGET_IDS) if (!order.includes(id)) order.push(id);
  return { order, hidden: list(raw.hidden), wide: list(raw.wide) };
}

/** The cards to draw, in order. */
export const visibleWidgets = (layout: Layout): WidgetId[] =>
  layout.order.filter((id) => !layout.hidden.includes(id));

export function moveWidget(layout: Layout, id: WidgetId, by: -1 | 1): Layout {
  const visible = visibleWidgets(layout);
  const at = visible.indexOf(id);
  const target = visible[at + by];
  if (at < 0 || target === undefined) return layout;
  const order = [...layout.order];
  const a = order.indexOf(id);
  const b = order.indexOf(target);
  [order[a], order[b]] = [order[b], order[a]];
  return { ...layout, order };
}

/** Puts `id` at position `index` among the visible cards (what dragging a handle does). Hidden cards keep
 *  their slots, so showing one again returns it where it was. Same object when nothing moves. */
export function moveWidgetTo(layout: Layout, id: WidgetId, index: number): Layout {
  const visible = visibleWidgets(layout);
  const from = visible.indexOf(id);
  if (from < 0) return layout;
  const to = Math.min(Math.max(0, Math.trunc(index)), visible.length - 1);
  if (to === from) return layout;
  const next = [...visible];
  next.splice(from, 1);
  next.splice(to, 0, id);
  let n = 0;
  const order = layout.order.map((slot) =>
    layout.hidden.includes(slot) ? slot : next[n++],
  );
  return { ...layout, order };
}

/** Where a dragged row lands: how many of the OTHER rows' middles lie above the pointer. */
export function dropIndex(otherMiddles: readonly number[], pointerY: number): number {
  return otherMiddles.filter((middle) => middle < pointerY).length;
}

const toggled = (list: readonly WidgetId[], id: WidgetId): WidgetId[] =>
  list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

export const toggleHidden = (layout: Layout, id: WidgetId): Layout => ({
  ...layout,
  hidden: toggled(layout.hidden, id),
});

export const toggleWide = (layout: Layout, id: WidgetId): Layout => ({
  ...layout,
  wide: toggled(layout.wide, id),
});

export const MAX_LAYOUTS = 8;

export function saveLayout(
  saved: readonly SavedLayout[],
  name: string,
  layout: Layout,
): SavedLayout[] {
  const clean = name.trim().slice(0, 40);
  if (!clean) return [...saved];
  const rest = saved.filter((s) => s.name.toLowerCase() !== clean.toLowerCase());
  return [...rest, { name: clean, layout: sanitizeLayout(layout) }].slice(-MAX_LAYOUTS);
}

export function sanitizeSavedLayouts(value: unknown): SavedLayout[] {
  if (!Array.isArray(value)) return [];
  const out: SavedLayout[] = [];
  for (const raw of value.slice(0, MAX_LAYOUTS)) {
    if (typeof raw !== "object" || raw === null) continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.name !== "string" || !r.name.trim()) continue;
    out.push({ name: r.name.trim().slice(0, 40), layout: sanitizeLayout(r.layout) });
  }
  return out;
}
