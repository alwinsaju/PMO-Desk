// Run with `pnpm test`. The report preview reads the Markdown the report writes.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isEmptyPreview, parseReportPreview } from "./reportPreview.ts";
import { renderMarkdown } from "./report.ts";
import { build, sampleTodos } from "./reportFixtures.mjs";

describe("parseReportPreview", () => {
  it("reads a generated report into a title, intro, stats and sections", () => {
    const markdown = renderMarkdown(build(sampleTodos()));
    const preview = parseReportPreview(markdown);

    assert.match(preview.title, /Weekly status/);
    assert.ok(preview.intro.some((line) => line.startsWith("Period:")));
    const summary = preview.sections.find((s) => s.heading === "Summary");
    assert.ok(summary?.stats && summary.stats.length >= 4);
    assert.deepEqual(
      summary.stats.find((s) => s.label === "Closed this period"),
      { label: "Closed this period", value: "2" },
    );
    const completed = preview.sections.find((s) => s.heading === "Completed this period");
    assert.equal(completed.count, 2);
    assert.equal(completed.bullets.length, 2);
    assert.equal(completed.stats, null);
    assert.ok(completed.bullets.some((b) => b.includes("Publish RAID log v3")));
  });

  it("keeps non-numeric parentheses in a heading", () => {
    const [section] = parseReportPreview(
      "# T\n\n## Due in the next 7 days (Sat 24 Oct to Fri 30 Oct) (2)\n- A\n- B\n",
    ).sections;
    assert.equal(section.heading, "Due in the next 7 days (Sat 24 Oct to Fri 30 Oct)");
    assert.equal(section.count, 2);
  });

  it("undoes the escapes and emphasis of the Markdown", () => {
    const preview = parseReportPreview(
      "# Atlas \\#1\n\n## Notes\n- Ship **v2** by \\*Friday\\* (Pat)\n",
    );
    assert.equal(preview.title, "Atlas #1");
    assert.equal(preview.sections[0].bullets[0], "Ship v2 by *Friday* (Pat)");
  });

  it("puts loose lines under their heading, and before any heading in the intro", () => {
    const preview = parseReportPreview("Hello\n# T\nPeriod: now\n## A\nSome note\n- x\n");
    assert.deepEqual(preview.intro, ["Hello", "Period: now"]);
    assert.equal(preview.title, "T");
    assert.deepEqual(preview.sections[0].notes, ["Some note"]);
    assert.deepEqual(preview.sections[0].stats, null);
  });

  it("shows a second level-one heading as a section rather than losing it", () => {
    const preview = parseReportPreview("# One\n# Two\n- a\n");
    assert.equal(preview.title, "One");
    assert.equal(preview.sections[0].heading, "Two");
  });

  it("copes with CRLF, blank text and numbered lists", () => {
    assert.equal(isEmptyPreview(parseReportPreview("")), true);
    assert.equal(isEmptyPreview(parseReportPreview("  \n\n")), true);
    const preview = parseReportPreview("# T\r\n## A\r\n1. first\r\n2) second\r\n");
    assert.deepEqual(preview.sections[0].bullets, ["first", "second"]);
    assert.equal(isEmptyPreview(preview), false);
  });
});
