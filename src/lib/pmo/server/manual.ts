// POST /api/pmo/intake/manual: a pasted message becomes a source:"manual"
// pmo-intake/1 file in the SAME inbox the producers use, written the same way
// (temp file, then rename), so it is deduplicated, filtered and queued by the
// ordinary ingest pass rather than by a side door. The sourceId is a hash of
// the content, so pasting the same text twice is one item, unless the person
// chooses "Import anyway" (allowDuplicate), which salts the id.
import { createHash, randomBytes } from "node:crypto";
import { stat } from "node:fs/promises";
import path from "node:path";
import { dedupeKey, normaliseText } from "../dedupe.ts";
import { filterIntake } from "../filter.ts";
import { buildManualIntake, ManualPasteSchema } from "../manualIntake.ts";
import { IntakeSchema } from "../types.ts";
import type { ActionResult, Pmo } from "./actions.ts";
import { writeJsonAtomic } from "./fsx.ts";

export interface ManualSubmitted {
  /** The same text is already in the system; nothing was written. */
  duplicate: boolean;
  fileName: string | null;
  /** The reason the filter will give, if a blocked-domain/term rule will catch it. */
  wouldFilter: string | null;
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** yyyymmddThhmmssZ */
export function compactUtc(instant: Date): string {
  return instant
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
}

export async function submitManualIntake(
  pmo: Pmo,
  body: unknown,
): Promise<ActionResult<ManualSubmitted>> {
  const parsed = ManualPasteSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
    return { ok: false, reason: `${where}${issue.message}` };
  }
  const paste = parsed.data;

  const hash = sha256(
    [paste.subject, paste.from, paste.body].map((part) => normaliseText(part)).join("\n"),
  );
  const now = pmo.now();
  // "Import anyway" salts the id so the new item does not collide with the old one.
  const idHash = paste.allowDuplicate
    ? sha256(`${hash}|${now.getTime()}|${randomBytes(4).toString("hex")}`)
    : hash;
  const raw = buildManualIntake(
    paste,
    `manual-${idHash.slice(0, 32)}`,
    now.toISOString(),
  );
  const intake = IntakeSchema.safeParse(raw);
  if (!intake.success)
    return { ok: false, reason: "That text could not be turned into a message." };

  const key = dedupeKey(intake.data);
  if (!paste.allowDuplicate && (await pmo.store.hasSeen(key))) {
    return { ok: true, duplicate: true, fileName: null, wouldFilter: null };
  }

  const config = await pmo.store.loadConfig();
  const dir = pmo.inboxDir(config);
  try {
    if (!(await stat(dir)).isDirectory()) throw new Error("not a folder");
  } catch {
    // Like every producer, never invent the inbox: it is where a sync lives.
    return {
      ok: false,
      reason: `The inbox folder was not found (${dir}). Create it, then paste again.`,
    };
  }

  const fileName = `manual-${compactUtc(now)}-${idHash.slice(0, 8)}.json`;
  await writeJsonAtomic(path.join(dir, fileName), raw);
  await pmo.store.audit("paste", {
    origin: paste.origin,
    fileName,
    ...(paste.allowDuplicate ? { importedAnyway: true } : {}),
  });

  const verdict = filterIntake(intake.data, config);
  return {
    ok: true,
    duplicate: false,
    fileName,
    wouldFilter: verdict.pass ? null : verdict.reason,
  };
}
