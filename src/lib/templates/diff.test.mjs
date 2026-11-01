import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { collapseSame, diffStats, lineDiff, versionChanges } from "./diff.ts";

const kinds = (diff) => diff.map((l) => `${l.kind[0]}:${l.text}`);

describe("lineDiff", () => {
  it("marks nothing for identical text", () => {
    assert.deepEqual(kinds(lineDiff("a\nb", "a\nb")), ["s:a", "s:b"]);
  });
  it("finds an added, a removed and a changed line", () => {
    assert.deepEqual(kinds(lineDiff("a\nb", "a\nb\nc")), ["s:a", "s:b", "a:c"]);
    assert.deepEqual(kinds(lineDiff("a\nb\nc", "a\nc")), ["s:a", "d:b", "s:c"]);
    assert.deepEqual(kinds(lineDiff("a\nb\nc", "a\nx\nc")), ["s:a", "d:b", "a:x", "s:c"]);
  });
  it("keeps shared lines in order across several edits", () => {
    const diff = lineDiff("one\ntwo\nthree\nfour", "zero\none\nthree\nfour\nfive");
    assert.deepEqual(kinds(diff), [
      "a:zero",
      "s:one",
      "d:two",
      "s:three",
      "s:four",
      "a:five",
    ]);
  });
  it("handles empty sides and CRLF", () => {
    assert.deepEqual(kinds(lineDiff("", "a")), ["a:a"]);
    assert.deepEqual(kinds(lineDiff("a", "")), ["d:a"]);
    assert.deepEqual(lineDiff("", ""), []);
    assert.deepEqual(kinds(lineDiff("a\r\nb", "a\nb")), ["s:a", "s:b"]);
  });
  it("counts what changed", () => {
    assert.deepEqual(diffStats(lineDiff("a\nb", "a\nc\nd")), { added: 2, removed: 1 });
  });
});

describe("collapseSame", () => {
  const text = (n) => Array.from({ length: n }, (_, i) => `line ${i}`).join("\n");
  it("folds long unchanged runs but keeps context around a change", () => {
    const diff = lineDiff(text(10), text(10).replace("line 5", "changed"));
    const rows = collapseSame(diff, 1);
    assert.deepEqual(
      rows.map((r) => (r.kind === "skip" ? `skip ${r.count}` : `${r.kind[0]}:${r.text}`)),
      ["skip 4", "s:line 4", "d:line 5", "a:changed", "s:line 6", "skip 3"],
    );
  });
  it("shows everything when nothing changed within reach", () => {
    assert.deepEqual(collapseSame(lineDiff("a", "a")), [{ kind: "skip", count: 1 }]);
  });
});

describe("versionChanges", () => {
  const base = {
    name: "N",
    description: "",
    subject: "Hi",
    to: "",
    cc: "",
    body: "x\ny",
  };
  it("lists only the fields that differ, old to current", () => {
    const changes = versionChanges({ ...base, subject: "Hello", body: "x\nz" }, base);
    assert.deepEqual(
      changes.map((c) => c.field),
      ["subject", "body"],
    );
    assert.deepEqual(kinds(changes[0].diff), ["d:Hi", "a:Hello"]);
    assert.deepEqual(kinds(changes[1].diff), ["s:x", "d:y", "a:z"]);
  });
  it("is empty when nothing differs", () => {
    assert.deepEqual(versionChanges(base, base), []);
  });
});
