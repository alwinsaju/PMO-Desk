// Run with `pnpm test`. The dock tile count badge's text and spoken label.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { attentionMeaning, badgeText, badgedLabel, tileHover } from "./dockBadge.ts";

describe("dock badge", () => {
  it("shows nothing for zero, negatives and junk", () => {
    for (const bad of [0, -3, Number.NaN, Number.POSITIVE_INFINITY, 0.4]) {
      assert.equal(badgeText(bad), null);
    }
  });

  it("shows the number, then 9+", () => {
    assert.equal(badgeText(1), "1");
    assert.equal(badgeText(9), "9");
    assert.equal(badgeText(10), "9+");
    assert.equal(badgeText(120), "9+");
  });

  it("extends the tile label only when there is a badge", () => {
    assert.equal(badgedLabel("PMO To-Do", 0), "PMO To-Do");
    assert.equal(badgedLabel("PMO To-Do", 3), "PMO To-Do, 3 need attention");
    assert.equal(badgedLabel("PMO To-Do", 12), "PMO To-Do, 12 need attention");
  });
});

describe("attentionMeaning", () => {
  it("lists each source with its count", () => {
    assert.equal(
      attentionMeaning({ pmo: 2, leave: 1, tasks: 0, registers: 0 }),
      "3 need attention: 2 PMO items, 1 time-off request",
    );
  });

  it("singular and ignores junk", () => {
    assert.equal(
      attentionMeaning({ pmo: 0, leave: 0, tasks: 1, registers: Number.NaN }),
      "1 needs attention: 1 task needing you",
    );
  });

  it("is null when nothing needs you", () => {
    assert.equal(attentionMeaning({ pmo: 0, leave: 0, tasks: 0, registers: 0 }), null);
  });
});

describe("tileHover", () => {
  it("is just the name for an idle tile", () => {
    assert.deepEqual(tileHover({ label: "Notes", running: "none" }), {
      title: "Notes",
      lines: [],
    });
  });

  it("adds the badge meaning, then the run state", () => {
    assert.deepEqual(
      tileHover({
        label: "Dashboard",
        running: "open",
        badge: 3,
        meaning: "3 need attention: 2 PMO items, 1 time-off request",
      }),
      {
        title: "Dashboard",
        lines: ["3 need attention: 2 PMO items, 1 time-off request", "Open"],
      },
    );
  });

  it("falls back to a plain count and lists several windows", () => {
    assert.deepEqual(
      tileHover({
        label: "Staff",
        running: "minimized",
        badge: 1,
        windowTitles: ["Roster", "Time off"],
      }),
      {
        title: "Staff",
        lines: ["1 needs attention", "Minimized", "Roster · Time off"],
      },
    );
  });
});
