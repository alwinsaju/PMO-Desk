import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  draftSummaryLines,
  parseDraftSummary,
  RECIPIENTS_UNREADABLE,
} from "./draftSummary.ts";

const summary = {
  to: ["USPDTOperate <u@x.com>"],
  cc: ["Peethambaram, Sreela <s@x.com>", "Atchula, Rupavani <r@x.com>"],
  subject: "Backlog Incidents | 4 May",
  attachments: ["Backlog.xlsx"],
};

describe("parseDraftSummary", () => {
  it("returns the summary of an ok reply", () => {
    assert.deepEqual(parseDraftSummary({ ok: true, summary }), summary);
  });

  it("is null for failures, null summaries and malformed replies", () => {
    assert.equal(parseDraftSummary({ ok: false, reason: "x" }), null);
    assert.equal(parseDraftSummary({ ok: true, summary: null }), null);
    assert.equal(parseDraftSummary({ ok: true }), null);
    assert.equal(parseDraftSummary(null), null);
    assert.equal(parseDraftSummary({ ok: true, summary: "x" }), null);
  });

  it("is null when there is no recipient at all", () => {
    assert.equal(
      parseDraftSummary({ ok: true, summary: { ...summary, to: [" "], cc: [] } }),
      null,
    );
  });

  it("drops non-strings, trims and caps what it shows", () => {
    const parsed = parseDraftSummary({
      ok: true,
      summary: {
        to: [" a@x.com ", 5, null, ""],
        cc: "not a list",
        subject: "s".repeat(500),
        attachments: undefined,
      },
    });
    assert.deepEqual(parsed, {
      to: ["a@x.com"],
      cc: [],
      subject: "s".repeat(300),
      attachments: [],
    });
    const many = parseDraftSummary({
      ok: true,
      summary: { ...summary, to: Array.from({ length: 80 }, (_, i) => `p${i}@x.com`) },
    });
    assert.equal(many.to.length, 50);
  });
});

describe("draftSummaryLines", () => {
  it("shows To, Cc, Subject and Attachments", () => {
    assert.deepEqual(draftSummaryLines(summary), [
      "To: USPDTOperate <u@x.com>",
      "Cc: Peethambaram, Sreela <s@x.com>; Atchula, Rupavani <r@x.com>",
      "Subject: Backlog Incidents | 4 May",
      "Attachments: Backlog.xlsx",
    ]);
  });

  it("omits empty Cc and Attachments lines", () => {
    assert.deepEqual(
      draftSummaryLines({ to: ["a@x.com"], cc: [], subject: "S", attachments: [] }),
      ["To: a@x.com", "Subject: S"],
    );
  });

  it("falls back to the check-Outlook warning for a null summary", () => {
    assert.deepEqual(draftSummaryLines(null), [RECIPIENTS_UNREADABLE]);
    assert.equal(
      RECIPIENTS_UNREADABLE,
      "Recipients could not be read - check the draft in Outlook before sending.",
    );
  });
});
