// Run with `pnpm test`. How many profile requests go out at once, and when an unanswered one
// is sent again (the M365 flow throttles with HTTP 429 when 70 requests arrive together).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_AUTO_ATTEMPTS,
  MAX_NEW_REQUESTS_PER_SCAN,
  MAX_REQUESTS_IN_FLIGHT,
  RETRY_BASE_MS,
  RETRY_MAX_MS,
  planRequests,
  retryDelayMs,
} from "./exchange.ts";

const emails = (n) => Array.from({ length: n }, (_, i) => `p${i}@x.com`);
const open = (email, attempt, ageMs) => ({ email, attempt, ageMs });

describe("retryDelayMs", () => {
  it("waits longer after every unanswered try, up to a ceiling", () => {
    assert.equal(retryDelayMs(1), RETRY_BASE_MS);
    assert.equal(retryDelayMs(2), RETRY_BASE_MS * 2);
    assert.equal(retryDelayMs(3), RETRY_BASE_MS * 4);
    assert.equal(retryDelayMs(30), RETRY_MAX_MS);
    assert.equal(retryDelayMs(0), RETRY_BASE_MS);
  });
});

describe("planRequests", () => {
  it("asks for only a few new people per scan, not all 72 at once", () => {
    const plan = planRequests({ waiting: emails(72), open: [] });
    assert.equal(plan.length, MAX_NEW_REQUESTS_PER_SCAN);
    assert.ok(plan.every((r) => r.attempt === 1));
    assert.deepEqual(
      plan.map((r) => r.email),
      emails(MAX_NEW_REQUESTS_PER_SCAN),
    );
  });

  it("never has more than the limit in flight", () => {
    const inFlight = emails(MAX_REQUESTS_IN_FLIGHT - 2).map((e) => open(e, 1, 1000));
    const plan = planRequests({ waiting: emails(72), open: inFlight });
    assert.equal(plan.length, 2);
    const full = emails(MAX_REQUESTS_IN_FLIGHT).map((e) => open(e, 1, 1000));
    assert.deepEqual(planRequests({ waiting: emails(72), open: full }), []);
  });

  it("does not ask again for a request that is still young", () => {
    const plan = planRequests({
      waiting: ["a@x.com"],
      open: [open("a@x.com", 1, RETRY_BASE_MS - 1)],
    });
    assert.deepEqual(plan, []);
  });

  it("asks again for an unanswered request once its wait is over, counting the try", () => {
    const plan = planRequests({
      waiting: ["a@x.com", "b@x.com"],
      open: [open("a@x.com", 1, RETRY_BASE_MS), open("b@x.com", 3, RETRY_BASE_MS * 4)],
    });
    assert.deepEqual(plan, [
      { email: "b@x.com", attempt: 4 },
      { email: "a@x.com", attempt: 2 },
    ]);
  });

  it("uses the stale request's own longer wait, so a second try is not immediate", () => {
    const plan = planRequests({
      waiting: ["a@x.com"],
      open: [open("a@x.com", 2, RETRY_BASE_MS + 1)],
    });
    assert.deepEqual(plan, []);
  });

  it("gives up on its own after the maximum number of tries", () => {
    const plan = planRequests({
      waiting: ["a@x.com"],
      open: [open("a@x.com", MAX_AUTO_ATTEMPTS, RETRY_MAX_MS * 2)],
    });
    assert.deepEqual(plan, []);
  });

  it("serves new people before retries, and the longest-waiting retry first", () => {
    const plan = planRequests({
      waiting: ["new1@x.com", "late@x.com", "later@x.com"],
      open: [
        open("late@x.com", 1, RETRY_BASE_MS + 10),
        open("later@x.com", 1, RETRY_BASE_MS * 3),
      ],
    });
    assert.deepEqual(
      plan.map((r) => r.email),
      ["new1@x.com", "later@x.com", "late@x.com"],
    );
  });

  it("compares addresses without regard to case and ignores people who are not waiting", () => {
    const plan = planRequests({
      waiting: ["A@X.com"],
      open: [open("a@x.com", 1, 1000), open("gone@x.com", 1, RETRY_MAX_MS)],
    });
    assert.deepEqual(plan, []);
  });

  it("lets 72 people get through over a handful of scans", () => {
    const waiting = emails(72);
    let openNow = [];
    let scans = 0;
    const answered = new Set();
    while (answered.size < 72 && scans < 200) {
      scans++;
      const plan = planRequests({
        waiting: waiting.filter((e) => !answered.has(e)),
        open: openNow,
      });
      openNow = [
        ...openNow.map((o) => ({ ...o, ageMs: o.ageMs + 20_000 })),
        ...plan.map((r) => ({ email: r.email, attempt: r.attempt, ageMs: 0 })),
      ];
      // The flow answers every request that is a scan old.
      for (const o of openNow) if (o.ageMs >= 20_000) answered.add(o.email);
      openNow = openNow.filter((o) => !answered.has(o.email));
    }
    assert.equal(answered.size, 72);
    assert.ok(scans <= 25, `took ${scans} scans`);
  });
});
