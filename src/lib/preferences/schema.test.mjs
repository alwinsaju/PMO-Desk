// Run with `pnpm test`. What the saved preferences are allowed to hold.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  appendCommandLog,
  DEFAULT_PREFERENCES,
  MAX_COMMAND_LOG,
  MAX_FAVOURITES,
  MAX_REMEMBERED_WINDOWS,
  MAX_SAVED_VIEWS,
  recentPrompts,
  removeView,
  rememberWindowRect,
  saveView,
  sanitizePreferences,
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
