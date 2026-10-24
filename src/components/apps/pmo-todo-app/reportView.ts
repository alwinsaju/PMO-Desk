// Pure view-model for the Reports tab: the period choice, the editable draft and
// what is dirty or edited, the save request, the narrative card, the copy texts,
// the mail link and the "previous reports" rows. No React, relative imports with
// the .ts extension, so `pnpm test` can load this under plain Node
// (see reportView.test.mjs). Nothing here sends anything.
import { buildMailto, type Mailto } from "../../../lib/pmo/chaser.ts";
import { addDays, describeInstant } from "../../../lib/pmo/due.ts";
import {
  NARRATIVE_HEADINGS,
  PeriodRequestSchema,
  dayLabel,
  markdownToPlainText,
  resolvePeriod,
  safeTimeZone,
  type PeriodKind,
  type PeriodRequest,
  type ReportData,
  type ReportSummary,
  type SavedReportRevision,
  type SavedReportSummary,
} from "../../../lib/pmo/report.ts";
import { insertNarrative } from "../../../lib/pmo/reportNarrative.ts";
import type { ReportNarrativeJob } from "../../../lib/pmo/types.ts";

// --- the period -----------------------------------------------------------------------

export type PeriodChoice = PeriodKind;

export const PERIOD_CHOICES: { id: PeriodChoice; label: string; short: string }[] = [
  { id: "this-week", label: "This week so far", short: "This week" },
  { id: "last-week", label: "Last week", short: "Last week" },
  { id: "last-7-days", label: "Last 7 days", short: "Last 7 days" },
  { id: "custom", label: "Custom range", short: "Custom" },
];

/** What the person picked and wrote, kept by the window so it survives a tab switch. */
export interface ReportViewState {
  choice: PeriodChoice;
  customStart: string;
  customEnd: string;
  draft: ReportDraft | null;
}

export function initialReportView(today: string): ReportViewState {
  return {
    choice: "this-week",
    customStart: addDays(today, -6),
    customEnd: today,
    draft: null,
  };
}

/** The request for what is picked, or why it cannot be made (a custom range is
 *  checked with the same rules as the server). */
export function periodRequest(
  view: Pick<ReportViewState, "choice" | "customStart" | "customEnd">,
  now: Date,
  timeZone: string,
): { ok: true; request: PeriodRequest } | { ok: false; reason: string } {
  const raw =
    view.choice === "custom"
      ? { kind: "custom", start: view.customStart.trim(), end: view.customEnd.trim() }
      : { kind: view.choice };
  if (view.choice === "custom" && (!raw.start || !raw.end)) {
    return { ok: false, reason: "Choose a start and an end date." };
  }
  const parsed = PeriodRequestSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "Choose a start and an end date." };
  const resolved = resolvePeriod(parsed.data, now, safeTimeZone(timeZone));
  return resolved.ok ? { ok: true, request: parsed.data } : resolved;
}

// --- the draft ---------------------------------------------------------------------------

export interface ReportDraft {
  /** `rp_...`: the id the first save files it under. */
  id: string;
  kind: PeriodKind;
  startDay: string;
  endDay: string;
  periodLabel: string;
  title: string;
  generatedAt: string;
  asOfDay: string;
  /** The text as generated (with the highlights if they were added). */
  baseline: string;
  /** What is in the editor. */
  text: string;
  /** The text of a reopened revision was itself an edit of the generated one. */
  baselineEdited: boolean;
  /** The last text that reached disk, and which revision it is. */
  savedText: string | null;
  savedRevision: number | null;
  /** The highlights that are in the text, and which job wrote them. */
  narrative: { model: string; promptVersion: number } | null;
  narrativeJobId: string | null;
  /** The text caps a long list (the saved data keeps everything). */
  capped: boolean;
  summary: ReportSummary | null;
}

/** The reply of POST /api/pmo/reports. */
export interface GeneratedReport {
  id: string;
  data: ReportData;
  markdown: string;
  capped: boolean;
}

export function draftFromGenerated(reply: GeneratedReport): ReportDraft {
  const { data } = reply;
  return {
    id: reply.id,
    kind: data.period.kind,
    startDay: data.period.startDay,
    endDay: data.period.endDay,
    periodLabel: data.period.label,
    title: data.title,
    generatedAt: data.generatedAt,
    asOfDay: data.asOfDay,
    baseline: reply.markdown,
    text: reply.markdown,
    baselineEdited: false,
    savedText: null,
    savedRevision: null,
    narrative: null,
    narrativeJobId: null,
    capped: reply.capped,
    summary: data.summary,
  };
}

/** The reply of GET /api/pmo/reports/[id]. */
export interface OpenedReport {
  summary: SavedReportSummary;
  revision: number;
  markdown: string;
  revisions: SavedReportRevision[];
  data: unknown;
}

const looksLikeSummary = (value: unknown): value is ReportSummary =>
  !!value &&
  typeof value === "object" &&
  ["open", "closed", "created", "overdue"].every(
    (key) => typeof (value as Record<string, unknown>)[key] === "number",
  );

/** A saved report reopened for editing: the saved text is the baseline. */
export function draftFromSaved(opened: OpenedReport): ReportDraft {
  const { summary } = opened;
  const data = opened.data as Partial<ReportData> | null;
  const revision = opened.revisions.find((r) => r.rev === opened.revision);
  return {
    id: summary.id,
    kind: summary.period.kind,
    startDay: summary.period.startDay,
    endDay: summary.period.endDay,
    periodLabel: summary.period.label,
    title: summary.title,
    generatedAt: summary.generatedAt,
    asOfDay: typeof data?.asOfDay === "string" ? data.asOfDay : summary.period.endDay,
    baseline: opened.markdown,
    text: opened.markdown,
    baselineEdited: revision?.edited ?? summary.edited,
    savedText: opened.markdown,
    savedRevision: opened.revision,
    narrative: summary.usedModel ? { model: "local model", promptVersion: 0 } : null,
    narrativeJobId: null,
    capped: false,
    summary: looksLikeSummary(data?.summary) ? data.summary : null,
  };
}

/** The text differs from what was generated (or from the revision reopened). */
export const isEdited = (draft: ReportDraft): boolean =>
  draft.baselineEdited || draft.text !== draft.baseline;

/** The editor holds something that is not on disk yet. */
export const isUnsaved = (draft: ReportDraft): boolean => draft.text !== draft.savedText;

/** Edits that would be lost if the editor were replaced: changed from the
 *  generated text and not saved. A fresh, untouched report is not worth a warning. */
export const hasUnsavedEdits = (draft: ReportDraft): boolean =>
  draft.text !== draft.baseline && draft.text !== draft.savedText;

export function saveState(draft: ReportDraft): { label: string; canSave: boolean } {
  const blank = draft.text.trim() === "";
  if (draft.savedRevision === null) {
    return { label: "Not saved yet", canSave: !blank };
  }
  if (isUnsaved(draft)) {
    return {
      label: `Unsaved changes (saved: revision ${draft.savedRevision})`,
      canSave: !blank,
    };
  }
  return { label: `Saved as revision ${draft.savedRevision}`, canSave: false };
}

/** The body of POST /api/pmo/reports/[id]. The resolved days (not "this week")
 *  go with the first save, so a report saved after midnight keeps its period. */
export function saveBody(draft: ReportDraft) {
  return {
    markdown: draft.text,
    edited: isEdited(draft),
    ...(draft.savedRevision !== null ? { baseRevision: draft.savedRevision } : {}),
    period: { start: draft.startDay, end: draft.endDay, kind: draft.kind },
    generatedAt: draft.generatedAt,
    narrative: draft.narrative,
  };
}

/** After a successful save. */
export function markSaved(
  draft: ReportDraft,
  revision: number,
  savedText: string,
): ReportDraft {
  return { ...draft, savedRevision: revision, savedText };
}

// --- the highlights card ---------------------------------------------------------------

export type NarrativeView =
  | { kind: "idle" }
  | { kind: "drafting"; text: string }
  | { kind: "failed"; message: string }
  | {
      kind: "ready";
      parts: { heading: string; lines: string[] }[];
      /** One line about what was left out, or null when nothing was. */
      removedNote: string | null;
      removed: { part: string; line: string; reason: string }[];
      applied: boolean;
      model: string;
    };

export function narrativeView(
  job: ReportNarrativeJob | null,
  draft: Pick<ReportDraft, "narrativeJobId"> | null,
): NarrativeView {
  if (!job) return { kind: "idle" };
  if (job.status === "drafting") {
    return {
      kind: "drafting",
      text: "Drafting… (can take a minute on this PC). The report below is complete without it.",
    };
  }
  if (job.status === "failed" || !job.narrative) {
    return {
      kind: "failed",
      message: job.error ?? "The highlights could not be written.",
    };
  }
  const narrative = job.narrative;
  const n = job.removed.length;
  return {
    kind: "ready",
    parts: NARRATIVE_HEADINGS.map(({ key, heading }) => ({
      heading,
      lines: narrative[key],
    })).filter((part) => part.lines.length > 0),
    removedNote:
      n === 0
        ? null
        : `${n} ${n === 1 ? "line was" : "lines were"} left out because ${n === 1 ? "it names" : "they name"} something that is not in your to-dos.`,
    removed: job.removed,
    applied: draft?.narrativeJobId === job.id,
    model: job.model ?? "local model",
  };
}

/** Add the highlights to the text. Earlier highlights are replaced, the rest of
 *  the text (including the person's edits) is kept. The baseline gets the same
 *  insertion, so an untouched report still counts as unedited. */
export function addNarrative(draft: ReportDraft, job: ReportNarrativeJob): ReportDraft {
  if (job.status !== "ready" || !job.narrative) return draft;
  return {
    ...draft,
    text: insertNarrative(draft.text, job.narrative),
    baseline: insertNarrative(draft.baseline, job.narrative),
    narrative: { model: job.model ?? "local model", promptVersion: job.promptVersion },
    narrativeJobId: job.id,
  };
}

// --- copy and mail ----------------------------------------------------------------------

/** What each Copy button puts on the clipboard: the editor as Markdown, or as
 *  plain text for Outlook and Teams. */
export function copyText(
  draft: Pick<ReportDraft, "text">,
  as: "text" | "markdown",
): string {
  return as === "markdown" ? draft.text : markdownToPlainText(draft.text);
}

/** An unsent compose window with the plain text, only while it fits in a link. */
export function mailLink(
  draft: Pick<ReportDraft, "text" | "title" | "periodLabel">,
): Mailto {
  return buildMailto({
    subject: `${draft.title}: ${draft.periodLabel}`.replace(/\s+/g, " ").slice(0, 150),
    body: markdownToPlainText(draft.text),
  });
}

// --- previous reports -------------------------------------------------------------------

export interface SavedRow {
  id: string;
  title: string;
  periodLabel: string;
  savedLabel: string;
  revisionLabel: string;
  chips: string[];
}

export function savedRows(
  reports: readonly SavedReportSummary[],
  timeZone: string,
): SavedRow[] {
  const zone = safeTimeZone(timeZone);
  return reports.map((report) => ({
    id: report.id,
    title: report.title,
    periodLabel: report.period.label,
    savedLabel: describeInstant(report.savedAt, zone),
    revisionLabel: report.revisions > 1 ? `${report.revisions} revisions` : "1 revision",
    chips: [
      ...(report.edited ? ["edited"] : []),
      ...(report.usedModel ? ["AI highlights"] : []),
    ],
  }));
}

/** The one line under the controls once there is a draft. */
export function draftSubtitle(
  draft: Pick<ReportDraft, "periodLabel" | "asOfDay">,
): string {
  return `${draft.periodLabel}. Open items are as of ${dayLabel(draft.asOfDay, true)}.`;
}

/** Counts shown as chips above the editor; the overdue one is the only emphasis. */
export function summaryChips(
  summary: ReportSummary | null,
): { label: string; strong: boolean }[] {
  if (!summary) return [];
  return [
    { label: `${summary.open} open`, strong: false },
    { label: `${summary.closed} closed`, strong: false },
    { label: `${summary.created} new`, strong: false },
    ...(summary.overdue > 0
      ? [{ label: `${summary.overdue} overdue`, strong: true }]
      : []),
    ...(summary.waiting > 0
      ? [{ label: `${summary.waiting} waiting`, strong: false }]
      : []),
  ];
}
