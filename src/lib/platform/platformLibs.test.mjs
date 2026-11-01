import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { APP_HELP, GENERAL_HELP, helpFor } from "./appHelp.ts";
import { detailsText, explainError } from "./friendlyError.ts";
import { sanitizePlatformPrefs, DEFAULT_PLATFORM_PREFS } from "./platformPrefs.ts";
import {
  PROFILES,
  canDecideLeave,
  defaultLayoutFor,
  layoutAfterSwitch,
  sanitizeProfile,
} from "./profile.ts";
import { RELEASES, latestRelease, releasesToShow } from "./releaseNotes.ts";
import {
  SAMPLE_TAG,
  SAMPLE_TODOS,
  addDaysTo,
  isSampleEmployee,
  isSampleTodo,
  sampleEmail,
  sampleEmployeeInputs,
  sampleTimeOff,
} from "./sampleData.ts";
import { TOUR_STEPS, progressText, stepAt, tourLength } from "./tour.ts";
import {
  addressProblem,
  checkDue,
  compareVersions,
  downloadInstaller,
  fetchManifest,
  installerName,
  isNewer,
  parseManifest,
  parseVersion,
} from "./updates.ts";
import { DEFAULT_LAYOUT, WIDGET_IDS } from "../dashboard/layout.ts";

const publicHost = async () => ["93.184.216.34"];
const sha = (s) => createHash("sha256").update(s).digest("hex");
const good = {
  version: "6.1.0",
  notes: ["One", "Two"],
  url: "https://updates.example.org/AI-OS-Setup-6.1.0.exe",
  sha256: "a".repeat(64),
  publishedAt: "2026-04-01",
};
const MANIFEST_URL = "https://updates.example.org/latest.json";

test("versions: parse, compare and newer", () => {
  assert.deepEqual(parseVersion("v5.7"), [5, 7, 0]);
  assert.deepEqual(parseVersion("6.0.1-beta"), [6, 0, 1]);
  assert.equal(parseVersion("latest"), null);
  assert.equal(compareVersions("5.10.0", "5.9.9"), 1);
  assert.equal(compareVersions("5.0.0", "5.0"), 0);
  assert.equal(compareVersions("4.9", "5.0"), -1);
  assert.equal(compareVersions("x", "5.0"), 0);
  assert.equal(isNewer("6.0.1", "6.0.0"), true);
  assert.equal(isNewer("6.0.0", "6.0.0"), false);
});

test("updates: a manifest is accepted only when it is https, same site, checksummed", () => {
  const ok = parseManifest(good, MANIFEST_URL);
  assert.equal(ok.ok, true);
  assert.equal(ok.manifest.notes.length, 2);
  const bad = (patch, text) => {
    const r = parseManifest({ ...good, ...patch }, MANIFEST_URL);
    assert.equal(r.ok, false);
    assert.match(r.reason, text);
  };
  bad({ version: "soon" }, /version/);
  bad({ sha256: "abc" }, /checksum/);
  bad({ url: "http://updates.example.org/a.exe" }, /https/);
  bad({ url: "https://evil.example.net/a.exe" }, /same site/);
  bad({ url: "https://updates.example.org/a.zip" }, /installer/);
  assert.equal(parseManifest("nope", MANIFEST_URL).ok, false);
  // a relative address resolves against the manifest
  assert.equal(parseManifest({ ...good, url: "/dl/Setup.exe" }, MANIFEST_URL).ok, true);
  // upper-case checksums are normalised; notes are capped
  const many = parseManifest(
    { ...good, sha256: "A".repeat(64), notes: Array(30).fill("n") },
    MANIFEST_URL,
  );
  assert.equal(many.manifest.sha256, "a".repeat(64));
  assert.equal(many.manifest.notes.length, 12);
});

test("updates: the check is off until enabled, then daily", () => {
  const now = new Date("2026-03-05T12:00:00Z");
  assert.equal(checkDue(false, "", now), false);
  assert.equal(checkDue(true, "", now), true);
  assert.equal(checkDue(true, "garbage", now), true);
  assert.equal(checkDue(true, "2026-03-05T01:00:00Z", now), false);
  assert.equal(checkDue(true, "2026-03-04T11:00:00Z", now), true);
});

test("updates: addresses must be https and public", async () => {
  assert.match(await addressProblem("http://updates.example.org/x", publicHost), /https/);
  assert.match(await addressProblem("https://localhost/x", publicHost), /https/);
  assert.match(await addressProblem("https://127.0.0.1/x", publicHost), /https/);
  assert.match(
    await addressProblem("https://intranet.corp/x", async () => ["10.0.0.5"]),
    /private/,
  );
  assert.match(
    await addressProblem("https://nowhere.invalid/x", async () => {
      throw new Error("nx");
    }),
    /found/,
  );
  assert.equal(await addressProblem("https://updates.example.org/x", publicHost), null);
});

test("updates: fetchManifest reads the file and explains failures", async () => {
  const json = (body, init) => async () =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), init);
  const ok = await fetchManifest(MANIFEST_URL, {
    resolve: publicHost,
    fetchImpl: json(good),
  });
  assert.equal(ok.ok, true);
  const err = await fetchManifest(MANIFEST_URL, {
    resolve: publicHost,
    fetchImpl: json("x", { status: 500 }),
  });
  assert.match(err.reason, /error \(500\)/);
  assert.match(
    (
      await fetchManifest(MANIFEST_URL, {
        resolve: publicHost,
        fetchImpl: json("not json"),
      })
    ).reason,
    /valid JSON/,
  );
  assert.match(
    (
      await fetchManifest(MANIFEST_URL, {
        resolve: publicHost,
        fetchImpl: json("x".repeat(70_000)),
      })
    ).reason,
    /too large/,
  );
  assert.match(
    (
      await fetchManifest(MANIFEST_URL, {
        resolve: publicHost,
        fetchImpl: async () => {
          throw new Error("down");
        },
      })
    ).reason,
    /Could not reach/,
  );
  assert.match(
    (await fetchManifest("http://x.example.org/a", { resolve: publicHost })).reason,
    /https/,
  );
});

test("updates: the installer is checked against its checksum before it is kept", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "aios-upd-"));
  try {
    const bytes = Buffer.from("pretend installer");
    const manifest = { ...good, sha256: sha(bytes) };
    const serve = async () =>
      new Response(bytes, { headers: { "content-length": String(bytes.length) } });
    const done = await downloadInstaller(manifest, dir, {
      resolve: publicHost,
      fetchImpl: serve,
    });
    assert.equal(done.ok, true);
    assert.equal(path.basename(done.file), "AI-OS-Setup-6.1.0.exe");
    assert.equal((await readFile(done.file)).toString(), "pretend installer");

    const tampered = await downloadInstaller(
      { ...manifest, version: "6.2.0", sha256: sha("something else") },
      dir,
      { resolve: publicHost, fetchImpl: serve },
    );
    assert.equal(tampered.ok, false);
    assert.match(tampered.reason, /checksum/);
    assert.deepEqual((await readdir(dir)).sort(), ["AI-OS-Setup-6.1.0.exe"]);

    const failed = await downloadInstaller(manifest, dir, {
      resolve: publicHost,
      fetchImpl: async () => new Response("no", { status: 404 }),
    });
    assert.match(failed.reason, /404/);
    const huge = await downloadInstaller(manifest, dir, {
      resolve: publicHost,
      fetchImpl: async () =>
        new Response(bytes, { headers: { "content-length": String(1e10) } }),
    });
    assert.match(huge.reason, /larger/);
    const privateHost = await downloadInstaller(manifest, dir, {
      resolve: async () => ["192.168.1.9"],
    });
    assert.match(privateHost.reason, /private/);
    assert.equal(installerName("6.0/../x"), "AI-OS-Setup-6.0_.._x.exe");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("profile: a lead keeps today's Dashboard and a member gets a lean one", () => {
  assert.equal(defaultLayoutFor("pmo-lead"), DEFAULT_LAYOUT);
  const member = defaultLayoutFor("team-member");
  assert.deepEqual(
    WIDGET_IDS.filter((id) => !member.hidden.includes(id)),
    ["today", "todos", "chasers", "away"],
  );
  assert.equal(canDecideLeave("pmo-lead"), true);
  assert.equal(canDecideLeave("team-member"), false);
  assert.equal(sanitizeProfile("nonsense"), "pmo-lead");
  assert.equal(sanitizeProfile("team-member"), "team-member");
  assert.ok(PROFILES["team-member"].hint.length > 0);
});

test("profile: switching changes an untouched Dashboard but never a customised one", () => {
  const untouched = layoutAfterSwitch(DEFAULT_LAYOUT, "pmo-lead", "team-member");
  assert.equal(untouched.kept, false);
  assert.deepEqual(untouched.layout, defaultLayoutFor("team-member"));
  const custom = { ...DEFAULT_LAYOUT, hidden: [] };
  const kept = layoutAfterSwitch(custom, "pmo-lead", "team-member");
  assert.equal(kept.kept, true);
  assert.equal(kept.layout, custom);
  assert.equal(layoutAfterSwitch(custom, "pmo-lead", "pmo-lead").kept, true);
  const back = layoutAfterSwitch(
    defaultLayoutFor("team-member"),
    "team-member",
    "pmo-lead",
  );
  assert.deepEqual(back.layout, DEFAULT_LAYOUT);
});

test("prefs: sanitised, with the update check off by default", () => {
  assert.deepEqual(sanitizePlatformPrefs(undefined), DEFAULT_PLATFORM_PREFS);
  assert.equal(DEFAULT_PLATFORM_PREFS.updates.enabled, false);
  const p = sanitizePlatformPrefs({
    profile: "team-member",
    lastSeenVersion: " 6.0.0 ",
    tourDone: true,
    sampleLoaded: "yes",
    updates: { enabled: true, manifestUrl: "x".repeat(900), availableVersion: 5 },
  });
  assert.equal(p.profile, "team-member");
  assert.equal(p.lastSeenVersion, "6.0.0");
  assert.equal(p.tourDone, true);
  assert.equal(p.sampleLoaded, false);
  assert.equal(p.updates.enabled, true);
  assert.equal(p.updates.manifestUrl.length, 500);
  assert.equal(p.updates.availableVersion, "");
  assert.equal(p.lastBackupAt, "");
  assert.equal(
    sanitizePlatformPrefs({ lastBackupAt: "2026-10-30T09:05:00.000Z" }).lastBackupAt,
    "2026-10-30T09:05:00.000Z",
  );
  assert.equal(sanitizePlatformPrefs({ lastBackupAt: "yesterday" }).lastBackupAt, "");
});

test("release notes: shown once per update, first run shows only the latest", () => {
  assert.ok(RELEASES.length >= 1);
  assert.equal(latestRelease().version, RELEASES[0].version);
  const latest = latestRelease().version;
  assert.equal(releasesToShow("", latest).length, 1);
  assert.equal(releasesToShow(latest, latest).length, 0);
  assert.equal(releasesToShow("5.0.0", latest).length, RELEASES.length);
  // a build older than the notes shows nothing yet
  assert.equal(releasesToShow("", "5.0.0").length, 0);
  for (const r of RELEASES) {
    assert.ok(parseVersion(r.version));
    for (const g of r.groups) assert.ok(g.title && g.items.length > 0);
  }
});

test("help: every app has a summary and three tasks with steps", () => {
  const ids = new Set();
  for (const h of APP_HELP) {
    assert.ok(!ids.has(h.appId), `duplicate ${h.appId}`);
    ids.add(h.appId);
    assert.ok(h.summary.length > 10);
    assert.equal(h.tasks.length, 3, h.appId);
    for (const t of h.tasks)
      assert.ok(t.title && t.steps.length > 0, `${h.appId}: ${t.title}`);
  }
  for (const id of [
    "dashboard",
    "pmo-todo",
    "tasks",
    "staff",
    "templates",
    "files",
    "notes",
    "browser",
    "app-store",
    "settings",
  ]) {
    assert.ok(ids.has(id), `missing help for ${id}`);
  }
  assert.equal(helpFor("tasks").title, "Tasks");
  assert.equal(helpFor("nope"), null);
  assert.equal(helpFor(null), null);
  assert.ok(GENERAL_HELP.length >= 3);
});

test("tour: steps are in range, ids are unique and progress reads well", () => {
  assert.equal(new Set(TOUR_STEPS.map((s) => s.id)).size, tourLength);
  assert.equal(stepAt(0).id, "welcome");
  assert.equal(stepAt(-1), null);
  assert.equal(stepAt(tourLength), null);
  assert.equal(progressText(0), `Step 1 of ${tourLength}`);
  assert.equal(progressText(99), `Step ${tourLength} of ${tourLength}`);
  assert.ok(TOUR_STEPS.some((s) => s.appId === "dashboard"));
});

test("sample data: marked so it can be found and removed, and dated from today", () => {
  assert.equal(addDaysTo("2026-02-27", 2), "2026-03-01");
  assert.equal(addDaysTo("2026-03-01", -1), "2026-02-28");
  assert.equal(addDaysTo("2027-12-31", 1), "2028-01-01");
  assert.equal(sampleEmail("Ana", "Lopez"), "ana.lopez@example.com");
  assert.equal(isSampleTodo({ tags: ["x", SAMPLE_TAG] }), true);
  assert.equal(isSampleTodo({ tags: [] }), false);
  assert.equal(isSampleTodo({}), false);
  assert.equal(isSampleEmployee({ deloitteEmail: "Ana.Lopez@Example.com" }), true);
  assert.equal(isSampleEmployee({ deloitteEmail: "ana@example.com.au" }), false);
  assert.equal(isSampleEmployee({ deloitteEmail: "ana@deloitte.com" }), false);
  assert.ok(SAMPLE_TODOS.some((t) => t.dueInDays < 0));
  assert.ok(SAMPLE_TODOS.some((t) => t.waitingOn));
  const people = sampleEmployeeInputs();
  assert.equal(people.length, 4);
  assert.ok(people.every((p) => isSampleEmployee({ deloitteEmail: p.deloitteEmail })));
  const leave = sampleTimeOff(["a", "b"], "2026-03-02");
  assert.deepEqual(
    leave.map((l) => [l.employeeId, l.status]),
    [
      ["b", "approved"],
      ["a", "pending"],
    ],
  );
  assert.equal(leave[0].startDate, "2026-03-04");
  assert.deepEqual(sampleTimeOff([], "2026-03-02"), []);
});

test("errors: plain sentences for the usual problems, with cleaned details", () => {
  const kind = (input, status) => explainError(input, { status }).kind;
  assert.equal(kind(new TypeError("Failed to fetch")), "offline");
  assert.equal(kind(new DOMException("x", "TimeoutError")), "timeout");
  assert.equal(kind("EBUSY: resource busy or locked, open 'C:\\x.xlsx'"), "file-locked");
  assert.equal(kind("ENOENT: no such file or directory"), "file-missing");
  assert.equal(kind("x", 403), "refused");
  assert.equal(kind("x", 404), "not-found");
  assert.equal(kind("x", 413), "too-large");
  assert.equal(kind("x", 502), "server");
  assert.equal(kind("Traceback (most recent call last):\n  File x"), "task");
  assert.equal(kind({ ok: false, reason: "Something odd" }), "unknown");

  const plain = explainError({ ok: false, reason: "That date is not a real day" });
  assert.equal(plain.message, "That date is not a real day.");
  const stack = explainError(new Error("boom\n    at f (C:\\x\\a.js:1:2)"));
  assert.match(stack.message, /Something unexpected/);
  assert.ok(!stack.message.includes("boom"));
  const secret = explainError("password=hunter2 failed for ana@x.com");
  assert.ok(!secret.detail.includes("hunter2") && !secret.detail.includes("ana@x.com"));

  const text = detailsText(plain, {
    appVersion: "6.0.0",
    where: "Staff",
    now: new Date("2026-03-05T00:00:00Z"),
  });
  assert.match(text, /AI OS 6\.0\.0/);
  assert.match(text, /Where: Staff/);
  assert.match(text, /2026-03-05T00:00:00.000Z/);
  assert.match(
    detailsText({ kind: "unknown", message: "m", detail: "" }),
    /Details: \(none\)/,
  );
});
