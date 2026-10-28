import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SELFTEST_MAX_AGE_MS,
  loadReusableSelfTest,
  reusableSelfTest,
  saveSelfTest,
} from "./selfTestCache.ts";

const NOW = Date.parse("2026-10-28T10:00:00Z");
const opts = { now: NOW, appVersion: "2.0.0" };
const pass = {
  ok: true,
  python: "3.12",
  checks: [{ id: "a", title: "A", ok: true, detail: "" }],
};
const fail = {
  ok: false,
  python: "3.12",
  checks: [{ id: "a", title: "A", ok: false, detail: "x" }],
};
const stored = (over = {}) => ({
  ok: true,
  at: new Date(NOW - 1000).toISOString(),
  appVersion: "2.0.0",
  facts: pass,
  ...over,
});

describe("reusableSelfTest", () => {
  it("reuses a recent pass for the same version", () => {
    assert.deepEqual(reusableSelfTest(stored(), opts), pass);
  });

  it("does not reuse a failure", () => {
    assert.equal(reusableSelfTest(stored({ ok: false, facts: fail }), opts), null);
    assert.equal(reusableSelfTest(stored({ facts: fail }), opts), null);
  });

  it("does not reuse another app version", () => {
    assert.equal(reusableSelfTest(stored({ appVersion: "1.0.0" }), opts), null);
  });

  it("expires after 7 days", () => {
    const at = (age) => new Date(NOW - age).toISOString();
    assert.deepEqual(
      reusableSelfTest(stored({ at: at(SELFTEST_MAX_AGE_MS - 1) }), opts),
      pass,
    );
    assert.equal(reusableSelfTest(stored({ at: at(SELFTEST_MAX_AGE_MS) }), opts), null);
  });

  it("does not trust a timestamp from the future or garbage", () => {
    assert.equal(
      reusableSelfTest(stored({ at: new Date(NOW + 60_000).toISOString() }), opts),
      null,
    );
    assert.equal(reusableSelfTest(stored({ at: "nope" }), opts), null);
    assert.equal(reusableSelfTest(null, opts), null);
    assert.equal(reusableSelfTest("x", opts), null);
    assert.equal(reusableSelfTest(stored({ facts: { ok: true } }), opts), null);
  });
});

describe("load / save", () => {
  it("round-trips through the injected file system", () => {
    const files = new Map();
    const io = {
      read: (f) => files.get(f) ?? null,
      write: (f, t) => files.set(f, t),
    };
    assert.equal(loadReusableSelfTest("f", io, opts), null);
    saveSelfTest("f", pass, io, opts);
    assert.deepEqual(loadReusableSelfTest("f", io, opts), pass);
    assert.equal(loadReusableSelfTest("f", io, { ...opts, appVersion: "3" }), null);
  });

  it("treats unreadable or corrupt files as 'no result' and never throws on save", () => {
    const io = {
      read: () => "{ nope",
      write: () => {
        throw new Error("EPERM");
      },
    };
    assert.equal(loadReusableSelfTest("f", io, opts), null);
    assert.doesNotThrow(() => saveSelfTest("f", pass, io, opts));
    const throwing = {
      read: () => {
        throw new Error("EBUSY");
      },
      write: () => {},
    };
    assert.equal(loadReusableSelfTest("f", throwing, opts), null);
  });
});
