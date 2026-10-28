import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formSummary, gatePending, requiredQuestionsText } from "./formGate.ts";

const schema = {
  fields: [
    {
      id: "a",
      label: "A",
      type: "select",
      required: true,
      options: [{ value: "x" }, { value: "y" }],
      default: "x",
    },
    { id: "b", label: "B", type: "text", required: true },
    { id: "c", label: "C", type: "text", required: true },
    { id: "d", label: "D", type: "text", required: false },
  ],
};

describe("requiredQuestionsText", () => {
  it("uses the shared wording", () => {
    assert.equal(
      requiredQuestionsText(3, 3),
      "3 of 3 required questions still need an answer",
    );
    assert.equal(
      requiredQuestionsText(1, 4),
      "1 of 4 required questions still need an answer",
    );
  });
  it("says all answered / none required at the edges", () => {
    assert.equal(requiredQuestionsText(0, 2), "All 2 required questions answered");
    assert.equal(requiredQuestionsText(0, 0), "No required questions");
  });
});

describe("gatePending", () => {
  it("is the engine's list: a preselected default does not count as answered", () => {
    assert.deepEqual(gatePending(schema, ["a", "b", "c"], {}), ["a", "b", "c"]);
  });
  it("drops ids the person has just answered but not yet saved", () => {
    assert.deepEqual(gatePending(schema, ["a", "b", "c"], { a: "y", b: " hi " }), ["c"]);
  });
  it("ignores blank text and invalid select edits", () => {
    assert.deepEqual(gatePending(schema, ["a", "b"], { a: "zzz", b: "   " }), ["a", "b"]);
  });
  it("card and dialog agree: same pending ids give the same sentence", () => {
    const pending = ["a", "b", "c"];
    assert.equal(
      formSummary(schema, pending),
      requiredQuestionsText(gatePending(schema, pending, {}).length, 3),
    );
  });
});
