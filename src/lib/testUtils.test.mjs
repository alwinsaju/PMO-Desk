import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { waitFor } from "./testUtils.mjs";

describe("waitFor", () => {
  it("returns the first truthy value", async () => {
    let n = 0;
    assert.equal(await waitFor(() => ++n >= 3 && "done"), "done");
    assert.equal(n, 3);
  });

  it("supports async predicates", async () => {
    let n = 0;
    assert.equal(await waitFor(async () => ++n > 1, 500, 1), true);
  });

  it("throws when the condition is never met", async () => {
    await assert.rejects(
      waitFor(() => false, 30, 5),
      /not met within 30 ms/,
    );
  });
});
