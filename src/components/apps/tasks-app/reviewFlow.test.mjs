// Run with `pnpm test`. Pure logic only: no React, no network, no engine.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  acceptableSuggestions,
  neighbourNumber,
  nextPendingNumber,
  resolveLabel,
  searchOptions,
  similarPending,
} from "./reviewFlow.ts";

const OPTIONS = ["Hardware Issue", "Access Related", "Print Label"];

function incident(number, extra = {}) {
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
    resolved_subcategory2: null,
    ...extra,
  };
}

describe("resolveLabel", () => {
  it("keeps the list's own spelling for an existing category", () => {
    assert.deepEqual(resolveLabel("  hardware   issue ", OPTIONS), {
      ok: true,
      label: "Hardware Issue",
      isNew: false,
    });
  });

  it("uses the existing category for a plural or typo spelling instead of adding a duplicate", () => {
    assert.deepEqual(resolveLabel("hardwre issue", OPTIONS), {
      ok: true,
      label: "Hardware Issue",
      isNew: false,
      matchedFrom: "hardwre issue",
    });
    assert.equal(resolveLabel("print labels", OPTIONS).label, "Print Label");
  });

  it("accepts anything else as a new category with whitespace collapsed", () => {
    assert.deepEqual(resolveLabel("  Drive   Mapping ", OPTIONS), {
      ok: true,
      label: "Drive Mapping",
      isNew: true,
    });
  });

  it("refuses blank, placeholder and over-long names", () => {
    assert.equal(resolveLabel("   ", OPTIONS).ok, false);
    assert.equal(resolveLabel("Skip", OPTIONS).ok, false);
    assert.equal(resolveLabel("needs review", OPTIONS).ok, false);
    assert.equal(resolveLabel("x".repeat(61), OPTIONS).ok, false);
  });
});

describe("searchOptions", () => {
  it("returns everything for an empty query and offers no add", () => {
    assert.deepEqual(searchOptions(OPTIONS, " "), {
      matches: OPTIONS,
      canAdd: false,
      similar: null,
    });
  });

  it("filters case-insensitively and offers add when nothing matches exactly", () => {
    assert.deepEqual(searchOptions(OPTIONS, "acc"), {
      matches: ["Access Related"],
      canAdd: true,
      similar: null,
    });
  });

  it("does not offer add for an exact match or a reserved word", () => {
    assert.equal(searchOptions(OPTIONS, "print label").canAdd, false);
    assert.equal(searchOptions(OPTIONS, "skip").canAdd, false);
  });

  it("points to the existing category instead of offering a duplicate", () => {
    assert.deepEqual(searchOptions(OPTIONS, "hardwre issues"), {
      matches: [],
      canAdd: false,
      similar: "Hardware Issue",
    });
    assert.equal(searchOptions(OPTIONS, "Drive Mapping").similar, null);
  });
});

describe("nextPendingNumber", () => {
  const list = [
    incident("A", { resolved_subcategory2: "x" }),
    incident("B"),
    incident("C", { resolved_subcategory2: "x" }),
    incident("D"),
  ];

  it("moves forward to the next unresolved incident", () => {
    assert.equal(nextPendingNumber(list, "A"), "B");
    assert.equal(nextPendingNumber(list, "B"), "D");
  });

  it("wraps around and returns null when nothing else is pending", () => {
    assert.equal(nextPendingNumber(list, "D"), "B");
    const done = list.map((i) => ({ ...i, resolved_subcategory2: "x" }));
    assert.equal(nextPendingNumber(done, "A"), null);
  });

  it("starts from the top when there is no current incident", () => {
    assert.equal(nextPendingNumber(list, null), "B");
  });
});

describe("neighbourNumber", () => {
  const list = [incident("A"), incident("B"), incident("C")];

  it("steps both ways and stops at the ends", () => {
    assert.equal(neighbourNumber(list, "B", 1), "C");
    assert.equal(neighbourNumber(list, "B", -1), "A");
    assert.equal(neighbourNumber(list, "C", 1), null);
    assert.equal(neighbourNumber(list, "A", -1), null);
    assert.equal(neighbourNumber(list, "missing", 1), null);
  });
});

describe("similarPending", () => {
  const list = [
    incident("A", { short_description: "T: Drive mapping" }),
    incident("B", { short_description: " t:  drive MAPPING " }),
    incident("C", { short_description: "T: Drive mapping", resolved_subcategory2: "x" }),
    incident("D", { short_description: "Other" }),
    incident("E"),
  ];

  it("finds other unresolved incidents with the same description", () => {
    assert.deepEqual(
      similarPending(list, list[0]).map((i) => i.number),
      ["B"],
    );
  });

  it("finds nothing for a blank description", () => {
    assert.deepEqual(similarPending(list, list[4]), []);
  });

  it("also finds incidents whose resolution notes are almost the same (same notes group)", () => {
    const withNotes = [
      incident("A", { short_description: "Offboarding request", notes_group: "notes-1" }),
      incident("B", { short_description: "Deactivate access", notes_group: "notes-1" }),
      incident("C", { short_description: "Deactivate access", notes_group: "notes-2" }),
      incident("D", { notes_group: "notes-1", resolved_subcategory2: "x" }),
      incident("E", { short_description: "Offboarding request" }),
    ];
    assert.deepEqual(
      similarPending(withNotes, withNotes[0]).map((i) => i.number),
      ["B", "E"],
    );
    assert.deepEqual(
      similarPending(withNotes, withNotes[1]).map((i) => i.number),
      ["A", "C"],
    );
  });
});

describe("acceptableSuggestions", () => {
  const list = [
    incident("A", { ai_suggestion: { label: "Hardware Issue", confidence: "high" } }),
    incident("B", { ai_suggestion: { label: "Other", confidence: "low" } }),
    incident("C", {
      ai_suggestion: { label: "Print Label", confidence: "high" },
      resolved_subcategory2: "Print Label",
    }),
    incident("D"),
  ];

  it("takes every pending suggestion by default", () => {
    assert.deepEqual(acceptableSuggestions(list), [
      { number: "A", subcategory2: "Hardware Issue" },
      { number: "B", subcategory2: "Other" },
    ]);
  });

  it("can be limited by confidence and never touches resolved incidents", () => {
    assert.deepEqual(acceptableSuggestions(list, "high"), [
      { number: "A", subcategory2: "Hardware Issue" },
    ]);
  });

  it("stages an existing option instead of a differently spelled suggestion", () => {
    const spelled = [
      incident("A", { ai_suggestion: { label: "hardwre issue", confidence: "high" } }),
    ];
    assert.deepEqual(acceptableSuggestions(spelled, "low", ["Hardware Issue"]), [
      { number: "A", subcategory2: "Hardware Issue" },
    ]);
  });
});
