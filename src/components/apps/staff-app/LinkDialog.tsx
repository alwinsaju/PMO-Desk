"use client";

import { useMemo, useState } from "react";
import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
} from "@/components/ui";
import { displayName } from "@/lib/staff/employees";
import { suggestLinks } from "@/lib/staff/shifts";
import type { Employee } from "@/lib/staff/types";
import { EmployeeAvatar } from "./parts";

/** Pick the directory profile a roster entry belongs to. */
export function LinkDialog({
  memberName,
  employees,
  linkedIds,
  onPick,
  onClose,
}: {
  /** The roster entry being linked; the dialog is open when this is set. */
  memberName: string | null;
  employees: readonly Employee[];
  /** Profiles that are already linked to someone else. */
  linkedIds: ReadonlySet<string>;
  onPick: (employeeId: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const open = memberName !== null;
  const { suggested, others } = useMemo(() => {
    const free = employees.filter((e) => !linkedIds.has(e.id));
    const best = new Set(
      suggestLinks(memberName ?? "", free, new Set()).map((e) => e.id),
    );
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = (e: Employee) =>
      terms.every((t) =>
        `${displayName(e)} ${e.deloitteEmail}`.toLowerCase().includes(t),
      );
    const byName = (a: Employee, b: Employee) =>
      displayName(a).localeCompare(displayName(b));
    return {
      suggested: free.filter((e) => best.has(e.id) && matches(e)).sort(byName),
      others: free.filter((e) => !best.has(e.id) && matches(e)).sort(byName),
    };
  }, [employees, linkedIds, memberName, query]);

  const row = (e: Employee) => (
    <li key={e.id}>
      <button
        type="button"
        onClick={() => {
          setQuery("");
          onPick(e.id);
        }}
        className="hover:bg-chip focus-visible:ring-focus rounded-control flex w-full items-center gap-3 px-2.5 py-2 text-left outline-none focus-visible:ring-2"
      >
        <EmployeeAvatar employee={e} size="sm" />
        <span className="min-w-0">
          <span className="text-ink block truncate text-[13.5px] font-semibold">
            {displayName(e)}
          </span>
          <span className="text-ink-muted block truncate text-[12px]">
            {e.deloitteEmail}
          </span>
        </span>
      </button>
    </li>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setQuery("");
          onClose();
        }
      }}
    >
      {open && (
        <DialogContent className="max-w-md">
          <DialogTitle>Link to a directory profile</DialogTitle>
          <DialogDescription>
            Choose who “{memberName}” is. Their shifts stay as they are; the name, photo
            and details then come from the directory.
          </DialogDescription>
          <div className="relative mt-4">
            <MagnifyingGlassIcon
              size={15}
              className="text-ink-muted pointer-events-none absolute top-1/2 left-3 -translate-y-1/2"
            />
            <Input
              autoFocus
              aria-label="Search the directory"
              placeholder="Search by name or email"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="scroll-thin mt-3 max-h-[320px] overflow-y-auto">
            {suggested.length + others.length === 0 ? (
              <p className="text-ink-muted px-2 py-6 text-center text-[13px]">
                No unlinked profile matches. Add the person in the Directory first.
              </p>
            ) : (
              <>
                {suggested.length > 0 && (
                  <>
                    <p className="text-ink-muted px-2.5 pt-1 pb-1 text-[11.5px] font-bold tracking-[0.06em] uppercase">
                      Same name
                    </p>
                    <ul>{suggested.map(row)}</ul>
                  </>
                )}
                {others.length > 0 && (
                  <>
                    <p className="text-ink-muted px-2.5 pt-3 pb-1 text-[11.5px] font-bold tracking-[0.06em] uppercase">
                      Everyone else
                    </p>
                    <ul>{others.map(row)}</ul>
                  </>
                )}
              </>
            )}
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
