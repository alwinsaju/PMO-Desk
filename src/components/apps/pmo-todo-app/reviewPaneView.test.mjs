// Run with `pnpm test`. The two-pane Review Queue: layout choice, row wording, selection.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  REVIEW_PANE_MIN_WIDTH,
  oneLine,
  resolveSelection,
  reviewLayout,
  reviewRowView,
} from "./reviewPaneView.ts";

const NOW = Date.parse("2026-10-30T10:00:00+05:30");
const proposal = (status, extra = {}) => ({
  id: "p1",
  status,
  isActionable: status === "ready" ? true : null,
  structuring: "ai",
  quoteVerified: true,
  summary: {
    source: "outlook",
    subject: "Send the RAID log",
    senderName: "Sam Lee",
    senderAddress: "sam@company.com",
    receivedAt: "2026-10-30T09:55:00+05:30",
  },
  draft: {
    title: "Send RAID log to Sam",
    description: "Sam wants the RAID log.\nBy Friday.",
  },
  ...extra,
});

describe("reviewLayout", () => {
  it("keeps the dialog at 900 px and below, and uses two panes above", () => {
    assert.equal(REVIEW_PANE_MIN_WIDTH, 900);
    assert.equal(reviewLayout(0), "dialog");
    assert.equal(reviewLayout(900), "dialog");
    assert.equal(reviewLayout(901), "pane");
    assert.equal(reviewLayout(1600), "pane");
  });
});

describe("oneLine", () => {
  it("collapses whitespace and cuts long text at a word", () => {
    assert.equal(oneLine("  a \n b\t c "), "a b c");
    assert.equal(oneLine(null), "");
    const cut = oneLine("word ".repeat(60), 40);
    assert.ok(cut.length <= 40);
    assert.ok(cut.endsWith("…"));
    assert.ok(!cut.includes("wor…"), cut);
  });
});

describe("reviewRowView", () => {
  it("shows the subject as the title, the description as the summary, and when", () => {
    const row = reviewRowView(proposal("ready"), NOW);
    assert.equal(row.title, "Send the RAID log");
    assert.equal(row.summary, "Sam wants the RAID log. By Friday.");
    assert.equal(row.sender, "Sam Lee");
    assert.equal(row.when, "5 min ago");
    assert.equal(row.showStatus, false);
    assert.equal(row.fellBack, false);
  });

  it("flags a draft the AI could not structure", () => {
    const row = reviewRowView(proposal("ready", { structuring: "fallback" }), NOW);
    assert.equal(row.fellBack, true);
  });

  it("does not flag the fallback on a row the model thinks is not a task", () => {
    const row = reviewRowView(
      proposal("ready", { structuring: "fallback", isActionable: false }),
      NOW,
    );
    assert.equal(row.fellBack, false);
    assert.equal(row.showStatus, true);
  });

  it("falls back to the draft title, then a placeholder, when the subject is empty", () => {
    const blank = { ...proposal("ready").summary, subject: "  " };
    assert.equal(
      reviewRowView(proposal("ready", { summary: blank }), NOW).title,
      "Send RAID log to Sam",
    );
    assert.equal(
      reviewRowView(proposal("pending", { summary: blank, draft: null }), NOW).title,
      "(no subject)",
    );
  });

  it("explains rows that have no draft yet", () => {
    assert.match(
      reviewRowView(proposal("structuring", { draft: null }), NOW).summary,
      /Waiting/,
    );
    assert.match(
      reviewRowView(proposal("failed", { draft: null }), NOW).summary,
      /could not/,
    );
    assert.equal(
      reviewRowView(proposal("failed", { draft: null }), NOW).showStatus,
      true,
    );
  });

  it("reports the checks a reviewer should make", () => {
    const row = reviewRowView(
      proposal("ready", {
        quoteVerified: false,
        replyBelowQuote: true,
        possibleDuplicateOf: "p0",
        part: { index: 2, total: 3 },
      }),
      NOW,
    );
    assert.equal(row.checkOriginal, true);
    assert.equal(row.replyBelowQuote, true);
    assert.equal(row.duplicate, true);
    assert.equal(row.part, "Task 2 of 3");
  });
});

describe("resolveSelection", () => {
  const order = ["a", "b", "c"];
  it("keeps the chosen row while it is still listed", () => {
    assert.equal(resolveSelection(order, "b", 1), "b");
  });
  it("starts on the first row", () => {
    assert.equal(resolveSelection(order, null, 0), "a");
  });
  it("moves to the row that took the place of a settled one", () => {
    assert.equal(resolveSelection(["a", "c"], "b", 1), "c");
  });
  it("falls back to the last row when the last one was settled", () => {
    assert.equal(resolveSelection(["a", "b"], "c", 2), "b");
  });
  it("selects nothing in an empty list", () => {
    assert.equal(resolveSelection([], "a", 0), null);
  });
});
