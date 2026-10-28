"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckIcon,
  CopyIcon,
  EnvelopeSimpleIcon,
  FloppyDiskIcon,
  SparkleIcon,
} from "@phosphor-icons/react";
import { Button, Input } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { SavedReportSummary } from "@/lib/pmo/report";
import type { PmoState, ReportNarrativeJob } from "@/lib/pmo/types";
import {
  fetchReport,
  fetchReportNarrative,
  generateReport,
  listReports,
  saveReport,
  startReportNarrative,
} from "./api";
import {
  CONTENT_WIDTH,
  Chip,
  ErrorLine,
  Field,
  GUTTER_X,
  NativeSelect,
  ROW_CARD,
  ScrollBody,
  SectionLabel,
  TextArea,
} from "./parts";
import {
  PERIOD_CHOICES,
  addNarrative,
  copyText,
  draftFromGenerated,
  draftFromSaved,
  draftSubtitle,
  hasUnsavedEdits,
  mailLink,
  markSaved,
  narrativeView,
  periodRequest,
  saveBody,
  saveState,
  savedRows,
  summaryChips,
  type PeriodChoice,
  type ReportViewState,
} from "./reportView";

interface ReportsTabProps {
  state: PmoState;
  /** The period choice and the draft. Kept by the window so they survive a tab switch. */
  view: ReportViewState;
  onViewChange: (view: ReportViewState) => void;
}

const POLL_MS = 2000;

/** Text to the clipboard; falls back to the older route when the browser refuses. */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.cssText = "position:fixed;opacity:0;pointer-events:none";
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

/**
 * The weekly status report. "Generate" builds it from the to-dos by code (no
 * model, instant); "Write highlights with AI" optionally asks the LOCAL model for
 * a short, verified narrative; the text is edited here, copied for Outlook or
 * Teams, and saved as local revision files. Nothing is sent: the optional mail
 * button is a plain mailto: link that only opens an unsent compose window, and
 * only while the text fits in one. All text is shown in a <textarea>, never as HTML.
 */
export function ReportsTab({ state, view, onViewChange }: ReportsTabProps) {
  const { draft } = view;
  const [busy, setBusy] = useState<"generate" | "save" | "open" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedReportSummary[] | null>(null);
  const [job, setJob] = useState<ReportNarrativeJob | null>(null);
  const [startingJob, setStartingJob] = useState(false);
  /** Bumped when a job was just started, so the poll loop restarts. */
  const [pollTick, setPollTick] = useState(0);
  const [copied, setCopied] = useState<"text" | "markdown" | null>(null);
  /** A destructive step waiting for its second click: "generate" or "open:<id>". */
  const [armed, setArmed] = useState<string | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeZone = state.config.reminders.timeZone;

  const patchView = useCallback(
    (patch: Partial<ReportViewState>) => onViewChange({ ...view, ...patch }),
    [view, onViewChange],
  );

  const refreshSaved = useCallback(async () => {
    try {
      const reply = await listReports();
      if (reply.ok) setSaved(reply.reports);
    } catch {
      // Offline: the list simply stays as it was.
    }
  }, []);

  useEffect(() => {
    void refreshSaved();
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, [refreshSaved]);

  // The highlights job for this period: ask once when the report changes (so a
  // job started before leaving the tab shows up again), then poll while it runs.
  const jobKey = draft ? `${draft.startDay}_${draft.endDay}` : null;
  useEffect(() => {
    if (!jobKey) {
      setJob(null);
      return;
    }
    setJob((prev) => (prev && prev.key !== jobKey ? null : prev));
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      try {
        const reply = await fetchReportNarrative(jobKey);
        if (cancelled) return;
        if (reply.ok) {
          setJob(reply.job);
          if (reply.job?.status !== "drafting") return;
        }
      } catch {
        if (cancelled) return;
      }
      timer = setTimeout(poll, POLL_MS);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [jobKey, pollTick]);

  const nowDate = new Date(state.serverTime);
  const choice = view.choice;

  async function generate() {
    const built = periodRequest(view, nowDate, timeZone);
    if (!built.ok) return setError(built.reason);
    if (draft && hasUnsavedEdits(draft) && armed !== "generate") {
      setArmed("generate");
      return;
    }
    setArmed(null);
    setBusy("generate");
    setError(null);
    setNotice(null);
    try {
      const reply = await generateReport(built.request);
      if (!reply.ok) return setError(reply.reason);
      patchView({ draft: draftFromGenerated(reply) });
    } catch {
      setError("Could not reach the app server.");
    } finally {
      setBusy(null);
    }
  }

  async function startHighlights() {
    if (!draft) return;
    const built = periodRequest(
      {
        choice: "custom",
        customStart: draft.startDay,
        customEnd: draft.endDay,
      },
      nowDate,
      timeZone,
    );
    if (!built.ok) return setError(built.reason);
    setError(null);
    setStartingJob(true);
    try {
      const reply = await startReportNarrative(built.request);
      if (!reply.ok) return setError(reply.reason);
      setJob(reply.job);
      setPollTick((tick) => tick + 1);
    } catch {
      setError("Could not reach the app server.");
    } finally {
      setStartingJob(false);
    }
  }

  function addHighlights() {
    if (!draft || !job) return;
    patchView({ draft: addNarrative(draft, job) });
    setNotice("Highlights added to the report.");
  }

  async function save() {
    if (!draft) return;
    setBusy("save");
    setError(null);
    setNotice(null);
    try {
      const reply = await saveReport(draft.id, saveBody(draft));
      if (!reply.ok) return setError(reply.reason);
      patchView({ draft: markSaved(draft, reply.revision, draft.text) });
      setNotice(`Saved as revision ${reply.revision}.`);
      void refreshSaved();
    } catch {
      setError("Could not reach the app server.");
    } finally {
      setBusy(null);
    }
  }

  async function open(id: string) {
    if (draft && hasUnsavedEdits(draft) && armed !== `open:${id}`) {
      setArmed(`open:${id}`);
      return;
    }
    setArmed(null);
    setBusy("open");
    setError(null);
    setNotice(null);
    try {
      const reply = await fetchReport(id);
      if (!reply.ok) return setError(reply.reason);
      patchView({ draft: draftFromSaved(reply) });
    } catch {
      setError("Could not reach the app server.");
    } finally {
      setBusy(null);
    }
  }

  async function copy(as: "text" | "markdown") {
    if (!draft) return;
    const ok = await copyToClipboard(copyText(draft, as));
    if (!ok)
      return setError("Could not copy automatically. Select the text and press Ctrl+C.");
    setError(null);
    setCopied(as);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(null), 2000);
  }

  const status = narrativeView(job, draft);
  const drafting = status.kind === "drafting" || startingJob;
  const save_ = draft ? saveState(draft) : null;
  const mailto = draft ? mailLink(draft) : null;
  const rows = savedRows(saved ?? [], timeZone);
  const chips = draft ? summaryChips(draft.summary) : [];
  const statusText = `${notice ?? save_?.label ?? ""}${
    mailto && !mailto.ok && !notice ? ". Too long for a mail link: use Copy." : ""
  }`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScrollBody memoryKey="pmo:reports">
        <div className={cn(CONTENT_WIDTH, GUTTER_X, "flex flex-col gap-5 pt-1 pb-6")}>
          {/* Period and Generate. */}
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Period" className="min-w-0">
              <NativeSelect
                value={choice}
                aria-label="Report period"
                onChange={(event) => {
                  setArmed(null);
                  patchView({ choice: event.target.value as PeriodChoice });
                }}
                className="min-w-44"
              >
                {PERIOD_CHOICES.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {choice === "custom" && (
              <>
                <Field label="From" className="min-w-0">
                  <Input
                    type="date"
                    value={view.customStart}
                    max={state.today}
                    className="w-40 text-[13px]"
                    onChange={(event) => patchView({ customStart: event.target.value })}
                  />
                </Field>
                <Field label="To" className="min-w-0">
                  <Input
                    type="date"
                    value={view.customEnd}
                    max={state.today}
                    className="w-40 text-[13px]"
                    onChange={(event) => patchView({ customEnd: event.target.value })}
                  />
                </Field>
              </>
            )}
            <Button
              disabled={busy !== null}
              onClick={() => void generate()}
              className="shrink-0"
            >
              {busy === "generate"
                ? "Generating…"
                : armed === "generate"
                  ? "Replace my edits"
                  : "Generate"}
            </Button>
            {armed === "generate" && (
              <span role="status" className="text-ink-muted basis-full text-[12.5px]">
                You have edits that are not saved. Generating again replaces them.{" "}
                <button
                  type="button"
                  onClick={() => setArmed(null)}
                  className="text-ink focus-visible:ring-focus rounded font-semibold underline underline-offset-2 outline-none focus-visible:ring-2"
                >
                  Keep editing
                </button>
              </span>
            )}
          </div>

          {error && <ErrorLine>{error}</ErrorLine>}

          {!draft ? (
            <p className="text-ink-muted text-[13.5px] leading-relaxed">
              Pick a period and press Generate. The report is built from the to-dos in
              this app (nothing is read from Excel, ServiceNow or SharePoint), appears at
              once, and stays on this computer: this app never sends it. You can add a
              short summary written by the local model, edit the text, copy it for Outlook
              or Teams, and save it.
            </p>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <p className="text-ink-soft text-[13px] leading-snug font-semibold">
                  {draftSubtitle(draft)}
                </p>
                <p
                  role="status"
                  className="text-ink-muted text-[12px] leading-snug @md:hidden"
                >
                  {statusText}
                </p>
                {chips.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {chips.map((chip) => (
                      <Chip key={chip.label} tone={chip.strong ? "strong" : "neutral"}>
                        {chip.label}
                      </Chip>
                    ))}
                  </div>
                )}
              </div>

              {/* The optional highlights. */}
              <section
                aria-label="Highlights from the local model"
                className="border-line bg-card rounded-card flex flex-col gap-3 border p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={drafting}
                    onClick={() => void startHighlights()}
                  >
                    <SparkleIcon size={14} weight="bold" />
                    {status.kind === "ready" || status.kind === "failed"
                      ? "Write highlights again"
                      : "Write highlights with AI"}
                  </Button>
                  <span className="text-ink-muted min-w-0 basis-full text-[12px] leading-snug @md:flex-1 @md:basis-0">
                    Optional. The local model sees only the titles, owners and dates in
                    this report; lines that name anything else are left out.
                  </span>
                </div>

                {drafting && (
                  <p
                    role="status"
                    className="text-ink-soft flex items-center gap-2.5 text-[13px]"
                  >
                    <span className="bg-accent motion-safe:animate-blink h-2 w-2 shrink-0 rounded-full" />
                    {status.kind === "drafting" ? status.text : "Starting…"}
                  </p>
                )}
                {status.kind === "failed" && !drafting && (
                  <p role="alert" className="text-red text-[13px] font-semibold">
                    {status.message}
                  </p>
                )}
                {status.kind === "ready" && !drafting && (
                  <div className="flex flex-col gap-2">
                    {status.parts.map((part) => (
                      <div key={part.heading}>
                        <h4 className="text-ink-muted text-[11px] font-bold tracking-[0.08em] uppercase">
                          {part.heading}
                        </h4>
                        <ul className="mt-0.5 flex list-disc flex-col gap-0.5 pl-4">
                          {part.lines.map((line) => (
                            <li
                              key={line}
                              className="text-ink text-[13px] leading-snug break-words"
                            >
                              {line}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                    {status.removedNote && (
                      <p
                        className="text-ink-muted text-[12.5px] leading-snug"
                        title={status.removed
                          .map((r) => `${r.part}: ${r.reason}`)
                          .join("\n")}
                      >
                        {status.removedNote}
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                      <Button size="sm" disabled={status.applied} onClick={addHighlights}>
                        {status.applied ? <CheckIcon size={14} weight="bold" /> : null}
                        {status.applied ? "Added to the report" : "Add to the report"}
                      </Button>
                      <span className="text-ink-muted text-[12px]">
                        Written by {status.model}.
                      </span>
                    </div>
                  </div>
                )}
              </section>

              <Field label="Report text (Markdown; edit freely)">
                <TextArea
                  value={draft.text}
                  rows={18}
                  spellCheck
                  aria-label="Report text"
                  className="min-h-72 font-mono text-[12px] leading-relaxed"
                  onChange={(event) => {
                    setNotice(null);
                    patchView({ draft: { ...draft, text: event.target.value } });
                  }}
                />
              </Field>
              {draft.capped && (
                <p className="text-ink-muted text-[12px] leading-snug">
                  Long lists show their first items and &quot;+N more&quot;. Saving keeps
                  every item in a separate full copy.
                </p>
              )}
            </>
          )}

          {/* Previous reports. */}
          <section aria-label="Previous reports" className="flex flex-col gap-2">
            <SectionLabel className="border-line border-b pb-2">
              Previous reports
            </SectionLabel>
            {saved === null ? (
              <p className="text-ink-muted text-[13.5px]">Loading&hellip;</p>
            ) : rows.length === 0 ? (
              <p className="text-ink-muted text-[13.5px]">
                Nothing saved yet. Saved reports are kept on this computer until you
                delete them.
              </p>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {rows.map((row) => {
                  const current = draft?.id === row.id;
                  return (
                    <li
                      key={row.id}
                      className={cn(
                        ROW_CARD,
                        "flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3",
                      )}
                    >
                      <div className="min-w-0 flex-1 basis-48">
                        <p className="text-ink truncate text-[14px] font-semibold">
                          {row.title}: {row.periodLabel}
                        </p>
                        <p className="text-ink-muted text-[12px]">
                          Saved {row.savedLabel} &middot; {row.revisionLabel}
                        </p>
                      </div>
                      {row.chips.map((chip) => (
                        <Chip key={chip} tone="neutral">
                          {chip}
                        </Chip>
                      ))}
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy !== null}
                        aria-label={`Open ${row.title}: ${row.periodLabel}`}
                        onClick={() => void open(row.id)}
                      >
                        {armed === `open:${row.id}`
                          ? "Discard edits and open"
                          : current
                            ? "Reload"
                            : "Open"}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </ScrollBody>

      {/* Sticky actions. */}
      {draft && save_ && mailto && (
        <div className="bg-win border-line shrink-0 border-t">
          <div
            className={cn(
              CONTENT_WIDTH,
              GUTTER_X,
              "flex flex-wrap items-center gap-2.5 py-3",
            )}
          >
            <Button
              disabled={!draft.text.trim()}
              aria-label="Copy as text"
              title="Copy as plain text, for Outlook or Teams"
              onClick={() => void copy("text")}
            >
              {copied === "text" ? (
                <CheckIcon size={14} weight="bold" />
              ) : (
                <CopyIcon size={14} />
              )}
              {copied === "text" ? (
                "Copied"
              ) : (
                <>
                  <span className="@lg:hidden">Text</span>
                  <span className="hidden @lg:inline">Copy as text</span>
                </>
              )}
            </Button>
            <Button
              variant="secondary"
              disabled={!draft.text.trim()}
              aria-label="Copy as Markdown"
              title="Copy as Markdown"
              onClick={() => void copy("markdown")}
            >
              {copied === "markdown" ? (
                <CheckIcon size={14} weight="bold" />
              ) : (
                <CopyIcon size={14} />
              )}
              {copied === "markdown" ? (
                "Copied"
              ) : (
                <>
                  <span className="@lg:hidden">Markdown</span>
                  <span className="hidden @lg:inline">Copy as Markdown</span>
                </>
              )}
            </Button>
            {mailto.ok && (
              <Button variant="outline" asChild>
                {/* A mailto: link only opens an unsent compose window in the
                    user's own mail program; this app sends nothing. */}
                <a
                  href={mailto.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Open as unsent mail draft"
                  title="Opens a new, unsent message in your mail program"
                  data-testid="open-report-mail-draft"
                >
                  <EnvelopeSimpleIcon size={14} />
                  <span className="@xl:hidden">Mail draft</span>
                  <span className="hidden @xl:inline">Open as unsent mail draft</span>
                </a>
              </Button>
            )}
            <span
              role="status"
              className="text-ink-muted hidden min-w-0 flex-1 text-right text-[12px] leading-snug @md:block"
            >
              {statusText}
            </span>
            <Button
              variant="secondary"
              disabled={busy !== null || !save_.canSave}
              onClick={() => void save()}
              className="ml-auto shrink-0 @md:ml-0"
            >
              <FloppyDiskIcon size={14} />
              {busy === "save" ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
