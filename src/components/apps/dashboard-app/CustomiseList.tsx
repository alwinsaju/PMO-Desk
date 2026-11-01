"use client";

import { useRef, useState } from "react";
import { DotsSixVerticalIcon } from "@phosphor-icons/react";
import { useDrag } from "@use-gesture/react";
import { cn } from "@/lib/cn";
import {
  WIDGET_TITLE,
  dropIndex,
  moveWidget,
  moveWidgetTo,
  toggleHidden,
  toggleWide,
  type Layout,
  type WidgetId,
} from "@/lib/dashboard/layout";

interface RowProps {
  id: WidgetId;
  layout: Layout;
  dragging: boolean;
  onChange: (next: Layout) => void;
  onDragStart: (id: WidgetId) => void;
  onDragMove: (id: WidgetId, y: number) => void;
  onDragEnd: () => void;
}

/** One card in the Customise list. The grip drags it (the cards below follow live); with the
 *  grip focused, the Up and Down arrow keys move it one place instead. */
function Row({
  id,
  layout,
  dragging,
  onChange,
  onDragStart,
  onDragMove,
  onDragEnd,
}: RowProps) {
  const hidden = layout.hidden.includes(id);
  const bind = useDrag(
    ({ first, last, xy }) => {
      if (first) onDragStart(id);
      onDragMove(id, xy[1]);
      if (last) onDragEnd();
    },
    // Window listeners instead of pointer capture: the rows move in the DOM while
    // dragging, which would otherwise drop the capture.
    { filterTaps: true, pointer: { touch: true, capture: false } },
  );
  return (
    <li
      data-reorder-id={hidden ? undefined : id}
      data-dragging={dragging ? "true" : undefined}
      className={cn(
        "rounded-control flex flex-wrap items-center gap-3 px-2 py-1.5 text-[13px]",
        "data-[dragging=true]:bg-surface-elevated data-[dragging=true]:ring-accent data-[dragging=true]:shadow-float-sm data-[dragging=true]:ring-2",
      )}
    >
      {hidden ? (
        <span aria-hidden className="h-8 w-8 shrink-0" />
      ) : (
        <button
          type="button"
          {...bind()}
          aria-label={`Reorder ${WIDGET_TITLE[id]}: drag, or use the Up and Down arrow keys`}
          title="Drag to reorder"
          onKeyDown={(event) => {
            if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
            event.preventDefault();
            onChange(moveWidget(layout, id, event.key === "ArrowUp" ? -1 : 1));
          }}
          className={cn(
            "text-ink-muted hover:text-ink hover:bg-chip rounded-control focus-ring grid h-8 w-8 shrink-0 touch-none place-items-center",
            dragging ? "cursor-grabbing" : "cursor-grab",
          )}
        >
          <DotsSixVerticalIcon size={18} weight="bold" aria-hidden />
        </button>
      )}
      <label className="text-ink flex min-w-44 flex-1 items-center gap-2">
        <input
          type="checkbox"
          checked={!hidden}
          onChange={() => onChange(toggleHidden(layout, id))}
          className="accent-accent h-4 w-4"
          aria-label={`Show ${WIDGET_TITLE[id]}`}
        />
        <span className={hidden ? "text-ink-muted" : undefined}>{WIDGET_TITLE[id]}</span>
      </label>
      {!hidden && (
        <label className="text-ink-soft flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={layout.wide.includes(id)}
            onChange={() => onChange(toggleWide(layout, id))}
            className="accent-accent h-4 w-4"
            aria-label={`Wide ${WIDGET_TITLE[id]}`}
          />
          Wide
        </label>
      )}
    </li>
  );
}

/**
 * The Customise list. While a grip is dragged, `onPreview` gets the layout as it would be, so the
 * Dashboard behind redraws live; releasing keeps it (`onCommit`). Hidden cards have no grip and stay
 * in their slots (see `moveWidgetTo`).
 */
export function CustomiseList({
  layout,
  onCommit,
  onPreview,
}: {
  layout: Layout;
  onCommit: (next: Layout) => void;
  onPreview: (draft: Layout | null) => void;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const [draggingId, setDraggingId] = useState<WidgetId | null>(null);
  const [draft, setDraft] = useState<Layout | null>(null);
  const middles = useRef<number[]>([]);
  // The latest preview for the gesture callbacks; `draft` is the copy that is drawn.
  const draftRef = useRef<Layout | null>(null);

  function start(id: WidgetId) {
    const rows = [
      ...(listRef.current?.querySelectorAll<HTMLElement>("[data-reorder-id]") ?? []),
    ];
    middles.current = rows
      .filter((row) => row.dataset.reorderId !== id)
      .map((row) => {
        const rect = row.getBoundingClientRect();
        return rect.top + rect.height / 2;
      });
    draftRef.current = layout;
    setDraggingId(id);
  }

  function move(id: WidgetId, y: number) {
    const base = draftRef.current ?? layout;
    const next = moveWidgetTo(base, id, dropIndex(middles.current, y));
    if (next === base) return;
    draftRef.current = next;
    setDraft(next);
    onPreview(next);
  }

  function end() {
    const final = draftRef.current;
    draftRef.current = null;
    setDraft(null);
    setDraggingId(null);
    if (final && final !== layout) onCommit(final);
    onPreview(null);
  }

  const shown = draft ?? layout;
  return (
    <ul ref={listRef} className="flex flex-col gap-0.5">
      {shown.order.map((id) => (
        <Row
          key={id}
          id={id}
          layout={shown}
          dragging={draggingId === id}
          onChange={onCommit}
          onDragStart={start}
          onDragMove={move}
          onDragEnd={end}
        />
      ))}
    </ul>
  );
}
