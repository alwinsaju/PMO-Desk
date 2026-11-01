// Run with `pnpm test`. Settings > Activity timeline: categories, filters and day grouping.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  categoryCounts,
  categoryOf,
  filterByCategory,
  groupByDay,
} from "./activityTimeline.ts";
import { ACTION_LABELS } from "./auditView.ts";

describe("categoryOf", () => {
  it("puts every named action in a real category", () => {
    for (const action of Object.keys(ACTION_LABELS)) {
      assert.notEqual(categoryOf(action), "other", action);
    }
    assert.equal(categoryOf("something-new"), "other");
  });

  it("groups related actions", () => {
    assert.equal(categoryOf("approve"), "messages");
    assert.equal(categoryOf("complete"), "todos");
    assert.equal(categoryOf("signoff-request"), "signoff");
    assert.equal(categoryOf("chaser-draft"), "signoff");
    assert.equal(categoryOf("report-save"), "reports");
    assert.equal(categoryOf("config"), "settings");
  });
});

describe("filters", () => {
  const entries = [{ action: "complete" }, { action: "approve" }, { action: "edit" }];

  it("counts by category in display order, skipping empty ones", () => {
    assert.deepEqual(categoryCounts(entries), [
      { category: "todos", count: 2 },
      { category: "messages", count: 1 },
    ]);
  });

  it("filters by one category or keeps everything", () => {
    assert.equal(filterByCategory(entries, "todos").length, 2);
    assert.equal(filterByCategory(entries, "").length, 3);
    assert.equal(filterByCategory(entries, "reports").length, 0);
  });
});

describe("groupByDay", () => {
  const now = new Date(2026, 9, 30, 12, 0, 0); // 30 Oct 2026, local
  const at = (d, h) => new Date(2026, 9, d, h, 0, 0).toISOString();

  it("groups newest-first entries under Today, Yesterday and dated headings", () => {
    const groups = groupByDay(
      [{ at: at(30, 11) }, { at: at(30, 9) }, { at: at(29, 18) }, { at: at(26, 10) }],
      now,
    );
    assert.deepEqual(
      groups.map((g) => [g.label, g.entries.length]),
      [
        ["Today", 2],
        ["Yesterday", 1],
        ["Mon 26 Oct", 1],
      ],
    );
  });

  it("skips entries whose time cannot be read", () => {
    assert.deepEqual(groupByDay([{ at: "not a date" }], now), []);
  });
});
