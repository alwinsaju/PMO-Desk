// The "Needs attention" strip under the PMO toolbar: one plain-words line per
// thing that is wrong, with how many and the first few file names. Pure, so the
// wording is tested without rendering anything (see attentionView.test.mjs).
import type { AttentionSummary } from "./types.ts";

export type AttentionId =
  | "corruptRecords"
  | "oversizedFiles"
  | "erroredFiles"
  | "parkedFiles"
  | "foreignFiles"
  | "duplicatesIgnored"
  | "queuePaused"
  | "modelMissing"
  | "badTimeZone";

export interface AttentionLine {
  id: AttentionId;
  text: string;
}

/** How many file names a line spells out before "and N more". */
export const MAX_SHOWN_NAMES = 3;

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** ": a.json, b.json and 2 more" (empty when no name is known). */
function namesSuffix(names: string[], count: number): string {
  const shown = names.slice(0, MAX_SHOWN_NAMES);
  if (shown.length === 0) return "";
  const more = count - shown.length;
  return `: ${shown.join(", ")}${more > 0 ? ` and ${more} more` : ""}`;
}

/** Lines for everything in the summary that is not zero or false, most
 *  serious first. `skip` drops kinds that the notices above already say. */
export function attentionLines(
  summary: AttentionSummary,
  skip: readonly AttentionId[] = [],
): AttentionLine[] {
  const lines: AttentionLine[] = [];
  const add = (id: AttentionId, text: string) => {
    if (!skip.includes(id)) lines.push({ id, text });
  };

  const corrupt = summary.corruptRecords;
  if (corrupt > 0) {
    add(
      "corruptRecords",
      `${corrupt} saved ${plural(corrupt, "record", "records")} could not be read and ${plural(
        corrupt,
        "was",
        "were",
      )} moved to the corrupt folder${namesSuffix(summary.corruptFileNames, corrupt)}.`,
    );
  }
  const oversized = summary.oversizedFiles;
  if (oversized > 0) {
    add(
      "oversizedFiles",
      `${oversized} inbox ${plural(oversized, "file is", "files are")} too large to take in${namesSuffix(
        summary.oversizedFileNames,
        oversized,
      )}.`,
    );
  }
  const errored = summary.erroredFiles;
  if (errored > 0) {
    add(
      "erroredFiles",
      `${errored} inbox ${plural(errored, "file", "files")} could not be read on the last scan (locked, or no permission)${namesSuffix(
        summary.erroredFileNames,
        errored,
      )}. ${plural(errored, "It is", "They are")} tried again on the next scan.`,
    );
  }
  const parked = summary.parkedFiles;
  if (parked > 0) {
    add(
      "parkedFiles",
      `${parked} producer ${plural(parked, "file", "files")} failed validation and ${plural(
        parked,
        "was",
        "were",
      )} parked in rejected-files${namesSuffix(summary.parkedFileNames, parked)}.`,
    );
  }
  const foreign = summary.foreignFiles;
  if (foreign > 0) {
    add(
      "foreignFiles",
      `${foreign} ${plural(foreign, "file", "files")} in the inbox ${plural(
        foreign,
        "is",
        "are",
      )} not PMO messages and ${plural(foreign, "was", "were")} left alone${namesSuffix(
        summary.foreignFileNames,
        foreign,
      )}.`,
    );
  }
  if (summary.queuePaused) {
    add("queuePaused", "Structuring is paused: the local model is not running.");
  }
  if (summary.modelMissing) {
    add("modelMissing", "The local model is not installed.");
  }
  if (summary.badTimeZone) {
    add("badTimeZone", "The time zone in the settings file is not a real zone.");
  }
  const repeats = summary.duplicatesIgnored;
  if (repeats > 0) {
    add(
      "duplicatesIgnored",
      `${repeats} repeated ${plural(repeats, "message was", "messages were")} ignored since the app started.`,
    );
  }
  return lines;
}
