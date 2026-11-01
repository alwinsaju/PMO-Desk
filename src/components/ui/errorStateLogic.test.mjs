import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { errorStateDetails } from "./errorStateLogic.ts";

const NOW = new Date("2026-10-30T10:00:00.000Z");

describe("errorStateDetails", () => {
  it("puts what failed, the likely cause and the technical detail on the clipboard", () => {
    const text = errorStateDetails(
      {
        title: "Couldn't reach the Tasks launcher",
        cause: "The Tasks engine is still starting.",
        detail: "ECONNREFUSED 127.0.0.1:8000",
        where: "Tasks",
      },
      { appVersion: "6.0.1", now: NOW },
    );
    assert.match(text, /^AI OS 6\.0\.1$/m);
    assert.match(text, /^When: 2026-10-30T10:00:00\.000Z$/m);
    assert.match(text, /^Where: Tasks$/m);
    assert.match(text, /^What: Couldn't reach the Tasks launcher$/m);
    assert.match(text, /Likely cause: The Tasks engine is still starting\./);
    assert.match(text, /ECONNREFUSED 127\.0\.0\.1:8000/);
  });

  it("copes with only a title", () => {
    const text = errorStateDetails({ title: "Failed" }, { now: NOW });
    assert.match(text, /^What: Failed$/m);
    assert.match(text, /^Details: \(none\)$/m);
  });
});
