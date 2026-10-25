// Run with `pnpm test` (Node's built-in test runner; Node >= 23.6 imports the
// .ts modules directly). Pure logic only — no network, no real engine.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { approveWithReviewCheck } from "./approveGate.ts";
import {
  applyResolutions,
  findColumns,
  parsePastedText,
  planImport,
  rowsFromSheets,
  toResolutionPayload,
  withResolvedLabels,
} from "./reviewImport.ts";

const OPTIONS = ["Hardware Issue", "Other", "Donor Loyalty issue", "Print Label"];

function incident(number, resolved = null) {
  return {
    number,
    short_description: null,
    resolution_notes: null,
    category: null,
    subcategory: null,
    state: null,
    assignment_group: null,
    assigned_to: null,
    current_subcategory2: "Needs Review",
    review_reasons: [],
    resolved_subcategory2: resolved,
  };
}

const QUEUE = [incident("INC1"), incident("INC2"), incident("INC3"), incident("INC4")];

describe("parsePastedText", () => {
  it("reads tab-separated columns copied from Excel, with a header", () => {
    const rows = parsePastedText(
      "Number\tSubcategory2\nINC1\tHardware Issue\nINC2\tOther\n",
    );
    assert.deepEqual(
      rows.map((r) => [r.number, r.value]),
      [
        ["INC1", "Hardware Issue"],
        ["INC2", "Other"],
      ],
    );
  });

  it("reads comma-separated text without a header, incl. quoted values", () => {
    const rows = parsePastedText('INC1,Hardware Issue\r\n"INC2","Other"\r\n');
    assert.deepEqual(
      rows.map((r) => [r.number, r.value]),
      [
        ["INC1", "Hardware Issue"],
        ["INC2", "Other"],
      ],
    );
  });

  it("falls back to splitting on the first whitespace run", () => {
    const rows = parsePastedText("INC1 Hardware Issue");
    assert.deepEqual([rows[0].number, rows[0].value], ["INC1", "Hardware Issue"]);
  });

  it("honours header names in a wider paste and ignores blank lines", () => {
    const rows = parsePastedText(
      "Short description\tINC Number\tSub-category 2\n\nx\tINC1\tOther",
    );
    assert.deepEqual([rows[0].number, rows[0].value], ["INC1", "Other"]);
  });

  it("gives a number with no second cell an empty value", () => {
    assert.equal(parsePastedText("INC1")[0].value, "");
  });
});

describe("findColumns / rowsFromSheets", () => {
  it("matches headers regardless of case, spacing and punctuation", () => {
    assert.deepEqual(findColumns([" NUMBER ", "x", "Sub Category-2"]), {
      number: 0,
      subcategory2: 2,
    });
    assert.equal(findColumns(["Number", "Subcategory"]), null);
  });

  it("prefers Review Needed, falls back to Incidents, ignores sheets without both columns", () => {
    const sheets = [
      {
        sheet: "Incidents",
        data: [
          ["Number", "Subcategory2"],
          ["INC1", "Other"],
          ["INC2", "Print Label"],
          ["INC999", "WIP"],
        ],
      },
      {
        sheet: "Org",
        data: [
          ["Assigned to", "Org"],
          ["a", "b"],
        ],
      },
      {
        sheet: "Review Needed",
        data: [
          ["Title banner"],
          ["Number", "Subcategory2", "Review reason"],
          ["INC1", "Hardware Issue", "x"],
          ["INC2", null, "x"],
          ["INC77", "Other", "x"],
        ],
      },
    ];
    const plan = planImport(QUEUE, OPTIONS, rowsFromSheets(sheets));
    const byNumber = Object.fromEntries(
      plan.resolutions.map((r) => [r.number, r.subcategory2]),
    );
    // Review Needed wins for INC1; its blank INC2 falls through to Incidents.
    assert.deepEqual(byNumber, { INC1: "Hardware Issue", INC2: "Print Label" });
    // INC77 is on the review sheet but not in the queue -> reported;
    // INC999 comes from the whole-month Incidents sheet -> silently ignored.
    assert.deepEqual(
      plan.notInQueue.map((n) => n.number),
      ["INC77"],
    );
    assert.deepEqual(plan.stillBlank, ["INC3", "INC4"]);
  });
});

describe("planImport", () => {
  const plan = (rows, incidents = QUEUE) =>
    planImport(
      incidents,
      OPTIONS,
      rows.map(([number, value]) => ({
        number,
        value,
        source: "paste",
        scope: "review",
      })),
    );

  it("canonicalizes existing options and stages unknown values as new labels", () => {
    const result = plan([
      ["INC1", "  hardware   ISSUE "],
      ["INC2", "donor loyalty ISSUE"],
      ["INC3", "  Brand   New Category "],
    ]);
    assert.deepEqual(result.resolutions, [
      { number: "INC1", subcategory2: "Hardware Issue" },
      { number: "INC2", subcategory2: "Donor Loyalty issue" },
      { number: "INC3", subcategory2: "Brand New Category" },
    ]);
    assert.deepEqual(result.newLabels, [{ label: "Brand New Category", count: 1 }]);
  });

  it("collapses near-duplicate new labels to the first spelling and counts them", () => {
    const result = plan([
      ["INC1", "Server Related"],
      ["INC2", "server  related"],
      ["INC3", "SERVER RELATED"],
      ["INC4", "Other"],
    ]);
    assert.deepEqual(
      result.resolutions.map((r) => r.subcategory2),
      ["Server Related", "Server Related", "Server Related", "Other"],
    );
    assert.deepEqual(result.newLabels, [{ label: "Server Related", count: 3 }]);
  });

  it("treats blank, skip and the Needs Review placeholder as pending, never as resolutions", () => {
    const result = plan([
      ["INC1", ""],
      ["INC2", "Skip"],
      ["INC3", "Needs Review"],
    ]);
    assert.equal(result.resolutions.length, 0);
    assert.equal(result.newLabels.length, 0);
    assert.deepEqual(result.stillBlank, ["INC1", "INC2", "INC3", "INC4"]);
  });

  it("reports numbers outside the queue and matches numbers case-insensitively", () => {
    const result = plan([
      ["inc1", "Other"],
      ["INC404", "Other"],
    ]);
    assert.deepEqual(result.resolutions, [{ number: "INC1", subcategory2: "Other" }]);
    assert.deepEqual(result.notInQueue, [{ number: "INC404", value: "Other" }]);
  });

  it("counts overwrites of already-resolved incidents and excludes them from stillBlank", () => {
    const incidents = [
      incident("INC1", "Other"),
      incident("INC2", "Print Label"),
      incident("INC3"),
    ];
    const result = plan(
      [
        ["INC1", "Hardware Issue"],
        ["INC2", "Print Label"],
      ],
      incidents,
    );
    assert.equal(result.overwrites, 1);
    assert.deepEqual(result.stillBlank, ["INC3"]);
  });

  it("uses the last line for a repeated number in a paste and counts the conflict", () => {
    const result = plan([
      ["INC1", "Other"],
      ["INC1", "Print Label"],
    ]);
    assert.deepEqual(result.resolutions, [
      { number: "INC1", subcategory2: "Print Label" },
    ]);
    assert.equal(result.duplicates, 1);
  });
});

describe("applyResolutions / toResolutionPayload", () => {
  it("import wins over a staged value, keeps the rest, and recomputes pending", () => {
    const incidents = [
      incident("INC1", "Other"),
      incident("INC2", "Print Label"),
      incident("INC3"),
    ];
    const next = applyResolutions(incidents, [
      { number: "INC1", subcategory2: "Hardware Issue" },
      { number: "INC3", subcategory2: "Other" },
    ]);
    assert.equal(next.pending, 0);
    // Posted payload is the FULL resolved set in the engine's shape.
    assert.deepEqual(toResolutionPayload(next.incidents), [
      { number: "INC1", subcategory2: "Hardware Issue" },
      { number: "INC2", subcategory2: "Print Label" },
      { number: "INC3", subcategory2: "Other" },
    ]);
    // Input is not mutated.
    assert.equal(incidents[0].resolved_subcategory2, "Other");
  });
});

describe("approveWithReviewCheck", () => {
  const queueWith = (resolved) => {
    const incidents = ["INC1", "INC2", "INC3", "INC4", "INC5", "INC6", "INC7"].map(
      (n, i) => incident(n, i < resolved ? "Other" : null),
    );
    return {
      count: incidents.length,
      pending: incidents.length - resolved,
      options: OPTIONS,
      incidents,
    };
  };

  it("never calls approve while the re-read queue has pending incidents", async () => {
    let approved = 0;
    const outcome = await approveWithReviewCheck("t", {
      fetchReviewIncidents: async () => queueWith(0),
      approveTask: async () => {
        approved++;
        return { ok: true };
      },
    });
    assert.equal(approved, 0);
    assert.equal(outcome.kind, "blocked");
    assert.equal(outcome.block.pending, 7);
    assert.deepEqual(outcome.block.numbers, ["INC1", "INC2", "INC3", "INC4", "INC5"]);
  });

  it("calls approve once nothing is pending", async () => {
    let approved = 0;
    const outcome = await approveWithReviewCheck("t", {
      fetchReviewIncidents: async () => queueWith(7),
      approveTask: async () => {
        approved++;
        return { ok: true };
      },
    });
    assert.equal(approved, 1);
    assert.deepEqual(outcome, { kind: "result", result: { ok: true } });
  });

  it("does not approve when the queue cannot be read", async () => {
    let approved = 0;
    const outcome = await approveWithReviewCheck("t", {
      fetchReviewIncidents: async () => {
        throw new Error("offline");
      },
      approveTask: async () => {
        approved++;
        return { ok: true };
      },
    });
    assert.equal(approved, 0);
    assert.equal(outcome.kind, "unverified");
  });

  it("turns a engine pending-refusal into the same block", async () => {
    let reads = 0;
    const outcome = await approveWithReviewCheck("t", {
      fetchReviewIncidents: async () => queueWith(++reads === 1 ? 7 : 5),
      approveTask: async () => ({
        ok: false,
        reason: "2 incident(s) still need a Subcategory2",
        pending: 2,
      }),
    });
    assert.equal(outcome.kind, "blocked");
    assert.equal(outcome.block.pending, 2);
    assert.deepEqual(outcome.block.numbers, ["INC6", "INC7"]);
  });

  it("passes any other engine refusal through untouched", async () => {
    const outcome = await approveWithReviewCheck("t", {
      fetchReviewIncidents: async () => queueWith(7),
      approveTask: async () => ({ ok: false, reason: "task is working" }),
    });
    assert.deepEqual(outcome, {
      kind: "result",
      result: { ok: false, reason: "task is working" },
    });
  });
});

describe("withResolvedLabels", () => {
  it("adds resolved labels missing from the options (once, case-insensitively)", () => {
    const incidents = [
      incident("INC1", "Server Related"),
      incident("INC2", "server related"),
      incident("INC3", "other"),
      incident("INC4"),
    ];
    assert.deepEqual(withResolvedLabels(OPTIONS, incidents), [
      ...OPTIONS,
      "Server Related",
    ]);
  });

  it("returns the same array when nothing is new", () => {
    assert.equal(withResolvedLabels(OPTIONS, [incident("INC1", "Other")]), OPTIONS);
  });
});
