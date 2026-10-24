// Run with `node --test desktop/pmo-notifier.test.cjs` (also part of `pnpm test`).
// The shell's reminder poller against a fake server, a fake Notification class
// and fake timers: no Electron, no network, no real notification.
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
  DESKTOP_HEADER,
  attentionLabel,
  createReminderPoller,
  readDesktopPrefs,
  renderBadgeBitmap,
} = require("./pmo-notifier.cjs");

class FakeNotification {
  static shown = [];
  static supported = true;
  static failOnShow = false;
  static isSupported() {
    return FakeNotification.supported;
  }
  constructor(options) {
    this.options = options;
    this.handlers = {};
  }
  on(name, handler) {
    this.handlers[name] = handler;
  }
  show() {
    if (FakeNotification.failOnShow) throw new Error("no toast for you");
    FakeNotification.shown.push(this);
  }
}

function harness(replies, overrides = {}) {
  FakeNotification.shown = [];
  FakeNotification.supported = true;
  FakeNotification.failOnShow = false;
  const calls = [];
  const logs = [];
  const opened = [];
  const attention = [];
  let step = 0;
  const poller = createReminderPoller({
    getBaseUrl: () => "http://127.0.0.1:3100",
    isReady: () => true,
    fetchImpl: async (url, init) => {
      calls.push({ url, init, body: JSON.parse(init.body) });
      const reply = replies[Math.min(step++, replies.length - 1)];
      if (reply instanceof Error) throw reply;
      return { json: async () => reply };
    },
    Notification: FakeNotification,
    onOpenTodo: (id) => opened.push(id),
    onAttention: (n) => attention.push(n),
    log: (message, level) => logs.push([level ?? "log", message]),
    ...overrides,
  });
  return { poller, calls, logs, opened, attention };
}

const claim = (extra = {}) => ({
  ok: true,
  claimId: "cl_abc",
  notifications: [{ key: "k1" }],
  toast: { title: "PMO To-Do: 1 item needs attention", body: "", todoId: "td_1" },
  attention: { count: 1 },
  ...extra,
});

describe("claim, show, acknowledge", () => {
  it("claims with the desktop marker, shows the server's toast, then acknowledges", async () => {
    const { poller, calls, attention } = harness([
      claim(),
      { ok: true, acknowledged: 1 },
    ]);
    const result = await poller.pollOnce();
    assert.equal(result.shown, 1);
    assert.deepEqual(
      calls.map((c) => [c.url, c.init.method, c.body]),
      [
        ["http://127.0.0.1:3100/api/pmo/due/claim", "POST", { client: "desktop" }],
        ["http://127.0.0.1:3100/api/pmo/due/ack", "POST", { claimId: "cl_abc" }],
      ],
    );
    for (const call of calls) {
      assert.equal(
        call.init.headers["x-ai-os-desktop"],
        DESKTOP_HEADER["x-ai-os-desktop"],
      );
      assert.equal(call.init.headers["Content-Type"], "application/json");
    }
    assert.equal(FakeNotification.shown.length, 1);
    assert.deepEqual(
      {
        title: FakeNotification.shown[0].options.title,
        body: FakeNotification.shown[0].options.body,
      },
      { title: "PMO To-Do: 1 item needs attention", body: "" },
    );
    assert.deepEqual(attention, [1]);
  });

  it("clicking the notification opens that to-do, or none when it covers several", async () => {
    const one = harness([claim(), { ok: true }]);
    await one.poller.pollOnce();
    FakeNotification.shown[0].handlers.click();
    assert.deepEqual(one.opened, ["td_1"]);

    const many = harness([
      claim({
        toast: { title: "PMO To-Do: 3 items need attention", body: "", todoId: null },
      }),
      { ok: true },
    ]);
    await many.poller.pollOnce();
    FakeNotification.shown[0].handlers.click();
    assert.deepEqual(many.opened, [null]);
  });

  it("shows nothing and sends no acknowledgement when there is nothing new", async () => {
    const { poller, calls, attention } = harness([
      {
        ok: true,
        claimId: null,
        notifications: [],
        toast: null,
        attention: { count: 2 },
      },
    ]);
    assert.deepEqual(await poller.pollOnce(), { shown: 0 });
    assert.equal(calls.length, 1);
    assert.equal(FakeNotification.shown.length, 0);
    assert.deepEqual(attention, [2]); // the badge still updates
  });

  it("does not acknowledge when the notification could not be shown, so the claim expires and retries", async () => {
    const { poller, calls, logs } = harness([claim()]);
    FakeNotification.failOnShow = true;
    const result = await poller.pollOnce();
    assert.equal(result.skipped, "error");
    assert.equal(calls.length, 1);
    assert.match(logs[0][1], /no toast for you/);
    FakeNotification.supported = false;
    FakeNotification.failOnShow = false;
    assert.equal((await poller.pollOnce()).skipped, "error");
    assert.equal(calls.filter((c) => c.url.endsWith("/ack")).length, 0);
  });

  it("keeps a shown notification referenced until it closes, and logs a failed one", async () => {
    const { poller, logs } = harness([claim(), { ok: true }]);
    await poller.pollOnce();
    const toast = FakeNotification.shown[0];
    toast.handlers.failed({}, "blocked by focus assist");
    assert.match(logs.at(-1)[1], /failed to show: blocked by focus assist/);
    toast.handlers.close();
  });
});

describe("when not to poll", () => {
  it("skips while the server is not ready (starting, restarting, quitting)", async () => {
    let ready = false;
    const { poller, calls } = harness([claim()], { isReady: () => ready });
    assert.deepEqual(await poller.pollOnce(), { skipped: "server-not-ready" });
    assert.equal(calls.length, 0);
    ready = true;
    assert.equal((await poller.pollOnce()).shown, 1);
  });

  it("never overlaps two polls", async () => {
    let release;
    const gate = new Promise((resolve) => (release = resolve));
    const { poller, calls } = harness([claim()], {
      fetchImpl: async (url, init) => {
        calls.push({ url });
        await gate;
        return {
          json: async () => ({
            ok: true,
            claimId: null,
            toast: null,
            attention: { count: 0 },
          }),
        };
      },
    });
    const first = poller.pollOnce();
    assert.deepEqual(await poller.pollOnce(), { skipped: "busy" });
    release();
    await first;
    assert.equal(calls.length, 1);
  });

  it("reports a refused claim (a browser owns it, or the server said no) once, not every minute", async () => {
    const refusal = {
      ok: false,
      reason: "The AI OS desktop app delivers reminders on this server.",
    };
    const { poller, logs } = harness([
      refusal,
      refusal,
      claim({ claimId: null, toast: null }),
      refusal,
    ]);
    assert.equal((await poller.pollOnce()).skipped, "refused");
    await poller.pollOnce();
    assert.equal(logs.length, 1);
    await poller.pollOnce(); // recovered
    await poller.pollOnce(); // refused again: reported again
    assert.equal(logs.length, 2);
  });

  it("survives a network error and tells the log once", async () => {
    const { poller, logs } = harness([
      new Error("fetch failed"),
      new Error("fetch failed"),
    ]);
    assert.equal((await poller.pollOnce()).skipped, "error");
    await poller.pollOnce();
    assert.equal(logs.length, 1);
    assert.match(logs[0][1], /fetch failed/);
  });
});

describe("timers", () => {
  it("polls after a first delay and then every interval, and stops cleanly", () => {
    const timers = [];
    const cleared = [];
    const { poller } = harness([claim()], {
      setTimeoutImpl: (fn, ms) => (
        timers.push({ kind: "timeout", ms, fn }),
        timers.length
      ),
      setIntervalImpl: (fn, ms) => (
        timers.push({ kind: "interval", ms, fn }),
        timers.length
      ),
      clearTimeoutImpl: (id) => cleared.push(id),
      clearIntervalImpl: (id) => cleared.push(id),
    });
    poller.start();
    assert.deepEqual(
      timers.map((t) => [t.kind, t.ms]),
      [
        ["timeout", 20000],
        ["interval", 60000],
      ],
    );
    poller.stop();
    assert.deepEqual(cleared, [1, 2]);
    poller.stop(); // idempotent
    assert.deepEqual(cleared, [1, 2]);
  });
});

describe("the tray preference file", () => {
  const fsWith = (content) => ({
    readFileSync: () => {
      if (content instanceof Error) throw content;
      return content;
    },
  });

  it("is off unless the file says exactly true", () => {
    assert.deepEqual(readDesktopPrefs("x", fsWith('{"keepRunningInTray":true}')), {
      keepRunningInTray: true,
    });
    assert.deepEqual(readDesktopPrefs("x", fsWith('{"keepRunningInTray":false}')), {
      keepRunningInTray: false,
    });
    assert.deepEqual(readDesktopPrefs("x", fsWith('{"keepRunningInTray":"yes"}')), {
      keepRunningInTray: false,
    });
    assert.deepEqual(readDesktopPrefs("x", fsWith("{}")), { keepRunningInTray: false });
  });

  it("is off when the file is missing, empty or corrupt", () => {
    assert.deepEqual(readDesktopPrefs("x", fsWith(new Error("ENOENT"))), {
      keepRunningInTray: false,
    });
    assert.deepEqual(readDesktopPrefs("x", fsWith("")), { keepRunningInTray: false });
    assert.deepEqual(readDesktopPrefs("x", fsWith("{ nope")), {
      keepRunningInTray: false,
    });
    assert.deepEqual(readDesktopPrefs("x", fsWith("null")), { keepRunningInTray: false });
  });
});

describe("the taskbar badge", () => {
  it("labels the count in words, and nothing for zero", () => {
    assert.equal(attentionLabel(0), "");
    assert.equal(attentionLabel(1), "PMO To-Do: 1 item needs attention");
    assert.equal(attentionLabel(4), "PMO To-Do: 4 items need attention");
  });

  it("draws a 32x32 BGRA circle with white digits, transparent outside", () => {
    const { width, height, buffer } = renderBadgeBitmap(3);
    assert.deepEqual([width, height, buffer.length], [32, 32, 32 * 32 * 4]);
    const px = (x, y) => [...buffer.subarray((y * 32 + x) * 4, (y * 32 + x) * 4 + 4)];
    assert.equal(px(0, 0)[3], 0); // corner transparent
    assert.equal(px(31, 31)[3], 0);
    assert.equal(px(16, 2)[3], 255); // inside the circle
    const white = [...Array(32 * 32).keys()].filter((i) =>
      buffer.subarray(i * 4, i * 4 + 4).equals(Buffer.from([255, 255, 255, 255])),
    );
    assert.ok(white.length > 20, "digit pixels are drawn");
  });

  it("shows 9+ above nine, and different counts draw different badges", () => {
    assert.ok(!renderBadgeBitmap(10).buffer.equals(renderBadgeBitmap(9).buffer));
    assert.ok(renderBadgeBitmap(10).buffer.equals(renderBadgeBitmap(250).buffer));
    assert.ok(!renderBadgeBitmap(1).buffer.equals(renderBadgeBitmap(2).buffer));
  });
});
