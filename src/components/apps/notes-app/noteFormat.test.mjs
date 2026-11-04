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

describe("applyFormat: link", () => {
  it("puts a link skeleton at the cursor with its text selected", () => {
    const edit = applyFormat("see ", 4, 4, "link");
    assert.equal(edit.text, "see [link text](https://)");
    assert.equal(edit.text.slice(edit.start, edit.end), "link text");
  });
  it("makes the selected words the link text and selects the address to type", () => {
    const edit = applyFormat("read the spec now", 5, 13, "link");
    assert.equal(edit.text, "read [the spec](https://) now");
    assert.equal(edit.text.slice(edit.start, edit.end), "https://");
  });
  it("makes a selected address the link's address and selects the text to type", () => {
    const edit = applyFormat("go https://example.com/a now", 3, 24, "link");
    assert.equal(edit.text, "go [link text](https://example.com/a) now");
    assert.equal(edit.text.slice(edit.start, edit.end), "link text");
  });
  it("does not treat a javascript: selection as an address", () => {
    const edit = applyFormat("javascript:alert(1)", 0, 19, "link");
    assert.equal(edit.text, "[javascript:alert(1)](https://)");
    assert.equal(edit.text.slice(edit.start, edit.end), "https://");
  });
  it("takes the link off again when the whole link is selected", () => {
    const text = "a [b](https://x.example) c";
    const edit = applyFormat(text, 2, 24, "link");
    assert.equal(edit.text, "a b c");
    assert.equal(edit.text.slice(edit.start, edit.end), "b");
  });
  it("puts the skeleton after a selection that spans lines instead of wrapping it", () => {
    const edit = applyFormat("a\nb", 0, 3, "link");
    assert.equal(edit.text, "a\nb[link text](https://)");
  });
  it("copes with an empty note and a selection outside the text", () => {
    assert.equal(applyFormat("", 0, 0, "link").text, "[link text](https://)");
    assert.equal(applyFormat("ab", 5, 9, "link").text, "ab[link text](https://)");
  });
});

describe("applyFormat: code block", () => {
  it("inserts an empty fenced block with the cursor inside it", () => {
    const edit = applyFormat("", 0, 0, "code");
    assert.equal(edit.text, "```\n\n```");
    assert.deepEqual([edit.start, edit.end], [4, 4]);
  });
  it("starts the block on its own line when the cursor is mid-line", () => {
    const edit = applyFormat("abc", 3, 3, "code");
    assert.equal(edit.text, "abc\n```\n\n```");
    assert.deepEqual([edit.start, edit.end], [8, 8]);
  });
  it("wraps the selected text in a fence and keeps it selected", () => {
    const edit = applyFormat("x = 1\ny = 2", 0, 11, "code");
    assert.equal(edit.text, "```\nx = 1\ny = 2\n```");
    assert.equal(edit.text.slice(edit.start, edit.end), "x = 1\ny = 2");
  });
  it("keeps the text after the selection on its own line", () => {
    const edit = applyFormat("a b c", 2, 3, "code");
    assert.equal(edit.text, "a \n```\nb\n```\n c");
  });
  it("does not leave a stray blank line when the selection ends with a line break", () => {
    const edit = applyFormat("one\ntwo\nthree", 4, 8, "code");
    assert.equal(edit.text, "one\n```\ntwo\n```\nthree");
  });
});

describe("applyFormat: table", () => {
  const skeleton =
    "| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |";
  it("inserts a table skeleton with the first heading selected", () => {
    const edit = applyFormat("", 0, 0, "table");
    assert.equal(edit.text, skeleton);
    assert.equal(edit.text.slice(edit.start, edit.end), "Column 1");
  });
  it("puts the table on its own lines after the cursor's line text", () => {
    const edit = applyFormat("intro", 5, 5, "table");
    assert.equal(edit.text, `intro\n${skeleton}`);
    assert.equal(edit.text.slice(edit.start, edit.end), "Column 1");
  });
  it("keeps the rest of the line after the table", () => {
    const edit = applyFormat("ab", 1, 1, "table");
    assert.equal(edit.text, `a\n${skeleton}\nb`);
  });
  it("leaves a selection as it is and inserts after it", () => {
    const edit = applyFormat("keep this", 0, 4, "table");
    assert.ok(edit.text.startsWith("keep\n| Column 1"));
    assert.ok(edit.text.endsWith(" this"));
  });
});
