// Run with `pnpm test`. The Tasks logic added in v5.4: explainer, schedule, history, input checks,
// comparison, recipient safety, send-later and the dry-run plan.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { explainFailure, hidePaths, lastLine, retryLabel } from "./failureExplainer.ts";
import {
  defaultSchedule,
  latestOccurrence,
  nextOccurrence,
  occursOn,
  pendingOccurrence,
  sanitizeSchedules,
  scheduleMessage,
  staleUploads,
} from "./taskSchedule.ts";
import {
  durationMs,
  filterRuns,
  formatDuration,
  NO_FILTER,
  plainStepName,
  stepPosition,
  summarizeRuns,
  timeLeftText,
} from "./runHistory.ts";
import {
  byPriority,
  checkSheets,
  compareSnapshots,
  comparisonText,
  pushSnapshot,
  ruleFor,
  fileProblems,
  snapshotFrom,
  sparkline,
} from "./inputCheck.ts";
import {
  attachmentWarning,
  checkRecipients,
  internalDomains,
  looksLikeAddress,
  sameRecipients,
} from "./recipientCheck.ts";
import { canDispatch, decide, dequeue, enqueue, nextAt, sanitizeQueue } from "./sendQueue.ts";
import { dryRunPlan } from "./dryRun.ts";
import { dueSchedules, snapshotStates, stateNotices } from "./automation.ts";

describe("explainFailure", () => {
  it("recognises a file open in Excel", () => {
    const e = explainFailure("Traceback...\nPermissionError: [Errno 13] Permission denied: 'x.xlsx'");
    assert.match(e.title, /open in another program/);
    assert.match(e.technical, /Permission denied/);
  });
  it("names a missing column", () => {
    const e = explainFailure("File x\nKeyError: 'Assigned to'");
    assert.match(e.title, /Assigned to/);
  });
  it("recognises Outlook and missing-file failures", () => {
    assert.match(explainFailure("pywintypes.com_error: (-2147221005").title, /Outlook/);
    assert.match(explainFailure("No raw ServiceNow export found in input").title, /not found/);
  });
  it("says a missing sheet is a sheet, not a column", () => {
    const e = explainFailure(
      "Traceback (most recent call last):\n  File \"x.py\"\nKeyError: 'Worksheet Page 1 does not exist.'",
    );
    assert.equal(e.title, "The sheet “Page 1” was not found");
    assert.doesNotMatch(e.title, /column/);
    assert.match(e.steps[0], /named exactly “Page 1”/);
    assert.match(explainFailure("KeyError: 'Assigned to'").title, /column called “Assigned to”/);
  });
  it("explains text dates and unexpected layouts without showing the path in the title or steps", () => {
    const dates = explainFailure("File \"b.py\", line 9\nAttributeError: 'str' object has no attribute 'year'");
    assert.match(dates.title, /date column/);
    const layout = explainFailure(
      "ValueError: Unexpected column layout in C:\\Users\\a\\input\\x.xlsx: ['Number', 'Short description']",
    );
    assert.match(layout.title, /columns are not the ones/);
    assert.doesNotMatch([layout.title, ...layout.steps].join(" "), /C:\\/);
    assert.match(layout.technical, /C:\\Users/);
  });
  it("explains an interrupted run and does not mention uploads for a task without any", () => {
    assert.match(
      explainFailure("The engine restarted while this task was running. Retry resumes after the last completed step.").title,
      /restarted/,
    );
    assert.match(explainFailure("boom", null).steps[0], /uploaded/);
    assert.doesNotMatch(explainFailure("boom", null, { hasUploads: false }).steps[0], /uploaded/);
  });
  it("shows a script's own plain message without folder names, and keeps tracebacks out of it", () => {
    const plain = explainFailure(
      'No raw ServiceNow export found in C:\\Users\\a\\tasks\\input (expected a file like "incident (19).xlsx")',
    );
    assert.doesNotMatch(plain.message ?? "", /C:\\/);
    assert.match(plain.message ?? "", /No raw ServiceNow export found in input/);
    assert.equal(explainFailure("Traceback (most recent call last):\nKeyError: 'x'").message, undefined);
    assert.equal(hidePaths("in C:\\Program Files\\App\\a b\\file.xlsx now"), "in file.xlsx now");
  });
  it("falls back to a generic message that names the step", () => {
    const e = explainFailure("boom", "Build report");
    assert.match(e.title, /Build report/);
    assert.ok(e.steps.length >= 2);
  });
  it("reads the last line and labels retry", () => {
    assert.equal(lastLine("a\n\n b \n"), "b");
    assert.equal(lastLine(null), "");
    assert.equal(retryLabel("Build report"), "Retry from “Build report”");
    assert.equal(retryLabel(null), "Retry");
  });
});

describe("schedule", () => {
  const weekly = { ...defaultSchedule("t"), weekday: 2, time: "09:00" }; // Tuesday
  it("finds the weekday and clamps a month day", () => {
    assert.equal(occursOn(weekly, "2026-10-27"), true); // a Tuesday
    assert.equal(occursOn(weekly, "2026-10-28"), false);
    const monthly = { ...defaultSchedule("t"), cadence: "monthly", dayOfMonth: 31 };
    assert.equal(occursOn(monthly, "2026-02-28"), true);
    assert.equal(occursOn(monthly, "2026-04-30"), true);
    assert.equal(occursOn(monthly, "2026-04-29"), false);
  });
  it("counts today only after its time", () => {
    assert.equal(latestOccurrence(weekly, new Date(2026, 9, 27, 8, 0)), "2026-10-20");
    assert.equal(latestOccurrence(weekly, new Date(2026, 9, 27, 9, 30)), "2026-10-27");
  });
  it("finds the next run: later today, else the next matching day", () => {
    assert.deepEqual(nextOccurrence(weekly, new Date(2026, 9, 27, 8, 0)), {
      day: "2026-10-27",
      time: "09:00",
    });
    assert.deepEqual(nextOccurrence(weekly, new Date(2026, 9, 27, 9, 0)), {
      day: "2026-11-03",
      time: "09:00",
    });
    const monthly = { ...defaultSchedule("t"), cadence: "monthly", dayOfMonth: 31 };
    assert.equal(nextOccurrence(monthly, new Date(2026, 3, 1, 10, 0)).day, "2026-04-30");
    assert.equal(nextOccurrence(weekly, new Date(2026, 9, 27, 10, 0), 3), null);
  });
  it("reports due today, missed earlier and nothing once handled", () => {
    const now = new Date(2026, 9, 27, 10, 0);
    assert.deepEqual(pendingOccurrence(weekly, undefined, now), { kind: "due", day: "2026-10-27" });
    assert.deepEqual(pendingOccurrence(weekly, "2026-10-20", new Date(2026, 9, 29, 10, 0)), {
      kind: "missed",
      day: "2026-10-27",
    });
    assert.deepEqual(pendingOccurrence(weekly, "2026-10-27", now), { kind: "none" });
  });
  it("words the reminders", () => {
    assert.match(scheduleMessage("Aging report", { kind: "due", day: "2026-10-27" }, false, false), /not all of its files/);
    assert.match(scheduleMessage("Aging report", { kind: "due", day: "2026-10-27" }, true, true), /review step/);
  });
  it("drops malformed stored schedules", () => {
    const out = sanitizeSchedules([{ taskId: "a", weekday: 99, time: "25:00" }, null, { taskId: "a" }, {}]);
    assert.equal(out.length, 1);
    assert.equal(out[0].weekday, 1);
    assert.equal(out[0].time, "09:00");
  });
});

describe("history", () => {
  const run = (over) => ({
    run_id: "r",
    task_id: "weekly-aging-report",
    task_name: "Weekly aging report",
    started_at: "2026-10-20T09:00:00Z",
    ended_at: "2026-10-20T09:05:00Z",
    outcome: "completed",
    current_step_at_end: null,
    error: null,
    steps_completed: [],
    approvals: [],
    ...over,
  });
  it("measures and formats durations", () => {
    assert.equal(durationMs(run({})), 300_000);
    assert.equal(formatDuration(45_000), "45s");
    assert.equal(formatDuration(300_000), "5 min");
    assert.equal(formatDuration(5_400_000), "1 h 30 min");
  });
  it("filters by outcome, text and age, newest first", () => {
    const runs = [
      run({ run_id: "a", ended_at: "2026-10-01T10:00:00Z" }),
      run({ run_id: "b", outcome: "failed", error: "KeyError: 'Assigned to'" }),
    ];
    const now = new Date("2026-10-22T00:00:00Z");
    assert.deepEqual(filterRuns(runs, { ...NO_FILTER, outcome: "failed" }, now).map((r) => r.run_id), ["b"]);
    assert.deepEqual(filterRuns(runs, { ...NO_FILTER, text: "assigned" }, now).map((r) => r.run_id), ["b"]);
    assert.deepEqual(filterRuns(runs, { ...NO_FILTER, sinceDays: 7 }, now).map((r) => r.run_id), ["b"]);
    assert.deepEqual(filterRuns(runs, NO_FILTER, now).map((r) => r.run_id), ["b", "a"]);
  });
  it("summarises runs", () => {
    const s = summarizeRuns([run({}), run({ outcome: "failed" }), run({})]);
    assert.equal(s.successPercent, 67);
    assert.equal(s.failed, 1);
    assert.equal(summarizeRuns([]).successPercent, null);
  });
  it("gives step positions, plain names and a cautious time left", () => {
    const task = {
      state: "working",
      currentStep: "create_pivot",
      steps: [{ id: "build_report" }, { id: "create_pivot" }, { id: "weird_step", label: "Do the thing" }],
    };
    assert.equal(stepPosition(task), "Step 2 of 3");
    assert.equal(stepPosition({ ...task, state: "resting" }), null);
    assert.equal(plainStepName(task, "build_report"), "Building the report");
    assert.equal(plainStepName(task, "weird_step"), "Do the thing");
    assert.equal(timeLeftText(task, [run({})]), null);
    const many = [run({}), run({}), run({})];
    assert.match(timeLeftText(task, many), /about \d+ min left|less than a minute/);
  });
});

describe("input check and comparison", () => {
  const now = new Date("2026-10-30T00:00:00Z");
  const sheet = (rows, name = "Page 1") => [
    {
      sheet: name,
      data: [["Number", "Requested for", "Opened", "Assigned to", "Updated", "Priority"], ...rows],
    },
  ];
  const row = (n, opened = "2026-09-01", updated = "2026-10-28", priority = "3 - Moderate") => [
    n, "x", new Date(opened), "Pat", new Date(updated), priority,
  ];
  it("accepts a good export and finds its rule", () => {
    const rule = ruleFor("weekly-backlog-report", "incident");
    assert.ok(rule);
    const c = checkSheets(sheet([row("INC1"), row("INC2")]), rule, now);
    assert.equal(c.ok, true);
    assert.equal(c.rows, 2);
    assert.equal(ruleFor("weekly-backlog-report", "unknown"), null);
  });
  it("requires the Email column in the team roster and the Deployment sheet in the deployment workbook", () => {
    const rule = ruleFor("weekly-aging-report", "roster");
    const good = [{ sheet: "Sheet1", data: [["Full Name", "Email"], ["Ann", "ann@x.com"]] }];
    assert.equal(checkSheets(good, rule, now).ok, true);
    const noEmail = [{ sheet: "Sheet1", data: [["Full Name"], ["Ann"]] }];
    assert.match(checkSheets(noEmail, rule, now).problems[0], /Missing column: Email/);
    assert.equal(checkSheets([{ sheet: "Sheet1", data: [["Full Name", "Email"]] }], rule, now).ok, false);
    const deployment = ruleFor("deployment-dep-weekend-mailer", "workbook");
    assert.match(
      checkSheets([{ sheet: "Sheet1", data: [["x"], ["y"]] }], deployment, now).problems[0],
      /no sheet called “Deployment”/,
    );
    assert.equal(checkSheets([{ sheet: "Deployment", data: [["Title"], ["y"]] }], deployment, now).ok, true);
  });
  it("reports a wrong sheet, missing columns and an empty sheet", () => {
    const rule = ruleFor("weekly-aging-report", "incident");
    assert.match(checkSheets(sheet([row("INC1")], "Sheet1"), rule, now).problems[0], /Page 1/);
    const noCol = [{ sheet: "Page 1", data: [["Number"], ["INC1"]] }];
    assert.match(checkSheets(noCol, rule, now).problems[0], /Assigned to, Updated/);
    assert.match(checkSheets(sheet([]), rule, now).problems.join(" "), /no rows/);
  });
  it("catches the wrong file for the shift roster, the December staff list and the previous monthly workbook", () => {
    const shift = ruleFor("december-disconnect", "roster");
    assert.equal(ruleFor("shift-roster", "roster"), shift);
    const incidentExport = [{ sheet: "Page 1", data: [["Number", "Assigned to"], ["INC1", "Pat"]] }];
    const wrong = checkSheets(incidentExport, shift, now);
    assert.equal(wrong.ok, false);
    assert.match(wrong.problems[0], /no sheet called “PDT Operate” \(this file has “Page 1”\)/);
    assert.equal(checkSheets([{ sheet: "PDT Operate", data: [["x"], ["y"]] }], shift, now).ok, true);

    const staff = ruleFor("december-disconnect", "staff");
    const good = [
      { sheet: "Roster", data: [["Report"], [], ["Full Name", "Team", "Location"], ["Ann", "DS", "UK"]] },
    ];
    assert.equal(checkSheets(good, staff, now).ok, true);
    assert.equal(checkSheets(good, staff, now).rows, 1);
    assert.match(checkSheets(incidentExport, staff, now).problems[0], /Team column and a name column/);
    const noRows = [{ sheet: "Roster", data: [["First Name", "Last Name", "Section"]] }];
    assert.match(checkSheets(noRows, staff, now).problems[0], /no rows below the header/);
    assert.equal(checkSheets([], staff, now).ok, false);

    const history = ruleFor("monthly-report-deck", "history");
    assert.equal(checkSheets(incidentExport, history, now).ok, false);
    assert.equal(
      checkSheets([{ sheet: "Incidents", data: [["Number"], ["INC1"]] }], history, now).ok,
      true,
    );
  });
  it("lists the files that look wrong, with their names", () => {
    const bad = { ok: false, problems: ["There is no sheet called “X”."], warnings: [], rows: 0 };
    const good = { ok: true, problems: [], warnings: [], rows: 3 };
    assert.deepEqual(fileProblems({ roster: bad, staff: good, other: undefined }, { roster: "Shift roster workbook" }), [
      "Shift roster workbook: There is no sheet called “X”.",
    ]);
    assert.deepEqual(fileProblems({}, {}), []);
  });
  it("warns about a stale export and repeated numbers", () => {
    const rule = ruleFor("weekly-aging-report", "incident");
    const c = checkSheets(sheet([row("INC1", "2026-01-01", "2026-09-01"), row("INC1", "2026-01-01", "2026-09-01")]), rule, now);
    assert.equal(c.ok, true);
    assert.equal(c.warnings.length, 2);
  });
  it("compares two snapshots", () => {
    const rule = ruleFor("weekly-aging-report", "incident");
    const prev = snapshotFrom("t", sheet([row("INC1"), row("INC2")]), rule, new Date("2026-10-23T00:00:00Z"));
    const cur = snapshotFrom("t", sheet([row("INC2", "2026-08-01"), row("INC3", "2026-10-29")]), rule, now);
    const c = compareSnapshots(prev, cur);
    assert.deepEqual(c.added.map((r) => r.n), ["INC3"]);
    assert.deepEqual(c.closed.map((r) => r.n), ["INC1"]);
    assert.equal(c.carried, 1);
    assert.equal(c.ageing.length, 1);
    assert.match(comparisonText(c), /1 new, 1 closed, 1 carried over/);
    assert.deepEqual(byPriority(cur.rows), [{ priority: "3 - Moderate", count: 2 }]);
  });
  it("keeps the newest snapshots and draws a trend", () => {
    let list = [];
    for (let i = 0; i < 15; i++) {
      list = pushSnapshot(list, { taskId: "t", at: `2026-10-${10 + i}`, total: i, rows: [{ n: "x", priority: "", opened: "" }] });
    }
    assert.equal(list.length, 12);
    assert.equal(list.at(-1).rows.length, 1);
    assert.equal(list[0].rows.length, 0);
    assert.equal(sparkline([1], 10, 10), null);
    assert.equal(sparkline([0, 10], 10, 10), "0.0,10.0 10.0,0.0");
  });
});

describe("recipient safety", () => {
  const internal = internalDomains(["a@deloitte.com", "Pat <b@deloitte.com>"]);
  it("flags changed and outside recipients", () => {
    const prev = { to: ["a@deloitte.com"], cc: [] };
    const cur = { to: ["a@deloitte.com", "z@gmail.com"], cc: ["b@deloitte.com"] };
    const w = checkRecipients(cur, prev, internal);
    assert.equal(w.filter((x) => x.kind === "changed").length, 2);
    assert.match(w.find((x) => x.kind === "external").text, /z@gmail.com/);
  });
  it("is quiet when nothing changed and everyone is internal", () => {
    const r = { to: ["a@deloitte.com"], cc: [] };
    assert.deepEqual(checkRecipients(r, r, internal), []);
    assert.equal(sameRecipients(r, { to: ["A@Deloitte.com"], cc: [] }), true);
  });
  it("does not guess outside addresses with no staff list", () => {
    assert.deepEqual(checkRecipients({ to: ["z@gmail.com"], cc: [] }, null, new Set()), []);
  });
  it("warns about large attachments", () => {
    assert.equal(attachmentWarning([{ name: "a", bytes: 1000 }]), null);
    assert.match(attachmentWarning([{ name: "a", bytes: 12 * 1048576 }]), /large/);
    assert.match(attachmentWarning([{ name: "a", bytes: 25 * 1048576 }]), /refuse/);
  });
});

describe("send later", () => {
  const item = (over) => ({
    id: "q1",
    taskId: "t",
    taskName: "T",
    at: "2026-10-30T09:00:00.000Z",
    queuedAt: "2026-10-29T09:00:00.000Z",
    subject: "s",
    recipients: { to: ["a@x.com"], cc: [] },
    ...over,
  });
  it("waits, sends within the grace period, then goes overdue", () => {
    assert.equal(decide(item(), new Date("2026-10-30T08:59:00Z")), "wait");
    assert.equal(decide(item(), new Date("2026-10-30T09:05:00Z")), "send");
    assert.equal(decide(item(), new Date("2026-10-30T11:00:00Z")), "overdue");
  });
  it("only sends where the person approved it", () => {
    const same = { to: ["a@x.com"], cc: [] };
    assert.deepEqual(canDispatch(item(), "awaiting_send", same), { ok: true });
    assert.equal(canDispatch(item(), "resting", same).ok, false);
    assert.equal(canDispatch(item(), "awaiting_send", null).ok, false);
    assert.match(canDispatch(item(), "awaiting_send", { to: ["b@x.com"], cc: [] }).reason, /changed/);
  });
  it("keeps one queued send per task and finds the next time", () => {
    let q = enqueue([], item());
    q = enqueue(q, item({ id: "q2" }));
    assert.deepEqual(q.map((x) => x.id), ["q2"]);
    assert.deepEqual(dequeue(q, "q2"), []);
    const now = new Date(2026, 9, 30, 10, 0);
    assert.equal(nextAt(now, 9).getDate(), 31);
    assert.equal(nextAt(now, 14).getDate(), 30);
  });
  it("drops malformed stored items", () => {
    assert.equal(sanitizeQueue([{ id: 1 }, null, item()]).length, 1);
  });
});

describe("dry run", () => {
  const task = {
    inputs: [{ id: "incident", label: "Incident export", type: "file", required: true }],
    steps: [
      { id: "build_report", type: "python" },
      { id: "create_draft", type: "powershell" },
      { id: "review_gate", type: "review" },
      { id: "send_gate", type: "confirm" },
      { id: "send_draft", type: "powershell" },
    ],
  };
  it("lists steps by who acts and says nothing is sent without confirmation", () => {
    const plan = dryRunPlan(task, [{ id: "incident", present: true, filename: "incident (19).xlsx" }]);
    assert.deepEqual(plan.lines.map((l) => l.kind), ["auto", "auto", "you", "you", "outside"]);
    assert.equal(plan.sends, true);
    assert.match(plan.note, /Nothing is sent until you confirm/);
    assert.match(plan.reads[0], /incident \(19\)\.xlsx/);
    assert.match(dryRunPlan(task, []).reads[0], /NOT uploaded/);
  });
});

describe("scheduled runs and stale uploads", () => {
  const file = (over) => ({ label: "Incident export", type: "file", present: true, ...over });
  it("names uploads older than the day the task was due, never the ones kept on purpose", () => {
    const inputs = [
      file({ modified: "2026-10-20T08:00:00" }),
      file({ label: "Roster", persist: true, modified: "2026-01-01T08:00:00" }),
      file({ label: "Fresh", modified: "2026-10-27T08:30:00" }),
      file({ label: "Unknown age", modified: null }),
      file({ label: "Missing", present: false, modified: null }),
      { label: "Pick", type: "select", present: true },
    ];
    assert.deepEqual(staleUploads(inputs, "2026-10-27"), ["Incident export", "Unknown age"]);
    assert.deepEqual(staleUploads([file({ modified: "2026-10-27T00:00:00" })], "2026-10-27"), []);
  });
  it("says why a stale schedule was not prepared", () => {
    const due = { kind: "due", day: "2026-10-27" };
    assert.match(scheduleMessage("Aging", due, true, false, ["Incident export"]), /Incident export was uploaded before then, so it was not prepared/);
    assert.match(scheduleMessage("Aging", due, true, false, ["A", "B"]), /A, B were uploaded before then/);
    assert.match(scheduleMessage("Aging", due, true, false, []), /files are in/);
  });
});

describe("recipient syntax", () => {
  it("accepts plain and display-name addresses and refuses text with something else in it", () => {
    assert.equal(looksLikeAddress("a@b.com"), true);
    assert.equal(looksLikeAddress("Peethambaram, Sreela <speethambaram@deloitte.com>"), true);
    assert.equal(looksLikeAddress("not an email"), false);
    assert.equal(looksLikeAddress("x@y.comBcc: evil@evil.com"), false);
  });
  it("warns about entries that are not clear addresses", () => {
    const w = checkRecipients({ to: ["a@b.com", "not an email"], cc: [] }, null, new Set());
    assert.equal(w.length, 1);
    assert.equal(w[0].kind, "invalid");
    assert.match(w[0].text, /not an email/);
  });
});

describe("automation", () => {
  const t = (id, state) => ({ id, displayName: id.toUpperCase(), state });
  it("does not notify on the first poll", () => {
    assert.deepEqual(stateNotices(null, [t("a", "error")]), []);
  });
  it("notices tasks that need you, fail or finish", () => {
    const prev = snapshotStates([t("a", "working"), t("b", "working"), t("c", "awaiting_send"), t("d", "working"), t("e", "error")]);
    const now = [t("a", "awaiting_review"), t("b", "error"), t("c", "resting"), t("d", "working"), t("e", "resting"), t("f", "error")];
    const kinds = stateNotices(prev, now).map((n) => `${n.taskId}:${n.kind}`);
    assert.deepEqual(kinds, ["a:review", "b:failed", "c:done"]);
  });
  it("lists only existing tasks with an unhandled schedule", () => {
    const s = { ...defaultSchedule("a"), weekday: 2 };
    const monday = new Date(2026, 9, 26, 10, 0);
    const wed = new Date(2026, 9, 28, 10, 0);
    assert.equal(dueSchedules([s], {}, new Set(["a"]), monday).length, 1);
    assert.equal(dueSchedules([s], {}, new Set(["b"]), monday).length, 1 - 1);
    assert.equal(dueSchedules([s], { a: "2026-10-27" }, new Set(["a"]), wed).length, 0);
    assert.equal(dueSchedules([s], {}, new Set(["a"]), wed)[0].due.kind, "missed");
  });
});
