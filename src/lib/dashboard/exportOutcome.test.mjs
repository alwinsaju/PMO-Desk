import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { exportOutcome, exportToast } from "./exportOutcome.ts";

describe("dashboard export outcome", () => {
  it("tells a save, a cancelled dialog and a failure apart", () => {
    assert.deepEqual(exportOutcome(true, "C:\\a.png"), {
      status: "saved",
      path: "C:\\a.png",
    });
    assert.deepEqual(exportOutcome(true, null), { status: "cancelled" });
    assert.deepEqual(exportOutcome(false, null), { status: "failed" });
  });
  it("says nothing for a cancel and explains a failure in plain words", () => {
    assert.equal(exportToast({ status: "cancelled" }, "png"), null);
    assert.deepEqual(exportToast({ status: "saved", path: "x.pdf" }, "pdf"), {
      tone: "success",
      message: "Saved x.pdf",
    });
    assert.match(exportToast({ status: "failed" }, "png").message, /picture/);
    assert.match(exportToast({ status: "failed" }, "pdf").message, /PDF/);
    assert.equal(exportToast({ status: "failed" }, "pdf").tone, "danger");
  });
});
