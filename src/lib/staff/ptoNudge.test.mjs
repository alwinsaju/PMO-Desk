// Run with `pnpm test`. The AI widget's PTO heads-up: which pending requests it lists,
// what it says, what counts as new, and how often the background reader looks.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPtoAlert } from "./ptoAlert.ts";
import { describePtoAlert, keepReadingDismissed, unseenIds } from "./ptoNudge.ts";
import {
  DEFAULT_PTO_SCAN_MS,
  MIN_PTO_SCAN_MS,
  ptoScanInterval,
} from "./ptoScanInterval.ts";

const person = (id, firstName, lastName) => ({
  id,
  firstName,
  lastName,
  deloitteEmail: `${firstName.toLowerCase()}@deloitte.com`,
});
const request = (id, employeeId, patch = {}) => ({
  id,
  employeeId,
  type: "pto",
  startDate: "2026-11-12",
  endDate: "2026-11-13",
  reason: "",
  status: "pending",
  createdAt: `2026-10-29T10:0${id.length}:00Z`,
  decidedAt: "",
  source: "email",
  ...patch,
});
const range = (a, b) => `${a}..${b}`;
const employees = [person("e1", "Alwin", "Saju"), person("e2", "Selva", "Karunakaran")];

describe("buildPtoAlert", () => {
  it("lists only pending requests that came from an email, with names", () => {
    const alert = buildPtoAlert({
      timeOff: [
        request("a", "e1"),
        request("bb", "e2", { status: "approved" }),
        request("ccc", "e2", { source: undefined }),
        request("dddd", "e2", { type: "comp-off" }),
        request("eeeee", "ghost"),
      ],
      employees,
      reading: true,
      waiting: 2,
    });
    assert.deepEqual(
      alert.pending.map((p) => [p.id, p.name, p.type]),
      [
        ["a", "Alwin Saju", "pto"],
        ["dddd", "Selva Karunakaran", "comp-off"],
        ["eeeee", "Someone", "pto"],
      ],
    );
    assert.equal(alert.reading, true);
    assert.equal(alert.waiting, 2);
  });

  it("caps the list", () => {
    const many = Array.from({ length: 30 }, (_, i) => request(`r${i}`, "e1"));
    assert.equal(
      buildPtoAlert({ timeOff: many, employees, reading: false, waiting: 0 }).pending
        .length,
      20,
    );
  });
});

describe("unseenIds and describePtoAlert", () => {
  const alert = buildPtoAlert({
    timeOff: [request("a", "e1"), request("bb", "e2", { type: "sick" })],
    employees,
    reading: false,
    waiting: 0,
  });

  it("only counts requests the person has not been told about", () => {
    assert.deepEqual(unseenIds(alert, []), ["a", "bb"]);
    assert.deepEqual(unseenIds(alert, ["a"]), ["bb"]);
    assert.deepEqual(unseenIds(alert, ["a", "bb", "old"]), []);
  });

  it("says who needs approval, in the singular and the plural", () => {
    const two = describePtoAlert(alert, ["a", "bb"], range);
    assert.equal(two.kind, "approve");
    assert.match(two.title, /2 leave emails/);
    assert.deepEqual(two.lines, [
      "Alwin Saju: PTO, 2026-11-12..2026-11-13",
      "Selva Karunakaran: Sick leave, 2026-11-12..2026-11-13",
    ]);
    const one = describePtoAlert(alert, ["bb"], range);
    assert.match(one.title, /a leave email/);
    assert.equal(one.lines.length, 1);
  });

  it("lists at most three and counts the rest", () => {
    const many = buildPtoAlert({
      timeOff: Array.from({ length: 5 }, (_, i) => request(`r${i}`, "e1")),
      employees,
      reading: false,
      waiting: 0,
    });
    const copy = describePtoAlert(many, unseenIds(many, []), range);
    assert.equal(copy.lines.length, 4);
    assert.equal(copy.lines[3], "and 2 more");
  });

  it("says it is reading when nothing new waits, and nothing when idle", () => {
    const reading = { ...alert, reading: true, waiting: 3 };
    const copy = describePtoAlert(reading, [], range);
    assert.equal(copy.kind, "reading");
    assert.deepEqual(copy.lines, ["2 more waiting"]);
    assert.equal(describePtoAlert(alert, [], range), null);
    assert.equal(describePtoAlert(reading, ["a"], range).kind, "approve");
  });

  it("lets the reading card be dismissed, but never the approval card", () => {
    const reading = { ...alert, reading: true, waiting: 3 };
    assert.equal(describePtoAlert(reading, [], range, true), null);
    assert.equal(describePtoAlert(reading, ["a"], range, true).kind, "approve");
    assert.equal(describePtoAlert(reading, [], range, false).kind, "reading");
  });

  it("keeps a dismissal only until the reader goes idle", () => {
    assert.equal(keepReadingDismissed(true, { ...alert, reading: true }), true);
    assert.equal(keepReadingDismissed(true, { ...alert, reading: false }), false);
    assert.equal(keepReadingDismissed(false, { ...alert, reading: true }), false);
  });
});

describe("ptoScanInterval", () => {
  it("defaults, bounds and can be turned off", () => {
    assert.equal(ptoScanInterval({}), DEFAULT_PTO_SCAN_MS);
    assert.equal(ptoScanInterval({ AI_OS_PTO_SCAN_MS: "30000" }), 30_000);
    assert.equal(ptoScanInterval({ AI_OS_PTO_SCAN_MS: "10" }), MIN_PTO_SCAN_MS);
    assert.equal(ptoScanInterval({ AI_OS_PTO_SCAN_MS: "junk" }), DEFAULT_PTO_SCAN_MS);
    assert.equal(ptoScanInterval({ AI_OS_PTO_SCAN_MS: "0" }), null);
    assert.equal(ptoScanInterval({ AI_OS_PTO_SCAN_MS: "off" }), null);
  });
});
