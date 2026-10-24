"use client";

import { memo, useMemo, useState } from "react";
import { CopyIcon } from "@phosphor-icons/react";
import { Button, ScrollArea } from "@/components/ui";
import {
  FilterChip,
  GateNote,
  NativeSelect,
  SearchField,
  SeverityChip,
} from "./GateParts";
import {
  filterFlags,
  flagKinds,
  flagsToTsv,
  SEVERITIES,
  severityCounts,
  type FlagFilter,
} from "./flagsView";
import { OpenFileButtons } from "./OpenFileButtons";
import { latestArtifactNotification } from "./taskPresenter";
import type { GateData } from "./useGateData";
import type { Flag, FlagSeverity, Task } from "./types";

/** Rows rendered before "Show more" — a few hundred is plenty to scan, and
 *  Copy always exports the whole filtered set regardless. */
const PAGE_SIZE = 200;

/**
 * The draft-review panel for a `flags` gate: what to do (edit the draft in
 * Excel, save, then Approve), the draft workbook's Open button, counts by
 * severity that double as filters, and a scrollable, copy-friendly flag list.
 * Read-only: the only action here besides Open is Copy.
 */
export function FlagsGatePanel({ task, gate }: { task: Task; gate: GateData }) {
  const [filter, setFilter] = useState<FlagFilter>({
    severity: "all",
    kind: "all",
    query: "",
  });
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");

  const file = gate.flags;
  const artifact = latestArtifactNotification(task);

  const counts = useMemo(() => (file ? severityCounts(file) : null), [file]);
  const kinds = useMemo(() => flagKinds(file?.flags ?? []), [file]);
  const visible = useMemo(() => filterFlags(file?.flags ?? [], filter), [file, filter]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(flagsToTsv(visible));
      setCopied("copied");
    } catch {
      setCopied("failed");
    }
    setTimeout(() => setCopied("idle"), 2000);
  };

  const setFilterPart = (part: Partial<FlagFilter>) => {
    setFilter((current) => ({ ...current, ...part }));
    setLimit(PAGE_SIZE);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5">
      <div className="border-border/60 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-neutral-50 p-3">
        <p className="text-ink-muted max-w-md text-[12px]">
          <strong className="text-ink font-medium">
            Edit the draft in Excel, save the file, then press Approve.
          </strong>{" "}
          Your edits are compared with the plan in the next step.
        </p>
        {artifact ? (
          <OpenFileButtons taskId={task.id} notification={artifact} draft icon />
        ) : (
          <span className="text-ink-faint text-[11px]">
            The draft workbook&apos;s Open button appears here once it&apos;s ready.
          </span>
        )}
      </div>

      {gate.status === "loading" || gate.status === "idle" ? (
        <GateNote>Loading flags…</GateNote>
      ) : !file || !counts ? (
        <GateNote>{gate.error ?? "No flags file was written for this draft."}</GateNote>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <FilterChip
              active={filter.severity === "all"}
              onClick={() => setFilterPart({ severity: "all" })}
            >
              All {file.flags.length}
            </FilterChip>
            {SEVERITIES.map((severity: FlagSeverity) => (
              <FilterChip
                key={severity}
                active={filter.severity === severity}
                onClick={() =>
                  setFilterPart({
                    severity: filter.severity === severity ? "all" : severity,
                  })
                }
              >
                <SeverityChip severity={severity} bare />
                {counts[severity]}
              </FilterChip>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <SearchField
              value={filter.query}
              onChange={(query) => setFilterPart({ query })}
              placeholder="Search person, date, message…"
              label="Search flags"
              className="min-w-[10rem] flex-1"
            />
            <NativeSelect
              aria-label="Filter by kind"
              value={filter.kind}
              onChange={(event) => setFilterPart({ kind: event.target.value })}
              className="w-auto max-w-[12rem]"
            >
              <option value="all">All kinds</option>
              {kinds.map((kind) => (
                <option key={kind} value={kind}>
                  {kind}
                </option>
              ))}
            </NativeSelect>
            <Button
              size="sm"
              variant="outline"
              onClick={copy}
              disabled={visible.length === 0}
            >
              <CopyIcon size={14} weight="bold" aria-hidden />
              {copied === "copied"
                ? "Copied"
                : copied === "failed"
                  ? "Copy failed"
                  : `Copy ${visible.length}`}
            </Button>
          </div>

          <ScrollArea className="border-border/60 h-[min(20rem,42vh)] rounded-lg border">
            {visible.length === 0 ? (
              <GateNote>
                {file.flags.length === 0
                  ? "No flags — the draft is clean."
                  : "No flags match."}
              </GateNote>
            ) : (
              <ul className="divide-border/60 divide-y" aria-label="Flags">
                {visible.slice(0, limit).map((flag, index) => (
                  <FlagRow key={`${flag.key}-${index}`} flag={flag} />
                ))}
                {visible.length > limit && (
                  <li className="p-2 text-center">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setLimit((n) => n + PAGE_SIZE)}
                    >
                      Show {Math.min(PAGE_SIZE, visible.length - limit)} more of{" "}
                      {visible.length - limit}
                    </Button>
                  </li>
                )}
              </ul>
            )}
          </ScrollArea>
        </>
      )}
    </div>
  );
}

/** One flag. memo()'d and content-visibility:auto, so a re-render of the panel
 *  (or scrolling past hundreds of rows) only pays for the rows actually shown. */
const FlagRow = memo(function FlagRow({ flag }: { flag: Flag }) {
  return (
    <li className="flex flex-col gap-1 px-3 py-2 select-text [contain-intrinsic-size:auto_3.5rem] [content-visibility:auto]">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <SeverityChip severity={flag.severity} />
        <span className="text-ink-muted font-mono text-[11px]">{flag.kind}</span>
        <span className="text-ink text-[12px] font-medium">
          {flag.person ?? <span className="text-ink-faint">—</span>}
        </span>
        <span className="text-ink-faint font-mono text-[11px]">{flag.date ?? "—"}</span>
        {(flag.team || flag.shift) && (
          <span className="text-ink-faint text-[11px]">
            {[flag.team, flag.shift].filter(Boolean).join(" · ")}
          </span>
        )}
      </div>
      <p className="text-ink-muted text-[12px] break-words">{flag.message}</p>
    </li>
  );
});
