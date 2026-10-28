"use client";

import { useMemo, useState } from "react";
import {
  ArrowCounterClockwiseIcon,
  MagnifyingGlassIcon,
  PencilSimpleIcon,
  TrashIcon,
  UserMinusIcon,
} from "@phosphor-icons/react";
import { Button, Input } from "@/components/ui";
import { formatDate, todayIso } from "@/lib/staff/dates";
import { NO_FILTER, displayName, filterEmployees } from "@/lib/staff/employees";
import { useStaffStore } from "@/lib/staff/staffStore";
import type { OffboardedEmployee } from "@/lib/staff/types";
import { EmployeeDialog } from "./EmployeeDialog";
import { ConfirmDialog, DASH, EmployeeAvatar, EmptyState } from "./parts";

const HEAD = "px-3 py-2.5 text-left text-[11.5px] font-bold tracking-[0.06em] uppercase";

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
  const [editing, setEditing] = useState<OffboardedEmployee | null>(null);
  const [deleting, setDeleting] = useState<OffboardedEmployee | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shown = useMemo(
    () =>
      filterEmployees(offboarded, { ...NO_FILTER, query }).sort((a, b) =>
        b.offboardedAt.localeCompare(a.offboardedAt),
      ),
    [offboarded, query],
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
    if (result.ok) setDeleting(null);
    else setError(result.reason);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
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
              <table className="w-full min-w-[820px] border-collapse text-left">
                <thead className="text-ink-muted bg-surface-elevated sticky top-0 z-[1]">
                  <tr className="border-line border-b">
                    <th scope="col" className={`${HEAD} pl-5`}>
                      Name
                    </th>
                    <th scope="col" className={HEAD}>
                      Level
                    </th>
                    <th scope="col" className={HEAD}>
                      OP
                    </th>
                    <th scope="col" className={HEAD}>
                      Team
                    </th>
                    <th scope="col" className={HEAD}>
                      Roll-off
                    </th>
                    <th scope="col" className={HEAD}>
                      Offboarded
                    </th>
                    <th scope="col" className={`${HEAD} pr-5 text-right`}>
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((person) => (
                    <tr key={person.id} className="border-line hover:bg-chip border-b">
                      <td className="py-2.5 pr-3 pl-5">
                        <div className="flex min-w-0 items-center gap-3">
                          <EmployeeAvatar employee={person} />
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
                      <td className="text-ink-soft px-3 py-2.5 text-[13px]">
                        {person.level || DASH}
                      </td>
                      <td className="text-ink-soft px-3 py-2.5 text-[13px]">
                        {person.op || DASH}
                      </td>
                      <td className="text-ink-soft px-3 py-2.5 text-[13px]">
                        {person.team || DASH}
                      </td>
                      <td className="text-ink-soft px-3 py-2.5 text-[13px] whitespace-nowrap">
                        {formatDate(person.rollOffDate) || DASH}
                      </td>
                      <td className="text-ink-soft px-3 py-2.5 text-[13px] whitespace-nowrap">
                        {offboardedOn(person) || DASH}
                      </td>
                      <td className="py-2.5 pr-5 pl-3">
                        <div className="flex justify-end gap-1.5">
                          <Button
                            variant="outline"
                            size="sm"
                            aria-label={`Edit ${displayName(person)}`}
                            onClick={() => setEditing(person)}
                          >
                            <PencilSimpleIcon size={14} weight="bold" />
                            Edit
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            aria-label={`Restore ${displayName(person)} to the roster`}
                            onClick={() => void bringBack(person)}
                          >
                            <ArrowCounterClockwiseIcon size={14} weight="bold" />
                            Restore
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red"
                            aria-label={`Delete ${displayName(person)} permanently`}
                            onClick={() => {
                              setError(null);
                              setDeleting(person);
                            }}
                          >
                            <TrashIcon size={14} weight="bold" />
                            Delete
                          </Button>
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
