// Run with `pnpm test`. The wording of the "Needs attention" strip.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { attentionLines } from "./attentionView.ts";
import { emptyAttentionSummary } from "./types.ts";

const summary = (patch) => ({ ...emptyAttentionSummary(), ...patch });

describe("attentionLines", () => {
  it("says nothing for a healthy system", () => {
    assert.deepEqual(attentionLines(emptyAttentionSummary()), []);
  });

  it("names up to three files and counts the rest", () => {
    const [line] = attentionLines(
      summary({
        corruptRecords: 5,
        corruptFileNames: [
          "queue/a.json",
          "queue/b.json",
          "todos/c.json",
          "todos/d.json",
        ],
      }),
    );
    assert.equal(line.id, "corruptRecords");
    assert.equal(
      line.text,
      "5 saved records could not be read and were moved to the corrupt folder: queue/a.json, queue/b.json, todos/c.json and 2 more.",
    );
  });

  it("uses singular wording and no 'more' when every name is shown", () => {
    const [line] = attentionLines(
      summary({ oversizedFiles: 1, oversizedFileNames: ["huge.json"] }),
    );
    assert.equal(line.text, "1 inbox file is too large to take in: huge.json.");
  });

  it("counts files whose names are unknown without a dangling colon", () => {
    const [line] = attentionLines(summary({ foreignFiles: 2 }));
    assert.equal(
      line.text,
      "2 files in the inbox are not PMO messages and were left alone.",
    );
  });

  it("covers errored, parked and repeated messages", () => {
    const lines = attentionLines(
      summary({
        erroredFiles: 1,
        erroredFileNames: ["a.json"],
        parkedFiles: 2,
        parkedFileNames: ["b.json", "c.json"],
        duplicatesIgnored: 1,
      }),
    );
    assert.deepEqual(
      lines.map((l) => l.id),
      ["erroredFiles", "parkedFiles", "duplicatesIgnored"],
    );
    assert.match(lines[0].text, /tried again on the next scan/);
    assert.match(lines[1].text, /parked in rejected-files: b\.json, c\.json\./);
    assert.equal(lines[2].text, "1 repeated message was ignored since the app started.");
  });

  it("reports the flags, and can skip what the notices already say", () => {
    const flags = summary({ queuePaused: true, modelMissing: true, badTimeZone: true });
    assert.deepEqual(
      attentionLines(flags).map((l) => l.id),
      ["queuePaused", "modelMissing", "badTimeZone"],
    );
    assert.deepEqual(
      attentionLines(flags, ["queuePaused", "modelMissing", "badTimeZone"]),
      [],
    );
  });
});
