import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shortLabel, stillNeededText } from "./stillNeeded.ts";

describe("stillNeededText", () => {
  it("is empty when nothing is missing", () => {
    assert.equal(stillNeededText([]), "");
  });
  it("lists the files without their column details", () => {
    assert.equal(
      stillNeededText([
        "ServiceNow incident export",
        "Team roster (Names.xlsx: Full Name, Email)",
      ]),
      "Still needed: ServiceNow incident export, Team roster",
    );
  });
  it("keeps a label that is only a parenthesis", () => {
    assert.equal(shortLabel("(odd)"), "(odd)");
    assert.equal(shortLabel("Plain name"), "Plain name");
  });
});
