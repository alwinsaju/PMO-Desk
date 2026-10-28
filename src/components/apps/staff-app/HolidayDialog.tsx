"use client";

import { useMemo, useState } from "react";
import {
  PencilSimpleIcon,
  PlusIcon,
  TrashIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  IconButton,
  Input,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatRange, todayIso, weekdayIndex } from "@/lib/staff/dates";
import {
  INDIA_LOCATIONS,
  abbreviate,
  canonicalLocation,
  describeLocations,
  holidayList,
  locationChoices,
  observes,
} from "@/lib/staff/holidays";
import { useRosterStore } from "@/lib/staff/rosterStore";
import { useStaffStore } from "@/lib/staff/staffStore";
import { newId } from "@/lib/staff/shifts";
import type { RosterEvent } from "@/lib/staff/types";
import { SELECT_CLASS, hueClass } from "./parts";

const DAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type Kind = RosterEvent["kind"];

const KIND_LABEL: Record<Kind, string> = {
  holiday: "Holiday",
  swap: "Shift swap day",
  note: "Note",
};

interface Draft {
  id: string | null;
  kind: Kind;
  date: string;
  endDate: string;
  label: string;
  /** The locations ticked; every one of them ticked is saved as "every location". */
  selected: string[];
}

export function HolidayDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <Body />
        </DialogContent>
      )}
    </Dialog>
  );
}

function Body() {
  const config = useRosterStore((s) => s.config);
  const save = useRosterStore((s) => s.save);
  const employees = useStaffStore((s) => s.employees);
  const baseChoices = useMemo(
    () => locationChoices(config.members, employees, config.events),
    [config.members, config.events, employees],
  );
  const [extra, setExtra] = useState<string[]>([]);
  const choices = useMemo(
    () => [...baseChoices, ...extra.filter((l) => !baseChoices.includes(l))],
    [baseChoices, extra],
  );

  const blank = (): Draft => ({
    id: null,
    kind: "holiday",
    date: "",
    endDate: "",
    label: "",
    selected: choices,
  });
  const [draft, setDraft] = useState<Draft>(blank);
  const [newPlace, setNewPlace] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const thisYear = todayIso().slice(0, 4);
  const [year, setYear] = useState(thisYear);

  const years = useMemo(() => {
    const set = new Set<string>([thisYear]);
    for (const e of config.events) set.add(e.date.slice(0, 4));
    return [...set].sort();
  }, [config.events, thisYear]);

  const list = useMemo(
    () =>
      config.events
        .filter((e) => e.date.slice(0, 4) === year)
        .sort(
          (a, b) =>
            a.date.localeCompare(b.date) ||
            a.kind.localeCompare(b.kind) ||
            a.label.localeCompare(b.label),
        ),
    [config.events, year],
  );
  const holidays = holidayList(list).length;

  const patch = (change: Partial<Draft>) => setDraft((d) => ({ ...d, ...change }));
  const toggle = (place: string) =>
    patch({
      selected: draft.selected.includes(place)
        ? draft.selected.filter((l) => l !== place)
        : [...draft.selected, place],
    });

  function addPlace() {
    const name = canonicalLocation(newPlace);
    if (!name) return;
    if (!choices.includes(name)) setExtra((e) => [...e, name]);
    if (!draft.selected.includes(name)) patch({ selected: [...draft.selected, name] });
    setNewPlace("");
  }

  async function persist(events: RosterEvent[]) {
    setBusy(true);
    setError(null);
    const result = await save({ ...config, events });
    setBusy(false);
    if (!result.ok) setError(result.reason);
    return result.ok;
  }

  async function submit() {
    const label = draft.label.trim();
    if (!draft.date) return setError("Pick the date.");
    if (!label) return setError("Give it a name.");
    const endDate = draft.endDate || draft.date;
    if (endDate < draft.date) return setError("The end date is before the start date.");
    if (draft.kind === "holiday" && draft.selected.length === 0) {
      return setError("Choose at least one location that observes it.");
    }
    const everywhere = choices.every((l) => draft.selected.includes(l));
    const event: RosterEvent = {
      id: draft.id ?? newId("evt"),
      date: draft.date,
      endDate,
      label,
      kind: draft.kind,
      ...(draft.kind === "holiday" && !everywhere
        ? { locations: choices.filter((l) => draft.selected.includes(l)) }
        : {}),
    };
    const events = draft.id
      ? config.events.map((e) => (e.id === draft.id ? event : e))
      : [...config.events, event];
    if (await persist(events)) {
      setYear(event.date.slice(0, 4));
      setDraft({ ...blank(), kind: draft.kind });
    }
  }

  function edit(event: RosterEvent) {
    setError(null);
    setDraft({
      id: event.id,
      kind: event.kind,
      date: event.date,
      endDate: event.endDate === event.date ? "" : event.endDate,
      label: event.label,
      selected: choices.filter((l) => observes(event, l)),
    });
  }

  const everywhere = choices.every((l) => draft.selected.includes(l));
  const summary =
    draft.selected.length === 0
      ? "No location chosen"
      : describeLocations(everywhere ? [] : draft.selected, choices);

  return (
    <>
      <DialogTitle>Holidays and special days</DialogTitle>
      <DialogDescription>
        Enter a holiday once and choose the locations that observe it. People at those
        locations show HOL on that day, and the date is marked at the top of the roster.
      </DialogDescription>

      <section
        aria-label={draft.id ? "Edit" : "Add"}
        className="border-line bg-card rounded-card mt-5 flex flex-col gap-4 border p-4"
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_150px_150px]">
          <label className="flex flex-col gap-1.5">
            <span className="text-ink-soft text-[12.5px] font-semibold">Name</span>
            <Input
              value={draft.label}
              maxLength={100}
              placeholder="Diwali"
              onChange={(e) => patch({ label: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-ink-soft text-[12.5px] font-semibold">Date</span>
            <Input
              type="date"
              value={draft.date}
              onChange={(e) => patch({ date: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-ink-soft text-[12.5px] font-semibold">
              To (optional)
            </span>
            <Input
              type="date"
              value={draft.endDate}
              min={draft.date}
              onChange={(e) => patch({ endDate: e.target.value })}
            />
          </label>
        </div>

        <label className="flex flex-col gap-1.5 sm:max-w-[220px]">
          <span className="text-ink-soft text-[12.5px] font-semibold">Type</span>
          <select
            className={SELECT_CLASS}
            value={draft.kind}
            onChange={(e) => patch({ kind: e.target.value as Kind })}
          >
            {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>

        {draft.kind === "holiday" && (
          <fieldset className="flex flex-col gap-2.5">
            <legend className="text-ink-soft mb-1 text-[12.5px] font-semibold">
              Locations that observe it
              <span className="text-ink-muted ml-2 font-medium">{summary}</span>
            </legend>
            <div className="flex flex-wrap gap-1.5">
              {choices.map((place) => {
                const on = draft.selected.includes(place);
                return (
                  <button
                    key={place}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(place)}
                    className={cn(
                      "rounded-chip transition-ui h-8 border px-3 text-[12.5px] font-semibold",
                      on
                        ? "rh-hol border-transparent"
                        : "border-line-strong text-ink-muted hover:bg-chip",
                    )}
                  >
                    {place}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => patch({ selected: choices })}
              >
                Every location
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  patch({ selected: choices.filter((l) => INDIA_LOCATIONS.includes(l)) })
                }
              >
                India only
              </Button>
              <Button variant="ghost" size="sm" onClick={() => patch({ selected: [] })}>
                Clear
              </Button>
              <span className="text-ink-muted text-[12px]">
                Tick everything, then untick the exceptions, for “all except …”.
              </span>
              <form
                className="ml-auto flex items-center gap-1.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  addPlace();
                }}
              >
                <Input
                  aria-label="Another location"
                  placeholder="Another location"
                  value={newPlace}
                  maxLength={60}
                  onChange={(e) => setNewPlace(e.target.value)}
                  className="h-8 w-[160px] text-[13px]"
                />
                <Button
                  type="submit"
                  variant="outline"
                  size="sm"
                  disabled={!newPlace.trim()}
                >
                  Add
                </Button>
              </form>
            </div>
          </fieldset>
        )}

        {error && (
          <p role="alert" className="text-red flex items-start gap-2 text-[13px]">
            <WarningCircleIcon size={16} className="mt-px shrink-0" />
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <Button disabled={busy} onClick={() => void submit()}>
            {draft.id ? (
              "Save changes"
            ) : (
              <>
                <PlusIcon size={14} weight="bold" />
                Add {KIND_LABEL[draft.kind].toLowerCase()}
              </>
            )}
          </Button>
          {(draft.id || draft.date || draft.label) && (
            <Button
              variant="ghost"
              onClick={() => {
                setError(null);
                setDraft(blank());
              }}
            >
              {draft.id ? "Cancel editing" : "Clear"}
            </Button>
          )}
        </div>
      </section>

      <div className="mt-6 flex items-center gap-3">
        <h3 className="text-ink text-[14px] font-bold">
          {holidays} {holidays === 1 ? "holiday" : "holidays"} in
        </h3>
        <select
          aria-label="Year"
          className={cn(SELECT_CLASS, "h-8 w-[100px]")}
          value={year}
          onChange={(e) => setYear(e.target.value)}
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>

      {list.length === 0 ? (
        <p className="text-ink-muted mt-3 text-[13px]">Nothing entered for {year} yet.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {list.map((event) => (
            <li
              key={event.id}
              className={cn(
                "border-line bg-card rounded-card flex items-start gap-3 border px-3 py-2.5",
                draft.id === event.id && "border-accent",
              )}
            >
              <span
                className={cn(
                  "rounded-chip mt-0.5 w-[88px] shrink-0 px-2 py-1 text-center text-[11.5px] leading-tight font-bold",
                  hueClass(
                    event.kind === "holiday"
                      ? "hol"
                      : event.kind === "swap"
                        ? "swap"
                        : "off",
                  ),
                )}
              >
                {DAY[weekdayIndex(event.date)]}
                <br />
                {formatRange(event.date, event.endDate)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-ink text-[13.5px] font-semibold">{event.label}</p>
                {event.kind === "holiday" ? (
                  <>
                    <p className="text-ink-muted mt-0.5 text-[12px]">
                      {describeLocations(event.locations, choices)}
                    </p>
                    <ul
                      className="mt-1.5 flex flex-wrap gap-1"
                      aria-label={`Locations observing ${event.label}`}
                    >
                      {choices.map((place) => {
                        const on = observes(event, place);
                        return (
                          <li
                            key={place}
                            title={`${place}${on ? "" : " (works)"}`}
                            className={cn(
                              "rounded-sm px-1.5 py-px text-[10.5px] font-bold",
                              on ? "rh-hol" : "text-ink-faint bg-chip",
                            )}
                          >
                            {abbreviate(place)}
                          </li>
                        );
                      })}
                    </ul>
                  </>
                ) : (
                  <p className="text-ink-muted mt-0.5 text-[12px]">
                    {KIND_LABEL[event.kind]}, for everyone
                  </p>
                )}
              </div>
              <IconButton
                aria-label={`Edit ${event.label}`}
                size="sm"
                onClick={() => edit(event)}
              >
                <PencilSimpleIcon />
              </IconButton>
              <IconButton
                aria-label={`Delete ${event.label}`}
                size="sm"
                disabled={busy}
                onClick={() => {
                  if (draft.id === event.id) setDraft(blank());
                  void persist(config.events.filter((e) => e.id !== event.id));
                }}
              >
                <TrashIcon />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
