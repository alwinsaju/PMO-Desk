import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { KIND_TONE, usedByBadge, usedByCount } from "./listView.ts";

const tpl = (over = {}) => ({
  id: "a",
  kind: "email",
  name: "Aging",
  subject: "",
  body: "",
  usedBy: [],
  ...over,
});

describe("usedByCount", () => {
  it("counts the places an email or report is used in", () => {
    assert.equal(usedByCount(tpl({ usedBy: ["x", "y"] })), 2);
    assert.equal(usedByCount(tpl()), 0);
  });
  it("counts the other templates that include a snippet", () => {
    const snippet = tpl({ id: "s", kind: "snippet", name: "Sign off" });
    const all = [
      snippet,
      tpl({ id: "1", body: "Hi\n{{> sign_off}}" }),
      tpl({ id: "2", subject: "{{>sign_off}}" }),
      tpl({ id: "3", body: "{{> other}}" }),
      tpl({ id: "4", body: "{{> sign_off_2}}" }),
    ];
    assert.equal(usedByCount(snippet, all, "s"), 2);
  });
  it("is zero for a snippet with no usable key", () => {
    assert.equal(usedByCount(tpl({ kind: "snippet", name: "!!!" }), [tpl()]), 0);
  });
});

describe("usedByBadge", () => {
  it("reads per type", () => {
    assert.deepEqual(usedByBadge(0, "email"), { label: "Not used", tone: "neutral" });
    assert.deepEqual(usedByBadge(1, "report"), { label: "Used by 1", tone: "accent" });
    assert.deepEqual(usedByBadge(2, "snippet"), {
      label: "In 2 templates",
      tone: "accent",
    });
    assert.equal(usedByBadge(1, "snippet").label, "In 1 template");
  });
  it("gives every type a tone", () => {
    assert.deepEqual(Object.keys(KIND_TONE).sort(), ["email", "report", "snippet"]);
  });
});
