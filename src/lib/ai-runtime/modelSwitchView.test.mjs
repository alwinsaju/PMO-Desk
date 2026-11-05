// Run with `pnpm test`. The wording and states of the "Fast AI model" switch.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fastSwitchView } from "./modelSwitchView.ts";

const options = (fastInstalled = true) => [
  { id: "gemma4:12b", kind: "accurate", installed: true },
  { id: "qwen3.5:4b", kind: "fast", installed: fastInstalled },
];
const base = { active: "gemma4:12b", preferred: "gemma4:12b", pull: null, error: null };

describe("fastSwitchView", () => {
  it("is off and says what the careful model is", () => {
    const view = fastSwitchView({ ...base, options: options() });
    assert.equal(view.checked, false);
    assert.match(view.hint, /gemma4:12b, the most careful/);
  });

  it("offers the download when the fast model is not on this computer", () => {
    const view = fastSwitchView({ ...base, options: options(false) });
    assert.equal(view.checked, false);
    assert.match(view.hint, /download qwen3\.5:4b \(about 3\.3 GB\)/);
  });

  it("is on when the fast model is chosen", () => {
    const view = fastSwitchView({
      ...base,
      active: "qwen3.5:4b",
      preferred: "qwen3.5:4b",
      options: options(),
    });
    assert.equal(view.checked, true);
    assert.match(view.hint, /Quicker answers/);
  });

  it("shows the download progress and which model is used until then", () => {
    const view = fastSwitchView({
      ...base,
      preferred: "qwen3.5:4b",
      pull: { model: "qwen3.5:4b", percent: 41.6 },
      options: options(false),
    });
    assert.equal(view.checked, true);
    assert.equal(view.hint, "Downloading qwen3.5:4b 42%. Using gemma4:12b until then.");
  });

  it("explains a chosen model that is not downloaded and not downloading", () => {
    const view = fastSwitchView({
      ...base,
      preferred: "qwen3.5:4b",
      options: options(false),
    });
    assert.equal(view.hint, "qwen3.5:4b is not downloaded yet. Using gemma4:12b.");
  });

  it("says which model is really answering when the careful one is not installed", () => {
    const view = fastSwitchView({
      ...base,
      active: "qwen3.5:4b",
      options: [
        { id: "gemma4:12b", kind: "accurate", installed: false },
        { id: "qwen3.5:4b", kind: "fast", installed: true },
      ],
    });
    assert.equal(view.checked, false);
    assert.equal(
      view.hint,
      "Using qwen3.5:4b right now. gemma4:12b, the most careful, is not installed on this computer.",
    );
  });

  it("shows an error instead of the hint", () => {
    const view = fastSwitchView({ ...base, error: "Disk is full.", options: options() });
    assert.equal(view.hint, "Disk is full.");
  });

  it("matches a :latest spelling of the chosen model", () => {
    const view = fastSwitchView({
      ...base,
      preferred: "QWEN3.5:4B:latest",
      options: options(),
    });
    assert.equal(view.checked, true);
  });
});
