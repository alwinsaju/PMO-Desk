// Run with `pnpm test`. pgm-1 (portfolio RAG), ops-1 (PMO health scorecard), ops-4 (contracts on Today)
// and the layout rule that keeps the two new cards hidden for layouts saved before they existed.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { REGISTERS } from "../registers/defs.ts";
import { defaultLayoutFor, layoutAfterSwitch } from "../platform/profile.ts";
import {
  contractTodayAlerts,
  pmoScorecard,
  portfolioRag,
  todayList,
} from "./insights.ts";
import {
  DEFAULT_LAYOUT,
  WIDGET_IDS,
  sanitizeLayout,
  sanitizeSavedLayouts,
  toggleHidden,
  visibleWidgets,
} from "./layout.ts";

const NOW_ISO = "2026-03-05T10:00:00.000Z";
const TODAY = "2026-03-05";
const rec = (id, values, updatedAt = NOW_ISO) => ({
  id: `rg_${id.padStart(12, "0")}`,
  createdAt: NOW_ISO,
  updatedAt,
  values,
});
const project = (id, project, schedule, budget, scope, extra = {}) =>
  rec(id, { project, schedule, budget, scope, status: "Active", ...extra });

describe("portfolioRag", () => {
  it("counts each open project by its worst of schedule, budget and scope", () => {
    const out = portfolioRag([
      project("1", "Alpha", "Green", "Green", "Green"),
      project("2", "Beta", "Amber", "Green", "Green"),
      project("3", "Gamma", "Green", "Red", "Amber"),
      project("4", "Delta", "Red", "Red", "Green"),
    ]);
    assert.deepEqual([out.red, out.amber, out.green, out.total], [2, 1, 1, 4]);
    assert.deepEqual(
      out.projects.map((p) => [p.project, p.rag]),
      [
        ["Delta", "Red"],
        ["Gamma", "Red"],
        ["Beta", "Amber"],
        ["Alpha", "Green"],
      ],
    );
    assert.deepEqual(out.projects[0].which, ["schedule", "budget"]);
    assert.deepEqual(out.projects[3].which, []);
  });

  it("leaves closed projects out and handles an empty register", () => {
    const out = portfolioRag([
      project("1", "Alpha", "Red", "Red", "Red", { status: "Closed" }),
      project("2", "Beta", "Green", "Green", "Green"),
    ]);
    assert.deepEqual([out.red, out.amber, out.green, out.total], [0, 0, 1, 1]);
    assert.deepEqual(portfolioRag([]), {
      red: 0,
      amber: 0,
      green: 0,
      total: 0,
      collapsed: 0,
      projects: [],
    });
  });

  it("counts a project named twice once, keeping the newest row", () => {
    const out = portfolioRag([
      project("1", "Alpha", "Red", "Green", "Green", { asOf: "2026-02-01" }),
      project("2", "alpha ", "Green", "Green", "Green", { asOf: "2026-03-01" }),
      project("3", "Beta", "Amber", "Green", "Green", { asOf: "2026-03-01" }),
    ]);
    assert.equal(out.total, 2);
    assert.equal(out.collapsed, 1);
    assert.equal(out.red, 0);
    assert.equal(out.green, 1);
    assert.equal(out.amber, 1);
  });

  it("breaks an asOf tie by the later edit, and never merges rows with no name", () => {
    const tie = portfolioRag([
      project("1", "Alpha", "Red", "Green", "Green", { asOf: "2026-03-01" }),
      rec(
        "2",
        {
          project: "Alpha",
          schedule: "Green",
          budget: "Green",
          scope: "Green",
          status: "Active",
          asOf: "2026-03-01",
        },
        "2026-03-06T10:00:00.000Z",
      ),
    ]);
    assert.equal(tie.total, 1);
    assert.equal(tie.red, 0, "the later edit wins");
    const unnamed = portfolioRag([
      project("1", "", "Red", "Green", "Green"),
      project("2", "", "Green", "Green", "Green"),
    ]);
    assert.equal(unnamed.total, 2);
    assert.equal(unnamed.projects[0].project, "(untitled)");
  });
});

describe("pmoScorecard", () => {
  const summaries = Object.fromEntries(
    REGISTERS.map((d) => [d.id, { id: d.id, total: 4, open: 3, late: 0, soon: 0 }]),
  );

  it("covers exactly the registers that have an alert rule", () => {
    const card = pmoScorecard(summaries);
    assert.deepEqual(card.rows.map((r) => r.id).sort(), [
      "changes",
      "governance",
      "invoices",
      "raid",
      "sla",
      "stakeholders",
      "status-report",
      "timesheets",
      "vendors",
    ]);
    for (const none of ["decisions", "lessons", "minutes", "capacity", "doclinks"]) {
      assert.equal(
        card.rows.some((r) => r.id === none),
        false,
        none,
      );
    }
  });

  it("shows late and soon per register and totals them", () => {
    const card = pmoScorecard({
      ...summaries,
      raid: { id: "raid", total: 5, open: 5, late: 2, soon: 1 },
      vendors: { id: "vendors", total: 2, open: 2, late: 0, soon: 1 },
      // A register without a rule never feeds the card, whatever its summary says.
      lessons: { id: "lessons", total: 9, open: 9, late: 7, soon: 7 },
    });
    const by = Object.fromEntries(card.rows.map((r) => [r.id, r]));
    assert.deepEqual([by.raid.late, by.raid.soon, by.raid.state], [2, 1, "late"]);
    assert.equal(by.vendors.state, "soon");
    assert.equal(by.sla.state, "clear");
    assert.deepEqual([card.late, card.soon, card.clear], [2, 2, 7]);
  });

  it("treats a register the summaries do not mention as clear", () => {
    const card = pmoScorecard({});
    assert.equal(card.rows.length, 9);
    assert.equal(card.clear, 9);
  });
});

describe("contracts on the Today list", () => {
  const vendor = (id, values) =>
    rec(id, { vendor: `V${id}`, status: "Active", noticeDays: 60, ...values });
  const base = {
    todos: [],
    today: TODAY,
    now: new Date("2026-03-05T10:00:00+05:30"),
    prefs: { timeZone: "Asia/Kolkata", workDays: [1, 2, 3, 4, 5], chaserDays: 2 },
    pendingLeave: 0,
    reviewCount: 0,
    tasksNeedingYou: [],
    awayToday: [],
  };

  it("takes late and soon alerts from the vendor register's own rule", () => {
    const alerts = contractTodayAlerts(
      [
        vendor("1", { milestone1: "Go-live", milestone1Date: "2026-03-01" }),
        vendor("2", { paymentDate: "2026-03-08" }),
        vendor("3", {}),
        vendor("4", { status: "Ended", milestone1Date: "2026-03-01" }),
        vendor("5", { renewalDate: "2026-12-01" }), // far off: no alert
      ],
      TODAY,
    );
    assert.deepEqual(alerts, [
      { vendor: "V1", level: "late", text: "Go-live: late by 4 days" },
      { vendor: "V2", level: "soon", text: "Payment: due in 3 days" },
    ]);
  });

  it("reaches Today, late before leave and soon after due today, and stays optional", () => {
    const items = todayList({
      ...base,
      pendingLeave: 1,
      todos: [
        {
          id: "t1",
          title: "Due",
          status: "open",
          owner: { name: "Pat", email: null, isMe: true },
          dueAt: TODAY,
          priority: "normal",
          checkpoints: [],
          chaserDays: null,
          createdAt: NOW_ISO,
          approvedAt: NOW_ISO,
          completedAt: null,
        },
      ],
      contracts: [
        { vendor: "Acme", level: "soon", text: "Payment: due today" },
        { vendor: "Zed", level: "late", text: "Go-live: late by 2 days" },
      ],
    });
    assert.deepEqual(
      items.map((i) => i.kind),
      ["contract-late", "leave", "due-today", "contract-soon"],
    );
    assert.equal(items[0].appId, "vendors");
    assert.equal(items[0].text, "Zed contract: Go-live: late by 2 days");
    // Callers that do not pass contracts are unchanged.
    assert.deepEqual(todayList(base), []);
  });
});

describe("new Dashboard cards and saved layouts", () => {
  it("are registered and hidden by default", () => {
    assert.ok(WIDGET_IDS.includes("rag") && WIDGET_IDS.includes("scorecard"));
    assert.equal(visibleWidgets(DEFAULT_LAYOUT).includes("rag"), false);
    assert.equal(visibleWidgets(DEFAULT_LAYOUT).includes("scorecard"), false);
    assert.equal(
      visibleWidgets(toggleHidden(DEFAULT_LAYOUT, "rag")).includes("rag"),
      true,
    );
  });

  it("stay hidden in a layout saved before they existed, without touching its other choices", () => {
    const oldIds = WIDGET_IDS.filter((id) => id !== "rag" && id !== "scorecard");
    const saved = {
      order: [...oldIds].reverse(),
      hidden: ["today", "workload"],
      wide: ["todos"],
    };
    const l = sanitizeLayout(saved);
    assert.deepEqual(l.hidden, ["today", "workload", "rag", "scorecard"]);
    assert.deepEqual(l.wide, ["todos"]);
    assert.deepEqual(l.order.slice(0, oldIds.length), [...oldIds].reverse());
    assert.deepEqual(l.order.slice(-2), ["rag", "scorecard"]);
    // Once the person shows one and the layout lists it, it is not hidden again.
    const shown = sanitizeLayout({ ...l, hidden: ["today"] });
    assert.deepEqual(shown.hidden, ["today"]);
    // Named layouts get the same treatment.
    const named = sanitizeSavedLayouts([{ name: "Old", layout: saved }]);
    assert.equal(named[0].layout.hidden.includes("rag"), true);
  });

  it("an untouched old default still counts as the default when the profile changes", () => {
    const oldDefault = {
      order: WIDGET_IDS.filter((id) => id !== "rag" && id !== "scorecard"),
      hidden: ["workload", "aging", "signoff", "health", "week", "registers"],
      wide: ["today"],
    };
    const out = layoutAfterSwitch(oldDefault, "pmo-lead", "team-member");
    assert.equal(out.kept, false);
    assert.deepEqual(out.layout, defaultLayoutFor("team-member"));
    assert.equal(out.layout.hidden.includes("rag"), true);
    assert.equal(out.layout.hidden.includes("scorecard"), true);
  });
});
