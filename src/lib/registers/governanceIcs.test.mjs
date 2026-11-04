import assert from "node:assert/strict";
import test from "node:test";
import { governanceIcs } from "../staff/exportFiles.ts";

const rec = (id, values) => ({ id, values });
const STAMP = "20261105T000000Z";

test("governanceIcs: upcoming planned meetings only, all-day, soonest first", () => {
  const { ics, count } = governanceIcs(
    [
      rec("rg_000000000002", {
        title: "QBR",
        kind: "QBR",
        date: "2026-12-01",
        status: "Planned",
      }),
      rec("rg_000000000001", {
        title: "SteerCo, Q4; review",
        kind: "Steering committee",
        date: "2026-11-05",
        time: "10:00 IST",
        attendees: "Ann, Bo",
        status: "Planned",
      }),
      rec("rg_000000000003", { title: "Past", date: "2026-11-04", status: "Planned" }),
      rec("rg_000000000004", { title: "Held", date: "2026-11-20", status: "Held" }),
      rec("rg_000000000005", {
        title: "Cancelled",
        date: "2026-11-21",
        status: "Cancelled",
      }),
      rec("rg_000000000006", { title: "No date", date: "", status: "Planned" }),
      rec("rg_000000000007", {
        title: "Bad date",
        date: "2026-02-31",
        status: "Planned",
      }),
    ],
    "2026-11-05",
    STAMP,
  );
  assert.equal(count, 2);
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /X-WR-CALNAME:Governance calendar/);
  assert.equal((ics.match(/BEGIN:VEVENT/g) ?? []).length, 2);
  assert.ok(ics.indexOf("SteerCo") < ics.indexOf("SUMMARY:QBR"));
  // All-day: a DATE value, the day after as the end, never a clock time.
  assert.match(ics, /DTSTART;VALUE=DATE:20261105\r\nDTEND;VALUE=DATE:20261106/);
  assert.doesNotMatch(ics, /DTSTART:\d{8}T/);
  // Free text is escaped, and the time stays text in the description.
  assert.match(ics, /SUMMARY:SteerCo\\, Q4\\; review/);
  assert.match(
    ics,
    /DESCRIPTION:Type: Steering committee\\nTime: 10:00 IST\\nAttendees: Ann\\, Bo/,
  );
  assert.match(ics, /UID:gov-rg_000000000001@ai-os/);
  assert.doesNotMatch(ics, /Past|Held|Cancelled|No date|Bad date/);
});

test("governanceIcs: nothing upcoming gives an empty calendar and a zero count", () => {
  const { ics, count } = governanceIcs([], "2026-11-05", STAMP);
  assert.equal(count, 0);
  assert.doesNotMatch(ics, /BEGIN:VEVENT/);
});
