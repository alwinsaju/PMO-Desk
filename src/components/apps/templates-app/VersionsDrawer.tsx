"use client";

import { useEffect, useRef, useState } from "react";
import { ClockCounterClockwiseIcon, XIcon } from "@phosphor-icons/react";
import { Button, IconButton } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  collapseSame,
  diffStats,
  versionChanges,
  type DiffRow,
  type FieldChange,
} from "@/lib/templates/diff";
import type { Template, TemplateVersion } from "@/lib/templates/types";
import { saveTemplate } from "./api";
import { versionInput } from "./templateForm";

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const ROW_STYLE = {
  add: ["bg-success-soft text-ink", "+"],
  del: ["bg-red-soft text-ink", "−"],
  same: ["text-ink-soft", " "],
} as const;

function DiffRows({ rows }: { rows: readonly DiffRow[] }) {
  return (
    <div className="border-line rounded-control overflow-hidden border font-mono text-[12px] leading-relaxed">
      {rows.map((row, i) =>
        row.kind === "skip" ? (
          <p key={i} className="bg-chip text-ink-muted px-2.5 py-0.5 text-center">
            {row.count} unchanged line{row.count === 1 ? "" : "s"}
          </p>
        ) : (
          <p
            key={i}
            data-diff={row.kind}
            className={cn("flex gap-2 px-2.5 py-px", ROW_STYLE[row.kind][0])}
          >
            <span aria-hidden className="text-ink-muted w-3 shrink-0 select-none">
              {ROW_STYLE[row.kind][1]}
            </span>
            <span className="sr-only">
              {row.kind === "add" ? "Added: " : row.kind === "del" ? "Removed: " : ""}
            </span>
            <span className="min-w-0 break-words whitespace-pre-wrap">
              {row.text || " "}
            </span>
          </p>
        ),
      )}
    </div>
  );
}

function ChangeBlock({ change }: { change: FieldChange }) {
  const { added, removed } = diffStats(change.diff);
  return (
    <section aria-label={change.label} className="flex flex-col gap-1.5">
      <h4 className="text-ink-muted flex items-baseline gap-2 text-[11px] font-bold tracking-[0.08em] uppercase">
        {change.label}
        <span className="text-[11px] font-semibold tracking-normal normal-case">
          <span className="text-success">+{added}</span>{" "}
          <span className="text-red">−{removed}</span>
        </span>
      </h4>
      <DiffRows rows={collapseSame(change.diff)} />
    </section>
  );
}

/**
 * A side drawer over the editor for a saved template's earlier versions: pick one to see, line by line,
 * what changed between it and the template now, and restore it. Restoring saves straight away and keeps
 * the current wording as another version, so nothing is lost.
 */
export function VersionsDrawer({
  template,
  onClose,
  onChanged,
}: {
  template: Template;
  onClose: () => void;
  onChanged: () => void;
}) {
  const history: TemplateVersion[] = template.history ?? [];
  const [chosenAt, setChosenAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Focus moves into the drawer while it is open and back to where it was when it closes.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => before?.focus?.();
  }, []);

  const chosen = history.find((v) => v.at === chosenAt) ?? history[0] ?? null;
  const changes = chosen ? versionChanges(template, chosen) : [];

  const restore = async (version: TemplateVersion) => {
    setBusy(true);
    setMessage(null);
    const reply = await saveTemplate(template.id, versionInput(template, version)).catch(
      () => null,
    );
    setBusy(false);
    if (!reply || !reply.ok) {
      setMessage(reply ? reply.reason : "Could not reach the app server.");
      return;
    }
    setChosenAt(null);
    setMessage("Restored. The wording from before was kept as an earlier version.");
    onChanged();
  };

  return (
    <aside
      aria-label="Versions"
      data-testid="versions-drawer"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
      className="bg-surface-elevated border-line-strong shadow-modal absolute inset-y-0 right-0 z-10 flex w-[min(26rem,100%)] flex-col border-l"
    >
      <header className="border-line flex shrink-0 items-start gap-2 border-b px-4 py-3">
        <span className="min-w-0 flex-1">
          <h2 className="text-ink flex items-center gap-2 text-[15px] font-bold">
            <ClockCounterClockwiseIcon size={16} weight="bold" aria-hidden />
            Versions
          </h2>
          <p className="text-ink-muted truncate text-[12px]">
            {template.name} · one is kept each time the wording changes
          </p>
        </span>
        <IconButton
          ref={closeRef}
          aria-label="Close versions"
          variant="ghost"
          size="sm"
          onClick={onClose}
        >
          <XIcon weight="bold" />
        </IconButton>
      </header>

      <div className="scroll-thin flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-3">
        {message && (
          <p
            role="status"
            className="bg-accent-soft text-ink rounded-control px-3 py-2 text-[12.5px]"
          >
            {message}
          </p>
        )}
        {history.length === 0 ? (
          <p className="text-ink-muted py-6 text-center text-[13px]">
            No earlier versions yet. Change the wording and save to start the history.
          </p>
        ) : (
          <>
            <ul aria-label="Earlier versions" className="flex flex-col gap-1">
              {history.map((v) => {
                const stats = versionChanges(template, v).reduce(
                  (sum, c) => sum + diffStats(c.diff).added + diffStats(c.diff).removed,
                  0,
                );
                const active = v.at === chosen?.at;
                return (
                  <li key={v.at}>
                    <button
                      type="button"
                      aria-pressed={active}
                      data-testid="version-item"
                      onClick={() => setChosenAt(v.at)}
                      className={cn(
                        "rounded-control focus-visible:ring-focus flex w-full flex-col gap-0.5 px-3 py-2 text-left outline-none focus-visible:ring-2",
                        active ? "bg-accent-soft" : "hover:bg-chip",
                      )}
                    >
                      <span className="text-ink text-[13px] font-semibold">
                        {when(v.at)}
                      </span>
                      <span className="text-ink-muted truncate text-[12px]">
                        {v.subject || "(no subject)"} ·{" "}
                        {stats === 0
                          ? "same as now"
                          : `${stats} line${stats === 1 ? "" : "s"} differ`}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>

            {chosen && (
              <section
                aria-label="Changes since this version"
                className="flex flex-col gap-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-ink text-[13px] font-bold">Changes since then</h3>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy || changes.length === 0}
                    onClick={() => void restore(chosen)}
                    data-testid="version-restore"
                  >
                    {busy ? "Restoring…" : "Restore this version"}
                  </Button>
                </div>
                <p className="text-ink-muted text-[12px]">
                  <span className="text-red font-semibold">Red</span> lines were in this
                  version and are gone now;{" "}
                  <span className="text-success font-semibold">green</span> lines were
                  added since.
                </p>
                {changes.length === 0 ? (
                  <p className="text-ink-muted text-[12.5px]">
                    This version reads the same as the template now.
                  </p>
                ) : (
                  changes.map((change) => (
                    <ChangeBlock key={change.field} change={change} />
                  ))
                )}
              </section>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
