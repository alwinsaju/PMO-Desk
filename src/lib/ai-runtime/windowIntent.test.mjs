import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  appIdFromName,
  planOpenApp,
  resolveOpenIntent,
  resolveWindowTarget,
} from "./windowIntent.ts";

describe("resolveOpenIntent", () => {
  it("resolves the starter chips", () => {
    assert.equal(resolveOpenIntent("Open Notes"), "notes");
    assert.equal(resolveOpenIntent("Open Files"), "files");
    assert.equal(resolveOpenIntent("Open Tasks"), "tasks");
  });
  it("accepts natural phrasing", () => {
    assert.equal(resolveOpenIntent("  please launch the files app. "), "files");
    assert.equal(resolveOpenIntent("show my browser"), "browser");
    assert.equal(resolveOpenIntent("open app store"), "app-store");
  });
  it("leaves compound or unknown requests to the model", () => {
    assert.equal(resolveOpenIntent("open notes and write a poem"), null);
    assert.equal(resolveOpenIntent("open the pod bay doors"), null);
    assert.equal(resolveOpenIntent("what is a note"), null);
    assert.equal(resolveOpenIntent(""), null);
  });
});

describe("planOpenApp", () => {
  const windows = [
    { id: "a", appId: "notes", zIndex: 5 },
    { id: "b", appId: "notes", zIndex: 9 },
    { id: "c", appId: "files", zIndex: 7 },
  ];
  it("focuses the topmost existing window", () => {
    assert.deepEqual(planOpenApp("notes", windows), { type: "focus", windowId: "b" });
  });
  it("opens when the app is not running", () => {
    assert.deepEqual(planOpenApp("tasks", windows), { type: "open" });
    assert.deepEqual(planOpenApp("notes", []), { type: "open" });
  });
});

describe("resolveWindowTarget", () => {
  const windows = [{ id: "w1", appId: "files", title: "Files", zIndex: 1 }];
  it("accepts an exact window id", () => {
    assert.deepEqual(resolveWindowTarget("w1", windows), { kind: "window", id: "w1" });
  });
  it("maps an app name to its open window", () => {
    assert.deepEqual(resolveWindowTarget("files", windows), { kind: "window", id: "w1" });
    assert.deepEqual(resolveWindowTarget("Files", windows), { kind: "window", id: "w1" });
  });
  it("asks to open an app name that is not running", () => {
    assert.deepEqual(resolveWindowTarget("notes", windows), {
      kind: "open-app",
      appId: "notes",
    });
    assert.deepEqual(resolveWindowTarget("Notes", []), {
      kind: "open-app",
      appId: "notes",
    });
  });
  it("rejects unknown references", () => {
    assert.equal(resolveWindowTarget("nonsense-id", windows), null);
  });
});

describe("appIdFromName", () => {
  it("normalises case and whitespace", () => {
    assert.equal(appIdFromName("  App   Store "), "app-store");
    assert.equal(appIdFromName("calculator"), null);
  });
});
