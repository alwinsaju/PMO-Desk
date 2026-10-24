"use client";

import { useState } from "react";
import { BellSlashIcon } from "@phosphor-icons/react";
import { Button, Input, Popover, PopoverContent, PopoverTrigger } from "@/components/ui";
import {
  describeInstant,
  instantFromLocalInput,
  isSnoozed,
  snoozeUntil,
  type SnoozeChoice,
} from "@/lib/pmo/due";
import type { ReminderPrefs, Todo } from "@/lib/pmo/types";

interface SnoozeMenuProps {
  todo: Pick<Todo, "reminders">;
  prefs: Pick<ReminderPrefs, "timeZone" | "workStart">;
  /** The server's "now", so presets agree with the reminder engine. */
  nowIso: string;
  disabled?: boolean;
  /** An ISO instant to silence reminders until; null wakes the to-do up. */
  onSnooze: (until: string | null) => void;
  /** "icon" for a list row, "button" for the detail dialog. */
  variant?: "icon" | "button";
}

const CHOICES: { id: SnoozeChoice; label: string }[] = [
  { id: "1h", label: "In 1 hour" },
  { id: "tomorrow", label: "Tomorrow" },
  { id: "monday", label: "Next Monday" },
];

/** Snooze presets (1 h, tomorrow at the start of the working day, next
 *  Monday) plus a custom date and time, all read in the reminder time zone.
 *  Snoozing only silences this to-do's reminders; nothing else changes. */
export function SnoozeMenu({
  todo,
  prefs,
  nowIso,
  disabled,
  onSnooze,
  variant = "button",
}: SnoozeMenuProps) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");
  const now = new Date(nowIso);
  const snoozed = isSnoozed(todo, now);

  const pick = (until: Date | null) => {
    setOpen(false);
    onSnooze(until ? until.toISOString() : null);
  };
  const customInstant = custom ? instantFromLocalInput(custom, prefs.timeZone) : null;
  const customValid = customInstant !== null && customInstant.getTime() > now.getTime();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant={snoozed ? "secondary" : "ghost"}
          size="sm"
          disabled={disabled}
          aria-label={snoozed ? "Change snooze" : "Snooze reminders"}
          title={
            snoozed
              ? `Snoozed until ${describeInstant(todo.reminders.snoozedUntil!, prefs.timeZone)}`
              : "Snooze reminders for this to-do"
          }
          className={variant === "icon" ? "px-2" : undefined}
        >
          <BellSlashIcon size={14} weight={snoozed ? "fill" : "regular"} />
          {variant === "button" && (snoozed ? "Snoozed" : "Snooze")}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-2">
        <p className="text-ink-faint px-2 pt-1 pb-1.5 text-[10px] font-semibold tracking-wide uppercase">
          Silence reminders until
        </p>
        <ul className="flex flex-col">
          {CHOICES.map((choice) => {
            const until = snoozeUntil(choice.id, now, prefs);
            return (
              <li key={choice.id}>
                <button
                  type="button"
                  onClick={() => pick(until)}
                  className="rounded-control focus-visible:ring-accent flex w-full items-center justify-between gap-3 px-2 py-1.5 text-left text-[13px] outline-none hover:bg-neutral-100 focus-visible:ring-2"
                >
                  <span className="text-ink">{choice.label}</span>
                  <span className="text-ink-faint text-[11px]">
                    {describeInstant(until, prefs.timeZone)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <form
          className="border-border mt-1 flex flex-col gap-1.5 border-t px-2 pt-2 pb-1"
          onSubmit={(event) => {
            event.preventDefault();
            if (customValid) pick(customInstant);
          }}
        >
          <label className="text-ink text-[13px]" htmlFor="pmo-snooze-custom">
            Pick a date and time
          </label>
          <div className="flex gap-2">
            <Input
              id="pmo-snooze-custom"
              type="datetime-local"
              value={custom}
              onChange={(event) => setCustom(event.target.value)}
              className="h-8 px-2 text-[12px]"
            />
            <Button type="submit" size="sm" variant="secondary" disabled={!customValid}>
              Set
            </Button>
          </div>
          {custom && !customValid && (
            <span className="text-ink-faint text-[11px]">
              Choose a time in the future.
            </span>
          )}
        </form>
        {snoozed && (
          <button
            type="button"
            onClick={() => pick(null)}
            className="border-border rounded-control focus-visible:ring-accent mt-1 w-full border-t px-2 py-1.5 text-left text-[13px] outline-none hover:bg-neutral-100 focus-visible:ring-2"
          >
            Wake it up now
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
