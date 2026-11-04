// Run with `pnpm test`. The "Since you last opened" recap over the PMO audit log.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  RECAP_SCOPE_NOTE,
  RECAP_READ_LIMIT,
  buildRecap,
  entriesSince,
  recapBreakdown,
  recapCountText,
  recapMessage,
  validSince,
} from "./sinceRecap.ts";

const at = (minute) => `2026-11-05T10:${String(minute).padStart(2, "0")}:00.000Z`;
const entry = (minute, action = "complete") => ({ at: at(minute), action });

describe("entriesSince", () => {
  const entries = [entry(30), entry(20, "approve"), entry(10), entry(5)];

  it("keeps only entries strictly newer than the time", () => {
    assert.deepEqual(
      entriesSince(entries, at(10)).map((e) => e.at),
      [at(30), at(20)],
    );
  });

  it("keeps nothing for a missing or unreadable time", () => {
    assert.deepEqual(entriesSince(entries, ""), []);
    assert.deepEqual(entriesSince(entries, "yesterday"), []);
  });

  it("skips entries whose own time is unreadable", () => {
    assert.deepEqual(entriesSince([{ at: "nope", action: "x" }], at(1)), []);
  });
});

describe("validSince", () => {
  it("accepts an ISO time and rejects anything else", () => {
    assert.equal(validSince(at(3)), at(3));
    assert.equal(validSince(""), "");
    assert.equal(validSince("soon"), "");
    assert.equal(validSince(42), "");
    assert.equal(validSince(null), "");
  });
});

describe("buildRecap", () => {
  it("shows nothing on the first run (no previous time)", () => {
    assert.equal(buildRecap([entry(30)], ""), null);
    assert.equal(buildRecap([entry(30)], "garbage"), null);
  });

  it("shows nothing when there is nothing new", () => {
    assert.equal(buildRecap([entry(5), entry(10)], at(10)), null);
    assert.equal(buildRecap([], at(10)), null);
  });

  it("counts new entries and splits them by kind", () => {
    const recap = buildRecap(
      [
        entry(40, "report-save"),
        entry(30, "approve"),
        entry(20),
        entry(10, "edit"),
        entry(1),
      ],
      at(5),
    );
    assert.equal(recap.count, 4);
    assert.equal(recap.atLeast, false);
    assert.equal(recap.since, at(5));
    assert.deepEqual(recap.categories, [
      { category: "todos", count: 2 },
      { category: "messages", count: 1 },
      { category: "reports", count: 1 },
    ]);
  });

  it("says 'at least' when every readable entry is newer, because older ones may be cut off", () => {
    const many = Array.from({ length: RECAP_READ_LIMIT }, () => entry(30));
    const recap = buildRecap(many, at(5));
    assert.equal(recap.count, RECAP_READ_LIMIT);
    assert.equal(recap.atLeast, true);
    // a full read that reaches back past the time is exact
    const reached = [...many.slice(1), entry(1)];
    assert.equal(buildRecap(reached, at(5)).atLeast, false);
  });
});

describe("wording", () => {
  const recap = buildRecap([entry(30, "approve"), entry(20), entry(19)], at(5));

  it("counts lines, singular and plural", () => {
    assert.equal(recapCountText({ count: 1, atLeast: false }), "1 new line");
    assert.equal(recapCountText({ count: 3, atLeast: false }), "3 new lines");
    assert.equal(
      recapCountText({ count: 2000, atLeast: true }),
      "at least 2000 new lines",
    );
  });

  it("lists the kinds", () => {
    assert.equal(recapBreakdown(recap), "To-dos 2, Messages 1");
  });

  it("names the log and says Toolkit and Staff are not covered", () => {
    const text = recapMessage(recap);
    assert.match(text, /^Since you last opened: 3 new lines/);
    assert.match(text, /Toolkit and Staff changes are not recorded/);
    assert.ok(text.length <= 400, "fits a toast");
    assert.match(RECAP_SCOPE_NOTE, /Toolkit and Staff changes are not recorded/);
  });
});
