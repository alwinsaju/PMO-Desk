"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { toast } from "@/lib/notifications/toastStore";
import { prepStart } from "@/lib/registers/alerts";
import type { Person } from "@/lib/registers/timesheets";
import type { RegisterRecord } from "@/lib/registers/types";
import { addDays, formatDayMonth, todayIso } from "@/lib/staff/dates";
import { governanceIcs } from "@/lib/staff/exportFiles";
import type { ExtrasContext } from "../RecordDialog";
import { createTodoFrom } from "../todoBridge";
import type { RegisterState } from "../useRegister";

const GOVERNANCE_STEPS = (title: string, date: string, start: string, today: string) => {
  const later = (d: string) => (d < today ? today : d);
  return [
    { title: `Prep: ${title}: agenda and attendees`, dueAt: later(start) },
    {
      title: `Prep: ${title}: pre-read and papers sent`,
      dueAt: later(addDays(date, -2)),
    },
  ];
};

function downloadCalendar(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/calendar" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** A calendar file (.ics) of the upcoming planned meetings, saved to this computer. All-day events: the
 *  Time field is free text, so it goes into the description. Nothing is sent and Outlook is not changed. */
function CalendarExport({ state }: { state: RegisterState }) {
  const today = todayIso();
  const count = governanceIcs(state.items, today, "").count;
  const save = () => {
    const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
    const { ics, count: n } = governanceIcs(state.items, today, stamp);
    downloadCalendar("governance-calendar.ics", ics);
    toast({
      tone: "success",
      message: `Saved ${n} upcoming meeting${n === 1 ? "" : "s"} as a calendar file.`,
    });
  };
  return (
    <div className="border-line rounded-md border p-3" data-testid="governance-calendar">
      <Button variant="outline" size="sm" disabled={count === 0} onClick={save}>
        Download calendar file (.ics)
      </Button>
      <span className="text-ink-muted ml-2 text-[12.5px]">
        {count === 0
          ? "No planned meetings from today on."
          : `${count} upcoming meeting${count === 1 ? "" : "s"}, as all-day events. Open the file in Outlook to add them; nothing is sent.`}
      </span>
    </div>
  );
}

/** In a meeting's record: make the prep to-dos (agenda, pre-read) dated back from the meeting, once; and
 *  save the upcoming meetings as a calendar file. */
export function GovernanceExtras({
  ctx,
  state,
  people,
}: {
  ctx: ExtrasContext;
  state: RegisterState;
  people: readonly Person[];
}) {
  return (
    <div className="space-y-3">
      <PrepExtras ctx={ctx} state={state} people={people} />
      <CalendarExport state={state} />
    </div>
  );
}

function PrepExtras({
  ctx,
  state,
  people,
}: {
  ctx: ExtrasContext;
  state: RegisterState;
  people: readonly Person[];
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const record: RegisterRecord | null = ctx.record;
  const date = typeof ctx.values.date === "string" ? ctx.values.date : "";
  const title = typeof ctx.values.title === "string" ? ctx.values.title : "";

  if (!record) {
    return (
      <p className="text-ink-muted text-[12.5px]">
        Save the meeting first, then you can make its prep to-dos.
      </p>
    );
  }
  if (record.todoId) {
    return (
      <p className="text-ink-muted text-[12.5px]" data-testid="prep-made">
        Prep to-dos were made for this meeting.
      </p>
    );
  }

  const make = async () => {
    if (!date) {
      setError("Give the meeting a date first.");
      return;
    }
    setBusy(true);
    setError(null);
    const start = prepStart({ ...record, values: ctx.values });
    let firstId: string | null = null;
    for (const step of GOVERNANCE_STEPS(title, date, start, todayIso())) {
      const made = await createTodoFrom(
        {
          title: step.title,
          description: `For the meeting on ${formatDayMonth(date)}.`,
          owner: null,
          dueAt: step.dueAt,
          tags: ["governance"],
        },
        people,
      );
      if (!made.ok) {
        setError(made.reason);
        setBusy(false);
        return;
      }
      firstId ??= made.todoId;
    }
    const reply = await state.save([
      { id: record.id, values: ctx.values, todoId: firstId ?? undefined },
    ]);
    setBusy(false);
    if (!reply.ok) {
      setError(reply.reason);
      return;
    }
    toast({ tone: "success", message: "Made the prep to-dos in PMO To-Do." });
  };

  return (
    <div className="border-line rounded-md border p-3" data-testid="governance-extras">
      <Button variant="outline" size="sm" disabled={busy} onClick={() => void make()}>
        Make prep to-dos
      </Button>
      <span className="text-ink-muted ml-2 text-[12.5px]">
        Agenda and pre-read, dated back from the meeting.
      </span>
      {error && (
        <p role="alert" className="text-red mt-2 text-[12.5px]">
          {error}
        </p>
      )}
    </div>
  );
}
