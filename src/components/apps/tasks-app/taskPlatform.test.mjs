// Run with `pnpm test` (Node's built-in test runner imports the .ts modules
// directly). Pure logic for the task-platform UI (start form, gates, form
// answers, flags, diff) plus the api.ts call shapes against a FAKE fetch —
// nothing here ever touches the network or the live agent-office backend.
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { AGENT_OFFICE_API_URL } from "./api.ts";
import * as api from "./api.ts";
import {
  blockers,
  blockingSummary,
  changeStats,
  diffSummary,
  filterChanges,
  flagDelta,
  isConfirmBlocked,
  sortChanges,
} from "./diffView.ts";
import {
  filterFlags,
  flagKinds,
  flagsSummary,
  flagsToTsv,
  severityCounts,
} from "./flagsView.ts";
import {
  answersToSave,
  dateFormatHint,
  effectiveAnswers,
  filterFields,
  formSummary,
  groupFields,
  hasUserEdits,
  isAnswered,
  isEdited,
  isTextField,
  localPending,
  TEXT_MAX_CHARS,
} from "./formGate.ts";
import {
  applyUpload,
  canClearInputs,
  canPrepare,
  cleanupNote,
  cleanupResultText,
  clearButtonLabel,
  clearConfirmText,
  cleansOnComplete,
  defaultChoice,
  emptyFileHint,
  formatBytes,
  formatUploaded,
  formatYears,
  holidaySourceLine,
  isChoosable,
  isOnFile,
  isOptionalFile,
  isPersistInput,
  keepsSomeInputs,
  missingRequired,
  OPTIONAL_PERSIST_HINT,
  PERSIST_HINT,
  prepareAfterIds,
  selectChoices,
  startDescription,
  uploadInvalidatesCheck,
  validateFile,
} from "./startForm.ts";
import {
  activeGate,
  describeApproval,
  hasPanelGates,
  hasStartForm,
  notificationFiles,
  openButtonLabel,
  refusalText,
  reviewReadyText,
  statusSentence,
  stepLabel,
} from "./taskPresenter.ts";

function task(overrides = {}) {
  return {
    id: "shift-roster",
    displayName: "Shift Roster",
    state: "resting",
    error: null,
    currentStep: null,
    assignedAgentId: null,
    steps: [],
    notifications: [],
    schedule: null,
    ...overrides,
  };
}

const INPUTS = [
  {
    id: "roster",
    label: "Roster workbook",
    type: "file",
    accept: [".xlsx"],
    required: true,
  },
  {
    id: "holidays",
    label: "Holiday Roster",
    type: "file",
    accept: [".xlsx"],
    required: true,
  },
  {
    id: "pto",
    label: "PTO import (optional)",
    type: "file",
    accept: [".xlsx"],
    required: false,
  },
  { id: "cycle", label: "Cycle", type: "select", optionsKey: "cycles", required: true },
];

const status = (id, present) => ({
  id,
  label: id,
  type: "file",
  required: true,
  present,
});

const OPTIONS = {
  cycles: [
    { id: "2026-12", label: "Dec 2026", enabled: true, coverage: 1 },
    {
      id: "2027-01",
      label: "Jan 2027",
      enabled: false,
      reason: "Previous cycle has no data",
    },
    { id: "2026-11", label: "Nov 2026" },
  ],
  default: "2026-12",
  problems: [{ severity: "error", message: "boom" }],
};

describe("start form", () => {
  it("prepare waits for the after-inputs (falls back to required files)", () => {
    const t = task({ inputs: INPUTS, prepare: true });
    assert.deepEqual(prepareAfterIds(t), ["roster", "holidays"]);
    assert.equal(
      canPrepare(t, [status("roster", true), status("holidays", false)]),
      false,
    );
    assert.equal(canPrepare(t, [status("roster", true), status("holidays", true)]), true);
    assert.equal(canPrepare(task({ inputs: INPUTS }), [status("roster", true)]), false);
  });

  it("honours an explicit prepare.after list", () => {
    const t = task({ inputs: INPUTS, prepare: { cmd: "x.py", after: ["roster"] } });
    assert.deepEqual(prepareAfterIds(t), ["roster"]);
    assert.equal(canPrepare(t, [status("roster", true)]), true);
  });

  it("keeps disabled cycles visible with their reason and treats missing enabled as enabled", () => {
    const choices = selectChoices(OPTIONS, "cycles");
    assert.equal(choices.length, 3);
    assert.equal(choices[1].enabled, false);
    assert.equal(choices[1].reason, "Previous cycle has no data");
    assert.equal(choices[2].enabled, true);
    assert.deepEqual(selectChoices(null, "cycles"), []);
    assert.deepEqual(selectChoices(OPTIONS, "nope"), []);
  });

  it("preselects the default only when it is enabled", () => {
    const choices = selectChoices(OPTIONS, "cycles");
    assert.equal(defaultChoice(OPTIONS, choices), "2026-12");
    assert.equal(defaultChoice({ ...OPTIONS, default: "2027-01" }, choices), "2026-12");
    assert.equal(defaultChoice({ ...OPTIONS, default: undefined }, choices), "2026-12");
    const allOff = choices.map((c) => ({ ...c, enabled: false }));
    assert.equal(defaultChoice(OPTIONS, allOff), null);
    assert.equal(isChoosable(choices, "2027-01"), false);
    assert.equal(isChoosable(choices, "2026-11"), true);
    assert.equal(isChoosable(choices, undefined), false);
  });

  it("enables Start only when every required input is satisfied", () => {
    const t = task({ inputs: INPUTS, prepare: true });
    const choices = { cycle: selectChoices(OPTIONS, "cycles") };
    const both = [status("roster", true), status("holidays", true)];
    assert.deepEqual(missingRequired(t, [], {}, {}), [
      "Roster workbook",
      "Holiday Roster",
      "Cycle",
    ]);
    assert.deepEqual(missingRequired(t, both, {}, choices), ["Cycle"]);
    assert.deepEqual(missingRequired(t, both, { cycle: "2027-01" }, choices), ["Cycle"]);
    assert.deepEqual(missingRequired(t, both, { cycle: "2026-12" }, choices), []);
  });

  it("validates extension (case-insensitive), size and emptiness", () => {
    const input = { label: "Roster workbook", accept: [".xlsx"] };
    assert.equal(validateFile(input, { name: "Roster.XLSX", size: 10 }), null);
    assert.match(validateFile(input, { name: "roster.csv", size: 10 }), /\.xlsx/);
    assert.match(validateFile(input, { name: "noext", size: 10 }), /\.xlsx/);
    assert.match(
      validateFile(input, { name: "a.xlsx", size: 60 * 1024 * 1024 }),
      /limit/,
    );
    assert.match(validateFile(input, { name: "a.xlsx", size: 0 }), /empty/);
    assert.equal(validateFile({ label: "x" }, { name: "a.bin", size: 1 }), null);
    assert.equal(formatBytes(512), "512 B");
    assert.equal(formatBytes(2048), "2.0 KB");
    assert.equal(formatBytes(5 * 1024 * 1024), "5.0 MB");
  });
});

describe("gates", () => {
  const steps = [
    { id: "analyze", type: "python", label: "Analyze roster" },
    {
      id: "answers",
      type: "review",
      label: "Answer questions",
      gate: { type: "form", schema: "output/ask-me.json" },
    },
    { id: "review_draft", type: "review", gate: { type: "flags" } },
    {
      id: "confirm_diff",
      type: "confirm",
      label: "Confirm the changes",
      gate: { type: "diff" },
    },
    { id: "legacy", type: "review", gate: { type: "none" } },
  ];

  it("only reports a panel gate while paused on that step", () => {
    assert.equal(
      activeGate(task({ steps, state: "working", currentStep: "answers" })),
      null,
    );
    assert.equal(
      activeGate(task({ steps, state: "awaiting_review", currentStep: "answers" })),
      "form",
    );
    assert.equal(
      activeGate(task({ steps, state: "awaiting_review", currentStep: "review_draft" })),
      "flags",
    );
    assert.equal(
      activeGate(task({ steps, state: "awaiting_send", currentStep: "confirm_diff" })),
      "diff",
    );
    assert.equal(
      activeGate(task({ steps, state: "awaiting_review", currentStep: "legacy" })),
      null,
    );
    assert.equal(hasPanelGates(task({ steps })), true);
    assert.equal(
      hasPanelGates(task({ steps: [{ id: "review_incidents", type: "review" }] })),
      false,
    );
    assert.equal(hasStartForm(task({ inputs: INPUTS })), true);
    assert.equal(hasStartForm(task()), false);
  });

  it("older tasks keep their text; platform steps use label and notification body", () => {
    const old = task({
      steps: [
        { id: "build_report", type: "python" },
        { id: "review_incidents", type: "review" },
      ],
      state: "awaiting_review",
      currentStep: "review_incidents",
      notifications: [
        {
          id: "n1",
          kind: "task.review_ready",
          title: "t",
          body: "backend text",
          outputPath: null,
          createdAt: "",
        },
      ],
    });
    assert.equal(statusSentence(old), "Waiting on your review.");
    assert.equal(reviewReadyText(old), null);
    assert.equal(stepLabel(old, "build_report"), "Build report");

    const platform = task({
      steps,
      state: "awaiting_review",
      currentStep: "answers",
      notifications: [
        {
          id: "n1",
          kind: "task.completed",
          title: "t",
          body: "old",
          outputPath: null,
          createdAt: "",
        },
        {
          id: "n2",
          kind: "task.review_ready",
          title: "t",
          body: "Questions are ready for you",
          outputPath: null,
          createdAt: "",
        },
      ],
    });
    assert.equal(statusSentence(platform), "Questions are ready for you");
    assert.equal(stepLabel(platform, "analyze"), "Analyze roster");
    assert.equal(
      statusSentence({ ...platform, state: "working", currentStep: "analyze" }),
      "Running Analyze roster…",
    );
    // No notification yet -> falls back to the fixed sentence.
    assert.equal(
      statusSentence({ ...platform, notifications: [] }),
      "Waiting on your review.",
    );
  });

  it("describes approvals", () => {
    assert.equal(
      describeApproval({ kind: "approve", user: "alsaju" }, "Answer questions"),
      "Approved: Answer questions — alsaju",
    );
    assert.equal(
      describeApproval({ kind: "send", user: "alsaju" }, "Confirm the changes"),
      "Confirmed: Confirm the changes — alsaju",
    );
  });
});

describe("form gate", () => {
  const schema = {
    fields: [
      {
        id: "shift:A",
        group: "Ask-me",
        label: "A",
        type: "select",
        required: true,
        default: "KEEP",
        options: [
          { value: "KEEP", label: "Keep" },
          { value: "S1", label: "S1" },
        ],
      },
      {
        id: "pattern:A",
        group: "Ask-me",
        label: "A weekly off",
        type: "select",
        required: false,
        options: [{ value: "MON_FRI", label: "Mon-Fri" }],
      },
      {
        id: "new:B",
        group: "New people",
        label: "B",
        description: "joins in Dec",
        type: "select",
        required: true,
        options: [{ value: "new_seat", label: "New seat" }],
      },
      {
        id: "pto:C",
        group: "PTO matches",
        label: "C",
        type: "select",
        required: true,
        options: [
          { value: "Carl", label: "Carl" },
          { value: "SKIP", label: "Skip" },
        ],
      },
    ],
  };

  it("shows edit, then saved, then default; drops values that are not options", () => {
    const eff = effectiveAnswers(
      schema,
      { "pto:C": "Carl", "new:B": "stale" },
      { "shift:A": "S1" },
    );
    assert.deepEqual(eff, {
      "shift:A": "S1",
      "pattern:A": "",
      "new:B": "",
      "pto:C": "Carl",
    });
    assert.equal(effectiveAnswers(schema, {}, {})["shift:A"], "KEEP");
  });

  it("computes unanswered required fields locally", () => {
    assert.deepEqual(localPending(schema, effectiveAnswers(schema, {}, {})), [
      "new:B",
      "pto:C",
    ]);
    const done = effectiveAnswers(schema, {}, { "new:B": "new_seat", "pto:C": "SKIP" });
    assert.deepEqual(localPending(schema, done), []);
  });

  it("saves defaults and edits that differ from what is saved, nothing else", () => {
    const saved = { "pto:C": "Carl" };
    const eff = effectiveAnswers(schema, saved, { "new:B": "new_seat" });
    assert.deepEqual(answersToSave(schema, saved, eff), {
      "shift:A": "KEEP",
      "new:B": "new_seat",
    });
    const after = { ...saved, "shift:A": "KEEP", "new:B": "new_seat" };
    assert.deepEqual(
      answersToSave(schema, after, effectiveAnswers(schema, after, {})),
      {},
    );
  });

  it("only flags real user edits as unsaved changes", () => {
    assert.equal(hasUserEdits(schema, {}, {}), false);
    assert.equal(hasUserEdits(schema, { "pto:C": "Carl" }, { "pto:C": "Carl" }), false);
    assert.equal(hasUserEdits(schema, { "pto:C": "Carl" }, { "pto:C": "SKIP" }), true);
    assert.equal(hasUserEdits(schema, {}, { "pto:C": "bogus" }), false);
  });

  it("groups in order of first appearance and filters by text / pending", () => {
    assert.deepEqual(
      groupFields(schema.fields).map((g) => [g.group, g.fields.length]),
      [
        ["Ask-me", 2],
        ["New people", 1],
        ["PTO matches", 1],
      ],
    );
    const eff = effectiveAnswers(schema, {}, {});
    const all = (f) => filterFields(schema.fields, f, eff).map((x) => x.id);
    assert.deepEqual(all({ query: "", onlyPending: false }), [
      "shift:A",
      "pattern:A",
      "new:B",
      "pto:C",
    ]);
    assert.deepEqual(all({ query: "weekly", onlyPending: false }), ["pattern:A"]);
    assert.deepEqual(all({ query: "joins dec", onlyPending: false }), ["new:B"]);
    assert.deepEqual(all({ query: "pto", onlyPending: false }), ["pto:C"]);
    assert.deepEqual(all({ query: "", onlyPending: true }), ["new:B", "pto:C"]);
  });
});

describe("flags", () => {
  const flags = [
    {
      key: "1",
      severity: "info",
      kind: "HOL_NOTE",
      person: "Zed",
      date: "2026-06-01",
      message: "fyi",
    },
    {
      key: "2",
      severity: "error",
      kind: "HOL_STRAY",
      person: "Amy",
      date: "2026-06-23",
      message: "stray\tholiday",
    },
    {
      key: "3",
      severity: "warning",
      kind: "HOL_STRAY",
      person: "Bob",
      date: "2026-06-02",
      message: "check",
    },
    {
      key: "4",
      severity: "error",
      kind: "GAP",
      person: "Amy",
      date: "2026-06-03",
      message: "gap",
    },
  ];

  it("uses file counts, falling back to a tally", () => {
    assert.deepEqual(
      severityCounts({ counts: { error: 2, warning: 14, info: 65 }, flags: [] }),
      { error: 2, warning: 14, info: 65 },
    );
    assert.deepEqual(severityCounts({ counts: {}, flags }), {
      error: 2,
      warning: 1,
      info: 1,
    });
  });

  it("filters by severity, kind and text; sorts most severe first", () => {
    const f = (o) =>
      filterFlags(flags, { severity: "all", kind: "all", query: "", ...o }).map(
        (x) => x.key,
      );
    assert.deepEqual(f({}), ["4", "2", "3", "1"]);
    assert.deepEqual(f({ severity: "error" }), ["4", "2"]);
    assert.deepEqual(f({ kind: "HOL_STRAY" }), ["2", "3"]);
    assert.deepEqual(f({ query: "amy 06-03" }), ["4"]);
    assert.deepEqual(f({ severity: "info", kind: "GAP" }), []);
    assert.deepEqual(flagKinds(flags), ["GAP", "HOL_NOTE", "HOL_STRAY"]);
  });

  it("exports a flat TSV", () => {
    const tsv = flagsToTsv([flags[1]]);
    assert.equal(tsv.split("\n").length, 2);
    assert.equal(tsv.split("\n")[1], "error\tHOL_STRAY\tAmy\t2026-06-23\tstray holiday");
  });
});

describe("diff view", () => {
  const changes = [
    { person: "Bob", date: "2026-12-10", before: "Shift-2", after: "P" },
    { person: "Amy", date: "2026-12-08", before: "Shift-1", after: "OFF" },
    { person: "Amy", date: "2026-12-02", before: null, after: "P" },
  ];

  it("sorts by person/date either way with stable tie-breaks", () => {
    const keys = (key, dir) =>
      sortChanges(changes, key, dir).map((c) => `${c.person}@${c.date}`);
    assert.deepEqual(keys("person", "asc"), [
      "Amy@2026-12-02",
      "Amy@2026-12-08",
      "Bob@2026-12-10",
    ]);
    assert.deepEqual(keys("person", "desc"), [
      "Bob@2026-12-10",
      "Amy@2026-12-02",
      "Amy@2026-12-08",
    ]);
    assert.deepEqual(keys("date", "asc"), [
      "Amy@2026-12-02",
      "Amy@2026-12-08",
      "Bob@2026-12-10",
    ]);
    assert.deepEqual(keys("after", "asc"), [
      "Amy@2026-12-08",
      "Amy@2026-12-02",
      "Bob@2026-12-10",
    ]);
    assert.equal(changes[0].person, "Bob"); // input untouched
  });

  it("filters across person, date, before and after", () => {
    assert.equal(filterChanges(changes, "").length, 3);
    assert.equal(filterChanges(changes, "amy").length, 2);
    assert.equal(filterChanges(changes, "amy shift-1").length, 1);
    assert.equal(filterChanges(changes, "2026-12-10").length, 1);
    assert.equal(filterChanges(changes, "nobody").length, 0);
    assert.deepEqual(changeStats(changes), { cells: 3, people: 2 });
  });

  it("blocks confirm exactly when `blocking` is non-empty", () => {
    assert.equal(isConfirmBlocked(null), false);
    assert.equal(isConfirmBlocked({ changes: [] }), false);
    assert.equal(isConfirmBlocked({ changes: [], blocking: [] }), false);
    const diff = {
      changes: [],
      blocking: [
        { kind: "SNAPSHOT_TAMPERED", message: "Snapshot changed" },
        { kind: "X", message: "y" },
      ],
    };
    assert.equal(isConfirmBlocked(diff), true);
    assert.equal(blockers(diff).length, 2);
    assert.equal(blockingSummary(diff.blocking), "Snapshot changed (+1 more)");
    assert.deepEqual(
      flagDelta({ changes: [], flags: { new: [{}], resolved: [{}, {}], remaining: 12 } }),
      { added: 1, resolved: 2, remaining: 12 },
    );
    assert.deepEqual(flagDelta({ changes: [] }), { added: 0, resolved: 0, remaining: 0 });
  });
});

describe("api helpers (fake fetch, never the network)", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function fake(handler) {
    const calls = [];
    globalThis.fetch = async (url, init = {}) => {
      calls.push({ url: String(url), init });
      return handler(String(url), init);
    };
    return calls;
  }
  const json = (body, status = 200) => ({
    ok: status < 400,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });

  it("hits the contract routes with the contract methods and bodies", async () => {
    const calls = fake(() => json({ ok: true }));
    await api.getInputs("shift-roster");
    await api.getOptions("shift-roster");
    await api.getForm("shift-roster");
    await api.getDiff("shift-roster");
    await api.getFlags("shift-roster");
    await api.prepare("shift-roster");
    await api.saveParams("shift-roster", { cycle: "2026-12" });
    await api.saveForm("shift-roster", { "shift:A": "KEEP" });
    const file = new File(["x"], "roster.xlsx");
    await api.uploadInput("shift-roster", "roster", file);

    const base = `${AGENT_OFFICE_API_URL}/tasks/shift-roster`;
    const seen = calls.map((c) => `${c.init.method} ${c.url.replace(base, "")}`);
    assert.deepEqual(seen, [
      "GET /inputs",
      "GET /options",
      "GET /form",
      "GET /diff",
      "GET /flags",
      "POST /prepare",
      "POST /params",
      "POST /form",
      "POST /upload?input=roster",
    ]);
    assert.deepEqual(JSON.parse(calls[6].init.body), { params: { cycle: "2026-12" } });
    assert.deepEqual(JSON.parse(calls[7].init.body), { answers: { "shift:A": "KEEP" } });
    assert.equal(calls[6].init.headers["Content-Type"], "application/json");
    assert.ok(calls[8].init.body instanceof FormData);
    assert.equal(calls[8].init.body.get("file").name, "roster.xlsx");
    assert.equal(calls[8].init.headers, undefined); // browser sets the multipart boundary
  });

  it("encodes ids in the path and query", async () => {
    const calls = fake(() => json({ ok: true }));
    await api.uploadInput("a b", "in/put", new File(["x"], "r.xlsx"));
    assert.ok(calls[0].url.endsWith("/tasks/a%20b/upload?input=in%2Fput"));
  });

  it("turns a 404 from an older backend into ok:false instead of throwing", async () => {
    fake(() => json({ detail: "Not Found" }, 404));
    const reply = await api.getForm("shift-roster");
    assert.equal(reply.ok, false);
    assert.match(reply.reason, /restart/i);
  });

  it("turns network failures and timeouts into ok:false", async () => {
    fake(() => {
      throw new TypeError("fetch failed");
    });
    assert.deepEqual(await api.getFlags("t"), {
      ok: false,
      reason: "Couldn't reach the backend.",
    });
    fake(() => {
      throw new DOMException("timed out", "TimeoutError");
    });
    assert.match((await api.getDiff("t")).reason, /too long/);
  });

  it("passes backend refusals through untouched", async () => {
    fake(() => json({ ok: false, reason: "disabled", pending: ["a"] }));
    const reply = await api.saveParams("t", { cycle: "x" });
    assert.equal(reply.ok, false);
    assert.equal(reply.reason, "disabled");
  });
});

describe("summaries and refusals", () => {
  it("summarises each gate for the card", () => {
    const schema = {
      fields: [
        { id: "a", required: true },
        { id: "b", required: true },
        { id: "c", required: false },
      ],
    };
    assert.equal(
      formSummary(schema, ["a"]),
      "1 of 2 required questions still need an answer",
    );
    assert.equal(formSummary(schema, []), "All 2 required questions answered");
    assert.equal(
      flagsSummary({ counts: { error: 2, warning: 14, info: 65 }, flags: [] }),
      "2 errors · 14 warnings · 65 info",
    );
    assert.equal(flagsSummary({ counts: { error: 1 }, flags: [] }), "1 error");
    assert.equal(flagsSummary({ counts: {}, flags: [] }), "No flags");
    assert.equal(
      diffSummary({
        changes: [
          { person: "A", date: "d" },
          { person: "A", date: "e" },
        ],
      }),
      "2 cells changed across 1 person",
    );
    assert.equal(
      diffSummary({ changes: [], outside_changes: [{}] }),
      "No cells changed · 1 outside the plan",
    );
  });

  it("names pending ids / blockers in a refusal, leaves legacy replies alone", () => {
    assert.equal(refusalText({ ok: false, reason: "nope" }), "nope");
    assert.equal(refusalText({ ok: false }), "request was rejected");
    assert.equal(
      refusalText({ ok: false, reason: "N still need a Subcategory2", pending: 4 }),
      "N still need a Subcategory2",
    );
    assert.equal(
      refusalText({
        ok: false,
        reason: "Unanswered",
        pending: ["a", "b", "c", "d", "e"],
      }),
      "Unanswered (a, b, c +2 more)",
    );
    assert.equal(
      refusalText({
        ok: false,
        reason: "Blocked",
        blocking: [{ kind: "SNAP", message: "Snapshot changed" }],
      }),
      "Blocked (Snapshot changed)",
    );
  });
});

describe("backend nulls (real flags have person/date null)", () => {
  const flags = [
    {
      key: "a",
      severity: "warning",
      kind: "PTO_UNMATCHED",
      person: "Zoe",
      date: null,
      message: "no date",
    },
    {
      key: "b",
      severity: "warning",
      kind: "STAFFING_SHORTAGE",
      person: null,
      date: "2026-12-02",
      team: "Ops",
      shift: "S2",
      message: "short",
    },
    {
      key: "c",
      severity: "warning",
      kind: "HEADCOUNT_BELOW_MIN",
      person: null,
      date: null,
      message: "min\theadcount",
    },
    {
      key: "d",
      severity: "warning",
      kind: "HOL_STRAY",
      person: "Amy",
      date: "2026-12-03",
      message: "stray",
    },
    {
      key: "e",
      severity: "warning",
      kind: "HOL_STRAY",
      person: "Amy",
      date: null,
      message: "stray 2",
    },
  ];
  const keys = (o = {}) =>
    filterFlags(flags, { severity: "all", kind: "all", query: "", ...o }).map(
      (f) => f.key,
    );

  it("sorts null person/date last, stably, without throwing", () => {
    // person asc: Amy(d, e), Zoe(a), then nulls (b by date, c with no date); dates null last.
    assert.deepEqual(keys(), ["d", "e", "a", "b", "c"]);
  });

  it("never searches the literal text null", () => {
    assert.deepEqual(keys({ query: "null" }), []);
    assert.deepEqual(keys({ query: "undefined" }), []);
    assert.deepEqual(keys({ query: "ops s2" }), ["b"]);
    assert.deepEqual(keys({ query: "zoe" }), ["a"]);
  });

  it("filters by kind/severity and lists kinds with nulls present", () => {
    assert.deepEqual(keys({ kind: "STAFFING_SHORTAGE" }), ["b"]);
    assert.deepEqual(keys({ severity: "info" }), []);
    assert.deepEqual(
      flagKinds([
        ...flags,
        { key: "x", severity: "info", kind: null, person: null, date: null, message: "" },
      ]),
      ["HEADCOUNT_BELOW_MIN", "HOL_STRAY", "PTO_UNMATCHED", "STAFFING_SHORTAGE"],
    );
  });

  it("exports nulls as empty TSV cells", () => {
    const rows = flagsToTsv([flags[2], flags[1]]).split("\n");
    assert.equal(rows[1], "warning\tHEADCOUNT_BELOW_MIN\t\t\tmin headcount");
    assert.equal(rows[2], "warning\tSTAFFING_SHORTAGE\t\t2026-12-02\tshort");
    assert.ok(!rows.join("\n").includes("null"));
  });

  it("handles null person/date in the diff table", () => {
    const changes = [
      { person: null, date: "2026-12-02", before: "S1", after: "P" },
      { person: "Bob", date: null, before: null, after: "OFF" },
      { person: "Amy", date: "2026-12-05", before: "S2", after: "P" },
    ];
    const order = (key, dir) =>
      sortChanges(changes, key, dir).map((c) => c.person ?? "-");
    assert.deepEqual(order("person", "asc"), ["Amy", "Bob", "-"]);
    assert.deepEqual(order("person", "desc"), ["Bob", "Amy", "-"]);
    assert.deepEqual(order("date", "asc"), ["-", "Amy", "Bob"]);
    assert.deepEqual(order("date", "desc"), ["Amy", "-", "Bob"]);
    assert.equal(filterChanges(changes, "null").length, 0);
    assert.equal(filterChanges(changes, "off").length, 1);
    assert.deepEqual(changeStats(changes), { cells: 3, people: 2 });
  });

  it("copes with null labels, descriptions and options in forms and inputs", () => {
    const fields = [
      {
        id: "a",
        group: "G",
        label: null,
        description: null,
        type: "select",
        required: true,
        default: null,
        options: null,
      },
    ];
    assert.deepEqual(
      filterFields(fields, { query: "null", onlyPending: false }, { a: "" }),
      [],
    );
    assert.equal(effectiveAnswers({ fields }, {}, {}).a, "");
    assert.deepEqual(
      selectChoices(
        { cycles: [{ id: "x", label: null, reason: null, enabled: null }] },
        "cycles",
      ),
      [{ id: "x", label: "x", enabled: true, reason: undefined, coverage: undefined }],
    );
    assert.equal(
      refusalText({ ok: false, reason: null, pending: null, blocking: null }),
      "request was rejected",
    );
  });
});

describe("form gate: text fields and optional defaults (December Disconnect availability rows)", () => {
  const DATES_HELP =
    "YYYY-MM-DD, comma separated (a range works too: 2026-12-28..2026-12-30)";
  const people = [
    { value: "NONE", label: "No exception" },
    { value: "P1", label: "P1" },
  ];
  const schema = {
    fields: [
      {
        id: "shift:N",
        group: "New people",
        label: "N",
        type: "select",
        required: true,
        default: "S1",
        options: [{ value: "S1", label: "S1" }],
      },
      {
        id: "avail_person_1",
        group: "Availability exceptions",
        label: "Main plan: exception 1, person",
        type: "select",
        required: false,
        default: "NONE",
        options: people,
      },
      {
        id: "avail_dates_1",
        group: "Availability exceptions",
        label: "Main plan: exception 1, dates",
        description: DATES_HELP,
        type: "text",
        required: false,
        default: "",
      },
      {
        id: "avail_mode_1",
        group: "Availability exceptions",
        label: "Main plan: exception 1, rule",
        type: "select",
        required: false,
        default: "unavailable",
        options: [
          { value: "unavailable", label: "Not available" },
          { value: "only_available", label: "Only available" },
        ],
      },
      {
        id: "note",
        group: "Other",
        label: "Why",
        type: "text",
        required: true,
      },
    ],
  };
  const [shift, person, dates, , note] = schema.fields;
  const eff = (saved = {}, edits = {}) => effectiveAnswers(schema, saved, edits);

  it("recognises text fields (anything that is not a select)", () => {
    assert.equal(isTextField(dates), true);
    assert.equal(isTextField(shift), false);
    assert.equal(isTextField({ ...dates, type: "number" }), true);
    assert.equal(TEXT_MAX_CHARS, 500);
  });

  it("shows a text field's saved answer, its edit, or empty", () => {
    assert.equal(eff()["avail_dates_1"], "");
    assert.equal(eff({ avail_dates_1: "2026-12-28" })["avail_dates_1"], "2026-12-28");
    assert.equal(
      eff({ avail_dates_1: "2026-12-28" }, { avail_dates_1: "2026-12-29" })[
        "avail_dates_1"
      ],
      "2026-12-29",
    );
    // an emptied text field stays empty: the edit wins over the saved answer
    assert.equal(
      eff({ avail_dates_1: "2026-12-28" }, { avail_dates_1: "" })["avail_dates_1"],
      "",
    );
  });

  it("counts a required text answer like the backend: trimmed and non-empty", () => {
    assert.equal(isAnswered(note, "  "), false);
    assert.equal(isAnswered(note, "\n\t"), false);
    assert.equal(isAnswered(note, undefined), false);
    assert.equal(isAnswered(note, " x "), true);
    assert.equal(isAnswered(shift, ""), false);
    assert.deepEqual(localPending(schema, eff()), ["note"]);
    assert.deepEqual(localPending(schema, eff({}, { note: "   " })), ["note"]);
    assert.deepEqual(localPending(schema, eff({}, { note: " because " })), []);
    // optional fields never pend, however empty
    assert.equal(localPending(schema, eff()).includes("avail_dates_1"), false);
    assert.equal(localPending(schema, eff()).includes("avail_person_1"), false);
  });

  it("'needs answer' filter and search work for text fields", () => {
    const e = eff();
    const ids = (f) => filterFields(schema.fields, f, e).map((x) => x.id);
    assert.deepEqual(ids({ query: "", onlyPending: true }), ["note"]);
    assert.deepEqual(ids({ query: "dates", onlyPending: false }), ["avail_dates_1"]);
    assert.deepEqual(ids({ query: "2026-12-28..2026-12-30", onlyPending: false }), [
      "avail_dates_1",
    ]);
    assert.deepEqual(ids({ query: "exception", onlyPending: false }), [
      "avail_person_1",
      "avail_dates_1",
      "avail_mode_1",
    ]);
    const typed = eff({}, { note: "x" });
    assert.deepEqual(
      filterFields(schema.fields, { query: "", onlyPending: true }, typed).map(
        (x) => x.id,
      ),
      [],
    );
  });

  it("Save sends trimmed text, required defaults and edits, but not untouched optional defaults", () => {
    const edits = { avail_dates_1: "  2026-12-28, 2026-12-29  ", note: " why " };
    const patch = answersToSave(schema, {}, eff({}, edits), edits);
    assert.deepEqual(patch, {
      "shift:N": "S1", // a required default is recorded
      avail_dates_1: "2026-12-28, 2026-12-29", // trimmed
      note: "why",
    });
    assert.equal("avail_person_1" in patch, false); // untouched optional default NONE
    assert.equal("avail_mode_1" in patch, false);
    // without `edits` every differing value goes (the older call shape)
    assert.equal(answersToSave(schema, {}, eff({}, edits))["avail_person_1"], "NONE");
  });

  it("an optional select the user changed is sent, also back to its default once something is saved", () => {
    const base = { "shift:N": "S1", note: "x" };
    const edits = { avail_person_1: "P1", avail_mode_1: "only_available" };
    assert.deepEqual(answersToSave(schema, base, eff(base, edits), edits), {
      avail_person_1: "P1",
      avail_mode_1: "only_available",
    });
    const saved = { ...base, avail_person_1: "P1" };
    const back = { avail_person_1: "NONE" };
    assert.deepEqual(answersToSave(schema, saved, eff(saved, back), back), {
      avail_person_1: "NONE",
    });
  });

  it("clearing a saved text answer sends null; clearing a required one makes it pending again", () => {
    const saved = { "shift:N": "S1", note: "x", avail_dates_1: "2026-12-28" };
    const edits = { avail_dates_1: "   ", note: "" };
    const effective = eff(saved, edits);
    assert.deepEqual(answersToSave(schema, saved, effective, edits), {
      avail_dates_1: null,
      note: null,
    });
    assert.deepEqual(localPending(schema, effective), ["note"]);
    // nothing saved and nothing typed: no null for an answer the backend never had
    const blank = { avail_dates_1: "" };
    assert.deepEqual(answersToSave(schema, {}, eff({}, blank), blank), {
      "shift:N": "S1",
    });
    // an optional text saved as empty and left empty is not re-sent
    const savedEmpty = { "shift:N": "S1", note: "x", avail_dates_1: "" };
    assert.deepEqual(answersToSave(schema, savedEmpty, eff(savedEmpty, {}), {}), {});
  });

  it("whitespace-only changes are not edits; real changes are", () => {
    assert.equal(isEdited(dates, undefined, "a"), false);
    assert.equal(isEdited(dates, " a ", "a"), false);
    assert.equal(isEdited(dates, "", undefined), false);
    assert.equal(isEdited(dates, "", "a"), true);
    assert.equal(isEdited(dates, "b", "a"), true);
    assert.equal(isEdited(person, "P1", undefined), true);
    assert.equal(isEdited(person, "P1", "P1"), false);
    assert.equal(hasUserEdits(schema, {}, {}), false);
    assert.equal(hasUserEdits(schema, { note: "x" }, { note: "" }), true);
    assert.equal(hasUserEdits(schema, { note: "x" }, { note: " x" }), false);
    assert.equal(hasUserEdits(schema, {}, { avail_dates_1: "2026-12-28" }), true);
  });

  it("hints (never blocks) when a date field's text is not a date list", () => {
    const hint = (v) => dateFormatHint(dates, v);
    for (const ok of [
      "",
      "   ",
      "2026-12-28",
      "2026-12-28,2026-12-29",
      " 2026-12-28 , 2026-12-30 ",
      "2026-12-28;2026-12-29",
      "2026-12-28\n2026-12-29",
      "2026-12-28..2026-12-30",
      "2026-12-28,2026-12-30..2026-12-31,",
    ]) {
      assert.equal(hint(ok), null, JSON.stringify(ok));
    }
    for (const bad of [
      "28/12/2026",
      "2026-12-28 2026-12-29",
      "2026-13-01",
      "2026-02-30",
      "Dec 28",
      "2026-12-30..2026-12-28",
      "2026-12-28..",
      "2026-12-28..2026-12-29..2026-12-30",
      "2026-12-28, tomorrow",
    ]) {
      assert.match(hint(bad), /YYYY-MM-DD/, JSON.stringify(bad));
    }
    // only fields that ask for dates, only text fields
    assert.equal(dateFormatHint(note, "nonsense"), null);
    assert.equal(dateFormatHint({ ...dates, description: "" }, "nonsense"), null);
    assert.equal(dateFormatHint({ ...dates, description: undefined }, "nonsense"), null);
    assert.equal(dateFormatHint({ ...dates, type: "select" }, "nonsense"), null);
    // and the hint changes nothing about what is saved
    const edits = { avail_dates_1: "nonsense" };
    const saved = { "shift:N": "S1", note: "x" };
    assert.deepEqual(answersToSave(schema, saved, eff(saved, edits), edits), {
      avail_dates_1: "nonsense",
    });
  });

  it("the form summary counts required fields only (optional text and selects do not)", () => {
    assert.equal(
      formSummary(schema, ["note"]),
      "1 of 2 required questions still need an answer",
    );
    assert.equal(formSummary(schema, []), "All 2 required questions answered");
  });
});

describe("several output files (Open buttons)", () => {
  const note = (over = {}) => ({
    id: "n1",
    kind: "task.review_ready",
    title: "t",
    body: "b",
    outputPath: "C:/t/output/main.xlsx",
    createdAt: "2026-10-23T00:00:00Z",
    ...over,
  });

  it("lists outputPaths, falling back to the single outputPath of an older backend", () => {
    assert.deepEqual(notificationFiles(note()), [
      { label: null, path: "C:/t/output/main.xlsx" },
    ]);
    assert.deepEqual(notificationFiles(note({ outputPaths: [] })), [
      { label: null, path: "C:/t/output/main.xlsx" },
    ]);
    assert.deepEqual(notificationFiles(note({ outputPath: null })), []);
    assert.deepEqual(notificationFiles(note({ outputPath: null, outputPaths: [] })), []);
    assert.deepEqual(
      notificationFiles(
        note({
          outputPaths: [
            { label: "Main plan", path: "C:/t/output/main.xlsx" },
            { label: " Analytics plan ", path: "C:/t/output/an.xlsx" },
            { label: "Again", path: "C:/t/output/an.xlsx" },
            { label: "", path: "C:/t/output/third.xlsx" },
            { label: "No path", path: "" },
            null,
          ],
        }),
      ),
      [
        { label: "Main plan", path: "C:/t/output/main.xlsx" },
        { label: "Analytics plan", path: "C:/t/output/an.xlsx" },
        { label: null, path: "C:/t/output/third.xlsx" },
      ],
    );
  });

  it("words each button from its label, the gate and how many files there are", () => {
    const plain = { label: null, path: "p" };
    assert.equal(openButtonLabel(plain, { count: 1 }), "Open");
    assert.equal(
      openButtonLabel(plain, { count: 1, draft: true }),
      "Open draft workbook",
    );
    assert.equal(openButtonLabel(plain, { count: 2 }), "Open workbook");
    assert.equal(openButtonLabel(plain, { count: 2, draft: true }), "Open workbook");
    const main = { label: "Main plan", path: "p" };
    assert.equal(openButtonLabel(main, { count: 2 }), "Open Main plan");
    assert.equal(
      openButtonLabel(main, { count: 2, draft: true }),
      "Open Main plan draft",
    );
    assert.equal(
      openButtonLabel({ label: "Analytics plan", path: "q" }, { count: 2, draft: true }),
      "Open Analytics plan draft",
    );
    assert.equal(
      openButtonLabel({ label: "Draft roster", path: "q" }, { count: 2, draft: true }),
      "Open Draft roster",
    );
    assert.equal(
      openButtonLabel({ label: "Next-year roster", path: "q" }, { count: 2 }),
      "Open Next-year roster",
    );
  });
});

describe("api: open a listed file, clear an answer", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });
  function fake() {
    const calls = [];
    globalThis.fetch = async (url, init = {}) => {
      calls.push({ url: String(url), init });
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    };
    return calls;
  }

  it("opens the primary file without a path and a listed file with its encoded path", async () => {
    const calls = fake();
    await api.openTaskNotification("december-disconnect", "n 1");
    await api.openTaskNotification(
      "december-disconnect",
      "n 1",
      "C:\\t\\output\\An plan.xlsx",
    );
    const base = `${AGENT_OFFICE_API_URL}/tasks/december-disconnect/notifications/n%201/open`;
    assert.equal(calls[0].url, base);
    assert.equal(calls[1].url, `${base}?path=C%3A%5Ct%5Coutput%5CAn%20plan.xlsx`);
    assert.deepEqual(
      calls.map((c) => c.init.method),
      ["POST", "POST"],
    );
  });

  it("posts a null to clear a saved text answer", async () => {
    const calls = fake();
    await api.saveForm("december-disconnect", { avail_dates_1: null, note: "x" });
    assert.deepEqual(JSON.parse(calls[0].init.body), {
      answers: { avail_dates_1: null, note: "x" },
    });
  });
});

describe("files kept across runs (persist)", () => {
  const HOLIDAYS = {
    id: "holidays",
    label: "Holiday Roster",
    type: "file",
    accept: [".xlsx"],
    required: true,
    persist: true,
  };
  const ROSTER = {
    id: "roster",
    label: "Roster workbook",
    type: "file",
    accept: [".xlsx"],
    required: true,
  };
  const t = task({
    inputs: [
      ROSTER,
      HOLIDAYS,
      {
        id: "cycle",
        label: "Cycle",
        type: "select",
        optionsKey: "cycles",
        required: true,
      },
    ],
    prepare: true,
  });
  const live = (id, over = {}) => ({
    id,
    label: id,
    type: "file",
    required: true,
    present: true,
    ...over,
  });

  it("a present persist file is 'on file'; absent or non-persist ones are not", () => {
    assert.equal(isPersistInput(HOLIDAYS), true);
    assert.equal(isPersistInput(ROSTER), false);
    assert.equal(isOnFile(HOLIDAYS, live("holidays")), true);
    assert.equal(isOnFile(HOLIDAYS, live("holidays", { present: false })), false);
    assert.equal(isOnFile(HOLIDAYS, undefined), false);
    assert.equal(isOnFile(ROSTER, live("roster")), false);
    // the live status wins over the manifest, either way
    assert.equal(isPersistInput(ROSTER, live("roster", { persist: true })), true);
    assert.equal(isPersistInput(HOLIDAYS, live("holidays", { persist: false })), false);
  });

  it("a required persist file that is on file counts as satisfied for Start (and for Check inputs)", () => {
    const choices = { cycle: selectChoices(OPTIONS, "cycles") };
    const statuses = [
      live("roster"),
      live("holidays", { persist: true, modified: "2026-01-05T09:30:00Z" }),
    ];
    assert.deepEqual(missingRequired(t, statuses, { cycle: "2026-12" }, choices), []);
    assert.equal(canPrepare(t, statuses), true);
    const absent = [live("roster"), live("holidays", { present: false, persist: true })];
    assert.deepEqual(missingRequired(t, absent, { cycle: "2026-12" }, choices), [
      "Holiday Roster",
    ]);
  });

  it("formats 'uploaded <date>' from the ISO UTC mtime", () => {
    const opts = { locale: "en-GB", timeZone: "UTC" };
    assert.equal(formatUploaded("2026-03-12T09:30:00Z", opts), "12 Mar 2026");
    assert.equal(formatUploaded("2026-03-12T09:30:00", opts), "12 Mar 2026"); // naive = UTC, not local
    assert.equal(formatUploaded("2026-03-12T23:30:00+00:00", opts), "12 Mar 2026");
    assert.equal(formatUploaded(null, opts), null);
    assert.equal(formatUploaded(undefined, opts), null);
    assert.equal(formatUploaded("not a date", opts), null);
    assert.match(PERSIST_HINT, /stays on file/);
  });

  it("a replaced persist file stays present with a fresh date and keeps its persist flag", () => {
    const before = [
      live("roster"),
      live("holidays", {
        persist: true,
        filename: "old.xlsx",
        size: 1,
        modified: "2025-01-01T00:00:00Z",
      }),
    ];
    const now = new Date("2026-06-01T10:00:00Z");
    const after = applyUpload(
      before,
      HOLIDAYS,
      { filename: "new.xlsx", size: 2048 },
      { name: "x.xlsx", size: 9 },
      now,
    );
    const row = after.find((s) => s.id === "holidays");
    assert.deepEqual(
      [row.present, row.persist, row.filename, row.size, row.modified],
      [true, true, "new.xlsx", 2048, "2026-06-01T10:00:00.000Z"],
    );
    assert.equal(after.length, 2);
    // first-ever upload (no status row yet): the file's own name/size and the manifest's persist
    const first = applyUpload([], HOLIDAYS, {}, { name: "h.xlsx", size: 77 }, now);
    assert.deepEqual(
      [first[0].id, first[0].present, first[0].persist, first[0].filename, first[0].size],
      ["holidays", true, true, "h.xlsx", 77],
    );
    assert.equal(isOnFile(HOLIDAYS, first[0]), true);
  });

  it("a persist file in prepare.after still gates Check inputs (so replacing it re-runs the check)", () => {
    assert.deepEqual(prepareAfterIds(t), ["roster", "holidays"]);
    const explicit = task({
      inputs: t.inputs,
      prepare: { cmd: "p.py", after: ["holidays"] },
    });
    assert.deepEqual(prepareAfterIds(explicit), ["holidays"]);
  });
});

describe("an optional kept file (Holiday Roster falls back to the reference file)", () => {
  const ROSTER = {
    id: "roster",
    label: "Roster workbook",
    type: "file",
    accept: [".xlsx"],
    required: true,
  };
  const HOLIDAYS = {
    id: "holidays",
    label:
      "Holiday Roster (optional - the reference file is used if you don't upload one)",
    type: "file",
    accept: [".xlsx"],
    required: false,
    persist: true,
  };
  const t = task({
    inputs: [
      ROSTER,
      HOLIDAYS,
      {
        id: "cycle",
        label: "Cycle",
        type: "select",
        optionsKey: "cycles",
        required: true,
      },
    ],
    prepare: { cmd: "scripts/prepare_options.py", after: ["roster"] },
  });
  const live = (id, over = {}) => ({
    id,
    label: id,
    type: "file",
    required: true,
    present: true,
    ...over,
  });

  it("only the roster gates Check inputs and Start; the missing Holiday Roster blocks nothing", () => {
    assert.deepEqual(prepareAfterIds(t), ["roster"]);
    const statuses = [
      live("roster"),
      live("holidays", { present: false, persist: true }),
    ];
    assert.equal(canPrepare(t, statuses), true);
    assert.equal(canPrepare(t, [live("roster", { present: false })]), false);
    const choices = { cycle: selectChoices(OPTIONS, "cycles") };
    assert.deepEqual(missingRequired(t, statuses, { cycle: "2026-12" }, choices), []);
    // with a bool `prepare` (GET /tasks) the fallback also leaves the optional file out
    assert.deepEqual(prepareAfterIds({ ...t, prepare: true }), ["roster"]);
  });

  it("an absent optional kept file says the reference file is used; a required one keeps the old hint", () => {
    assert.equal(isOptionalFile(HOLIDAYS), true);
    assert.equal(isOptionalFile(ROSTER), false);
    assert.equal(
      OPTIONAL_PERSIST_HINT,
      "Not uploaded - the reference file will be used.",
    );
    assert.equal(emptyFileHint(HOLIDAYS), OPTIONAL_PERSIST_HINT);
    assert.equal(
      emptyFileHint(HOLIDAYS, live("holidays", { persist: true })),
      OPTIONAL_PERSIST_HINT,
    );
    assert.equal(emptyFileHint({ ...HOLIDAYS, required: true }), PERSIST_HINT);
    // not kept: no hint at all (the roster, the PTO import)
    assert.equal(emptyFileHint(ROSTER), null);
    assert.equal(emptyFileHint({ id: "pto", required: false }), null);
    // the live status can switch the kept behaviour off
    assert.equal(emptyFileHint(HOLIDAYS, live("holidays", { persist: false })), null);
  });

  it("uploading the roster or the optional kept file makes an earlier check stale; the PTO import does not", () => {
    assert.equal(uploadInvalidatesCheck(t, ROSTER), true);
    assert.equal(uploadInvalidatesCheck(t, HOLIDAYS), true);
    assert.equal(
      uploadInvalidatesCheck(t, {
        id: "pto",
        label: "PTO import (optional)",
        type: "file",
        required: false,
      }),
      false,
    );
  });

  it("an uploaded optional file is still 'on file' and persists", () => {
    assert.equal(isOnFile(HOLIDAYS, live("holidays", { persist: true })), true);
    assert.equal(
      isOnFile(HOLIDAYS, live("holidays", { present: false, persist: true })),
      false,
    );
  });

  it("formats the covered years", () => {
    assert.equal(formatYears([2026, 2027]), "2026-2027");
    assert.equal(formatYears([2027, 2026, 2026]), "2026-2027");
    assert.equal(formatYears([2026, 2027, 2028]), "2026-2028");
    assert.equal(formatYears([2026]), "2026");
    assert.equal(formatYears([2026, 2028]), "2026, 2028");
    assert.equal(formatYears([]), "");
  });

  it("the Holiday Roster line under Check comes from options.holiday_source", () => {
    assert.equal(
      holidaySourceLine({
        holiday_source: {
          kind: "reference",
          file: "Holiday Roster 2026.xlsx",
          covers_years: [2026, 2027],
        },
      }),
      "Holiday Roster: reference file (covers 2026-2027)",
    );
    assert.equal(
      holidaySourceLine({
        holiday_source: {
          kind: "uploaded",
          file: "holiday-roster.xlsx",
          covers_years: [2026, 2027],
        },
      }),
      "Holiday Roster: uploaded file",
    );
    assert.equal(
      holidaySourceLine({
        holiday_source: { kind: "reference", file: "x.xlsx", covers_years: [] },
      }),
      "Holiday Roster: reference file",
    );
    // other tasks / older options files / malformed values: no line
    assert.equal(holidaySourceLine(null), null);
    assert.equal(holidaySourceLine(undefined), null);
    assert.equal(holidaySourceLine({}), null);
    assert.equal(holidaySourceLine({ holiday_source: null }), null);
    assert.equal(holidaySourceLine({ holiday_source: "reference" }), null);
    assert.equal(holidaySourceLine({ holiday_source: { kind: "other" } }), null);
  });
});

describe("start dialog for file-only tasks (no prepare, no select)", () => {
  const fileOnly = (over = {}) =>
    task({
      id: "weekly-aging-report",
      displayName: "Weekly aging report",
      inputs: [
        {
          id: "report",
          label: "Incident export",
          type: "file",
          accept: [".xlsx", ".csv"],
          dest: "input/export.xlsx",
          required: true,
        },
      ],
      prepare: false,
      cleanup: { onComplete: true, keep: [] },
      ...over,
    });
  const live = (present) => [
    { id: "report", label: "Incident export", type: "file", required: true, present },
  ];

  it("opens the start form, has no Check step, and Start is enabled right after the upload", () => {
    const f = fileOnly();
    assert.equal(hasStartForm(f), true);
    assert.equal(canPrepare(f, live(true)), false); // no Check inputs button to wait for
    assert.deepEqual(missingRequired(f, live(false), {}, {}), ["Incident export"]);
    assert.deepEqual(missingRequired(f, [], {}, {}), ["Incident export"]);
    assert.deepEqual(missingRequired(f, live(true), {}, {}), []);
    const after = applyUpload(
      [],
      f.inputs[0],
      { filename: "e.xlsx", size: 5 },
      { name: "e.xlsx", size: 5 },
    );
    assert.deepEqual(missingRequired(f, after, {}, {}), []);
  });

  it("words the dialog for what it asks", () => {
    assert.equal(
      startDescription(fileOnly()),
      "Add the file, then start the run. Nothing runs until you press Start.",
    );
    assert.match(
      startDescription(task({ inputs: INPUTS, prepare: true })),
      /check them, then choose/,
    );
    assert.match(
      startDescription(task({ inputs: INPUTS.slice(0, 2) })),
      /Add the files, then start/,
    );
  });

  it("shows the cleanup footnote only for tasks that clean up", () => {
    assert.equal(cleansOnComplete(fileOnly()), true);
    assert.equal(
      cleanupNote(fileOnly()),
      "Input files are removed automatically after the run completes.",
    );
    assert.equal(cleanupNote(fileOnly({ cleanup: null })), null);
    assert.equal(cleanupNote(fileOnly({ cleanup: undefined })), null);
    assert.equal(
      cleanupNote(fileOnly({ cleanup: { onComplete: false, keep: [] } })),
      null,
    );
    // something is kept: the line says so
    const kept = fileOnly({ cleanup: { onComplete: true, keep: ["holidays"] } });
    assert.match(cleanupNote(kept), /except the ones kept on file/);
    assert.equal(keepsSomeInputs(kept), true);
    assert.equal(keepsSomeInputs(fileOnly()), false);
    assert.equal(
      keepsSomeInputs(
        fileOnly({ inputs: [{ id: "h", label: "h", type: "file", persist: true }] }),
      ),
      true,
    );
  });
});

describe("clear input files", () => {
  const files = (n, bytes) => ({ files: n, bytes });
  const base = (over = {}) => task({ state: "resting", inputs: INPUTS, ...over });
  const mb = 1024 * 1024;

  it("is offered only when resting, on the inputs platform and something is cleanable", () => {
    assert.equal(canClearInputs(base(), files(3, 100)), true);
    assert.equal(canClearInputs(base(), files(0, 0)), false);
    assert.equal(canClearInputs(base(), null), false); // older backend: no `cleanable`
    assert.equal(canClearInputs(base(), undefined), false);
    for (const state of [
      "working",
      "awaiting_review",
      "awaiting_send",
      "finishing",
      "error",
    ]) {
      assert.equal(canClearInputs(base({ state }), files(3, 100)), false, state);
    }
    assert.equal(canClearInputs(base({ inputs: undefined }), files(3, 100)), false);
    assert.equal(canClearInputs(base({ inputs: [] }), files(3, 100)), false);
  });

  it("words the button, the confirmation and the result", () => {
    assert.equal(
      clearButtonLabel(files(3, 12 * mb)),
      "Clear input files (3 files, 12.0 MB)",
    );
    assert.equal(clearButtonLabel(files(1, 2048)), "Clear input files (1 file, 2.0 KB)");
    assert.equal(
      clearConfirmText(files(3, 12 * mb), false),
      "Delete 3 input files (12.0 MB) from this computer? This can't be undone.",
    );
    assert.match(
      clearConfirmText(files(1, 10), true),
      /Delete 1 input file .*Files kept on file for future runs stay\./,
    );
    assert.equal(
      cleanupResultText({ removed: 3, bytes: 12 * mb, skipped: 1 }),
      "Removed 3 files, freed 12.0 MB; 1 file skipped — it may be open in another program.",
    );
    assert.equal(
      cleanupResultText({ removed: 2, bytes: 3 * mb, skipped: 0 }),
      "Removed 2 files, freed 3.0 MB.",
    );
    assert.equal(
      cleanupResultText({ removed: 0, bytes: 0, skipped: 2 }),
      "No files were removed; 2 files skipped — they may be open in another program.",
    );
    assert.equal(cleanupResultText({}), "No files were removed.");
  });
});

describe("api: persist/cleanup fields and the cleanup route", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });
  const json = (body, status = 200) => ({
    ok: status < 400,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });

  it("passes persist, modified and cleanable through getInputs untouched", async () => {
    const body = {
      ok: true,
      inputs: [
        {
          id: "holidays",
          label: "Holiday Roster",
          type: "file",
          required: true,
          present: true,
          persist: true,
          modified: "2026-03-12T09:30:00Z",
          filename: "h.xlsx",
          size: 10,
        },
      ],
      params: {},
      cleanable: { files: 2, bytes: 4096 },
    };
    globalThis.fetch = async () => json(body);
    const reply = await api.getInputs("shift-roster");
    assert.equal(reply.inputs[0].persist, true);
    assert.equal(reply.inputs[0].modified, "2026-03-12T09:30:00Z");
    assert.deepEqual(reply.cleanable, { files: 2, bytes: 4096 });
  });

  it("POSTs /cleanup (encoded id, no body) and returns the counts", async () => {
    const calls = [];
    globalThis.fetch = async (url, init = {}) => {
      calls.push({ url: String(url), init });
      return json({ ok: true, removed: 3, bytes: 100, skipped: 1 });
    };
    const reply = await api.cleanupInputs("a b");
    assert.equal(calls[0].init.method, "POST");
    assert.ok(calls[0].url.endsWith("/tasks/a%20b/cleanup"));
    assert.equal(calls[0].init.body, undefined);
    assert.deepEqual(
      [reply.ok, reply.removed, reply.bytes, reply.skipped],
      [true, 3, 100, 1],
    );
  });

  it("flags a 404 as notFound (the control hides) but no other failure", async () => {
    globalThis.fetch = async () => json({ detail: "Not Found" }, 404);
    const missing = await api.cleanupInputs("t");
    assert.equal(missing.ok, false);
    assert.equal(missing.notFound, true);
    globalThis.fetch = async () => json({ detail: "boom" }, 500);
    const broken = await api.cleanupInputs("t");
    assert.equal(broken.ok, false);
    assert.equal(broken.notFound, undefined);
    globalThis.fetch = async () => {
      throw new TypeError("fetch failed");
    };
    assert.equal((await api.cleanupInputs("t")).notFound, undefined);
    globalThis.fetch = async () => json({ ok: false, reason: "The task is running." });
    assert.deepEqual(await api.cleanupInputs("t"), {
      ok: false,
      reason: "The task is running.",
    });
  });
});

describe("polled GETs share the previous parsed value when the body is unchanged", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });
  const reply = (body) => ({
    ok: true,
    status: 200,
    json: async () => JSON.parse(body),
    text: async () => body,
  });

  it("returns the identical array object for an identical /tasks body", async () => {
    globalThis.fetch = async () => reply('[{"id":"a","state":"resting"}]');
    const first = await api.fetchTasks();
    const second = await api.fetchTasks();
    assert.equal(second, first);
  });

  it("returns a new value as soon as the body differs", async () => {
    let body = '[{"id":"a","state":"resting"}]';
    globalThis.fetch = async () => reply(body);
    const first = await api.fetchTasks();
    body = '[{"id":"a","state":"working"}]';
    const second = await api.fetchTasks();
    assert.notEqual(second, first);
    assert.equal(second[0].state, "working");
    body = '[{"id":"a","state":"resting"}]';
    const third = await api.fetchTasks();
    assert.equal(third[0].state, "resting");
  });

  it("keeps paths independent (tasks vs agents)", async () => {
    globalThis.fetch = async (url) =>
      reply(String(url).endsWith("/tasks") ? "[1]" : "[1]");
    const tasks = await api.fetchTasks();
    const agents = await api.fetchAgents();
    assert.notEqual(tasks, agents);
  });

  it("shares gate GETs too, and never shares a failure", async () => {
    globalThis.fetch = async () => reply('{"ok":true,"flags":{"counts":{},"flags":[]}}');
    const a = await api.getFlags("t");
    const b = await api.getFlags("t");
    assert.equal(b, a);
    globalThis.fetch = async () => ({ ok: false, status: 500, text: async () => "" });
    const failed = await api.getFlags("t");
    assert.equal(failed.ok, false);
  });
});
