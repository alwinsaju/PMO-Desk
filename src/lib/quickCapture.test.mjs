// Run with `pnpm test`. The wording of the "Quick capture" settings row.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_LABEL, describeQuickCapture } from "./quickCapture.ts";

const state = (over = {}) => ({
  enabled: false,
  registered: false,
  accelerator: "Control+Shift+Space",
  label: "Ctrl+Shift+Space",
  error: null,
  ...over,
});

describe("describeQuickCapture", () => {
  it("is OFF before the shell has answered, and names the default shortcut", () => {
    const view = describeQuickCapture({ state: null });
    assert.equal(view.checked, false);
    assert.equal(view.warning, null);
    assert.ok(view.hint.includes(DEFAULT_LABEL));
    assert.equal(DEFAULT_LABEL, "Ctrl+Shift+Space");
  });

  it("OFF: says it is off and what the shortcut would be", () => {
    const view = describeQuickCapture({ state: state() });
    assert.equal(view.checked, false);
    assert.match(view.hint, /^Off\./);
    assert.match(view.hint, /Ctrl\+Shift\+Space/);
  });

  it("ON and registered: tells the person what to press, no warning", () => {
    const view = describeQuickCapture({
      state: state({ enabled: true, registered: true }),
    });
    assert.equal(view.checked, true);
    assert.equal(view.hint, "Press Ctrl+Shift+Space from any app to add a to-do");
    assert.equal(view.warning, null);
  });

  it("ON but taken by another app: stays ON and shows the shell's reason", () => {
    const reason =
      "Ctrl+Shift+Space is already used by another app, so quick capture is not active.";
    const view = describeQuickCapture({
      state: state({ enabled: true, registered: false, error: reason }),
    });
    assert.equal(view.checked, true);
    assert.equal(view.warning, reason);
  });

  it("an error from a failed call is shown, but a stale state error is not shown when OFF", () => {
    assert.equal(
      describeQuickCapture({ state: state(), error: "Could not save the setting." })
        .warning,
      "Could not save the setting.",
    );
    assert.equal(
      describeQuickCapture({ state: state({ enabled: false, error: "old" }) }).warning,
      null,
    );
  });
});
