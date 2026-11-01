"use client";

import { Fragment, useState } from "react";
import { CaretRightIcon } from "@phosphor-icons/react";
import { Badge } from "@/components/ui";
import { cn } from "@/lib/cn";
import { explainFailure } from "@/lib/tasks/failureExplainer";
import { OpenOutputLink } from "./OpenOutputLink";
import type { HistoryRow } from "./historyRows";

const HEAD = "px-4 py-2.5 text-[11.5px] font-bold tracking-[0.06em] uppercase";

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

function RunDetails({ row }: { row: HistoryRow }) {
  const { run } = row;
  const help =
    run.outcome === "failed" ? explainFailure(run.error, run.current_step_at_end) : null;
  const approvals = run.approvals ?? [];
  return (
    <div className="flex flex-col gap-1.5 text-[12.5px]">
      {help && (
        <>
          <p className="text-red font-semibold">{help.title}</p>
          <ol className="text-ink list-decimal pl-5">
            {help.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          <p className="text-ink-muted font-mono text-[11.5px]">{help.technical}</p>
        </>
      )}
      <p className="text-ink-muted">
        Steps finished: {run.steps_completed.join(", ") || "none"}
      </p>
      {approvals.length > 0 ? (
        <ul className="text-ink-soft">
          {approvals.map((a) => (
            <li key={`${a.step}-${a.at}`}>
              {a.kind === "send" ? "Confirmed" : "Approved"} “{a.step}” by {a.user} at{" "}
              {when(a.at)}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-ink-muted">No approvals were needed on this run.</p>
      )}
    </div>
  );
}

/** Every run as a table row: status pill, workflow, when it finished, how long it took and a link
 *  to the file it produced. A row opens to show what failed and who approved what. */
export function HistoryTable({ rows }: { rows: readonly HistoryRow[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="border-line bg-card rounded-card overflow-x-auto border">
      <table className="w-full border-collapse text-left" data-testid="history-table">
        <thead>
          <tr className="text-ink-muted">
            <th scope="col" className={HEAD}>
              Status
            </th>
            <th scope="col" className={HEAD}>
              Workflow
            </th>
            <th scope="col" className={HEAD}>
              Finished
            </th>
            <th scope="col" className={HEAD}>
              Took
            </th>
            <th scope="col" className={HEAD}>
              Output
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const expanded = open === row.key;
            return (
              <Fragment key={row.key}>
                <tr
                  data-testid="history-row"
                  className="border-line border-t align-middle"
                >
                  <td className="px-4 py-2.5">
                    <Badge variant={row.pill.tone} dot>
                      {row.pill.label}
                    </Badge>
                  </td>
                  <th scope="row" className="max-w-[260px] px-4 py-2.5 text-left">
                    <button
                      type="button"
                      aria-expanded={expanded}
                      onClick={() => setOpen(expanded ? null : row.key)}
                      className="text-ink focus-visible:ring-focus rounded-chip flex w-full items-center gap-1.5 text-left text-[13.5px] font-semibold outline-none focus-visible:ring-2"
                    >
                      <CaretRightIcon
                        size={12}
                        weight="bold"
                        aria-hidden
                        className={cn(
                          "text-ink-muted shrink-0 transition-transform",
                          expanded && "rotate-90",
                        )}
                      />
                      <span className="truncate">{row.taskName}</span>
                    </button>
                  </th>
                  <td className="text-ink-soft px-4 py-2.5 text-[13px] whitespace-nowrap">
                    {when(row.run.ended_at)}
                  </td>
                  <td className="text-ink-soft px-4 py-2.5 text-[13px] whitespace-nowrap tabular-nums">
                    {row.duration}
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    {row.output ? (
                      <OpenOutputLink taskId={row.run.task_id} output={row.output} />
                    ) : (
                      <span className="text-ink-faint text-[12.5px]">
                        <span aria-hidden>—</span>
                        <span className="sr-only">No output kept</span>
                      </span>
                    )}
                  </td>
                </tr>
                {expanded && (
                  <tr className="bg-chip">
                    <td colSpan={5} className="px-4 py-3">
                      <RunDetails row={row} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
