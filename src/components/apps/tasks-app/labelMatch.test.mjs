// Run with `pnpm test`. Pure logic only. The cases mirror tests/test_labels.py in
// tasks/monthly-report-deck (the Python twin of labelMatch.ts).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findSimilarLabel, isSameLabel, labelKey } from "./labelMatch.ts";

const SAME = [
  ["Soft Goods Issue", "softgoods issue"],
  ["Soft Goods Issue", "softgood issue"],
  ["Soft Goods Issue", "soft good isse"],
  ["Soft Goods Issue", "SoftGodds Issue"],
  ["Software Issue", "Software Isse"],
  ["Print Label", "print labels"],
  ["Donor Reaction Issue", "donor  reactions issue"],
  ["Unit Update - Plasma Volume", "unit update - plasma voulume"],
  ["NA", "n/a"],
];
const DIFFERENT = [
  ["EDQ Issue", "EOD Issue"],
  ["CMS 1.0 issues", "CMS 2.0 Issues"],
  ["Unit Update - Arm Used", "Unit Update - Arm Used PIN"],
  ["Physical Issue", "Physical related issue"],
  ["Donor Reaction record issue", "donor reaction issue"],
  ["HAE Issue", "DXT Issue"],
];

describe("isSameLabel", () => {
  for (const [a, b] of SAME) {
    it(`treats "${a}" and "${b}" as one category`, () => {
      assert.equal(isSameLabel(a, b), true);
      assert.equal(isSameLabel(b, a), true);
    });
  }
  for (const [a, b] of DIFFERENT) {
    it(`keeps "${a}" and "${b}" apart`, () => {
      assert.equal(isSameLabel(a, b), false);
      assert.equal(isSameLabel(b, a), false);
    });
  }
});

describe("labelKey", () => {
  it("ignores case, spacing, punctuation and plurals", () => {
    assert.equal(labelKey(" Soft  Goods-Issue "), "softgoodissue");
    assert.equal(labelKey("softgood issues"), "softgoodissue");
    assert.equal(labelKey(""), "");
  });
});

describe("findSimilarLabel", () => {
  const OPTIONS = [
    "Soft Goods Issue",
    "Deferral issue",
    "Referral bonus issue",
    "EDQ Issue",
    "Hardware Issue",
  ];

  it("finds the existing spelling of a variant", () => {
    assert.equal(findSimilarLabel("softgood issue", OPTIONS), "Soft Goods Issue");
    assert.equal(findSimilarLabel("  SOFT goods ISSUES ", OPTIONS), "Soft Goods Issue");
    assert.equal(findSimilarLabel("hardwre issue", OPTIONS), "Hardware Issue");
  });

  it("does not turn a real category into another one", () => {
    assert.equal(findSimilarLabel("Referral issue", OPTIONS), null); // "referral" is a real word elsewhere
    assert.equal(findSimilarLabel("EOD Issue", OPTIONS), null);
    assert.equal(findSimilarLabel("Drive Mapping", OPTIONS), null);
    assert.equal(findSimilarLabel("", OPTIONS), null);
  });
});
