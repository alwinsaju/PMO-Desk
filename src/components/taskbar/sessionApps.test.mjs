// Run with `pnpm test`. Which apps are remembered as "open", and which of them reopen at launch.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  appsToRestore,
  MAX_SESSION_APPS,
  sameIds,
  sessionAppIds,
} from "./sessionApps.ts";

const restorable = new Set(["notes", "files", "tasks", "raid", "dashboard"]);
const wins = (...list) => Object.fromEntries(list.map((w, i) => [`w${i}`, w]));

describe("sessionAppIds", () => {
  it("lists each app once, bottom to top", () => {
    const out = sessionAppIds(
      wins(
        { appId: "tasks", zIndex: 105 },
        { appId: "notes", zIndex: 101 },
        { appId: "files", zIndex: 103 },
      ),
      restorable,
    );
    assert.deepEqual(out, ["notes", "files", "tasks"]);
  });

  it("counts an app with several windows once, at its highest window", () => {
    const out = sessionAppIds(
      wins(
        { appId: "notes", zIndex: 100 },
        { appId: "files", zIndex: 101 },
        { appId: "notes", zIndex: 102 },
      ),
      restorable,
    );
    assert.deepEqual(out, ["files", "notes"]);
  });

  it("leaves out web apps and anything launch cannot open", () => {
    const out = sessionAppIds(
      wins(
        { appId: "web-app", zIndex: 100 },
        { appId: "settings", zIndex: 101 },
        { appId: "raid", zIndex: 102 },
      ),
      restorable,
    );
    assert.deepEqual(out, ["raid"]);
  });

  it("is empty for an empty desktop and never longer than the limit", () => {
    assert.deepEqual(sessionAppIds({}, restorable), []);
    const many = new Set(Array.from({ length: 30 }, (_, i) => `app${i}`));
    const list = [...many].map((appId, i) => ({ appId, zIndex: 100 + i }));
    const out = sessionAppIds(wins(...list), many);
    assert.equal(out.length, MAX_SESSION_APPS);
    assert.equal(out.at(-1), "app29");
  });
});

describe("appsToRestore", () => {
  it("keeps the saved order", () => {
    assert.deepEqual(appsToRestore(["files", "notes", "tasks"], restorable, new Set()), [
      "files",
      "notes",
      "tasks",
    ]);
  });

  it("skips an app that no longer exists, a repeat, and junk", () => {
    assert.deepEqual(
      appsToRestore(["gone", "notes", "notes", 7, null, "files"], restorable, new Set()),
      ["notes", "files"],
    );
  });

  it("skips an app that already has a window", () => {
    assert.deepEqual(appsToRestore(["notes", "files"], restorable, new Set(["notes"])), [
      "files",
    ]);
  });

  it("restores nothing from an empty or missing list", () => {
    assert.deepEqual(appsToRestore([], restorable, new Set()), []);
  });

  it("opens at most the limit", () => {
    const many = new Set(Array.from({ length: 30 }, (_, i) => `app${i}`));
    assert.equal(appsToRestore([...many], many, new Set()).length, MAX_SESSION_APPS);
  });
});

describe("sameIds", () => {
  it("compares order as well as members", () => {
    assert.equal(sameIds(["a", "b"], ["a", "b"]), true);
    assert.equal(sameIds(["a", "b"], ["b", "a"]), false);
    assert.equal(sameIds(["a"], ["a", "b"]), false);
    assert.equal(sameIds([], []), true);
  });
});
