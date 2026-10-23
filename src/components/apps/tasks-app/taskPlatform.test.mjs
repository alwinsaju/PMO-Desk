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
  effectiveAnswers,
  filterFields,
  formSummary,
  groupFields,
  hasUserEdits,
  localPending,
} from "./formGate.ts";
import {
  canPrepare,
  defaultChoice,
  formatBytes,
  isChoosable,
  missingRequired,
  prepareAfterIds,
  selectChoices,
  validateFile,
} from "./startForm.ts";
import {
  activeGate,
  describeApproval,
  hasPanelGates,
  hasStartForm,
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
