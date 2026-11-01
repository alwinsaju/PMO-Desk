"use client";

import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  CaretDownIcon,
  DownloadSimpleIcon,
  FileXlsIcon,
  MagnifyingGlassIcon,
  UserPlusIcon,
  UsersThreeIcon,
  XIcon,
} from "@phosphor-icons/react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  Input,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatDate, relativeDays, todayIso } from "@/lib/staff/dates";
import {
  NO_FILTER,
  SORT_LABELS,
  distinctValues,
  displayName,
  employeesToCsv,
  filterEmployees,
  isAwaitingProfile,
  rollOffStatus,
  rosterStats,
  sortEmployees,
  type DirectoryFilter,
  type SortKey,
} from "@/lib/staff/employees";
import { useStaffStore } from "@/lib/staff/staffStore";
import { noSpellcheck } from "@/lib/ui/noSpellcheck";
import {
  COLUMN_WIDTHS_KEY,
  DIRECTORY_COLUMNS,
  MAX_COLUMN_WIDTH,
  PANE_WIDTH,
  PANE_WIDTH_KEY,
  clampColumnWidth,
  clampPaneWidth,
  fitColumns,
  parseColumnWidths,
  parsePaneWidth,
  visibleColumns,
  type ColumnWidths,
  type DirectoryColumnKey,
} from "@/lib/staff/layout";
import type { Employee } from "@/lib/staff/types";
import { EmployeeDialog } from "./EmployeeDialog";
import { EmployeePane } from "./EmployeePane";
import { ImportDialog } from "./ImportDialog";
import { readSetting, writeSetting } from "./localSetting";
import { DASH, EmployeeAvatar, EmptyState, FilterMenu, TonePill } from "./parts";
import { ResizeHandle } from "./ResizeHandle";
import { useElementWidth } from "./useElementWidth";

function downloadCsv(employees: readonly Employee[]) {
  const blob = new Blob(["\uFEFF", employeesToCsv(employees)], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `staff-roster-${todayIso()}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function DirectoryTab() {
  const employees = useStaffStore((s) => s.employees);
  const status = useStaffStore((s) => s.status);

  const [filter, setFilter] = useState<DirectoryFilter>(NO_FILTER);
  const [sort, setSort] = useState<SortKey>("name");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [paneOpen, setPaneOpen] = useState(false);
  const [dialog, setDialog] = useState<
    { kind: "add" } | { kind: "edit"; employee: Employee } | { kind: "import" } | null
  >(null);

  const today = todayIso();
  const [widths, setWidths] = useState<ColumnWidths>(() =>
    parseColumnWidths(readSetting(COLUMN_WIDTHS_KEY)),
  );
  const [paneWidth, setPaneWidth] = useState(() =>
    parsePaneWidth(readSetting(PANE_WIDTH_KEY)),
  );
  const layoutRef = useRef<HTMLDivElement>(null);
  const [tableAreaRef, tableWidth] = useElementWidth();
  const revealRef = useRef<string | null>(null);

  useEffect(() => {
    writeSetting(COLUMN_WIDTHS_KEY, JSON.stringify(widths));
  }, [widths]);
  useEffect(() => {
    writeSetting(PANE_WIDTH_KEY, String(paneWidth));
  }, [paneWidth]);

  const resizeColumn = (key: DirectoryColumnKey, width: number) =>
    setWidths((w) => ({ ...w, [key]: clampColumnWidth(key, width) }));
  const resizePane = (width: number) =>
    setPaneWidth(clampPaneWidth(width, layoutRef.current?.clientWidth));

  const shown = useMemo(
    () => sortEmployees(filterEmployees(employees, filter), sort),
    [employees, filter, sort],
  );
  const stats = useMemo(() => rosterStats(employees, today), [employees, today]);
  const ops = useMemo(() => distinctValues(employees, "op"), [employees]);
  const offerings = useMemo(() => distinctValues(employees, "offering"), [employees]);
  const levels = useMemo(() => distinctValues(employees, "level"), [employees]);
  const columns = useMemo(
    () => fitColumns(visibleColumns(employees), widths, tableWidth),
    [employees, widths, tableWidth],
  );

  // The details pane stays closed until someone is picked.
  const selected = shown.find((e) => e.id === selectedId) ?? null;
  const showPane = selected !== null && paneOpen;
  const filtering =
    filter.query !== "" ||
    filter.location !== "" ||
    filter.op !== "" ||
    filter.offering !== "" ||
    filter.level !== "";

  // A person just added or edited is scrolled into view once their row exists.
  useEffect(() => {
    const id = revealRef.current;
    if (!id || id !== selectedId) return;
    const row = layoutRef.current?.querySelector<HTMLElement>(
      `[data-employee-id="${CSS.escape(id)}"]`,
    );
    if (!row) return;
    row.scrollIntoView({ block: "nearest" });
    revealRef.current = null;
  }, [shown, selectedId]);

  const setFilterKey = <K extends keyof DirectoryFilter>(
    key: K,
    value: DirectoryFilter[K],
  ) => setFilter((f) => ({ ...f, [key]: value }));

  if (status === "idle" || (status === "loading" && employees.length === 0)) {
    return <p className="text-ink-muted p-8 text-center text-sm">Loading the roster…</p>;
  }
  if (status === "offline" && employees.length === 0) {
    return (
      <EmptyState
        icon={<UsersThreeIcon size={26} />}
        title="Can't reach the AI OS server"
      >
        The roster will load automatically once the server is available.
      </EmptyState>
    );
  }

  const addButtons = (
    <>
      <Button variant="outline" onClick={() => setDialog({ kind: "import" })}>
        <FileXlsIcon size={16} weight="bold" />
        Import from Excel
      </Button>
      <Button onClick={() => setDialog({ kind: "add" })}>
        <UserPlusIcon size={16} weight="bold" />
        Add employee
      </Button>
    </>
  );

  return (
    <div ref={layoutRef} className="relative flex min-h-0 flex-1">
      <section
        className="@container flex min-w-0 flex-1 flex-col"
        aria-label="Employee directory"
      >
        <div className="flex flex-wrap items-center gap-2 px-5 pb-3">
          <div className="relative min-w-[180px] flex-1 @2xl:max-w-[280px]">
            <MagnifyingGlassIcon
              size={15}
              className="text-ink-muted pointer-events-none absolute top-1/2 left-3 -translate-y-1/2"
            />
            <Input
              {...noSpellcheck}
              aria-label="Search employees"
              placeholder="Search name, email, skill…"
              value={filter.query}
              onChange={(e) => setFilterKey("query", e.target.value)}
              className="h-8 pl-9 text-[13px]"
            />
          </div>
          <FilterMenu
            label="locations"
            value={filter.location}
            options={["Onshore", "Offshore"]}
            onChange={(v) => setFilterKey("location", v as DirectoryFilter["location"])}
          />
          {ops.length > 0 && (
            <FilterMenu
              label="offering portfolios"
              value={filter.op}
              options={ops}
              onChange={(v) => setFilterKey("op", v)}
            />
          )}
          {offerings.length > 0 && (
            <FilterMenu
              label="offerings"
              value={filter.offering}
              options={offerings}
              onChange={(v) => setFilterKey("offering", v)}
            />
          )}
          {levels.length > 0 && (
            <FilterMenu
              label="levels"
              value={filter.level}
              options={levels}
              onChange={(v) => setFilterKey("level", v)}
            />
          )}{" "}
          {filtering && (
            <Button variant="ghost" size="sm" onClick={() => setFilter(NO_FILTER)}>
              <XIcon size={12} weight="bold" />
              Clear
            </Button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" aria-label="Sort employees">
                  Sort: {SORT_LABELS[sort]}
                  <CaretDownIcon size={12} weight="bold" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuRadioGroup
                  value={sort}
                  onValueChange={(v) => setSort(v as SortKey)}
                >
                  {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                    <DropdownMenuRadioItem key={key} value={key}>
                      {SORT_LABELS[key]}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            {employees.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                aria-label="Export roster as CSV"
                onClick={() => downloadCsv(sortEmployees(employees, "name"))}
              >
                <DownloadSimpleIcon size={14} weight="bold" />
                Export
              </Button>
            )}
          </div>
        </div>

        <div ref={tableAreaRef} className="scroll-thin min-h-0 flex-1 overflow-y-auto">
          {employees.length === 0 ? (
            <EmptyState
              icon={<UsersThreeIcon size={26} />}
              title="No one on the roster yet"
              actions={addButtons}
            >
              Add people by their Deloitte email and their profile fills in from M365, or
              import your existing roster workbook. Every other app reads people from
              here.
            </EmptyState>
          ) : shown.length === 0 ? (
            <EmptyState
              icon={<MagnifyingGlassIcon size={26} />}
              title="No one matches"
              actions={
                <Button variant="outline" onClick={() => setFilter(NO_FILTER)}>
                  Clear search and filters
                </Button>
              }
            >
              Try a different name, or remove a filter.
            </EmptyState>
          ) : (
            <EmployeeTable
              employees={shown}
              selectedId={showPane ? selected.id : null}
              today={today}
              keys={columns.keys}
              widths={columns.widths}
              onWidth={resizeColumn}
              onSelect={(id) => {
                setSelectedId(id);
                setPaneOpen(true);
              }}
            />
          )}
        </div>

        {employees.length > 0 && (
          <div className="border-line flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t px-5 py-2">
            <div className="text-ink-muted flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px]">
              <span>
                <strong className="text-ink font-bold">
                  {filtering ? `${shown.length} of ${stats.total}` : stats.total}
                </strong>{" "}
                {filtering ? "shown" : stats.total === 1 ? "person" : "people"}
              </span>
              <span>{stats.onshore} onshore</span>
              <span>{stats.offshore} offshore</span>
              {stats.rollingOff > 0 && (
                <span className="text-amber font-semibold">
                  {stats.rollingOff} rolling off soon
                </span>
              )}
              {stats.awaitingProfile > 0 && (
                <span className="text-info font-semibold">
                  {stats.awaitingProfile} waiting for M365 profile
                </span>
              )}
            </div>
            <div className="flex gap-2">{addButtons}</div>
          </div>
        )}
      </section>

      {showPane && (
        <aside
          aria-label={`Details for ${displayName(selected)}`}
          style={{ "--pane-w": `${paneWidth}px` } as CSSProperties}
          className={cn(
            "border-line bg-surface-elevated z-10 flex w-[340px] max-w-full shrink-0 border-l",
            "shadow-pop absolute inset-y-0 right-0 @3xl:relative @3xl:inset-auto @3xl:w-[var(--pane-w)] @3xl:max-w-[calc(100%-320px)] @3xl:shadow-none",
          )}
        >
          <ResizeHandle
            label="Resize the details pane"
            value={paneWidth}
            min={PANE_WIDTH.min}
            max={PANE_WIDTH.max}
            invert
            onChange={resizePane}
            onReset={() => setPaneWidth(PANE_WIDTH.default)}
            className="inset-y-0 left-[-4px] hidden @3xl:flex"
          />
          <div className="min-w-0 flex-1">
            <EmployeePane
              key={selected.id}
              employee={selected}
              onEdit={() => setDialog({ kind: "edit", employee: selected })}
              onDeleted={() => {
                setSelectedId(null);
                setPaneOpen(false);
              }}
              onClose={() => setPaneOpen(false)}
            />
          </div>
        </aside>
      )}

      <EmployeeDialog
        open={dialog?.kind === "add" || dialog?.kind === "edit"}
        employee={dialog?.kind === "edit" ? dialog.employee : null}
        onOpenChange={(open) => !open && setDialog(null)}
        onSaved={(id) => {
          revealRef.current = id;
          setSelectedId(id);
          setPaneOpen(true);
          setFilter(NO_FILTER);
        }}
      />
      <ImportDialog
        open={dialog?.kind === "import"}
        onOpenChange={(open) => !open && setDialog(null)}
      />
    </div>
  );
}

const HEAD = "px-3 py-2 text-left text-[11.5px] font-bold tracking-[0.06em] uppercase";
const CELL = "text-ink-soft truncate px-3 py-2 text-[13px]";

type RowContext = { employee: Employee; today: string };

/** One cell per optional column; the employee column is drawn by the table itself. */
const CELLS: Record<
  Exclude<DirectoryColumnKey, "employee">,
  (ctx: RowContext) => ReactNode
> = {
  level: ({ employee }) => (
    <td className={CELL} title={employee.level}>
      {employee.level || DASH}
    </td>
  ),
  op: ({ employee }) => (
    <td className={CELL} title={employee.op}>
      {employee.op || DASH}
    </td>
  ),
  offering: ({ employee }) => (
    <td className={CELL} title={employee.offering}>
      {employee.offering || DASH}
    </td>
  ),
  team: ({ employee }) => (
    <td className={CELL} title={employee.team}>
      {employee.team || DASH}
    </td>
  ),
  location: ({ employee }) => (
    <td className="truncate px-3 py-2">
      {employee.location ? (
        <TonePill tone={employee.location === "Onshore" ? "accent" : "neutral"}>
          {employee.location}
        </TonePill>
      ) : (
        DASH
      )}
    </td>
  ),
  rolloff: ({ employee, today }) => {
    const rolloff = rollOffStatus(employee.rollOffDate, today);
    return (
      <td className="truncate px-3 py-2 text-[13px]">
        {employee.rollOffDate ? (
          <span
            className={cn(
              "whitespace-nowrap",
              rolloff.kind === "soon" && "text-amber font-semibold",
              rolloff.kind === "past" && "text-red font-semibold",
              rolloff.kind === "later" && "text-ink-soft",
            )}
            title={rolloff.kind === "none" ? undefined : relativeDays(rolloff.days)}
          >
            {formatDate(employee.rollOffDate)}
          </span>
        ) : (
          DASH
        )}
      </td>
    );
  },
};

function EmployeeTable({
  employees,
  selectedId,
  today,
  onSelect,
  keys,
  widths,
  onWidth,
}: {
  employees: Employee[];
  selectedId: string | null;
  today: string;
  onSelect: (id: string) => void;
  /** The columns to draw (empty ones are left out; narrow lists drop some). */
  keys: readonly DirectoryColumnKey[];
  widths: ColumnWidths;
  onWidth: (key: DirectoryColumnKey, width: number) => void;
}) {
  const columns = DIRECTORY_COLUMNS.filter((c) => keys.includes(c.key));
  return (
    <table className="w-full table-fixed border-collapse text-left">
      <colgroup>
        {columns.map((column) => (
          <col key={column.key} style={{ width: widths[column.key] }} />
        ))}
        <col />
      </colgroup>
      <thead className="text-ink-muted bg-surface-elevated sticky top-0 z-[1]">
        <tr className="border-line border-b">
          {columns.map((column, index) => (
            <th
              key={column.key}
              scope="col"
              className={cn(HEAD, "relative", index === 0 && "pl-5")}
            >
              <span className="block truncate">{column.label}</span>
              <ResizeHandle
                label={`Resize the ${column.label} column`}
                value={widths[column.key]}
                min={column.min}
                max={MAX_COLUMN_WIDTH}
                onChange={(width) => onWidth(column.key, width)}
                onReset={() => onWidth(column.key, column.width)}
                className="top-0 right-[-4px] h-full"
              />
            </th>
          ))}
          <th scope="col" aria-hidden className="p-0" />
        </tr>
      </thead>
      <tbody>
        {employees.map((employee) => {
          const active = employee.id === selectedId;
          return (
            <tr
              key={employee.id}
              data-employee-id={employee.id}
              tabIndex={0}
              aria-selected={active}
              onClick={() => onSelect(employee.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(employee.id);
                } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  const next =
                    e.key === "ArrowDown"
                      ? e.currentTarget.nextElementSibling
                      : e.currentTarget.previousElementSibling;
                  (next as HTMLElement | null)?.focus();
                }
              }}
              className={cn(
                "border-line group cursor-pointer scroll-mt-10 border-b outline-none",
                "transition-colors duration-150",
                "focus-visible:ring-focus focus-visible:ring-2 focus-visible:ring-inset",
                active ? "bg-accent-soft" : "hover:bg-chip",
              )}
            >
              <td
                className={cn(
                  "py-2 pr-3 pl-5",
                  active && "shadow-[inset_3px_0_0_var(--color-accent)]",
                )}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <EmployeeAvatar employee={employee} />
                  <div className="min-w-0">
                    <p
                      className="text-ink truncate text-[13.5px] font-semibold"
                      title={
                        isAwaitingProfile(employee)
                          ? "Waiting for the M365 profile"
                          : undefined
                      }
                    >
                      {displayName(employee)}
                    </p>
                    <p
                      className="text-ink-muted truncate text-[12px]"
                      title={employee.deloitteEmail}
                    >
                      {employee.deloitteEmail}
                    </p>
                  </div>
                </div>
              </td>
              {columns.slice(1).map((column) => (
                <Fragment key={column.key}>
                  {CELLS[column.key as Exclude<DirectoryColumnKey, "employee">]({
                    employee,
                    today,
                  })}
                </Fragment>
              ))}
              <td aria-hidden className="p-0" />
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
