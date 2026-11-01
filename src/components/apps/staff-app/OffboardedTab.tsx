"use client";

import { useMemo, useState } from "react";
import {
  ArrowCounterClockwiseIcon,
  MagnifyingGlassIcon,
  PencilSimpleIcon,
  TrashIcon,
  UserMinusIcon,
} from "@phosphor-icons/react";
import { Button, IconButton, Input } from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatDate, todayIso } from "@/lib/staff/dates";
import {
  NO_FILTER,
  defaultSortDir,
  displayName,
  filterEmployees,
  sortEmployees,
  type SortDir,
  type SortKey,
} from "@/lib/staff/employees";
import { useRosterStore } from "@/lib/staff/rosterStore";
import { useStaffPrefs } from "@/lib/staff/staffPrefsStore";
import { useStaffStore } from "@/lib/staff/staffStore";
import type { OffboardedEmployee } from "@/lib/staff/types";
import { EmployeeDialog } from "./EmployeeDialog";
import {
  ConfirmDialog,
  DASH,
  EmployeeAvatar,
  EmptyState,
  LevelChip,
  LocationChip,
  SortableTh,
  TH_CLASS,
} from "./parts";

type OffboardedSortKey = SortKey | "offboarded";
type OffboardedSort = { key: OffboardedSortKey; dir: SortDir };

const compareOffboarded = (a: OffboardedEmployee, b: OffboardedEmployee) =>
  a.offboardedAt.localeCompare(b.offboardedAt);

function offboardedOn(person: OffboardedEmployee): string {
  const at = new Date(person.offboardedAt);
  return Number.isNaN(at.getTime()) ? "" : formatDate(todayIso(at));
}

/** People who left the roster: still on file, hidden from every other app. */
export function OffboardedTab() {
  const offboarded = useStaffStore((s) => s.offboarded);
  const status = useStaffStore((s) => s.status);
  const commit = useStaffStore((s) => s.commit);
  const restore = useStaffStore((s) => s.restore);

  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<OffboardedSort>({ key: "offboarded", dir: "desc" });
  const [editing, setEditing] = useState<OffboardedEmployee | null>(null);
  const [deleting, setDeleting] = useState<OffboardedEmployee | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shown = useMemo(() => {
    const found = filterEmployees(offboarded, { ...NO_FILTER, query });
    if (sort.key !== "offboarded") return sortEmployees(found, sort.key, sort.dir);
    const sign = sort.dir === "desc" ? -1 : 1;
    return [...found].sort((a, b) => sign * compareOffboarded(a, b));
  }, [offboarded, query, sort]);

  const onSort = (key: OffboardedSortKey) =>
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "offboarded" ? "desc" : defaultSortDir(key) },
    );

  if (status === "idle" || (status === "loading" && offboarded.length === 0)) {
    return <p className="text-ink-muted p-8 text-center text-sm">Loading…</p>;
  }

  async function bringBack(person: OffboardedEmployee) {
    setError(null);
    const result = await restore([person.id]);
    if (!result.ok) setError(result.reason);
  }

  async function deleteForGood() {
    if (!deleting) return;
    setBusy(true);
    setError(null);
    const result = await commit("offboarded", { remove: [deleting.id] });
    setBusy(false);
    if (result.ok) {
      const id = deleting.id;
      useStaffPrefs.getState().update((p) => ({
        ...p,
        checklists: p.checklists.filter((c) => c.employeeId !== id),
        seenEmployees: p.seenEmployees.filter(
          (s) => s !== id && s !== `offboarding:${id}`,
        ),
      }));
      // Their roster entry and shifts went with them on the server.
      void useRosterStore.getState().load();
      void useStaffStore.getState().load();
      setDeleting(null);
    } else setError(result.reason);
  }

  return (
    <div className="@container flex min-h-0 flex-1 flex-col">
      {offboarded.length === 0 ? (
        <EmptyState icon={<UserMinusIcon size={26} />} title="No one has been offboarded">
          People you remove from the roster in the Directory are kept here. You can edit
          their details, restore them or delete their profile for good.
        </EmptyState>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 px-5 pb-3">
            <div className="relative min-w-[180px] flex-1 @2xl:max-w-[280px]">
              <MagnifyingGlassIcon
                size={15}
                className="text-ink-muted pointer-events-none absolute top-1/2 left-3 -translate-y-1/2"
              />
              <Input
                aria-label="Search offboarded employees"
                placeholder="Search name, email, skill…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-8 pl-9 text-[13px]"
              />
            </div>
            <span className="text-ink-muted text-[12.5px]">
              {query.trim()
                ? `${shown.length} of ${offboarded.length} shown`
                : `${offboarded.length} offboarded`}
            </span>
            {error && !deleting && (
              <span role="alert" className="text-red text-[12.5px]">
                {error}
              </span>
            )}
          </div>
          <div className="scroll-thin min-h-0 flex-1 overflow-auto">
            {shown.length === 0 ? (
              <EmptyState icon={<MagnifyingGlassIcon size={26} />} title="No one matches">
                Try a different name or email.
              </EmptyState>
            ) : (
              <table className="w-full border-collapse text-left">
                <thead className="text-ink-muted bg-surface-elevated sticky top-0 z-[1]">
                  <tr className="border-line border-b">
                    <SortableTh
                      label="Employee"
                      sortKey="name"
                      sort={sort}
                      onSort={onSort}
                      className="pl-5"
                    />
                    <SortableTh
                      label="Level"
                      sortKey="level"
                      sort={sort}
                      onSort={onSort}
                    />
                    <SortableTh
                      label="Offering portfolio"
                      sortKey="op"
                      sort={sort}
                      onSort={onSort}
                      className="hidden @3xl:table-cell"
                    />
                    <SortableTh
                      label="Team"
                      sortKey="team"
                      sort={sort}
                      onSort={onSort}
                      className="hidden @2xl:table-cell"
                    />
                    <SortableTh
                      label="Location"
                      sortKey="location"
                      sort={sort}
                      onSort={onSort}
                      className="hidden @4xl:table-cell"
                    />
                    <SortableTh
                      label="Roll-off"
                      sortKey="rolloff"
                      sort={sort}
                      onSort={onSort}
                      className="hidden @4xl:table-cell"
                    />
                    <SortableTh
                      label="Offboarded"
                      sortKey="offboarded"
                      sort={sort}
                      onSort={onSort}
                    />
                    <th scope="col" className={cn(TH_CLASS, "pr-5 text-right")}>
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((person) => (
                    <tr key={person.id} className="border-line hover:bg-chip border-b">
                      <td className="py-1.5 pr-3 pl-5">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <EmployeeAvatar employee={person} size="sm" />
                          <div className="min-w-0">
                            <p className="text-ink truncate text-[13.5px] font-semibold">
                              {displayName(person)}
                            </p>
                            <p className="text-ink-muted truncate text-[12px]">
                              {person.deloitteEmail}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-1.5">
                        <LevelChip level={person.level} />
                      </td>
                      <td className="text-ink-soft hidden px-3 py-1.5 text-[13px] @3xl:table-cell">
                        {person.op || DASH}
                      </td>
                      <td className="text-ink-soft hidden px-3 py-1.5 text-[13px] @2xl:table-cell">
                        {person.team || DASH}
                      </td>
                      <td className="hidden px-3 py-1.5 @4xl:table-cell">
                        <LocationChip location={person.location} />
                      </td>
                      <td className="text-ink-soft hidden px-3 py-1.5 text-[13px] whitespace-nowrap @4xl:table-cell">
                        {formatDate(person.rollOffDate) || DASH}
                      </td>
                      <td className="text-ink-soft px-3 py-1.5 text-[13px] whitespace-nowrap">
                        {offboardedOn(person) || DASH}
                      </td>
                      <td className="py-1.5 pr-5 pl-3">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            size="sm"
                            aria-label={`Restore ${displayName(person)} to the roster`}
                            onClick={() => void bringBack(person)}
                          >
                            <ArrowCounterClockwiseIcon size={14} weight="bold" />
                            Restore
                          </Button>
                          <IconButton
                            aria-label={`Edit ${displayName(person)}`}
                            tooltip="Edit"
                            variant="outline"
                            size="sm"
                            onClick={() => setEditing(person)}
                          >
                            <PencilSimpleIcon />
                          </IconButton>
                          <IconButton
                            aria-label={`Delete ${displayName(person)} permanently`}
                            tooltip="Delete permanently"
                            size="sm"
                            className="hover:text-red"
                            onClick={() => {
                              setError(null);
                              setDeleting(person);
                            }}
                          >
                            <TrashIcon />
                          </IconButton>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      <EmployeeDialog
        open={editing !== null}
        employee={editing}
        kind="offboarded"
        onOpenChange={(open) => !open && setEditing(null)}
        onSaved={() => undefined}
      />
      <ConfirmDialog
        open={deleting !== null}
        title={deleting ? `Delete ${displayName(deleting)} for good?` : "Delete?"}
        description="Their profile and photo are removed permanently and cannot be recovered."
        confirmLabel="Delete permanently"
        busy={busy}
        error={error}
        onConfirm={() => void deleteForGood()}
        onOpenChange={(open) => !open && setDeleting(null)}
      />
    </div>
  );
}
