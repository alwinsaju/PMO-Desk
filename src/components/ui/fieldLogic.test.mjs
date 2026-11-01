import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { describedBy, errorId, hintId, shouldShowError } from "./fieldLogic.ts";

describe("shouldShowError", () => {
  it("stays quiet until the user has left the field", () => {
    assert.equal(shouldShowError({ error: "Required", touched: false }), false);
  });

  it("shows after blur", () => {
    assert.equal(shouldShowError({ error: "Required", touched: true }), true);
  });

  it("shows straight away after a submit attempt (showErrorNow)", () => {
    assert.equal(
      shouldShowError({ error: "Required", touched: false, showErrorNow: true }),
      true,
    );
  });

  it("never shows without an error", () => {
    assert.equal(
      shouldShowError({ error: null, touched: true, showErrorNow: true }),
      false,
    );
    assert.equal(shouldShowError({ error: undefined, touched: true }), false);
    assert.equal(shouldShowError({ error: "", touched: true }), false);
  });
});

describe("describedBy", () => {
  it("points at the error when shown, otherwise at the hint", () => {
    assert.equal(describedBy("f", { hasHint: true, showError: true }), errorId("f"));
    assert.equal(describedBy("f", { hasHint: true, showError: false }), hintId("f"));
  });

  it("is undefined when there is nothing to describe", () => {
    assert.equal(describedBy("f", { hasHint: false, showError: false }), undefined);
  });
});
