// Run with `pnpm test`. The quick-add toast, including the note when a holiday moved the date.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseQuickAdd } from "../../../lib/pmo/quickAdd.ts";
import { SKIPPED_HOLIDAY_NOTE, quickAddToast } from "./quickAddView.ts";

const TODAY = "2026-11-05"; // Thursday
const WORK_DAYS = [1, 2, 3, 4, 5];

describe("quickAddToast", () => {
  it("names the day and nothing else when the date did not move", () => {
    const parsed = parseQuickAdd("Send deck to Priya Mon", TODAY, {
      holidays: new Set(),
      workDays: WORK_DAYS,
    });
    assert.equal(
      quickAddToast(parsed, TODAY),
      'Added "Send deck to Priya", due Mon 9 Nov.',
    );
  });

  it("says a holiday moved the date, like the live line and the command bar", () => {
    const parsed = parseQuickAdd("Send deck to Priya Fri", TODAY, {
      holidays: new Set(["2026-11-06"]),
      workDays: WORK_DAYS,
    });
    assert.equal(parsed.movedFrom, "2026-11-06");
    assert.equal(
      quickAddToast(parsed, TODAY),
      'Added "Send deck to Priya", due Mon 9 Nov (skipped a holiday).',
    );
    assert.equal(SKIPPED_HOLIDAY_NOTE, "(skipped a holiday)");
  });

  it("has no date part when no day was written", () => {
    assert.equal(
      quickAddToast({ title: "Tidy the desk", dueAt: null }, TODAY),
      'Added "Tidy the desk".',
    );
  });
});
