"use client";

import { useState } from "react";
import { CheckIcon, HourglassMediumIcon } from "@phosphor-icons/react";
import { Button, Input } from "@/components/ui";
import { Chip } from "./parts";
import { zonedInstant } from "@/lib/pmo/due";
import type { TodoPatch } from "@/lib/pmo/todoLogic";
import type { ChaserJob, ReminderPrefs, Todo } from "@/lib/pmo/types";
import { describeWaiting } from "./queueView";

interface WaitingPanelProps {
  todo: Todo;
  prefs: ReminderPrefs;
  nowIso: string;
  today: string;
  busy: boolean;
  /** The chaser draft for this to-do, if one exists. */
  job: ChaserJob | undefined;
  apply: (patch: TodoPatch) => Promise<boolean>;
  onDraftChaser: () => void;
}

const CADENCES = [1, 2, 3, 5, 7, 10];

/** "Waiting on <who>" with its since-date, one click to mark or clear it, the
 *  per-to-do chase cadence and the entry point to a chaser draft. */
export function WaitingPanel({
  todo,
  prefs,
  nowIso,
  today,
  busy,
  job,
  apply,
  onDraftChaser,
}: WaitingPanelProps) {
  const open = todo.status === "open";
  const waiting = describeWaiting(todo, new Date(nowIso), prefs, today);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState(false);

  const suggestions = [todo.requester.name, todo.source.sender]
    .map((value) => value?.trim())
    .filter(
      (value, index, all): value is string => !!value && all.indexOf(value) === index,
    )
    .filter((value) => value !== waiting?.who);

  const mark = async (who: string) => {
    const value = who.trim();
    if (!value) return;
    if (await apply({ waitingOn: value })) {
      setName("");
      setEditing(false);
    }
  };

  if (!open && !waiting) return null;

  return (
    <section
      aria-label="Waiting on"
      className="border-border flex flex-col gap-2.5 rounded-xl border bg-neutral-50 px-3.5 py-3"
    >
      {waiting && !editing ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-ink flex items-center gap-2 text-[13px]">
              <HourglassMediumIcon size={15} className="text-ink-muted shrink-0" />
              <span>
                Waiting on <strong className="font-semibold">{waiting.who}</strong>
                <span className="text-ink-muted">
                  {" · "}
                  {waiting.since}
                  {waiting.age && ` (${waiting.age})`}
                </span>
              </span>
              {waiting.chaseDue && <Chip tone="accent">Time to chase</Chip>}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={busy || !open}
                onClick={() => void apply({ waitingOn: null })}
              >
                <CheckIcon size={13} weight="bold" />
                Got a reply (clear waiting)
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || !open}
                onClick={onDraftChaser}
              >
                {job?.status === "drafting"
                  ? "Drafting a chaser…"
                  : job?.status === "ready"
                    ? "View chaser draft"
                    : "Draft a chaser"}
              </Button>
            </div>
          </div>
          {open && (
            <div className="text-ink-muted flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px]">
              <label className="flex items-center gap-1.5">
                Waiting since
                <Input
                  type="date"
                  className="h-8 w-40 text-[12px]"
                  value={waiting.sinceDay}
                  max={today}
                  disabled={busy}
                  onChange={(event) => {
                    const day = event.target.value;
                    if (!day || day > today) return;
                    void apply({
                      waitingSince: zonedInstant(
                        day,
                        "09:00",
                        prefs.timeZone,
                      ).toISOString(),
                    });
                  }}
                />
              </label>
              <label className="flex items-center gap-1.5">
                Chase after
                <select
                  value={todo.chaserDays ?? ""}
                  disabled={busy}
                  onChange={(event) =>
                    void apply({
                      chaserDays: event.target.value ? Number(event.target.value) : null,
                    })
                  }
                  className="rounded-control border-border bg-surface-elevated text-ink focus-visible:ring-accent h-8 border px-2 text-[12px] outline-none focus-visible:ring-2"
                >
                  <option value="">Default ({prefs.chaserDays})</option>
                  {CADENCES.map((days) => (
                    <option key={days} value={days}>
                      {days}
                    </option>
                  ))}
                  {todo.chaserDays !== null &&
                    todo.chaserDays !== undefined &&
                    !CADENCES.includes(todo.chaserDays) && (
                      <option value={todo.chaserDays}>{todo.chaserDays}</option>
                    )}
                </select>
                working days
              </label>
              <button
                type="button"
                onClick={() => {
                  setName(waiting.who);
                  setEditing(true);
                }}
                className="text-ink-muted hover:text-ink focus-visible:ring-accent rounded underline-offset-2 outline-none hover:underline focus-visible:ring-2"
              >
                Change who
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          <p className="text-ink-muted flex items-center gap-2 text-[12px]">
            <HourglassMediumIcon size={15} className="shrink-0" />
            {editing
              ? "Who are you waiting on now?"
              : "Not waiting on anyone. Mark it to get a chaser if nothing comes back."}
          </p>
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void mark(name);
            }}
          >
            <Input
              value={name}
              placeholder="Person or team"
              maxLength={120}
              aria-label="Who are you waiting on?"
              className="h-9 max-w-64 flex-1"
              onChange={(event) => setName(event.target.value)}
            />
            <Button type="submit" size="sm" disabled={busy || !name.trim()}>
              Mark waiting
            </Button>
            {editing && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setEditing(false)}
              >
                Cancel
              </Button>
            )}
          </form>
          {suggestions.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className="text-ink-faint">Quick pick:</span>
              {suggestions.map((value) => (
                <button
                  key={value}
                  type="button"
                  disabled={busy}
                  onClick={() => void mark(value)}
                  className="text-ink-muted hover:text-ink rounded-pill border-border focus-visible:ring-accent border px-2 py-0.5 outline-none hover:bg-neutral-100 focus-visible:ring-2"
                >
                  {value}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
