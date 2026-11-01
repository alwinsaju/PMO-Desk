import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { emailBreakParts } from "./emailBreaks.ts";

describe("email break parts", () => {
  it("splits after @ and dots, keeping every character", () => {
    const parts = emailBreakParts("aarav.sharma@deloitte.com");
    assert.deepEqual(parts, ["aarav.", "sharma@", "deloitte.", "com"]);
    assert.equal(parts.join(""), "aarav.sharma@deloitte.com");
  });

  it("returns nothing for an empty address and one part when there is no break point", () => {
    assert.deepEqual(emailBreakParts(""), []);
    assert.deepEqual(emailBreakParts("nobody"), ["nobody"]);
  });
});
