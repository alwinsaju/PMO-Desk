import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  demoOpenToast,
  installLabel,
  installedToast,
  isDemoApp,
  removedToast,
} from "./installFlow.ts";

const real = { id: "gmail", name: "Gmail", url: "https://mail.google.com/" };
const demo = { id: "taskflow", name: "TaskFlow" };

describe("installLabel", () => {
  it("reads Install, Installing… or Open", () => {
    assert.equal(installLabel(false, false), "Install");
    assert.equal(installLabel(true, false), "Installing…");
    assert.equal(installLabel(false, true), "Open");
    assert.equal(installLabel(true, true), "Installing…");
  });
  it("never says Open for a demo app: an installed demo reads Remove", () => {
    assert.equal(installLabel(false, true, true), "Remove");
    assert.equal(installLabel(false, false, true), "Install");
    assert.equal(installLabel(true, true, true), "Installing…");
  });
});

describe("isDemoApp", () => {
  it("is true for fictional entries (no url) only", () => {
    assert.equal(isDemoApp(demo), true);
    assert.equal(isDemoApp(real), false);
  });
});

describe("installedToast", () => {
  it("confirms the install and that it went to the dock", () => {
    const t = installedToast(real, () => {});
    assert.equal(t.title, "Gmail installed");
    assert.match(t.message, /added to the dock/i);
    assert.equal(t.tone, "success");
  });
  it("offers Open for a real app and runs the callback", () => {
    let opened = 0;
    const t = installedToast(real, () => opened++);
    assert.equal(t.action.label, "Open");
    t.action.run();
    assert.equal(opened, 1);
  });
  it("offers no Open for a demo app: there is nothing to open", () => {
    const t = installedToast(demo, () => {});
    assert.equal(t.action, undefined);
    assert.match(t.message, /demo/i);
  });
  it("uses a key so a quick second install replaces the toast", () => {
    assert.equal(installedToast(real, () => {}).key, "app-install:gmail");
  });
});

describe("demoOpenToast", () => {
  it("explains there is nothing to open and offers no action that removes it", () => {
    const t = demoOpenToast(demo);
    assert.match(t.title, /demo app/i);
    assert.match(t.message, /nothing to open/i);
    assert.equal(t.action, undefined);
  });
});

describe("removedToast", () => {
  it("says what was removed and offers Undo", () => {
    let undone = 0;
    const t = removedToast(demo, () => undone++);
    assert.match(t.title, /TaskFlow/);
    t.action.run();
    assert.equal(undone, 1);
    assert.equal(t.action.label, "Undo");
  });
});
