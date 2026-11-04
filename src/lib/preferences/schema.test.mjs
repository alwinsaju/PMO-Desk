// Run with `pnpm test`. What the saved preferences are allowed to hold.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  appendCommandLog,
  DEFAULT_PREFERENCES,
  MAX_COMMAND_LOG,
  MAX_FAVOURITES,
  MAX_LAST_OPEN_APPS,
  MAX_LAYOUT_NAME,
  MAX_LAYOUT_WINDOWS,
  MAX_WORKSPACE_LAYOUTS,
  MAX_REMEMBERED_WINDOWS,
  MAX_SAVED_VIEWS,
  recentPrompts,
  recentSuccessfulPrompts,
  removeView,
  rememberWindowRect,
  saveView,
  sanitizeAppIds,
  sanitizeLayoutWindows,
  sanitizePreferences,
  sanitizeWorkspaceLayouts,
  sanitizeWindowRect,
  toggleFavourite,
} from "./schema.ts";

describe("rememberWindowRect", () => {
  const rect = { x: 1, y: 2, width: 300, height: 200 };

  it("adds or replaces one window and leaves the rest alone", () => {
    const before = { a: rect };
    const after = rememberWindowRect(before, "b", { ...rect, x: 50 });
    assert.deepEqual(Object.keys(after), ["a", "b"]);
    assert.equal(after.a, before.a);
    assert.equal(rememberWindowRect(after, "b", { ...rect, x: 60 }).b.x, 60);
  });

  it("returns the same object when nothing changed, so no needless save", () => {
    const before = { a: rect };
    assert.equal(rememberWindowRect(before, "a", { ...rect }), before);
  });

  it("ignores a rectangle that is not usable", () => {
    const before = { a: rect };
    assert.equal(
      rememberWindowRect(before, "a", { x: NaN, y: 0, width: 1, height: 1 }),
      before,
    );
  });

  it("forgets the oldest window when full", () => {
    let rects = {};
    for (let i = 0; i < MAX_REMEMBERED_WINDOWS; i++)
      rects = rememberWindowRect(rects, `w${i}`, rect);
    rects = rememberWindowRect(rects, "new", rect);
    assert.equal(Object.keys(rects).length, MAX_REMEMBERED_WINDOWS);
    assert.ok("new" in rects);
    assert.ok(!("w0" in rects));
  });
});

describe("command log, history and favourites", () => {
  const entry = (over = {}) => ({
    at: 1,
    prompt: "what's overdue?",
    tool: "pmo_status",
    outcome: "answered",
    detail: "",
    ...over,
  });

  it("keeps the newest hundred and drops unusable entries", () => {
    let log = [];
    for (let i = 0; i < MAX_COMMAND_LOG + 5; i++)
      log = appendCommandLog(log, entry({ at: i }));
    assert.equal(log.length, MAX_COMMAND_LOG);
    assert.equal(log[0].at, 5);
    assert.equal(appendCommandLog(log, entry({ prompt: "  " })).length, MAX_COMMAND_LOG);
    assert.equal(
      appendCommandLog(log, entry({ outcome: "sent" })).length,
      MAX_COMMAND_LOG,
    );
    const stored = sanitizePreferences({
      commandLog: [entry(), { nonsense: true }, entry({ at: NaN })],
    });
    assert.equal(stored.commandLog.length, 1);
  });

  it("recalls distinct prompts, newest first", () => {
    const log = [
      entry({ prompt: "a" }),
      entry({ prompt: "b" }),
      entry({ prompt: "A" }),
      entry({ prompt: "c" }),
    ];
    assert.deepEqual(recentPrompts(log), ["c", "A", "b"]);
    assert.deepEqual(recentPrompts(log, 2), ["c", "A"]);
  });

  it("offers only prompts that worked as recent chips, newest first", () => {
    const log = [
      entry({ prompt: "old answer", outcome: "answered" }),
      entry({ prompt: "broke", outcome: "failed" }),
      entry({ prompt: "Open Notes", outcome: "done" }),
      entry({ prompt: "stopped", outcome: "cancelled" }),
      entry({ prompt: "open notes", outcome: "done" }),
      entry({ prompt: "retry me", outcome: "failed" }),
    ];
    assert.deepEqual(recentSuccessfulPrompts(log), ["open notes", "old answer"]);
    assert.deepEqual(recentSuccessfulPrompts(log, 1), ["open notes"]);
    assert.deepEqual(recentSuccessfulPrompts([]), []);
    assert.deepEqual(
      recentSuccessfulPrompts([
        entry({ outcome: "failed" }),
        entry({ outcome: "cancelled" }),
      ]),
      [],
    );
    // Up-arrow recall is unchanged: it still includes failed and cancelled prompts.
    assert.equal(recentPrompts(log).includes("broke"), true);
  });

  it("pins and unpins a favourite, ignoring case, with a cap", () => {
    let f = toggleFavourite([], "Who's off today?");
    assert.deepEqual(f, ["Who's off today?"]);
    assert.deepEqual(toggleFavourite(f, "who's off TODAY?"), []);
    assert.deepEqual(toggleFavourite(f, "  "), f);
    for (let i = 0; i < MAX_FAVOURITES + 3; i++) f = toggleFavourite(f, `q${i}`);
    assert.equal(f.length, MAX_FAVOURITES);
    assert.equal(f.at(-1), `q${MAX_FAVOURITES + 2}`);
  });

  it("falls back to the defaults for the confirm settings", () => {
    assert.deepEqual(
      sanitizePreferences({ confirmActions: { todo_snooze: "yes" } }).confirmActions,
      {
        create_todo: true,
        todo_done: true,
        todo_snooze: false,
      },
    );
  });
});

describe("saved views", () => {
  const view = (name, over = {}) => ({
    id: `id-${name}`,
    name,
    filter: "open",
    sort: "due",
    tag: null,
    text: "",
    ...over,
  });

  it("replaces a view of the same name, keeps the newest twelve, and removes by id", () => {
    let views = saveView([], view("Mine"));
    views = saveView(views, view("mine", { filter: "overdue" }));
    assert.equal(views.length, 1);
    assert.equal(views[0].filter, "overdue");
    for (let i = 0; i < MAX_SAVED_VIEWS + 3; i++) views = saveView(views, view(`v${i}`));
    assert.equal(views.length, MAX_SAVED_VIEWS);
    assert.deepEqual(removeView(views, views[0].id).length, MAX_SAVED_VIEWS - 1);
  });

  it("drops unusable views", () => {
    assert.deepEqual(saveView([], { id: "", name: "x" }), []);
    assert.equal(
      sanitizePreferences({ savedViews: [view("ok"), { nonsense: 1 }, view(" ")] })
        .savedViews.length,
      1,
    );
  });
});

describe("sanitizePreferences", () => {
  it("fills every field from the defaults when nothing was stored", () => {
    for (const stored of [undefined, null, 5, "x", [], {}]) {
      assert.deepEqual(sanitizePreferences(stored), DEFAULT_PREFERENCES);
    }
  });

  it("keeps valid values", () => {
    const stored = {
      dashboardPeriod: "next-week",
      instantUnlock: true,
      lockSummary: false,
      windowRects: { staff: { x: 10, y: 20, width: 900, height: 600 } },
      confirmActions: { create_todo: false, todo_done: true, todo_snooze: true },
      reducedMotion: true,
      highContrast: true,
      desktopWidget: true,
      autoRecur: false,
      savedViews: [
        {
          id: "v1",
          name: "My overdue",
          filter: "overdue",
          sort: "due",
          tag: null,
          text: "",
        },
      ],
      commandLog: [
        {
          at: 5,
          prompt: "what's overdue?",
          tool: "pmo_status",
          outcome: "answered",
          detail: "",
        },
      ],
      favourites: ["who's off today?"],
      showDockLabels: true,
      reopenLastApps: true,
      lastOpenApps: ["notes", "tasks"],
      workspaceLayouts: [
        {
          name: "Review",
          windows: [{ appId: "notes", rect: { x: 10, y: 20, width: 900, height: 600 } }],
        },
      ],
    };
    assert.deepEqual(sanitizePreferences(stored), stored);
  });

  it("replaces a bad field without touching the good ones", () => {
    const result = sanitizePreferences({
      dashboardPeriod: "last-year",
      instantUnlock: "yes",
      windowRects: { staff: { x: 1, y: 2, width: 300, height: 200 } },
    });
    assert.equal(result.dashboardPeriod, "this-week");
    assert.equal(result.instantUnlock, false);
    assert.equal(result.lockSummary, true);
    assert.deepEqual(result.windowRects.staff, { x: 1, y: 2, width: 300, height: 200 });
  });

  it("drops rectangles that are not finite, positive-sized numbers", () => {
    const result = sanitizePreferences({
      windowRects: {
        good: { x: 0, y: 0, width: 100, height: 100 },
        nan: { x: NaN, y: 0, width: 100, height: 100 },
        flat: { x: 0, y: 0, width: 0, height: 100 },
        text: { x: "1", y: 0, width: 100, height: 100 },
        huge: { x: 0, y: 0, width: 1e9, height: 100 },
        notObject: 7,
      },
    });
    assert.deepEqual(Object.keys(result.windowRects), ["good"]);
  });

  it("rounds coordinates and caps how many windows are remembered", () => {
    assert.deepEqual(
      sanitizeWindowRect({ x: 1.6, y: -2.4, width: 300.5, height: 200.2 }),
      {
        x: 2,
        y: -2,
        width: 301,
        height: 200,
      },
    );
    const many = Object.fromEntries(
      Array.from({ length: MAX_REMEMBERED_WINDOWS + 20 }, (_, i) => [
        `w${i}`,
        { x: 0, y: 0, width: 10, height: 10 },
      ]),
    );
    assert.equal(
      Object.keys(sanitizePreferences({ windowRects: many }).windowRects).length,
      MAX_REMEMBERED_WINDOWS,
    );
  });
});

describe("dock labels and reopening last session's apps", () => {
  it("are off by default, with nothing remembered", () => {
    assert.equal(DEFAULT_PREFERENCES.showDockLabels, false);
    assert.equal(DEFAULT_PREFERENCES.reopenLastApps, false);
    assert.deepEqual(DEFAULT_PREFERENCES.lastOpenApps, []);
  });

  it("falls back to off for a value that is not a boolean", () => {
    for (const bad of ["yes", 1, null, {}, []]) {
      const result = sanitizePreferences({ showDockLabels: bad, reopenLastApps: bad });
      assert.equal(result.showDockLabels, false);
      assert.equal(result.reopenLastApps, false);
    }
    const on = sanitizePreferences({ showDockLabels: true, reopenLastApps: true });
    assert.equal(on.showDockLabels, true);
    assert.equal(on.reopenLastApps, true);
  });

  it("one bad field does not disturb the others", () => {
    const result = sanitizePreferences({
      showDockLabels: "maybe",
      reopenLastApps: true,
      lastOpenApps: "notes",
      instantUnlock: true,
    });
    assert.equal(result.showDockLabels, false);
    assert.equal(result.reopenLastApps, true);
    assert.deepEqual(result.lastOpenApps, []);
    assert.equal(result.instantUnlock, true);
  });

  it("sanitizeAppIds keeps distinct, non-empty text ids in order", () => {
    assert.deepEqual(
      sanitizeAppIds(["notes", " files ", "notes", "", "  ", 4, null, {}]),
      ["notes", "files"],
    );
  });

  it("sanitizeAppIds gives an empty list for anything that is not an array", () => {
    for (const bad of [undefined, null, "notes", 3, { 0: "notes" }]) {
      assert.deepEqual(sanitizeAppIds(bad), []);
    }
  });

  it("sanitizeAppIds drops an absurdly long id and caps the list", () => {
    assert.deepEqual(sanitizeAppIds(["x".repeat(500), "ok"]), ["ok"]);
    const many = Array.from({ length: 100 }, (_, i) => `app${i}`);
    const out = sanitizeAppIds(many);
    assert.equal(out.length, MAX_LAST_OPEN_APPS);
    assert.equal(out[0], "app0");
  });
});

describe("named workspace layouts", () => {
  const rect = { x: 10, y: 20, width: 800, height: 500 };
  const layout = (name, windows = [{ appId: "notes", rect }]) => ({ name, windows });

  it("start as an empty list", () => {
    assert.deepEqual(DEFAULT_PREFERENCES.workspaceLayouts, []);
  });

  it("anything that is not a list gives an empty list, and one bad field leaves the rest alone", () => {
    for (const bad of ["x", 5, null, {}, true, undefined]) {
      assert.deepEqual(sanitizeWorkspaceLayouts(bad), []);
      assert.deepEqual(sanitizeLayoutWindows(bad), []);
      assert.deepEqual(
        sanitizePreferences({ workspaceLayouts: bad }).workspaceLayouts,
        [],
      );
    }
    const out = sanitizePreferences({ workspaceLayouts: "nope", instantUnlock: true });
    assert.equal(out.instantUnlock, true);
    assert.deepEqual(out.workspaceLayouts, []);
  });

  it("keeps a good layout and trims its name", () => {
    assert.deepEqual(sanitizeWorkspaceLayouts([layout("  Review  ")]), [
      layout("Review"),
    ]);
  });

  it("skips a layout with a bad name or no usable window, not the whole list", () => {
    const out = sanitizeWorkspaceLayouts([
      layout("   "),
      layout(7),
      "junk",
      null,
      layout("Empty", []),
      layout("Bad windows", "x"),
      layout("Only bad", [
        { appId: "notes", rect: { x: NaN, y: 0, width: 5, height: 5 } },
      ]),
      layout("Good"),
    ]);
    assert.deepEqual(out, [layout("Good")]);
  });

  it("sanitises each window: text id, usable rectangle, no repeats", () => {
    const out = sanitizeLayoutWindows([
      { appId: " notes ", rect: { x: 1.6, y: 2, width: 300.4, height: 200 } },
      { appId: "notes", rect },
      { appId: "", rect },
      { appId: 5, rect },
      { appId: "x".repeat(200), rect },
      { appId: "files", rect: { x: 0, y: 0, width: 0, height: 10 } },
      { appId: "tasks" },
      "junk",
      { appId: "raid", rect },
    ]);
    assert.deepEqual(out, [
      { appId: "notes", rect: { x: 2, y: 2, width: 300, height: 200 } },
      { appId: "raid", rect },
    ]);
  });

  it("caps the layouts and the windows in each", () => {
    const many = Array.from({ length: MAX_WORKSPACE_LAYOUTS + 5 }, (_, i) =>
      layout(`L${i}`),
    );
    assert.equal(sanitizeWorkspaceLayouts(many).length, MAX_WORKSPACE_LAYOUTS);
    const windows = Array.from({ length: MAX_LAYOUT_WINDOWS + 6 }, (_, i) => ({
      appId: `app${i}`,
      rect,
    }));
    assert.equal(sanitizeLayoutWindows(windows).length, MAX_LAYOUT_WINDOWS);
    assert.equal(
      sanitizeWorkspaceLayouts([layout("Big", windows)])[0].windows.length,
      MAX_LAYOUT_WINDOWS,
    );
  });

  it("caps the name length and drops a repeated name, ignoring case", () => {
    const out = sanitizeWorkspaceLayouts([
      layout("x".repeat(MAX_LAYOUT_NAME + 20)),
      layout("Review"),
      layout("REVIEW"),
      layout(" review "),
    ]);
    assert.equal(out[0].name.length, MAX_LAYOUT_NAME);
    assert.deepEqual(
      out.map((l) => l.name),
      ["x".repeat(MAX_LAYOUT_NAME), "Review"],
    );
  });
});
