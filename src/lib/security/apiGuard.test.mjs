// Run with `pnpm test`. The rules behind src/middleware.ts.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { guardApiRequest } from "./apiGuard.ts";

const call = (method, headers) =>
  guardApiRequest(new Request("http://127.0.0.1:3000/api/x", { method, headers }));

describe("guardApiRequest", () => {
  it("lets loopback hosts through for every method", () => {
    for (const host of ["127.0.0.1:3000", "localhost:3000", "[::1]:3000"]) {
      for (const method of ["GET", "HEAD", "OPTIONS", "POST", "DELETE"]) {
        assert.equal(call(method, { host }).ok, true, `${method} ${host}`);
      }
    }
  });

  it("refuses any request addressed to a non-loopback host (DNS rebinding)", () => {
    for (const method of ["GET", "POST"]) {
      assert.equal(call(method, { host: "evil.example:3000" }).ok, false);
      assert.equal(call(method, { host: "127.0.0.1.evil.example" }).ok, false);
    }
  });

  it("refuses a write whose Origin is not the app's own", () => {
    const host = "127.0.0.1:3000";
    assert.equal(call("POST", { host, origin: "https://evil.example" }).ok, false);
    assert.equal(call("DELETE", { host, origin: "http://127.0.0.1:4000" }).ok, false);
    assert.equal(call("POST", { host, origin: "null" }).ok, false);
    assert.equal(call("POST", { host, origin: "http://127.0.0.1:3000" }).ok, true);
    assert.equal(call("POST", { host }).ok, true); // curl, the desktop shell
  });

  it("does not apply the Origin rule to reads", () => {
    const host = "127.0.0.1:3000";
    assert.equal(call("GET", { host, origin: "https://other.example" }).ok, true);
  });

  it("applies the Origin / Sec-Fetch-Site rule to reads when asked (checkReads)", () => {
    const host = "127.0.0.1:3000";
    const strict = (headers) =>
      guardApiRequest(new Request("http://127.0.0.1:3000/api/x", { headers }), {
        checkReads: true,
      });
    assert.equal(strict({ host, origin: "https://other.example" }).ok, false);
    assert.equal(strict({ host, "sec-fetch-site": "cross-site" }).ok, false);
    assert.equal(strict({ host, "sec-fetch-site": "same-origin" }).ok, true);
    assert.equal(strict({ host: "evil.example" }).ok, false);
  });
});
