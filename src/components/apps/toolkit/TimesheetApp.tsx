"use client";

import { useMemo, useState } from "react";
import { Button, IconButton, Input } from "@/components/ui";
import { TrashIcon } from "@phosphor-icons/react";
import { toast } from "@/lib/notifications/toastStore";
import { registerById } from "@/lib/registers/defs";
import { addDays, formatDayMonth, mondayOf, todayIso } from "@/lib/staff/dates";
import {
  isSelf,
  matchSubmitted,
  personChasers,
  seedWeek,
  timesheetChaser,
} from "@/lib/registers/timesheets";
import { textOf } from "@/lib/registers/records";
import type { RegisterRecord } from "@/lib/registers/types";
import { useMyFirstName } from "@/components/people/useMyFirstName";
import { useMyIdentity } from "./useMyIdentity";
import { CopyDetailsButton } from "@/components/platform/CopyDetailsButton";
import { NativeSelect, TextArea } from "../pmo-todo-app/parts";
import { useTemplateText } from "../templates-app/useTemplateText";
import { PersonChasersDialog } from "./PersonChasersDialog";
import { ReportDialog } from "./ReportDialog";
import { removeWithUndo } from "./removeWithUndo";
import { AlertChip } from "./RecordDialog";
import { recordAlert } from "@/lib/registers/alerts";
import { UnreadableTool } from "./UnreadableTool";
import { usePeople } from "./usePeople";
import { useRegister } from "./useRegister";

const STATUSES = ["Missing", "Submitted", "On leave", "Excused"];
const timesheetDef = registerById("timesheets")!;

/** The timesheet chaser: who is expected for a week, who has filed, who is on leave, and one chaser for the rest. */
export function TimesheetApp({ windowId }: { windowId: string }) {
  const state = useRegister("timesheets");
  const { people, leave } = usePeople();
  const me = useMyFirstName();
  const self = useMyIdentity();
  const [week, setWeek] = useState(() => mondayOf(todayIso()));
  const [paste, setPaste] = useState("");
  const [note, setNote] = useState<{ text: string; detail?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [chaserOpen, setChaserOpen] = useState(false);
  const [perPersonOpen, setPerPersonOpen] = useState(false);

  const rows = useMemo(
    () =>
      state.items
        .filter((r) => textOf(r, "week") === week)
        .sort((a, b) => textOf(a, "person").localeCompare(textOf(b, "person"))),
    [state.items, week],
  );
  const count = (status: string) =>
    rows.filter((r) => textOf(r, "status") === status).length;
  const missing = rows.filter((r) => textOf(r, "status") === "Missing");
  const absent = people.filter((p) => !rows.some((r) => textOf(r, "person") === p.name));
  // The wording is the Templates app's "Timesheet chaser" when one is set, else the built-in text.
  const chaserText = useTemplateText(
    "app:toolkit:timesheet-chaser",
    chaserOpen || perPersonOpen,
  );
  const missingPeople = missing.map((r) => ({
    person: textOf(r, "person"),
    email: textOf(r, "email"),
  }));
  // The combined email goes to everyone else who is missing, not to you.
  const chaseRecipients = missingPeople.filter((m) => !isSelf(m, self));
  const chaser = timesheetChaser(week, chaseRecipients, me, chaserText.fill);
  const perPerson = personChasers(week, missingPeople, me, chaserText.fill, self);

  const fail = (reason: string, detail?: string) => setNote({ text: reason, detail });

  const seed = async (who: typeof people) => {
    setBusy(true);
    setNote(null);
    const before = new Set(state.items.map((r) => r.id));
    const reply = await state.save(
      seedWeek(week, who, leave).map((values) => ({ values })),
    );
    setBusy(false);
    if (!reply.ok) {
      fail(reply.reason, reply.detail);
      return;
    }
    const added = reply.items.filter((r) => !before.has(r.id)).map((r) => r.id);
    if (added.length === 0) return;
    toast({
      key: `undo-seed-${week}`,
      message: `Added ${added.length} ${added.length === 1 ? "person" : "people"} to this week.`,
      durationMs: 10_000,
      action: {
        label: "Undo",
        run: () =>
          void state.remove(added).then((back) => {
            if (!back.ok) toast({ tone: "danger", message: back.reason });
          }),
      },
    });
  };

  const removeRow = async (record: RegisterRecord) => {
    const reply = await removeWithUndo(timesheetDef, state, record);
    if (!reply.ok) fail(reply.reason);
  };

  const [adding, setAdding] = useState("");
  const addOne = async () => {
    const person = absent.find((p) => p.id === adding);
    if (!person) return;
    setAdding("");
    await seed([person]);
  };

  const setStatus = async (record: RegisterRecord, status: string) => {
    const reply = await state.save([
      { id: record.id, values: { ...record.values, status } },
    ]);
    if (!reply.ok) fail(reply.reason, reply.detail);
  };

  const applyPaste = async () => {
    const found = matchSubmitted(
      paste,
      rows.map((r) => ({ name: textOf(r, "person"), email: textOf(r, "email") })),
    );
    const targets = rows.filter(
      (r) =>
        found.matched.includes(textOf(r, "person")) && textOf(r, "status") === "Missing",
    );
    if (targets.length > 0) {
      setBusy(true);
      const reply = await state.save(
        targets.map((r) => ({ id: r.id, values: { ...r.values, status: "Submitted" } })),
      );
      setBusy(false);
      if (!reply.ok) {
        fail(reply.reason, reply.detail);
        return;
      }
    }
    setPaste("");
    setNote({
      text: `Marked ${targets.length} as submitted.${found.unmatched.length ? ` Not found: ${found.unmatched.slice(0, 3).join("; ")}.` : ""}`,
    });
  };

  const markChased = async () => {
    const today = todayIso();
    setBusy(true);
    const reply = await state.save(
      missing.map((r) => ({ id: r.id, values: { ...r.values, chasedOn: today } })),
    );
    setBusy(false);
    if (reply.ok)
      toast({ tone: "success", message: `Marked ${missing.length} as chased today.` });
    else fail(reply.reason, reply.detail);
  };

  if (!state.loaded && state.error) {
    return (
      <div
        data-window-id={windowId}
        data-testid="tool-timesheets"
        className="flex h-full w-full flex-col"
      >
        <UnreadableTool
          title={timesheetDef.title}
          blurb={timesheetDef.blurb}
          error={state.error}
          onRetry={state.reload}
        />
      </div>
    );
  }

  return (
    <div
      data-window-id={windowId}
      data-testid="tool-timesheets"
      className="flex h-full w-full flex-col"
    >
      <div className="flex flex-wrap items-center gap-2 px-6 pt-1 pb-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setWeek(addDays(week, -7))}
          aria-label="Previous week"
        >
          ‹
        </Button>
        <Input
          type="date"
          value={week}
          onChange={(e) => e.target.value && setWeek(mondayOf(e.target.value))}
          aria-label="Week"
          className="w-40"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => setWeek(addDays(week, 7))}
          aria-label="Next week"
        >
          ›
        </Button>
        <span className="text-ink-soft text-[13px]" data-testid="week-label">
          Week of {formatDayMonth(week)} to {formatDayMonth(addDays(week, 4))}
        </span>
        <span className="flex-1" />
        {rows.length > 0 && absent.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void seed(absent)}
          >
            Add {absent.length} missing from the list
          </Button>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="px-6 py-6 text-center" data-testid="week-empty">
          <p className="text-ink-muted text-[13px]">
            No one is being tracked for this week yet. Starting it lists everyone on the
            roster and puts people who are on leave all week aside.
          </p>
          <Button
            className="mt-3"
            disabled={busy || people.length === 0}
            onClick={() => void seed(people)}
          >
            Start this week ({people.length} people)
          </Button>
          {people.length === 0 && (
            <p className="text-ink-muted mt-2 text-[12.5px]">
              Add people in Staff Management first.
            </p>
          )}
        </div>
      ) : (
        <>
          <div
            className="flex flex-wrap items-center gap-3 px-6 pb-2 text-[13px]"
            data-testid="week-summary"
          >
            <span className="text-red font-semibold">{count("Missing")} missing</span>
            <span className="text-ink-soft">{count("Submitted")} submitted</span>
            <span className="text-ink-soft">{count("On leave")} on leave</span>
            <span className="text-ink-soft">{count("Excused")} excused</span>
            <span className="flex-1" />
            <Button
              size="sm"
              disabled={missing.length === 0}
              onClick={() => setChaserOpen(true)}
            >
              Chase the {missing.length} missing
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={missing.length === 0}
              onClick={() => setPerPersonOpen(true)}
            >
              One draft per person
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={missing.length === 0 || busy}
              onClick={() => void markChased()}
            >
              Mark them chased today
            </Button>
          </div>
          <div className="scroll-thin min-h-0 flex-1 overflow-auto px-6 pb-4">
            <table className="w-full border-collapse text-left text-[13px]">
              <thead>
                <tr className="text-ink-muted text-[11.5px] font-bold tracking-[0.06em] uppercase">
                  <th className="border-line border-b px-2 py-2">Person</th>
                  <th className="border-line border-b px-2 py-2">Status</th>
                  <th className="border-line border-b px-2 py-2">Chased</th>
                  <th className="border-line border-b px-2 py-2">Needs attention</th>
                  <th className="border-line border-b px-2 py-2">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    data-testid="timesheet-row"
                    className="border-line group border-b"
                  >
                    <td className="px-2 py-2">{textOf(r, "person")}</td>
                    <td className="px-2 py-2">
                      <NativeSelect
                        value={textOf(r, "status")}
                        onChange={(e) => void setStatus(r, e.target.value)}
                        aria-label={`Status of ${textOf(r, "person")}`}
                        className="w-auto"
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </NativeSelect>
                    </td>
                    <td className="text-ink-muted px-2 py-2">
                      {textOf(r, "chasedOn") ? formatDayMonth(textOf(r, "chasedOn")) : ""}
                    </td>
                    <td className="px-2 py-2">
                      {(() => {
                        const alert = recordAlert(timesheetDef, r, {
                          today: todayIso(),
                          config: {},
                        });
                        return alert ? (
                          <AlertChip level={alert.level} text={alert.text} />
                        ) : null;
                      })()}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <IconButton
                        size="sm"
                        variant="destructive-quiet"
                        aria-label={`Remove ${textOf(r, "person")} from this week`}
                        onClick={() => void removeRow(r)}
                      >
                        <TrashIcon />
                      </IconButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {absent.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <NativeSelect
                  value={adding}
                  onChange={(e) => setAdding(e.target.value)}
                  aria-label="Person to add to this week"
                  className="w-auto"
                >
                  <option value="">Add one person…</option>
                  {absent.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </NativeSelect>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy || adding === ""}
                  onClick={() => void addOne()}
                >
                  Add
                </Button>
              </div>
            )}
            <div className="mt-4">
              <TextArea
                rows={3}
                value={paste}
                onChange={(e) => setPaste(e.target.value)}
                aria-label="Paste who has submitted"
                placeholder="Paste the names or emails of people who have submitted, one per line"
              />
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                disabled={busy || paste.trim() === ""}
                onClick={() => void applyPaste()}
              >
                Mark them as submitted
              </Button>
            </div>
          </div>
        </>
      )}
      {note && (
        <p
          role={note.detail ? "alert" : "status"}
          className={`px-6 pb-3 text-[12.5px] ${note.detail ? "text-red" : "text-ink-muted"}`}
        >
          {note.text}
          {note.detail && (
            <CopyDetailsButton
              message={note.text}
              detail={note.detail}
              where="Timesheet chaser"
            />
          )}
        </p>
      )}
      {state.error && (
        <p role="alert" className="text-red px-6 pb-3 text-[12.5px]">
          {state.error.reason}
        </p>
      )}
      {perPersonOpen && (
        <PersonChasersDialog
          chasers={perPerson}
          onUse={chaserText.used}
          onClose={() => setPerPersonOpen(false)}
        />
      )}
      {chaserOpen && (
        <ReportDialog
          title="Timesheet chaser"
          description={`To: ${chaser.to || "(no email addresses on file)"}${chaser.withoutEmail.length ? `. No email for: ${chaser.withoutEmail.join(", ")}.` : ""} People on leave are not included. Nothing is sent from here.`}
          subject={chaser.subject}
          text={chaser.body}
          to={chaser.to.includes(";") ? undefined : chaser.to || undefined}
          recipients={chaser.to.includes(";") ? chaser.to : undefined}
          onUse={chaserText.used}
          onClose={() => setChaserOpen(false)}
        />
      )}
    </div>
  );
}
