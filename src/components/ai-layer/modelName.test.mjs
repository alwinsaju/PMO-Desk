import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { activeModelName } from "./modelName.ts";

describe("activeModelName", () => {
  it("reads the model in use from the model route's reply", () => {
    assert.equal(
      activeModelName({ ok: true, active: "gemma4:12b", preferred: "gemma4:12b" }),
      "gemma4:12b",
    );
    assert.equal(activeModelName({ ok: true, active: "  qwen3.5:4b " }), "qwen3.5:4b");
  });

  it("gives nothing for a reply that is not usable", () => {
    assert.equal(activeModelName(null), null);
    assert.equal(activeModelName("gemma4:12b"), null);
    assert.equal(activeModelName({ ok: false, reason: "x" }), null);
    assert.equal(activeModelName({ ok: true }), null);
    assert.equal(activeModelName({ ok: true, active: 7 }), null);
    assert.equal(activeModelName({ ok: true, active: "   " }), null);
  });

  it("shortens a very long name", () => {
    const name = activeModelName({ ok: true, active: "m".repeat(80) });
    assert.equal(name?.length, 32);
    assert.ok(name?.endsWith("…"));
  });
});
