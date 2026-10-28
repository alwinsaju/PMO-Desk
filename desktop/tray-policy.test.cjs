// Run with `pnpm test`. The hide-to-tray decision.
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { SESSION_QUERY_GRACE_MS, shouldHideToTray } = require("./tray-policy.cjs");

describe("shouldHideToTray", () => {
  it("hides only when the setting is on and nothing is ending", () => {
    assert.equal(
      shouldHideToTray({
        keepRunningInTray: true,
        isQuitting: false,
        sessionEnding: false,
      }),
      true,
    );
  });

  it("lets the close through when the setting is off or not exactly true", () => {
    for (const keepRunningInTray of [false, undefined, null, 1, "true"]) {
      assert.equal(
        shouldHideToTray({ keepRunningInTray }),
        false,
        String(keepRunningInTray),
      );
    }
  });

  it("lets the close through while quitting", () => {
    assert.equal(shouldHideToTray({ keepRunningInTray: true, isQuitting: true }), false);
  });

  it("lets the close through while the OS session is ending (sign-out, shutdown)", () => {
    assert.equal(
      shouldHideToTray({ keepRunningInTray: true, sessionEnding: true }),
      false,
    );
    assert.equal(
      shouldHideToTray({
        keepRunningInTray: true,
        isQuitting: true,
        sessionEnding: true,
      }),
      false,
    );
  });

  it("tolerates a missing argument", () => {
    assert.equal(shouldHideToTray(), false);
  });

  it("trusts a session query only briefly", () => {
    assert.ok(SESSION_QUERY_GRACE_MS > 0 && SESSION_QUERY_GRACE_MS <= 60_000);
  });
});
