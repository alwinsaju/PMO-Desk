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
  restoreAppearanceFromServer,
  setBrand,
  setTheme,
  withLookTransition,
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

describe("server mirror of the appearance", () => {
  const serverWith = (value) => async (url, init) => {
    serverWith.calls.push({ url, method: init?.method ?? "GET", body: init?.body });
    return { ok: true, json: async () => ({ ok: true, value }) };
  };
  serverWith.calls = [];
  afterEach(() => {
    delete globalThis.fetch;
    serverWith.calls = [];
  });

  it("setTheme / setBrand PUT both choices to the preferences key", () => {
    const env = fakeEnv();
    globalThis.window = { localStorage: env.localStorage, location: {} };
    globalThis.document = { documentElement: env.documentElement };
    globalThis.fetch = serverWith(null);
    setTheme("dark");
    setBrand("deloitte");
    const puts = serverWith.calls.filter((c) => c.method === "PUT");
    assert.deepEqual(
      puts.map((c) => [c.url, JSON.parse(c.body)]),
      [
        ["/api/ui-state/preferences", { value: { theme: "dark", brand: "default" } }],
        ["/api/ui-state/preferences", { value: { theme: "dark", brand: "deloitte" } }],
      ],
    );
  });

  it("a failing server never breaks setTheme", () => {
    const env = fakeEnv();
    globalThis.window = { localStorage: env.localStorage, location: {} };
    globalThis.document = { documentElement: env.documentElement };
    globalThis.fetch = () => Promise.reject(new Error("down"));
    setTheme("dark");
    assert.equal(env.attrs.get("data-theme"), "dark");
  });

  it("restores theme and brand from the server when localStorage has none", async () => {
    const env = fakeEnv();
    install(env);
    await restoreAppearanceFromServer(serverWith({ theme: "dark", brand: "deloitte" }));
    assert.equal(env.attrs.get("data-theme"), "dark");
    assert.equal(env.attrs.get("data-brand"), "deloitte");
    assert.equal(env.store.get(THEME_STORAGE_KEY), "dark");
    assert.equal(serverWith.calls.filter((c) => c.method === "PUT").length, 0);
  });

  it("never overrides a choice localStorage already has", async () => {
    const env = fakeEnv({ stored: { [THEME_STORAGE_KEY]: "light" } });
    install(env);
    await restoreAppearanceFromServer(serverWith({ theme: "dark", brand: "deloitte" }));
    assert.equal(env.attrs.has("data-theme"), false);
    assert.equal(env.store.get(THEME_STORAGE_KEY), "light");
    assert.equal(env.attrs.get("data-brand"), "deloitte");
  });

  it("ignores junk values and an unreachable server", async () => {
    const env = fakeEnv();
    install(env);
    await restoreAppearanceFromServer(serverWith({ theme: "purple", brand: 3 }));
    await restoreAppearanceFromServer(serverWith(null));
    await restoreAppearanceFromServer(() => Promise.reject(new Error("down")));
    await restoreAppearanceFromServer(async () => ({
      ok: false,
      json: async () => ({}),
    }));
    assert.equal(env.attrs.size, 0);
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

describe("look transition", () => {
  it("applies the change at once when the View Transitions API is missing", () => {
    const env = fakeEnv();
    install(env);
    setBrand("deloitte");
    assert.equal(env.attrs.get("data-brand"), "deloitte");
    assert.equal(env.attrs.has("data-look-switching"), false);
  });

  it("runs the change inside one view transition and clears the switching flag after it", async () => {
    const env = fakeEnv();
    install(env);
    let finish;
    let updateRan = false;
    globalThis.document.startViewTransition = (update) => {
      // The browser calls the update after it has captured the old screen.
      queueMicrotask(() => {
        update();
        updateRan = true;
      });
      return { finished: new Promise((resolve) => (finish = resolve)) };
    };
    setBrand("deloitte");
    assert.equal(
      env.attrs.has("data-look-switching"),
      true,
      "transitions are off while it runs",
    );
    assert.equal(
      env.store.get(BRAND_STORAGE_KEY),
      "deloitte",
      "the choice is saved at once",
    );
    await Promise.resolve();
    assert.equal(updateRan, true);
    assert.equal(env.attrs.get("data-brand"), "deloitte");
    finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(env.attrs.has("data-look-switching"), false);
  });

  it("skips the transition when the person asked for less motion", () => {
    const env = fakeEnv();
    install(env);
    globalThis.window.matchMedia = () => ({ matches: true });
    globalThis.document.startViewTransition = () => {
      throw new Error("must not animate");
    };
    withLookTransition(() => env.attrs.set("x", "1"));
    assert.equal(env.attrs.get("x"), "1");
  });

  it("still applies the change if starting the transition throws", () => {
    const env = fakeEnv();
    install(env);
    globalThis.document.startViewTransition = () => {
      throw new Error("not now");
    };
    setTheme("dark");
    assert.equal(env.attrs.get("data-theme"), "dark");
    assert.equal(env.attrs.has("data-look-switching"), false);
  });
});
