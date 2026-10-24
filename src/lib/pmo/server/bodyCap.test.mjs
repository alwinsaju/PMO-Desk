// Run with `pnpm test`. The size cap on request bodies (used by the paste route).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readBodyCapped } from "./bodyCap.ts";

const post = (body, headers = {}) =>
  new Request("http://localhost/api/pmo/intake/manual", {
    method: "POST",
    body,
    headers,
  });

describe("readBodyCapped", () => {
  it("returns the parsed JSON when the request is within the cap", async () => {
    const result = await readBodyCapped(post(JSON.stringify({ a: 1 })), 1024);
    assert.deepEqual(result, { body: { a: 1 } });
  });

  it("refuses a body over the cap, by its real size and by a declared Content-Length", async () => {
    const big = JSON.stringify({ text: "x".repeat(2000) });
    const real = await readBodyCapped(post(big), 1024);
    assert.match(real.reason, /too large \(the limit is 1 KB\)/);
    const declared = await readBodyCapped(
      post("{}", { "content-length": "999999" }),
      1024,
    );
    assert.match(declared.reason, /too large/);
  });

  it("counts bytes, not characters", async () => {
    const result = await readBodyCapped(
      post(JSON.stringify({ t: "\u20ac".repeat(400) })),
      1024,
    );
    assert.match(result.reason, /too large/);
  });

  it("explains a body that is not JSON", async () => {
    const result = await readBodyCapped(post("not json"), 1024);
    assert.match(result.reason, /not valid JSON/);
  });
});
