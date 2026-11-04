// Run with `pnpm test`. resolveDueWhen: a phrase as a DUE date, moved off the person's holidays.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveDueWhen, resolveWhen } from "./whenPhrase.ts";

const TODAY = "2026-10-30"; // Friday
const holidays = new Set(["2026-10-30", "2026-11-02"]);

describe("resolveDueWhen", () => {
  it("is exactly resolveWhen when there are no holidays", () => {
    for (const phrase of [
      "Fri",
      "tomorrow",
      "next week",
      "5 Nov",
      "blue moon",
      "weekend",
    ]) {
      assert.deepEqual(resolveDueWhen(phrase, TODAY), resolveWhen(phrase, TODAY));
      assert.deepEqual(resolveDueWhen(phrase, TODAY, {}), resolveWhen(phrase, TODAY));
      assert.deepEqual(
        resolveDueWhen(phrase, TODAY, { holidays: new Set() }),
        resolveWhen(phrase, TODAY),
      );
    }
  });

  it("moves a single day on a holiday to the next working day, with the label of the new day", () => {
    const range = resolveDueWhen("Fri", TODAY, { holidays });
    assert.equal(range.from, "2026-11-03");
    assert.equal(range.to, "2026-11-03");
    assert.equal(range.movedFrom, "2026-10-30");
    assert.match(range.label, /Tue/);
  });

  it("does not touch a period, a non-holiday day or an unknown phrase", () => {
    assert.deepEqual(
      resolveDueWhen("next week", TODAY, { holidays }),
      resolveWhen("next week", TODAY),
    );
    assert.deepEqual(
      resolveDueWhen("Thursday", TODAY, { holidays }),
      resolveWhen("Thursday", TODAY),
    );
    assert.equal(resolveDueWhen("blue moon", TODAY, { holidays }), null);
  });

  it("leaves 'who's off' questions alone: resolveWhen still gives the day itself", () => {
    assert.equal(resolveWhen("Fri", TODAY).from, "2026-10-30");
  });
});
