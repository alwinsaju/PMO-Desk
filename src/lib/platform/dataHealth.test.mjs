// Run with `pnpm test`. The Data tab's storage meter and backup freshness.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { STORAGE_GUIDE_BYTES, backupStatus, storageMeter } from "./dataHealth.ts";

describe("storageMeter", () => {
  it("fills toward the guide with a tone that gets stricter", () => {
    assert.deepEqual(storageMeter(0), {
      percent: 0,
      tone: "success",
      note: "Plenty of room.",
    });
    assert.equal(storageMeter(STORAGE_GUIDE_BYTES * 0.49).tone, "success");
    assert.equal(storageMeter(STORAGE_GUIDE_BYTES * 0.5).tone, "warning");
    assert.equal(storageMeter(STORAGE_GUIDE_BYTES * 0.9).tone, "danger");
  });

  it("caps at 100 and ignores junk sizes", () => {
    assert.equal(storageMeter(STORAGE_GUIDE_BYTES * 5).percent, 100);
    assert.equal(storageMeter(Number.NaN).percent, 0);
    assert.equal(storageMeter(-4).percent, 0);
  });
});

describe("backupStatus", () => {
  const now = new Date("2026-10-30T10:00:00Z");

  it("warns when there has never been a backup", () => {
    assert.equal(backupStatus("", now).when, "Never");
    assert.equal(backupStatus("", now).tone, "warning");
    assert.equal(backupStatus("garbage", now).tone, "warning");
  });

  it("words the age and softens or sharpens the tone", () => {
    assert.deepEqual(
      [
        backupStatus("2026-10-30T08:00:00Z", now),
        backupStatus("2026-10-29T08:00:00Z", now),
        backupStatus("2026-10-20T10:00:00Z", now),
        backupStatus("2026-09-01T10:00:00Z", now),
      ].map((s) => [s.when, s.tone]),
      [
        ["Today", "success"],
        ["Yesterday", "success"],
        ["10 days ago", "neutral"],
        ["59 days ago", "warning"],
      ],
    );
  });
});
