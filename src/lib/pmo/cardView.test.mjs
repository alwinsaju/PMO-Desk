// Run with `pnpm test`. Avatar initials, the action-item summary and the per-card toggle.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CARD_ITEM_LIMIT, actionItemsView, initials, toggleFlag } from "./cardView.ts";

describe("initials", () => {
  it("takes the first and last name", () => {
    assert.equal(initials("Pat Example"), "PE");
    assert.equal(initials("  mary jane van der berg "), "MB");
  });
  it("takes one letter from a single name", () => {
    assert.equal(initials("Sam"), "S");
  });
  it("reads an email's local part", () => {
    assert.equal(initials("pat.lee@company.com"), "PL");
    assert.equal(initials("sam@company.com"), "S");
  });
  it("copes with accents, punctuation and empty input", () => {
    assert.equal(initials("élodie Dupont"), "ÉD");
    assert.equal(initials("O'Neil, Pat"), "OP");
    assert.equal(initials(""), "?");
    assert.equal(initials(null), "?");
    assert.equal(initials("---"), "?");
  });
});

const item = (id, done) => ({ id, text: id, done });

describe("actionItemsView", () => {
  it("counts what is done", () => {
    const view = actionItemsView([item("a", true), item("b", false), item("c", false)]);
    assert.equal(view.done, 1);
    assert.equal(view.total, 3);
    assert.equal(view.label, "1 of 3 done");
    assert.equal(view.hidden, 0);
  });
  it("says when everything is done, and says nothing without items", () => {
    assert.equal(actionItemsView([item("a", true), item("b", true)]).label, "All 2 done");
    assert.equal(actionItemsView([]).label, "");
  });
  it("lists the first items and counts the rest", () => {
    const many = Array.from({ length: CARD_ITEM_LIMIT + 3 }, (_, i) =>
      item(`i${i}`, false),
    );
    const view = actionItemsView(many);
    assert.equal(view.shown.length, CARD_ITEM_LIMIT);
    assert.equal(view.hidden, 3);
    assert.equal(actionItemsView(many, 2).hidden, many.length - 2);
  });
});

describe("toggleFlag", () => {
  it("switches an id on, then off, without mutating", () => {
    const empty = {};
    const on = toggleFlag(empty, "t1");
    assert.deepEqual(on, { t1: true });
    assert.deepEqual(empty, {});
    assert.deepEqual(toggleFlag(on, "t1"), {});
    assert.deepEqual(toggleFlag(on, "t2"), { t1: true, t2: true });
  });
});
