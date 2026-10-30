"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { toast } from "@/lib/notifications/toastStore";
import { extractActionItems, type ExtractedItem } from "@/lib/pmo/pmoViews";
import type { Person } from "@/lib/registers/timesheets";
import { todayIso } from "@/lib/staff/dates";
import type { ExtrasContext } from "../RecordDialog";
import { createTodoFrom } from "../todoBridge";
import type { RegisterState } from "../useRegister";

/** In a meeting's record: find the action lines in the notes and turn the ones you tick into to-dos. */
export function MinutesExtras({
  ctx,
  people,
}: {
  ctx: ExtrasContext;
  state: RegisterState;
  people: readonly Person[];
}) {
  const [items, setItems] = useState<ExtractedItem[] | null>(null);
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const notes = typeof ctx.values.notes === "string" ? ctx.values.notes : "";
  const title = typeof ctx.values.title === "string" ? ctx.values.title : "";
  const madeBefore = typeof ctx.values.actions === "number" ? ctx.values.actions : 0;

  const find = () => {
    const found = extractActionItems(notes, todayIso());
    setItems(found);
    setTicked(new Set(found.map((_, i) => i)));
    setError(
      found.length === 0
        ? "No action lines found. Try “Action: …” or “Priya to send the deck Fri”."
        : null,
    );
  };

  const make = async () => {
    if (!items) return;
    setBusy(true);
    setError(null);
    let made = 0;
    for (const [i, item] of items.entries()) {
      if (!ticked.has(i)) continue;
      const result = await createTodoFrom(
        {
          title: item.title,
          description: `From the meeting “${title}”.`,
          owner: item.owner,
          dueAt: item.dueAt,
          tags: ["minutes"],
        },
        people,
      );
      if (!result.ok) {
        setError(result.reason);
        break;
      }
      made += 1;
    }
    setBusy(false);
    if (made > 0) {
      ctx.setValues({ ...ctx.values, actions: madeBefore + made });
      setItems(null);
      toast({
        tone: "success",
        message: `Made ${made} to-do${made === 1 ? "" : "s"}. Save the meeting to keep the count.`,
      });
    }
  };

  return (
    <div className="border-line rounded-md border p-3" data-testid="minutes-extras">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={find}>
          Find action lines in the notes
        </Button>
        <span className="text-ink-muted text-[12.5px]">
          {madeBefore} to-do{madeBefore === 1 ? "" : "s"} made from this meeting
        </span>
      </div>
      {items && items.length > 0 && (
        <>
          <ul className="mt-2 flex flex-col gap-1" aria-label="Action lines">
            {items.map((item, i) => (
              <li
                key={`${item.title}-${i}`}
                className="flex items-center gap-2 text-[13px]"
              >
                <input
                  type="checkbox"
                  checked={ticked.has(i)}
                  onChange={(e) =>
                    setTicked((cur) => {
                      const next = new Set(cur);
                      if (e.target.checked) next.add(i);
                      else next.delete(i);
                      return next;
                    })
                  }
                  aria-label={`Make a to-do: ${item.title}`}
                />
                <span className="text-ink">{item.title}</span>
                {item.owner && <span className="text-ink-muted">({item.owner})</span>}
                {item.dueAt && <span className="text-ink-muted">due {item.dueAt}</span>}
              </li>
            ))}
          </ul>
          <Button
            size="sm"
            className="mt-2"
            disabled={busy || ticked.size === 0}
            onClick={() => void make()}
          >
            {busy
              ? "Making…"
              : `Make ${ticked.size} to-do${ticked.size === 1 ? "" : "s"}`}
          </Button>
        </>
      )}
      {error && (
        <p role="alert" className="text-red mt-2 text-[12.5px]">
          {error}
        </p>
      )}
    </div>
  );
}
