import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { historyRows, outputForRun } from "./historyRows.ts";
import { requirementChecklist, fileKind, inputKind } from "./inputChecklist.ts";
import { stripDays, stripRows, toggleWeekday } from "./scheduleStrip.ts";
import { plainReason, refusalText, stepLabel } from "./taskPresenter.ts";
import { lastRunInfo } from "./workflowView.ts";
import { joinList } from "../../../lib/tasks/listText.ts";

describe("plain refusal reasons", () => {
  it("puts the engine's short reasons in plain words and leaves unknown ones alone", () => {
    assert.match(plainReason("prepare is running"), /still being checked/);
    assert.match(plainReason("task is awaiting_review"), /waiting for your review/);
    assert.match(plainReason("task is error"), /stopped with an error/);
    assert.equal(plainReason("task is mystery"), "task is mystery");
    assert.match(
      plainReason("file type '.exe' is not accepted (allowed: .xlsx)"),
      /\(\.exe\) is not accepted here\. Use \.xlsx\./,
    );
    assert.equal(plainReason("something else"), "something else");
    assert.match(refusalText({ ok: false, reason: "task is working" }), /running/);
  });
});

describe("labels and wording", () => {
  it("joins lists the way people say them", () => {
    assert.equal(joinList([]), "");
    assert.equal(joinList(["A"]), "A");
    assert.equal(joinList(["A", "B"]), "A and B");
    assert.equal(joinList(["A", "B", "C", "D"]), "A, B, C and D");
  });
  it("gives the shipped mailers' steps plain names, and a manifest label wins", () => {
    const task = {
      steps: [{ id: "create_pivot" }, { id: "review_gate", label: "Check it" }],
    };
    assert.equal(stepLabel(task, "create_pivot"), "Create the pivot table");
    assert.equal(stepLabel(task, "send_gate"), "Your OK to send");
    assert.equal(stepLabel(task, "review_gate"), "Check it");
    assert.equal(stepLabel(task, "build_report"), "Build report");
  });
  it("does not say 'Not run yet' while the first run is under way", () => {
    const now = new Date("2026-11-05T10:00:00Z");
    assert.equal(lastRunInfo([], now).text, "Not run yet");
    assert.equal(lastRunInfo([], now, "resting").text, "Not run yet");
    assert.equal(lastRunInfo([], now, "awaiting_review").text, "First run in progress");
  });
});

const note = (id, createdAt, outputPaths) => ({
  id,
  kind: "task.review_ready",
  title: "",
  body: "",
  outputPath: outputPaths?.[0]?.path ?? null,
  outputPaths,
  createdAt,
});
const run = {
  run_id: "r1",
  task_id: "t",
  task_name: null,
  started_at: "2026-06-10T09:00:00Z",
  ended_at: "2026-06-10T09:04:00Z",
  outcome: "completed",
  current_step_at_end: null,
  error: null,
  steps_completed: [],
};

describe("outputForRun", () => {
  it("picks the newest file written during the run", () => {
    const late = note("late", "2026-06-10T09:04:10Z", [
      { label: "Plan", path: "C:\\b.xlsx" },
    ]);
    const out = outputForRun(run, [
      note("early", "2026-06-10T09:01:00Z", [{ label: null, path: "C:\\a.xlsx" }]),
      late,
      note("other-day", "2026-06-09T09:02:00Z", [{ label: null, path: "C:\\c.xlsx" }]),
      note("no-file", "2026-06-10T09:04:20Z", undefined),
    ]);
    assert.deepEqual(out, {
      notification: late,
      file: { label: "Plan", path: "C:\\b.xlsx" },
    });
  });
  it("is null when nothing was written", () => {
    assert.equal(outputForRun(run, []), null);
  });
});

describe("historyRows", () => {
  it("builds pill, duration, name fallback and output per run", () => {
    const failed = { ...run, run_id: "r2", outcome: "failed", task_name: "Named" };
    const rows = historyRows(
      [run, failed],
      [
        {
          id: "t",
          notifications: [
            note("n", "2026-06-10T09:03:00Z", [{ label: null, path: "p" }]),
          ],
        },
      ],
    );
    assert.equal(rows[0].taskName, "t");
    assert.deepEqual(rows[0].pill, { label: "Completed", tone: "success" });
    assert.equal(rows[0].duration, "4 min");
    assert.equal(rows[0].output?.notification.id, "n");
    assert.deepEqual(rows[1].pill, { label: "Failed", tone: "danger" });
    assert.equal(rows[1].taskName, "Named");
    assert.equal(rows[1].key, "t:r2");
  });
  it("copes with a task that is no longer listed", () => {
    assert.equal(historyRows([run], [])[0].output, null);
  });
});

describe("scheduleStrip", () => {
  const NOW = new Date(2026, 5, 10, 8, 0); // Wed 10 Jun 2026
  const weekly = (weekday) => ({
    taskId: "t",
    cadence: "weekly",
    weekday,
    dayOfMonth: 1,
    time: "09:00",
    autoPrepare: false,
  });
  it("lists today and the next six days", () => {
    const days = stripDays(NOW);
    assert.deepEqual(
      days.map((d) => d.label),
      ["Today", "Thu", "Fri", "Sat", "Sun", "Mon", "Tue"],
    );
    assert.equal(days[0].day, "2026-06-10");
    assert.equal(days[0].isToday, true);
    assert.equal(days[0].weekday, 3);
  });
  it("marks the days each workflow runs", () => {
    const rows = stripRows(["t", "u"], [weekly(4)], NOW);
    assert.deepEqual(
      rows[0].cells.map((c) => c.runs),
      [false, true, false, false, false, false, false],
    );
    assert.equal(rows[0].time, "09:00");
    assert.equal(rows[1].cadence, null);
    assert.ok(rows[1].cells.every((c) => !c.runs));
  });
  it("shows a monthly run on its day", () => {
    const monthly = { ...weekly(1), cadence: "monthly", dayOfMonth: 12 };
    const cells = stripRows(["t"], [monthly], NOW)[0].cells;
    assert.equal(
      cells.findIndex((c) => c.runs),
      2,
    );
  });
  it("toggles a weekday: create, move, switch off, leave monthly", () => {
    const created = toggleWeekday(null, "t", 5);
    assert.equal(created?.weekday, 5);
    assert.equal(created?.cadence, "weekly");
    assert.equal(toggleWeekday(created, "t", 2)?.weekday, 2);
    assert.equal(toggleWeekday(created, "t", 5), null);
    const monthly = { ...weekly(1), cadence: "monthly" };
    assert.equal(toggleWeekday(monthly, "t", 3), monthly);
  });
});

describe("inputChecklist", () => {
  it("knows the kind of file", () => {
    assert.equal(fileKind("Names.XLSX"), "spreadsheet");
    assert.equal(fileKind(".csv"), "spreadsheet");
    assert.equal(fileKind("a.pdf"), "document");
    assert.equal(fileKind("a.json"), "data");
    assert.equal(fileKind("readme"), "file");
    assert.equal(fileKind(undefined), "file");
    assert.equal(inputKind({ accept: [".docx"] }), "document");
    assert.equal(inputKind({}), "file");
  });
  it("lists required inputs, ticking those no longer missing", () => {
    const inputs = [
      { label: "Incident export (Names.xlsx: A, B)", required: true },
      { label: "Roster", required: true },
      { label: "Holiday file", required: false },
    ];
    assert.deepEqual(requirementChecklist(inputs, ["Roster"]), [
      { label: "Incident export", done: true },
      { label: "Roster", done: false },
    ]);
  });
});
