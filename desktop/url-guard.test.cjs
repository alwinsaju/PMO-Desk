// Run with `pnpm test`. Origin comparison, navigation classes and permissions.
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const guard = require("./url-guard.cjs");

const APP = "http://127.0.0.1:3100";

describe("isAppUrl", () => {
  it("accepts the app origin with any path, query or hash", () => {
    for (const url of [
      APP,
      `${APP}/`,
      `${APP}/tasks?x=1#y`,
      "http://127.0.0.1:3100/api/tasks-engine/token",
    ]) {
      assert.equal(guard.isAppUrl(url, APP), true, url);
    }
  });

  it("rejects the ':31001' suffix attack and other ports", () => {
    for (const url of [
      "http://127.0.0.1:31001",
      "http://127.0.0.1:31001/x",
      "http://127.0.0.1:3101/",
      "http://127.0.0.1/",
      "http://127.0.0.1:3100.evil.test/",
    ]) {
      assert.equal(guard.isAppUrl(url, APP), false, url);
    }
  });

  it("rejects the userinfo '@' trick and look-alike hosts", () => {
    for (const url of [
      "http://127.0.0.1:3100@evil.test/",
      "http://127.0.0.1:3100:pw@evil.test:3100/",
      "http://evil.test/?http://127.0.0.1:3100",
      "http://localhost:3100/",
      "http://127.0.0.1.evil.test:3100/",
    ]) {
      assert.equal(guard.isAppUrl(url, APP), false, url);
    }
  });

  it("rejects other schemes", () => {
    for (const url of [
      "https://127.0.0.1:3100/",
      "file:///C:/Windows/System32/calc.exe",
      "javascript:alert(1)",
      "data:text/html,hi",
      "about:blank",
      "mailto:a@b.c",
      "ms-msdt:/id",
    ]) {
      assert.equal(guard.isAppUrl(url, APP), false, url);
    }
  });

  it("rejects garbage input and a garbage app url without throwing", () => {
    for (const url of ["", "not a url", "//127.0.0.1:3100", undefined, null, 42, {}]) {
      assert.equal(guard.isAppUrl(url, APP), false, String(url));
    }
    for (const app of [undefined, "", "garbage", "about:blank", "data:,x"]) {
      assert.equal(guard.isAppUrl(APP, app), false, String(app));
      assert.equal(guard.isAppUrl("about:blank", app), false, String(app));
    }
  });

  it("is case-insensitive on scheme and host", () => {
    assert.equal(guard.isAppUrl("HTTP://127.0.0.1:3100/x", APP), true);
  });

  it("follows the app url when the port changes", () => {
    assert.equal(guard.isAppUrl("http://127.0.0.1:3101/", "http://127.0.0.1:3101"), true);
    assert.equal(
      guard.isAppUrl("http://127.0.0.1:3100/", "http://127.0.0.1:3101"),
      false,
    );
  });
});

describe("classifyNavigation", () => {
  it("allows the app, hands web and mail links to the OS, denies the rest", () => {
    assert.equal(guard.classifyNavigation(`${APP}/x`, APP), "allow");
    assert.equal(guard.classifyNavigation("https://example.com/a", APP), "external");
    assert.equal(guard.classifyNavigation("http://example.com/a", APP), "external");
    assert.equal(guard.classifyNavigation("mailto:a@b.c?subject=x", APP), "external");
    assert.equal(guard.classifyNavigation("http://127.0.0.1:31001/", APP), "external");
    assert.equal(guard.classifyNavigation("file:///C:/x.exe", APP), "deny");
    assert.equal(guard.classifyNavigation("javascript:alert(1)", APP), "deny");
    assert.equal(guard.classifyNavigation("ms-msdt:/id", APP), "deny");
    assert.equal(guard.classifyNavigation("smb://host/share", APP), "deny");
    assert.equal(guard.classifyNavigation("garbage", APP), "deny");
    assert.equal(guard.classifyNavigation(undefined, APP), "deny");
  });
});

describe("isPermissionAllowed", () => {
  it("grants only notifications and clipboard writes, only to the app origin", () => {
    assert.equal(guard.isPermissionAllowed("notifications", `${APP}/`, APP), true);
    assert.equal(guard.isPermissionAllowed("clipboard-sanitized-write", APP, APP), true);
    // A bare origin string (the check handler's requestingOrigin) works too.
    assert.equal(guard.isPermissionAllowed("notifications", APP, APP), true);
  });

  it("denies everything else", () => {
    for (const permission of [
      "media",
      "geolocation",
      "clipboard-read",
      "openExternal",
      "fullscreen",
      "midi",
      "unknown",
      "",
      undefined,
    ]) {
      assert.equal(guard.isPermissionAllowed(permission, APP, APP), false, permission);
    }
    assert.equal(
      guard.isPermissionAllowed("notifications", "https://example.com/", APP),
      false,
    );
    assert.equal(
      guard.isPermissionAllowed("notifications", "http://127.0.0.1:31001/", APP),
      false,
    );
    assert.equal(guard.isPermissionAllowed("notifications", "", APP), false);
  });
});
