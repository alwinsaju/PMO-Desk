// Run with `pnpm test`. Theme/brand persistence against a FAKE document and
// localStorage: nothing here touches a real browser.
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  BRAND_STORAGE_KEY,
  THEME_STORAGE_KEY,
  getStoredBrand,
  getStoredTheme,
  getThemeInitScript,
  setBrand,
  setTheme,
} from "./theme.ts";

function fakeEnv({ stored = {}, throwing = false } = {}) {
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
  return { attrs, store, documentElement, localStorage };
}

function install(env) {
  globalThis.document = { documentElement: env.documentElement };
  globalThis.window = { localStorage: env.localStorage };
}

afterEach(() => {
  delete globalThis.document;
  delete globalThis.window;
});

describe("theme + brand persistence", () => {
  it("defaults to light / default when nothing is stored", () => {
    install(fakeEnv());
    assert.equal(getStoredTheme(), "light");
    assert.equal(getStoredBrand(), "default");
  });

  it("setBrand toggles ONLY the brand attribute and persists", () => {
    const env = fakeEnv();
    install(env);
    setBrand("deloitte");
    assert.equal(env.attrs.get("data-brand"), "deloitte");
    assert.equal(env.attrs.has("data-theme"), false);
    assert.equal(env.store.get(BRAND_STORAGE_KEY), "deloitte");
    assert.equal(getStoredBrand(), "deloitte");
    setBrand("default");
    assert.equal(env.attrs.has("data-brand"), false);
    assert.equal(getStoredBrand(), "default");
  });

  it("the two attributes are independent", () => {
    const env = fakeEnv();
    install(env);
    setTheme("dark");
    setBrand("deloitte");
    assert.equal(env.attrs.get("data-theme"), "dark");
    assert.equal(env.attrs.get("data-brand"), "deloitte");
    setTheme("light");
    assert.equal(env.attrs.has("data-theme"), false);
    assert.equal(env.attrs.get("data-brand"), "deloitte");
  });

  it("survives unavailable storage", () => {
    const env = fakeEnv({ throwing: true });
    install(env);
    assert.equal(getStoredBrand(), "default");
    setBrand("deloitte"); // must not throw
    assert.equal(env.attrs.get("data-brand"), "deloitte");
  });
});

describe("getThemeInitScript", () => {
  function run(stored, throwing = false) {
    const env = fakeEnv({ stored, throwing });
    new Function("window", "document", getThemeInitScript())(
      { localStorage: env.localStorage },
      { documentElement: env.documentElement },
    );
    return env.attrs;
  }

  it("applies both stored choices before hydration", () => {
    const attrs = run({ [THEME_STORAGE_KEY]: "dark", [BRAND_STORAGE_KEY]: "deloitte" });
    assert.equal(attrs.get("data-theme"), "dark");
    assert.equal(attrs.get("data-brand"), "deloitte");
  });

  it("applies each independently and ignores unknown values", () => {
    const onlyBrand = run({ [BRAND_STORAGE_KEY]: "deloitte" });
    assert.equal(onlyBrand.has("data-theme"), false);
    assert.equal(onlyBrand.get("data-brand"), "deloitte");
    const junk = run({ [THEME_STORAGE_KEY]: "purple", [BRAND_STORAGE_KEY]: "x" });
    assert.equal(junk.size, 0);
  });

  it("never throws when storage is blocked", () => {
    assert.equal(run({}, true).size, 0);
  });
});
