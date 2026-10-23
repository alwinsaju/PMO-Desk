"use client";

import { useMemo, useState } from "react";
import {
  ArrowRightIcon,
  CaretDownIcon,
  CaretUpIcon,
  ProhibitIcon,
} from "@phosphor-icons/react";
import {
  Button,
  ScrollArea,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  blockers,
  changeStats,
  filterChanges,
  flagDelta,
  sortChanges,
  type ChangeSortKey,
  type SortDirection,
} from "./diffView";
import { GateNote, SearchField, SeverityChip } from "./GateParts";
import type { GateData } from "./useGateData";
import type { CellChange, Flag, RosterDiff } from "./types";

const PAGE_SIZE = 300;

/**
 * The confirm step's review: every changed cell (person, date, before →
 * after, searchable and sortable), the changes that fall outside the plan,
 * issues, and the flag delta. If the diff carries `blocking` items they sit
 * on top, impossible to miss, and the confirm button (in the action bar
 * below the tabs) is disabled — the backend refuses the confirm too.
 */
export function DiffGatePanel({ gate }: { gate: GateData }) {
  if (gate.status === "loading" || gate.status === "idle") {
    return <GateNote>Loading changes…</GateNote>;
  }
  if (!gate.diff) {
    return (
      <GateNote>
        {gate.error ?? "No comparison has been written for this run yet."}
      </GateNote>
    );
  }
  return <DiffBody diff={gate.diff} />;
}

function DiffBody({ diff }: { diff: RosterDiff }) {
  const blocking = blockers(diff);
  const stats = changeStats(diff.changes ?? []);
  const outside = diff.outside_changes ?? [];
  const issues = diff.issues ?? [];
  const delta = flagDelta(diff);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5">
      {blocking.length > 0 && (
        <div
          role="alert"
          className="border-ink flex flex-col gap-1.5 rounded-lg border-2 bg-neutral-50 p-3"
        >
          <p className="text-ink flex items-center gap-1.5 text-[13px] font-semibold">
            <ProhibitIcon size={15} weight="bold" aria-hidden />
            Can&apos;t confirm — {blocking.length} blocking issue
            {blocking.length === 1 ? "" : "s"}
          </p>
          <ul className="flex flex-col gap-1">
            {blocking.map((item, index) => (
              <li
                key={`${item.kind}-${index}`}
                className="text-ink-muted text-[12px] break-words"
              >
                <span className="text-ink font-mono text-[11px]">{item.kind}</span>
                {item.message ? ` — ${item.message}` : ""}
              </li>
            ))}
          </ul>
          <p className="text-ink-faint text-[11px]">
            Fix this at the source and re-run the comparison; the confirm button stays
            disabled until nothing is blocking.
          </p>
        </div>
      )}

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          label="Cells changed"
          value={stats.cells}
          hint={`${stats.people} ${stats.people === 1 ? "person" : "people"}`}
        />
        <Stat label="Outside the plan" value={outside.length} />
        <Stat label="Issues" value={issues.length} />
        <Stat
          label="Flags"
          value={`+${delta.added} / −${delta.resolved}`}
          hint={`${delta.remaining} remaining`}
        />
      </dl>

      <Tabs defaultValue="changes" className="flex min-h-0 flex-1 flex-col">
        <TabsList className="self-start">
          <TabsTrigger value="changes">Changed cells ({stats.cells})</TabsTrigger>
          <TabsTrigger value="outside">Outside plan ({outside.length})</TabsTrigger>
          <TabsTrigger value="issues">Issues ({issues.length})</TabsTrigger>
          <TabsTrigger value="flags">Flag delta</TabsTrigger>
        </TabsList>

        <TabsContent value="changes" className="mt-2 min-h-0 flex-1">
          <ChangeTable
            changes={diff.changes ?? []}
            empty="No cells changed."
            label="Changed cells"
          />
        </TabsContent>
        <TabsContent value="outside" className="mt-2 min-h-0 flex-1">
          <p className="text-ink-faint mb-2 text-[11px]">
            Cells you edited that the plan didn&apos;t expect to change.
          </p>
          <ChangeTable
            changes={outside}
            empty="Nothing changed outside the plan."
            label="Outside the plan"
          />
        </TabsContent>
        <TabsContent value="issues" className="mt-2 min-h-0 flex-1">
          <ScrollArea className="border-border/60 h-[min(18rem,40vh)] rounded-lg border">
            {issues.length === 0 ? (
              <GateNote>No issues found.</GateNote>
            ) : (
              <ul className="divide-border/60 divide-y">
                {issues.map((issue, index) => (
                  <li key={index} className="flex flex-col gap-1 px-3 py-2 select-text">
                    <div className="flex items-center gap-2">
                      <SeverityChip severity={issue.severity} />
                      <span className="text-ink-muted font-mono text-[11px]">
                        {issue.kind}
                      </span>
                    </div>
                    <p className="text-ink-muted text-[12px] break-words">
                      {issue.message}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </ScrollArea>
        </TabsContent>
        <TabsContent value="flags" className="mt-2 min-h-0 flex-1">
          <ScrollArea className="border-border/60 h-[min(18rem,40vh)] rounded-lg border">
            <div className="flex flex-col gap-3 p-3">
              <p className="text-ink-muted text-[12px]">
                <strong className="text-ink font-semibold">{delta.added}</strong> new ·{" "}
                <strong className="text-ink font-semibold">{delta.resolved}</strong>{" "}
                resolved ·{" "}
                <strong className="text-ink font-semibold">{delta.remaining}</strong>{" "}
                remaining after your edits.
              </p>
              <FlagList title="New flags" flags={diff.flags?.new ?? []} />
              <FlagList title="Resolved flags" flags={diff.flags?.resolved ?? []} />
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | string;
  hint?: string;
}) {
  return (
    <div className="border-border/60 rounded-lg border px-3 py-2">
      <dt className="text-ink-faint text-[10px] font-semibold tracking-wide uppercase">
        {label}
      </dt>
      <dd className="text-ink text-[16px] leading-tight font-semibold">{value}</dd>
      {hint && <p className="text-ink-faint text-[11px]">{hint}</p>}
    </div>
  );
}

function FlagList({ title, flags }: { title: string; flags: Flag[] }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-ink-muted text-[11px] font-semibold tracking-wide uppercase">
        {title} ({flags.length})
      </p>
      {flags.length === 0 ? (
        <p className="text-ink-faint text-[12px]">None.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {flags.map((flag, index) => (
            <li
              key={`${flag.key}-${index}`}
              className="flex flex-col gap-0.5 select-text"
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <SeverityChip severity={flag.severity} />
                <span className="text-ink-muted font-mono text-[11px]">{flag.kind}</span>
                <span className="text-ink text-[12px] font-medium">
                  {flag.person ?? <span className="text-ink-faint">—</span>}
                </span>
                <span className="text-ink-faint font-mono text-[11px]">
                  {flag.date ?? "—"}
                </span>
                {(flag.team || flag.shift) && (
                  <span className="text-ink-faint text-[11px]">
                    {[flag.team, flag.shift].filter(Boolean).join(" · ")}
                  </span>
                )}
              </div>
              <p className="text-ink-muted text-[12px] break-words">{flag.message}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const COLUMNS: { key: ChangeSortKey; label: string }[] = [
  { key: "person", label: "Person" },
  { key: "date", label: "Date" },
  { key: "before", label: "Before" },
  { key: "after", label: "After" },
];

/** Searchable, sortable table of cell changes. Sorting by Before/After is
 *  offered too, but Person and Date are the two the reviewer lives in. */
function ChangeTable({
  changes,
  empty,
  label,
}: {
  changes: CellChange[];
  empty: string;
  label: string;
}) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<ChangeSortKey>("person");
  const [direction, setDirection] = useState<SortDirection>("asc");
  const [limit, setLimit] = useState(PAGE_SIZE);

  const rows = useMemo(
    () => sortChanges(filterChanges(changes, query), sortKey, direction),
    [changes, query, sortKey, direction],
  );

  const toggleSort = (key: ChangeSortKey) => {
    if (key === sortKey) setDirection((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setDirection("asc");
    }
  };

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <div className="flex items-center gap-2">
        <SearchField
          value={query}
          onChange={(value) => {
            setQuery(value);
            setLimit(PAGE_SIZE);
          }}
          placeholder="Search person, date, shift…"
          label={`Search ${label.toLowerCase()}`}
          className="flex-1"
        />
        <span className="text-ink-faint text-[11px] whitespace-nowrap" aria-live="polite">
          {rows.length === changes.length
            ? `${rows.length} rows`
            : `${rows.length} of ${changes.length}`}
        </span>
      </div>

      <ScrollArea className="border-border/60 h-[min(18rem,40vh)] rounded-lg border">
        {changes.length === 0 ? (
          <GateNote>{empty}</GateNote>
        ) : rows.length === 0 ? (
          <GateNote>No changes match.</GateNote>
        ) : (
          <table
            className="w-full border-collapse text-left text-[12px]"
            aria-label={label}
          >
            <thead className="border-border/60 sticky top-0 z-10 border-b bg-neutral-50">
              <tr>
                {COLUMNS.slice(0, 2).map((column) => (
                  <SortHeader
                    key={column.key}
                    column={column}
                    active={sortKey === column.key}
                    direction={direction}
                    onSort={toggleSort}
                  />
                ))}
                <th
                  scope="col"
                  className="text-ink-muted px-3 py-1.5 text-[11px] font-semibold tracking-wide uppercase"
                >
                  <span className="inline-flex items-center gap-2">
                    {COLUMNS.slice(2).map((column, index) => (
                      <span key={column.key} className="inline-flex items-center gap-2">
                        {index > 0 && (
                          <ArrowRightIcon size={11} weight="bold" aria-hidden />
                        )}
                        <SortButton
                          column={column}
                          active={sortKey === column.key}
                          direction={direction}
                          onSort={toggleSort}
                        />
                      </span>
                    ))}
                  </span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-border/60 divide-y">
              {rows.slice(0, limit).map((row, index) => (
                <tr key={`${row.person}|${row.date}|${index}`} className="select-text">
                  <td className="text-ink px-3 py-1.5 font-medium break-words">
                    {row.person ?? <span className="text-ink-faint">—</span>}
                  </td>
                  <td className="text-ink-muted px-3 py-1.5 font-mono text-[11px] whitespace-nowrap">
                    {row.date ?? "—"}
                  </td>
                  <td className="px-3 py-1.5">
                    <span className="inline-flex flex-wrap items-center gap-1.5">
                      <Cell value={row.before} />
                      <ArrowRightIcon
                        size={11}
                        weight="bold"
                        className="text-ink-faint"
                        aria-label="changed to"
                      />
                      <Cell value={row.after} strong />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {rows.length > limit && (
          <div className="p-2 text-center">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setLimit((n) => n + PAGE_SIZE)}
            >
              Show {Math.min(PAGE_SIZE, rows.length - limit)} more of{" "}
              {rows.length - limit}
            </Button>
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

function Cell({ value, strong = false }: { value: string | null; strong?: boolean }) {
  if (value === null || value === "") {
    return <span className="text-ink-faint text-[11px] italic">(empty)</span>;
  }
  return (
    <span
      className={cn(
        "rounded-control px-1.5 py-0.5 font-mono text-[11px]",
        strong
          ? "bg-accent-subtle text-accent-800 font-medium"
          : "text-ink-muted bg-neutral-100",
      )}
    >
      {value}
    </span>
  );
}

function SortButton({
  column,
  active,
  direction,
  onSort,
}: {
  column: { key: ChangeSortKey; label: string };
  active: boolean;
  direction: SortDirection;
  onSort: (key: ChangeSortKey) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSort(column.key)}
      className={cn(
        "focus-visible:ring-accent hover:text-ink inline-flex items-center gap-1 rounded uppercase outline-none focus-visible:ring-2",
        active && "text-ink",
      )}
    >
      {column.label}
      {active &&
        (direction === "asc" ? (
          <CaretUpIcon size={10} weight="bold" aria-hidden />
        ) : (
          <CaretDownIcon size={10} weight="bold" aria-hidden />
        ))}
    </button>
  );
}

function SortHeader(props: {
  column: { key: ChangeSortKey; label: string };
  active: boolean;
  direction: SortDirection;
  onSort: (key: ChangeSortKey) => void;
}) {
  return (
    <th
      scope="col"
      aria-sort={
        props.active ? (props.direction === "asc" ? "ascending" : "descending") : "none"
      }
      className="text-ink-muted px-3 py-1.5 text-[11px] font-semibold tracking-wide uppercase"
    >
      <SortButton {...props} />
    </th>
  );
}
