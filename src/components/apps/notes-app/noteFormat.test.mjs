import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyFormat, toggleCheck } from "./noteFormat.ts";

describe("applyFormat: line formats", () => {
  it("adds a bullet to the line under the cursor and keeps the cursor on its text", () => {
    const edit = applyFormat("one\ntwo", 5, 5, "bullet");
    assert.equal(edit.text, "one\n- two");
    assert.deepEqual([edit.start, edit.end], [7, 7]);
  });
  it("formats every non-empty line of a selection, skipping blank ones", () => {
    const edit = applyFormat("a\n\nb\nc", 0, 6, "bullet");
    assert.equal(edit.text, "- a\n\n- b\n- c");
  });
  it("takes the marker off when every line already has it", () => {
    const edit = applyFormat("- a\n- b", 0, 7, "bullet");
    assert.equal(edit.text, "a\nb");
  });
  it("adds to the rest when only some lines have it", () => {
    assert.equal(applyFormat("- a\nb", 0, 5, "bullet").text, "- a\n- b");
  });
  it("turns a bullet into a checklist item and back", () => {
    const checked = applyFormat("- milk", 2, 2, "check");
    assert.equal(checked.text, "- [ ] milk");
    assert.equal(applyFormat(checked.text, 0, 0, "check").text, "milk");
  });
  it("replaces a heading with a bullet rather than stacking markers", () => {
    assert.equal(applyFormat("# Plan", 0, 0, "bullet").text, "- Plan");
  });
  it("makes a heading on an empty note", () => {
    const edit = applyFormat("", 0, 0, "heading");
    assert.equal(edit.text, "# ");
    assert.deepEqual([edit.start, edit.end], [2, 2]);
  });
  it("ignores a selection that ends just after a line break", () => {
    assert.equal(applyFormat("a\nb", 0, 2, "heading").text, "# a\nb");
  });
});

describe("applyFormat: bold", () => {
  it("wraps the selection and keeps it selected", () => {
    const edit = applyFormat("say hello now", 4, 9, "bold");
    assert.equal(edit.text, "say **hello** now");
    assert.equal(edit.text.slice(edit.start, edit.end), "hello");
  });
  it("puts the cursor between the markers when nothing is selected", () => {
    const edit = applyFormat("ab", 1, 1, "bold");
    assert.equal(edit.text, "a****b");
    assert.deepEqual([edit.start, edit.end], [3, 3]);
  });
  it("unwraps a selection that sits inside markers, or includes them", () => {
    const inside = applyFormat("a **b** c", 4, 5, "bold");
    assert.equal(inside.text, "a b c");
    assert.equal(inside.text.slice(inside.start, inside.end), "b");
    const including = applyFormat("a **b** c", 2, 7, "bold");
    assert.equal(including.text, "a b c");
  });
  it("copes with a selection outside the text", () => {
    assert.equal(applyFormat("ab", 5, 9, "bold").text, "ab****");
  });
});

describe("toggleCheck", () => {
  it("flips a checklist line either way and leaves other lines alone", () => {
    assert.equal(toggleCheck("- [ ] call"), "- [x] call");
    assert.equal(toggleCheck("- [x] call"), "- [ ] call");
    assert.equal(toggleCheck("- call"), null);
    assert.equal(toggleCheck("plain"), null);
  });
});
