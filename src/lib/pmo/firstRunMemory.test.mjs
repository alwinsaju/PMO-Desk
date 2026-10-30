// Run with `pnpm test`. The first-run wizard's memory of progress and identity.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { initialFirstRunForm } from "./firstRun.ts";
import {
  clearProgress,
  loadProgress,
  PROGRESS_MAX_AGE_MS,
  saveProfile,
  saveProgress,
  skippedStepForm,
  withRememberedProfile,
} from "./firstRunMemory.ts";

const fakeStorage = () => {
  const map = new Map();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
};

const base = initialFirstRunForm({ suggestedName: "", detectedTimeZone: "Asia/Kolkata" });
const filled = {
  ...base,
  fullName: "Pat Example",
  otherNames: "Pat",
  email: "pat@example.com",
  allowedDomains: "example.com",
  inboxDir: "C:\\Inbox",
};

describe("wizard progress", () => {
  it("is put back where it was left", () => {
    const storage = fakeStorage();
    saveProgress(storage, { step: 2, form: filled }, 1_000);
    assert.deepEqual(loadProgress(storage, base, 2_000), { step: 2, form: filled });
  });

  it("is not 'progress' until something was answered or a step was passed", () => {
    const storage = fakeStorage();
    saveProgress(storage, { step: 0, form: base }, 1_000);
    assert.equal(loadProgress(storage, base, 2_000), null);
    saveProgress(storage, { step: 0, form: { ...base, fullName: "Pat" } }, 1_000);
    assert.equal(loadProgress(storage, base, 2_000).form.fullName, "Pat");
    saveProgress(storage, { step: 1, form: base }, 1_000);
    assert.equal(loadProgress(storage, base, 2_000).step, 1);
  });

  it("is not offered when old, cleared, out of range or damaged", () => {
    const storage = fakeStorage();
    saveProgress(storage, { step: 1, form: filled }, 1_000);
    assert.equal(loadProgress(storage, base, 1_000 + PROGRESS_MAX_AGE_MS + 1), null);
    clearProgress(storage);
    assert.equal(loadProgress(storage, base, 2_000), null);
    saveProgress(storage, { step: 9, form: filled }, 1_000);
    assert.equal(loadProgress(storage, base, 2_000), null);
    storage.setItem("ai-os:pmo-wizard-progress", "{oops");
    assert.equal(loadProgress(storage, base, 2_000), null);
    storage.setItem(
      "ai-os:pmo-wizard-progress",
      JSON.stringify({ step: 1, savedAt: 1_000, form: { fullName: 5 } }),
    );
    assert.equal(loadProgress(storage, base, 2_000), null);
    assert.equal(loadProgress(null, base, 2_000), null);
  });

  it("never fails because storage does", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    assert.doesNotThrow(() => saveProgress(broken, { step: 0, form: base }, 1));
    assert.equal(loadProgress(broken, base, 1), null);
    assert.doesNotThrow(() => clearProgress(broken));
    assert.equal(withRememberedProfile(broken, base), base);
  });
});

describe("remembered identity", () => {
  it("fills blank answers on a fresh data folder, but never the folder or what is typed", () => {
    const storage = fakeStorage();
    saveProfile(storage, filled);
    const fresh = withRememberedProfile(storage, { ...base, fullName: "Typed Name" });
    assert.equal(fresh.fullName, "Typed Name");
    assert.equal(fresh.email, "pat@example.com");
    assert.equal(fresh.allowedDomains, "example.com");
    assert.equal(fresh.inboxDir, "");
  });

  it("changes nothing when nothing was remembered", () => {
    assert.equal(withRememberedProfile(fakeStorage(), base), base);
  });
});

describe("skippedStepForm", () => {
  it("takes the suggested domain from the email", () => {
    const form = { ...base, email: "pat@example.com" };
    assert.equal(skippedStepForm("domains", form, "")?.allowedDomains, "example.com");
  });

  it("takes the detected time zone when none was chosen", () => {
    assert.equal(
      skippedStepForm("timeZone", { ...base, timeZone: "" }, "Europe/London")?.timeZone,
      "Europe/London",
    );
    assert.equal(
      skippedStepForm("timeZone", base, "Europe/London")?.timeZone,
      "Asia/Kolkata",
    );
  });

  it("cannot skip who you are or the inbox folder", () => {
    assert.equal(skippedStepForm("who", base, ""), null);
    assert.equal(skippedStepForm("inbox", base, ""), null);
  });
});
