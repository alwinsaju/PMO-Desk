"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui";
import { toast } from "@/lib/notifications/toastStore";
import { extractActionItems, type ExtractedItem } from "@/lib/pmo/pmoViews";
import { lineKey, parseMade, withMade } from "@/lib/registers/madeLines";
import type { Person } from "@/lib/registers/timesheets";
import { todayIso } from "@/lib/staff/dates";
import { readSetting, writeSetting } from "../../staff-app/localSetting";
import type { ExtrasContext } from "../RecordDialog";
import { createTodoFrom } from "../todoBridge";
import type { RegisterState } from "../useRegister";

const madeKey = (recordId: string) => `minutes-made:${recordId}`;

/** In a meeting's record: find the action lines in the notes and turn the ones you tick into to-dos. The count of
 *  to-dos made is saved at once, and a line that already became a to-do is not made again. */
export function MinutesExtras({
  ctx,
  state,
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
  const running = useRef(false);

  const record = ctx.record;
  const notes = typeof ctx.values.notes === "string" ? ctx.values.notes : "";
  const title = typeof ctx.values.title === "string" ? ctx.values.title : "";
  const madeBefore = typeof ctx.values.actions === "number" ? ctx.values.actions : 0;

  const alreadyMade = (item: ExtractedItem): boolean =>
    record !== null && parseMade(readSetting(madeKey(record.id))).includes(lineKey(item));

  const find = () => {
    const found = extractActionItems(notes, todayIso());
    setItems(found);
    setTicked(new Set(found.flatMap((item, i) => (alreadyMade(item) ? [] : [i]))));
    setError(
      found.length === 0
        ? "No action lines found. Try “Action: …” or “Priya to send the deck Fri”."
        : null,
    );
  };

  const make = async () => {
    if (!items || !record || running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    const doneLines: ExtractedItem[] = [];
    let failure: string | null = null;
    for (const [i, item] of items.entries()) {
      if (!ticked.has(i) || alreadyMade(item)) continue;
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
        failure = result.reason;
        break;
      }
      doneLines.push(item);
      // Remembered one by one, so a stop part-way never lets the same line be made twice.
      writeSetting(
        madeKey(record.id),
        JSON.stringify(withMade(parseMade(readSetting(madeKey(record.id))), [item])),
      );
    }
    if (doneLines.length > 0) {
      // The count belongs to the saved meeting: add to what is saved, not to what is typed in the form.
      const saved = state.items.find((r) => r.id === record.id) ?? record;
      const savedCount =
        typeof saved.values.actions === "number" ? saved.values.actions : 0;
      const total = savedCount + doneLines.length;
      const reply = await ctx.saveRecord(
        { ...saved.values, actions: total },
        saved.todoId,
      );
      if (reply.ok) ctx.commit({ actions: total });
      else {
        ctx.setValues({ ...ctx.values, actions: madeBefore + doneLines.length });
        failure = `The to-dos were made, but the count could not be saved: ${reply.reason} Save the meeting to keep it.`;
      }
      setItems(null);
      toast({
        tone: "success",
        message: `Made ${doneLines.length} to-do${doneLines.length === 1 ? "" : "s"}.`,
      });
    }
    if (failure) setError(failure);
    running.current = false;
    setBusy(false);
  };

  if (!record) {
    return (
      <p className="text-ink-muted text-[12.5px]" data-testid="minutes-extras">
        Save the meeting first, then you can make to-dos from its action lines.
      </p>
    );
  }

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
            {items.map((item, i) => {
              const made = alreadyMade(item);
              return (
                <li
                  key={`${item.title}-${i}`}
                  className="flex items-center gap-2 text-[13px]"
                >
                  <input
                    type="checkbox"
                    checked={ticked.has(i)}
                    disabled={made}
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
                  {made && (
                    <span className="text-ink-muted">already made into a to-do</span>
                  )}
                </li>
              );
            })}
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
