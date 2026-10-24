// Saved weekly reports: <data dir>\reports\. Local files only; nothing is sent.
// Server only.
//
//   <yyyy-mm-dd>-<id>.json       the sidecar: period, when it was generated, which
//                                model wrote the highlights (if any), the list of
//                                revisions, and the report's full data (every item,
//                                not just the ones the text shows)
//   <yyyy-mm-dd>-<id>.md         revision 1, exactly as saved
//   <yyyy-mm-dd>-<id>.r2.md ...  each later save is a NEW file; none is overwritten
//   <yyyy-mm-dd>-<id>.full.md    only when the text capped a long list: the same
//                                report with every item
//
// The date is the day the report was first saved (in the reminder time zone). A
// report is kept until someone deletes it: retention.ts never touches this folder.
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { localParts } from "../due.ts";
import {
  PeriodRequestSchema,
  buildReport,
  isCapped,
  renderMarkdown,
  safeTimeZone,
  type PeriodKind,
  type SavedReportRevision,
  type SavedReportSummary,
} from "../report.ts";
import { newId } from "../todoLogic.ts";
import { listFiles, readJson, writeJsonAtomic, writeTextAtomic } from "./fsx.ts";
import { isSafeId } from "./paths.ts";
import type { Store } from "./store.ts";
import { osUser } from "./store.ts";

export const MAX_REPORT_CHARS = 200_000;
/** The saved-report list shows this many, newest first. */
export const MAX_LISTED_REPORTS = 200;

const isoInstant = z.string().refine((v) => !Number.isNaN(Date.parse(v)), {
  message: "Not an ISO 8601 date-time",
});

const SidecarSchema = z.object({
  schema: z.literal("pmo-report-meta/1"),
  id: z.string(),
  title: z.string(),
  /** The file-name prefix: the first save's day. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period: z.object({
    kind: z.enum(["last-7-days", "this-week", "last-week", "custom"]),
    startDay: z.string(),
    endDay: z.string(),
    label: z.string(),
  }),
  generatedAt: z.string(),
  asOfDay: z.string(),
  narrative: z.object({ model: z.string(), promptVersion: z.number().int() }).nullable(),
  fullFile: z.string().nullable(),
  revisions: z
    .array(
      z.object({
        rev: z.number().int().min(1),
        file: z.string(),
        savedAt: z.string(),
        savedBy: z.string(),
        /** The text differs from what was generated (a person edited it). */
        edited: z.boolean(),
        chars: z.number().int(),
      }),
    )
    .min(1),
  data: z.unknown(),
});
export type ReportSidecar = z.infer<typeof SidecarSchema>;

const summaryOf = (sidecar: ReportSidecar): SavedReportSummary => {
  const latest = sidecar.revisions[sidecar.revisions.length - 1];
  return {
    id: sidecar.id,
    title: sidecar.title,
    period: sidecar.period,
    generatedAt: sidecar.generatedAt,
    savedAt: latest.savedAt,
    revisions: sidecar.revisions.length,
    edited: sidecar.revisions.some((r) => r.edited),
    usedModel: sidecar.narrative !== null,
  };
};

/** A file name this module wrote: no separators, no dots beyond the extension parts. */
const SAFE_FILE =
  /^\d{4}-\d{2}-\d{2}-[a-z]{1,4}_[0-9a-f]{8,40}(?:\.r\d{1,4}|\.full)?\.(?:md|json)$/;

async function findSidecarFile(store: Store, id: string): Promise<string | null> {
  if (!isSafeId(id)) return null;
  const names = await listFiles(store.paths.reports, ".json");
  return (
    names.find((name) => name.endsWith(`-${id}.json`) && SAFE_FILE.test(name)) ?? null
  );
}

async function loadSidecar(
  store: Store,
  id: string,
): Promise<{ sidecar: ReportSidecar; file: string } | null> {
  const file = await findSidecarFile(store, id);
  if (!file) return null;
  try {
    const parsed = SidecarSchema.safeParse(
      await readJson(path.join(store.paths.reports, file)),
    );
    return parsed.success ? { sidecar: parsed.data, file } : null;
  } catch {
    return null;
  }
}

export async function listReports(store: Store): Promise<SavedReportSummary[]> {
  const out: SavedReportSummary[] = [];
  for (const name of await listFiles(store.paths.reports, ".json")) {
    if (!SAFE_FILE.test(name)) continue;
    try {
      const parsed = SidecarSchema.safeParse(
        await readJson(path.join(store.paths.reports, name)),
      );
      if (parsed.success) out.push(summaryOf(parsed.data));
    } catch {
      // An unreadable sidecar is skipped, never fatal.
    }
  }
  return out
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
    .slice(0, MAX_LISTED_REPORTS);
}

export type ReadResult =
  | {
      ok: true;
      summary: SavedReportSummary;
      revision: number;
      markdown: string;
      revisions: SavedReportRevision[];
      data: unknown;
    }
  | { ok: false; reason: string };

export async function readReport(
  store: Store,
  id: string,
  rev?: number,
): Promise<ReadResult> {
  const found = await loadSidecar(store, id);
  if (!found) return { ok: false, reason: "That report was not found." };
  const { sidecar } = found;
  const wanted = rev ?? sidecar.revisions[sidecar.revisions.length - 1].rev;
  const revision = sidecar.revisions.find((r) => r.rev === wanted);
  if (!revision || !SAFE_FILE.test(revision.file)) {
    return { ok: false, reason: "That revision was not found." };
  }
  let markdown: string;
  try {
    markdown = await readFile(path.join(store.paths.reports, revision.file), "utf8");
  } catch {
    return { ok: false, reason: "The saved text of that revision is missing." };
  }
  return {
    ok: true,
    summary: summaryOf(sidecar),
    revision: revision.rev,
    markdown: markdown.replace(/^\ufeff/, ""),
    revisions: sidecar.revisions.map(({ rev: r, savedAt, savedBy, edited }) => ({
      rev: r,
      savedAt,
      savedBy,
      edited,
    })),
    data: sidecar.data,
  };
}

export const SaveReportBodySchema = z.object({
  markdown: z
    .string()
    .refine((v) => v.trim().length > 0, { message: "There is nothing to save." })
    .refine((v) => v.length <= MAX_REPORT_CHARS, {
      message: `The report is too long to save (the limit is ${MAX_REPORT_CHARS} characters).`,
    }),
  /** The text differs from what was generated. */
  edited: z.boolean(),
  /** A save of a revision that is no longer the latest is refused. */
  baseRevision: z.number().int().min(1).optional(),
  /** First save only: which days it covers (the resolved period, not "this week"),
   *  and the choice the person made. */
  period: z
    .object({
      start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      kind: z.enum(["last-7-days", "this-week", "last-week", "custom"]).optional(),
    })
    .optional(),
  generatedAt: isoInstant.optional(),
  /** Which model wrote the highlights that are in the text, if any. */
  narrative: z
    .object({
      model: z.string().max(80),
      promptVersion: z.number().int().min(0).max(1000),
    })
    .nullish(),
});
export type SaveReportBody = z.infer<typeof SaveReportBodySchema>;

export type SaveResult =
  | { ok: true; id: string; revision: number; savedAt: string; summary: SavedReportSummary }
  | { ok: false; reason: string };

const fail = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });

/** Save the report text as a new revision (the first save creates the report).
 *  Runs under the store lock so two saves never claim the same revision number. */
export async function saveReport(
  store: Store,
  id: string,
  body: SaveReportBody,
  deps: { now: Date },
): Promise<SaveResult> {
  if (!isSafeId(id)) return fail("That is not a report id.");
  const markdown = `${body.markdown.replace(/\r\n?/g, "\n").replace(/\n+$/, "")}\n`;
  const savedAt = deps.now.toISOString();
  const savedBy = osUser();

  return store.withLock(async () => {
    await mkdir(store.paths.reports, { recursive: true });
    const existing = await loadSidecar(store, id);

    if (existing) {
      const { sidecar, file } = existing;
      const latest = sidecar.revisions[sidecar.revisions.length - 1];
      if (body.baseRevision !== undefined && body.baseRevision !== latest.rev) {
        return fail(
          `A newer revision (${latest.rev}) of this report exists. Open it again before saving.`,
        );
      }
      const rev = latest.rev + 1;
      const prefix = file.replace(/\.json$/, "");
      const mdFile = `${prefix}.r${rev}.md`;
      await writeTextAtomic(path.join(store.paths.reports, mdFile), markdown);
      const next: ReportSidecar = {
        ...sidecar,
        revisions: [
          ...sidecar.revisions,
          {
            rev,
            file: mdFile,
            savedAt,
            savedBy,
            edited: body.edited,
            chars: markdown.length,
          },
        ],
      };
      await writeJsonAtomic(path.join(store.paths.reports, file), next);
      await store.audit("report-save", {
        reportId: id,
        revision: rev,
        edited: body.edited,
      });
      return { ok: true as const, id, revision: rev, savedAt, summary: summaryOf(next) };
    }

    // First save: the data is rebuilt for the resolved days, so the sidecar holds
    // every item (the text may have capped long lists).
    if (!body.period) return fail("Generate the report first, then save it.");
    const config = await store.loadConfig();
    const request = PeriodRequestSchema.safeParse({
      kind: "custom",
      start: body.period.start,
      end: body.period.end,
    });
    if (!request.success) return fail("That period is not valid.");
    const built = buildReport(await store.listTodos(), deps.now, request.data, config);
    if (!built.ok) return fail(built.reason);
    const { data } = built;
    const kind: PeriodKind = body.period.kind ?? "custom";
    const timeZone = safeTimeZone(config.reminders.timeZone);
    const date = localParts(deps.now, timeZone).day;
    const prefix = `${date}-${id}`;

    const fullFile = isCapped(data) ? `${prefix}.full.md` : null;
    if (fullFile) {
      await writeTextAtomic(
        path.join(store.paths.reports, fullFile),
        renderMarkdown(data, { maxPerSection: Number.POSITIVE_INFINITY }),
      );
    }
    const mdFile = `${prefix}.md`;
    await writeTextAtomic(path.join(store.paths.reports, mdFile), markdown);
    const sidecar: ReportSidecar = {
      schema: "pmo-report-meta/1",
      id,
      title: data.title,
      date,
      period: {
        kind,
        startDay: data.period.startDay,
        endDay: data.period.endDay,
        label: data.period.label,
      },
      generatedAt: body.generatedAt ?? savedAt,
      asOfDay: data.asOfDay,
      narrative: body.narrative ?? null,
      fullFile,
      revisions: [
        {
          rev: 1,
          file: mdFile,
          savedAt,
          savedBy,
          edited: body.edited,
          chars: markdown.length,
        },
      ],
      data,
    };
    await writeJsonAtomic(path.join(store.paths.reports, `${prefix}.json`), sidecar);
    await store.audit("report-save", {
      reportId: id,
      revision: 1,
      edited: body.edited,
      period: periodOf(sidecar),
      narrativeModel: sidecar.narrative?.model ?? null,
    });
    return { ok: true as const, id, revision: 1, savedAt, summary: summaryOf(sidecar) };
  });
}

const periodOf = (sidecar: ReportSidecar) =>
  `${sidecar.period.startDay}..${sidecar.period.endDay}`;

/** The id a generated report carries until it is saved. */
export const newReportId = (): string => newId("rp");
