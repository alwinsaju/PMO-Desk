// Run with `pnpm test`. Rich/lean effects persistence and the Settings row's
// wording against a FAKE document / localStorage / desktop bridge.
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  FX_STORAGE_KEY,
  GPU_UNAVAILABLE_WARNING,
  HARDWARE_ACCELERATION_HINT,
  describeHardwareAcceleration,
  getDisplayBridge,
  getFxInitScript,
  getStoredFx,
  setFx,
} from "./displayFx.ts";

function fakeEnv({ stored = {}, throwing = false, shell } = {}) {
  const attrs = new Map();
  const store = new Map(Object.entries(stored));
  const documentElement = {
    setAttribute: (k, v) => attrs.set(k, v),
    removeAttribute: (k) => attrs.delete(k),
    getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
  };
  const localStorage = {
    getItem: (k) => {
      if (throwing) throw new Error("denied");
      return store.has(k) ? store.get(k) : null;
    },
    setItem: (k, v) => {
      if (throwing) throw new Error("denied");
      store.set(k, v);
    },
  };
  return { attrs, store, documentElement, localStorage, shell };
}

function install(env) {
  globalThis.document = { documentElement: env.documentElement };
  globalThis.window = { localStorage: env.localStorage, aiOsDesktop: env.shell };
}

afterEach(() => {
  delete globalThis.document;
  delete globalThis.window;
});

const desktopState = (over = {}) => ({
  saved: true,
  launchedWithGpu: true,
  compositing: "enabled",
  gpuCompositing: true,
  ...over,
});

describe("rich/lean persistence", () => {
  it("defaults to lean and sets no attribute", () => {
    install(fakeEnv());
    assert.equal(getStoredFx(), "lean");
  });

  it("setFx('rich') sets data-fx and persists; lean removes it", () => {
    const env = fakeEnv();
    install(env);
    setFx("rich");
    assert.equal(env.attrs.get("data-fx"), "rich");
    assert.equal(env.store.get(FX_STORAGE_KEY), "rich");
    assert.equal(getStoredFx(), "rich");
    setFx("lean");
    assert.equal(env.attrs.has("data-fx"), false);
    assert.equal(getStoredFx(), "lean");
  });

  it("does not touch the theme or brand attributes", () => {
    const env = fakeEnv();
    install(env);
    setFx("rich");
    assert.equal(env.attrs.has("data-theme"), false);
    assert.equal(env.attrs.has("data-brand"), false);
  });

  it("survives a throwing localStorage", () => {
    const env = fakeEnv({ throwing: true });
    install(env);
    assert.equal(getStoredFx(), "lean");
    setFx("rich");
    assert.equal(env.attrs.get("data-fx"), "rich");
  });

  it("in the desktop app the shell's mode wins over localStorage", () => {
    install(
      fakeEnv({ stored: { [FX_STORAGE_KEY]: "rich" }, shell: { displayMode: "lean" } }),
    );
    assert.equal(getStoredFx(), "lean");
    install(fakeEnv({ stored: {}, shell: { displayMode: "rich" } }));
    assert.equal(getStoredFx(), "rich");
  });

  it("exposes the display bridge only when the shell provides it", () => {
    install(fakeEnv());
    assert.equal(getDisplayBridge(), undefined);
    const display = { getState() {} };
    install(fakeEnv({ shell: { displayMode: "lean", display } }));
    assert.equal(getDisplayBridge(), display);
  });
});

describe("init script", () => {
  function run(env) {
    install(env);
    new Function(getFxInitScript())();
    return env.attrs.get("data-fx");
  }

  it("sets data-fx=rich from localStorage in a browser", () => {
    assert.equal(run(fakeEnv({ stored: { [FX_STORAGE_KEY]: "rich" } })), "rich");
  });

  it("sets nothing when lean, empty, or storage throws", () => {
    assert.equal(run(fakeEnv({ stored: { [FX_STORAGE_KEY]: "lean" } })), undefined);
    assert.equal(run(fakeEnv()), undefined);
    assert.equal(run(fakeEnv({ throwing: true })), undefined);
  });

  it("prefers the desktop shell's mode (a stale localStorage mirror is ignored)", () => {
    assert.equal(
      run(
        fakeEnv({ stored: { [FX_STORAGE_KEY]: "rich" }, shell: { displayMode: "lean" } }),
      ),
      undefined,
    );
    assert.equal(run(fakeEnv({ shell: { displayMode: "rich" } })), "rich");
  });
});

describe("describeHardwareAcceleration", () => {
  it("browser: no GPU wording, never a restart or warning", () => {
    const view = describeHardwareAcceleration({
      fx: "rich",
      desktop: false,
      state: null,
    });
    assert.equal(view.checked, true);
    assert.equal(view.restartNeeded, false);
    assert.equal(view.warning, null);
    assert.match(view.hint, /browser/i);
  });

  it("desktop, nothing pending: normal hint, no warning with a real GPU", () => {
    const view = describeHardwareAcceleration({
      fx: "rich",
      desktop: true,
      state: desktopState(),
    });
    assert.equal(view.hint, HARDWARE_ACCELERATION_HINT);
    assert.equal(view.warning, null);
    assert.equal(view.restartNeeded, false);
  });

  it("asks for a restart when the saved GPU choice differs from this launch", () => {
    const turnedOn = describeHardwareAcceleration({
      fx: "rich",
      desktop: true,
      state: desktopState({
        saved: true,
        launchedWithGpu: false,
        compositing: "disabled_software",
        gpuCompositing: false,
      }),
    });
    assert.equal(turnedOn.restartNeeded, true);
    assert.match(turnedOn.hint, /restart/i);
    assert.equal(turnedOn.warning, null); // unknown until it actually runs with the GPU
    const turnedOff = describeHardwareAcceleration({
      fx: "lean",
      desktop: true,
      state: desktopState({ saved: false, launchedWithGpu: true }),
    });
    assert.equal(turnedOff.restartNeeded, true);
    assert.equal(turnedOff.checked, false);
  });

  it("warns when ON and the GPU was allowed but Chromium is still on software", () => {
    const view = describeHardwareAcceleration({
      fx: "rich",
      desktop: true,
      state: desktopState({ compositing: "disabled_software", gpuCompositing: false }),
    });
    assert.equal(view.warning, GPU_UNAVAILABLE_WARNING);
    assert.equal(view.restartNeeded, false);
  });

  it("never warns when OFF, and shows a save error instead of the GPU warning", () => {
    const off = describeHardwareAcceleration({
      fx: "lean",
      desktop: true,
      state: desktopState({
        saved: false,
        launchedWithGpu: false,
        gpuCompositing: false,
      }),
    });
    assert.equal(off.warning, null);
    const failed = describeHardwareAcceleration({
      fx: "lean",
      desktop: true,
      state: desktopState({ saved: false, launchedWithGpu: false }),
      error: "Could not save the setting.",
    });
    assert.equal(failed.warning, "Could not save the setting.");
  });
});
