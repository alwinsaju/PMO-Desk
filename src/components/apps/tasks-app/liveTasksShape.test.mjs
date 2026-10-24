// Regression: the REAL GET /tasks shape (captured read-only from the live
// engine) must make Run open the start form for tasks that declare inputs.
// Runs against a FAKE fetch only.
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import * as api from "./api.ts";
import { hasStartForm } from "./taskPresenter.ts";
import {
  applyUpload,
  canClearInputs,
  canPrepare,
  cleanupNote,
  defaultChoice,
  fileInputs,
  formatUploaded,
  hasPrepare,
  isOnFile,
  missingRequired,
  prepareAfterIds,
  selectChoices,
  selectInputs,
  startDescription,
} from "./startForm.ts";

const LIVE_TASKS = [
  {
    id: "december-disconnect",
    displayName: "December Disconnect",
    state: "resting",
    error: null,
    currentStep: null,
    assignedAgentId: null,
    steps: [
      {
        id: "analyze",
        type: "python",
        label: "Check the rosters and list the questions",
        gate: null,
      },
      {
        id: "answers",
        type: "review",
        label: "Answer the questions",
        gate: {
          type: "form",
          schema: "output/ask-me.json",
          answers: "output/ask-me-answers.json",
        },
      },
      {
        id: "build_draft",
        type: "python",
        label: "Build the draft winter plans",
        gate: null,
      },
      {
        id: "review_draft",
        type: "review",
        label: "Review the drafts in Excel",
        gate: {
          type: "flags",
          file: "output/flags.json",
        },
      },
      {
        id: "diff_draft",
        type: "python",
        label: "Compare your edits with the drafts",
        gate: null,
      },
      {
        id: "confirm_diff",
        type: "confirm",
        label: "Confirm the changes",
        gate: {
          type: "diff",
          file: "output/roster-diff.json",
        },
      },
      {
        id: "finalize",
        type: "python",
        label: "Build the final winter plans",
        gate: null,
      },
    ],
    notifications: [],
    schedule: null,
    runtime: "local",
    inputs: [
      {
        id: "roster",
        label: "Shift roster workbook",
        type: "file",
        accept: [".xlsx"],
        dest: "input/roster.xlsx",
        required: true,
      },
      {
        id: "staff",
        label: "PDT staff roster workbook",
        type: "file",
        accept: [".xlsx"],
        dest: "input/staff-roster.xlsx",
        required: true,
      },
      {
        id: "analytics_a",
        label: "Analytics roster, first month (optional)",
        type: "file",
        accept: [".xlsx"],
        dest: "input/analytics-a.xlsx",
        required: false,
      },
      {
        id: "analytics_b",
        label: "Analytics roster, second month (optional)",
        type: "file",
        accept: [".xlsx"],
        dest: "input/analytics-b.xlsx",
        required: false,
      },
      {
        id: "window",
        label: "Disconnect window",
        type: "select",
        optionsFile: "output/options.json",
        optionsKey: "windows",
        required: true,
      },
    ],
    prepare: true,
  },
  {
    id: "monthly-report-deck",
    displayName: "Monthly Report deck",
    state: "resting",
    error: null,
    currentStep: null,
    assignedAgentId: null,
    steps: [
      {
        id: "prepare_data",
        type: "python",
        label: null,
        gate: null,
      },
      {
        id: "review_incidents",
        type: "review",
        label: null,
        gate: null,
      },
      {
        id: "refresh_workbook",
        type: "powershell",
        label: null,
        gate: null,
      },
      {
        id: "review_workbook",
        type: "review",
        label: null,
        gate: null,
      },
    ],
    notifications: [],
    schedule: null,
    runtime: null,
    inputs: [],
    prepare: false,
  },
  {
    id: "shift-roster",
    displayName: "Shift Roster",
    state: "resting",
    error: null,
    currentStep: null,
    assignedAgentId: null,
    steps: [
      {
        id: "analyze",
        type: "python",
        label: "Check the roster and list the questions",
        gate: null,
      },
      {
        id: "answers",
        type: "review",
        label: "Answer the questions",
        gate: {
          type: "form",
          schema: "output/ask-me.json",
          answers: "output/ask-me-answers.json",
        },
      },
      {
        id: "build_draft",
        type: "python",
        label: "Build the draft roster",
        gate: null,
      },
      {
        id: "review_draft",
        type: "review",
        label: "Review the draft in Excel",
        gate: {
          type: "flags",
          file: "output/flags.json",
        },
      },
      {
        id: "diff_draft",
        type: "python",
        label: "Compare your edits with the draft",
        gate: null,
      },
      {
        id: "confirm_diff",
        type: "confirm",
        label: "Confirm the changes",
        gate: {
          type: "diff",
          file: "output/roster-diff.json",
        },
      },
      {
        id: "finalize",
        type: "python",
        label: "Build the final roster",
        gate: null,
      },
    ],
    notifications: [],
    schedule: null,
    runtime: "local",
    inputs: [
      {
        id: "roster",
        label: "Roster workbook",
        type: "file",
        accept: [".xlsx"],
        dest: "input/roster.xlsx",
        required: true,
      },
      {
        id: "holidays",
        label: "Holiday Roster",
        type: "file",
        accept: [".xlsx"],
        dest: "input/holiday-roster.xlsx",
        required: true,
      },
      {
        id: "pto",
        label: "PTO import (optional)",
        type: "file",
        accept: [".xlsx"],
        dest: "input/pto-import.xlsx",
        required: false,
      },
      {
        id: "cycle",
        label: "Cycle",
        type: "select",
        optionsFile: "output/options.json",
        optionsKey: "cycles",
        required: true,
      },
    ],
    prepare: true,
  },
];

describe("live /tasks shape", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("keeps inputs/prepare through fetchTasks and opens the start form", async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify(LIVE_TASKS), { status: 200 });
    const tasks = await api.fetchTasks();
    const byId = Object.fromEntries(tasks.map((t) => [t.id, t]));
    assert.equal(hasStartForm(byId["shift-roster"]), true);
    assert.equal(hasStartForm(byId["december-disconnect"]), true);
    assert.equal(hasStartForm(byId["monthly-report-deck"]), false);
    assert.equal(byId["shift-roster"].prepare, true);
    assert.deepEqual(
      byId["shift-roster"].inputs.map((i) => i.id),
      ["roster", "holidays", "pto", "cycle"],
    );
  });

  for (const [id, after, optional, selectId, key] of [
    [
      "december-disconnect",
      ["roster", "staff"],
      ["analytics_a", "analytics_b"],
      "window",
      "windows",
    ],
    ["shift-roster", ["roster", "holidays"], ["pto"], "cycle", "cycles"],
  ]) {
    it(`start form logic works on the live ${id} manifest (files, optional files, select)`, async () => {
      globalThis.fetch = async () =>
        new Response(JSON.stringify(LIVE_TASKS), { status: 200 });
      const task = (await api.fetchTasks()).find((t) => t.id === id);
      // GET /tasks exposes `prepare` as a bool: the "after" list falls back to the required files.
      assert.deepEqual(prepareAfterIds(task), after);
      assert.deepEqual(
        fileInputs(task)
          .filter((i) => !i.required)
          .map((i) => i.id),
        optional,
      );
      assert.deepEqual(
        selectInputs(task).map((i) => i.id),
        [selectId],
      );

      const status = (ids) => ids.map((i) => ({ id: i, present: true }));
      assert.equal(canPrepare(task, status(after.slice(0, 1))), false);
      assert.equal(canPrepare(task, status(after)), true);

      const options = {
        [key]: [
          { id: "a", label: "A" },
          { id: "b", label: "B", enabled: false, reason: "no data" },
        ],
        default: "a",
      };
      const choices = selectChoices(options, key);
      assert.equal(defaultChoice(options, choices), "a");
      const byInput = { [selectId]: choices };
      // Required files and a choice are all that Start needs; optional files never block it.
      assert.equal(
        missingRequired(task, status(after), { [selectId]: "a" }, byInput).length,
        0,
      );
      assert.equal(
        missingRequired(task, status(after), { [selectId]: "b" }, byInput).length,
        1,
      );
      assert.equal(missingRequired(task, [], {}, byInput).length, after.length + 1);
    });
  }
});

// SYNTHETIC (not captured): the four older tasks once the platform gives them
// a file-only `inputs` block (one REQUIRED file, no prepare, no select) and a
// `cleanup` policy, and shift-roster with its yearly Holiday Roster marked
// `persist`. Built from the live shapes above; fetch is faked.
const OLDER_TASKS = [
  ["weekly-aging-report", "Weekly aging report", "input/incidents.xlsx"],
  ["weekly-backlog-report", "Weekly backlog report", "input/incidents.xlsx"],
  ["deployment-dep-weekend-mailer", "Deployment weekend mailer", "input/schedule.xlsx"],
  ["monthly-report-deck", "Monthly Report deck", "input/incidents.xlsx"],
].map(([id, displayName, dest]) => ({
  id,
  displayName,
  state: "resting",
  error: null,
  currentStep: null,
  assignedAgentId: null,
  steps: [
    { id: "prepare_data", type: "python", label: null, gate: null },
    { id: "review_incidents", type: "review", label: null, gate: null },
  ],
  notifications: [],
  schedule: null,
  runtime: null,
  inputs: [
    {
      id: "data",
      label: "Source workbook",
      type: "file",
      accept: [".xlsx"],
      dest,
      required: true,
      persist: false,
    },
  ],
  prepare: false,
  cleanup: { onComplete: true, keep: [] },
}));

const PERSIST_ROSTER = {
  ...LIVE_TASKS.find((t) => t.id === "shift-roster"),
  inputs: LIVE_TASKS.find((t) => t.id === "shift-roster").inputs.map((i) =>
    i.id === "holidays" ? { ...i, persist: true } : i,
  ),
  cleanup: { onComplete: true, keep: ["holidays"] },
};

describe("synthetic manifests: the four older tasks gain a file-only inputs block", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });
  const load = async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify([...OLDER_TASKS, PERSIST_ROSTER]), { status: 200 });
    return api.fetchTasks();
  };

  it("Run now opens the start dialog for each of them, with cleanup and persist preserved", async () => {
    const tasks = await load();
    for (const [id] of OLDER_TASKS.map((t) => [t.id])) {
      const t = tasks.find((x) => x.id === id);
      assert.equal(hasStartForm(t), true, id);
      assert.equal(hasPrepare(t), false, id);
      assert.deepEqual(t.cleanup, { onComplete: true, keep: [] }, id);
      assert.equal(t.inputs[0].persist, false, id);
    }
    const roster = tasks.find((t) => t.id === "shift-roster");
    assert.equal(roster.inputs.find((i) => i.id === "holidays").persist, true);
    assert.deepEqual(roster.cleanup, { onComplete: true, keep: ["holidays"] });
  });

  it("single required file, no prepare/select: no Check step, Start enabled right after the upload", async () => {
    for (const t of (await load()).filter((x) =>
      OLDER_TASKS.some((o) => o.id === x.id),
    )) {
      assert.deepEqual(
        fileInputs(t).map((i) => i.required),
        [true],
        t.id,
      );
      assert.deepEqual(selectInputs(t), [], t.id);
      assert.equal(canPrepare(t, [{ id: "data", present: true }]), false, t.id);
      assert.deepEqual(missingRequired(t, [], {}, {}), ["Source workbook"], t.id);
      const uploaded = applyUpload(
        [],
        t.inputs[0],
        { filename: "x.xlsx", size: 9 },
        { name: "x.xlsx", size: 9 },
      );
      assert.deepEqual(missingRequired(t, uploaded, {}, {}), [], t.id);
      assert.match(startDescription(t), /^Add the file, then start the run\./, t.id);
      assert.equal(
        cleanupNote(t),
        "Input files are removed automatically after the run completes.",
        t.id,
      );
      assert.equal(canClearInputs(t, { files: 1, bytes: 10 }), true, t.id);
      assert.equal(
        canClearInputs({ ...t, state: "working" }, { files: 1, bytes: 10 }),
        false,
        t.id,
      );
    }
  });

  it("shift-roster with a persist Holiday Roster: on file satisfies it, the others still gate Start", async () => {
    const t = (await load()).find((x) => x.id === "shift-roster");
    const holidays = t.inputs.find((i) => i.id === "holidays");
    const statuses = [
      { id: "holidays", present: true, persist: true, modified: "2026-01-05T09:30:00Z" },
    ];
    assert.equal(isOnFile(holidays, statuses[0]), true);
    assert.equal(
      formatUploaded(statuses[0].modified, { locale: "en-GB", timeZone: "UTC" }),
      "5 Jan 2026",
    );
    const choices = {
      cycle: selectChoices({ cycles: [{ id: "c", label: "C" }] }, "cycles"),
    };
    assert.deepEqual(missingRequired(t, statuses, { cycle: "c" }, choices), [
      "Roster workbook",
    ]);
    assert.deepEqual(
      missingRequired(
        t,
        [...statuses, { id: "roster", present: true }],
        { cycle: "c" },
        choices,
      ),
      [],
    );
    assert.match(cleanupNote(t), /except the ones kept on file/);
  });

  it("older engine: no persist/cleanup/cleanable fields still behaves as before", async () => {
    const plain = LIVE_TASKS.find((t) => t.id === "shift-roster");
    assert.equal(cleanupNote(plain), null);
    assert.equal(canClearInputs(plain, undefined), false);
    assert.equal(isOnFile(plain.inputs[1], { id: "holidays", present: true }), false);
  });
});
