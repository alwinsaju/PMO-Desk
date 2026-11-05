// Run with `pnpm test`. The smaller setup helpers: model advice, the Outlook
// probe, the inbox/OneDrive facts and the background job holder.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  INBOX_FOLDER_NAME,
  inboxSuggestions,
  oneDriveFacts,
  saveInboxChoice,
  validateInboxChoice,
} from "./inbox.ts";
import { Job, JobRegistry } from "./jobs.ts";
import {
  FALLBACK_MODEL,
  downloadSizeText,
  isPullable,
  modelToPull,
  preflight,
  sameModel,
} from "./models.ts";
import { MODEL_SIZE, formatBytes } from "../format.ts";
import { probeOutlook } from "./outlook.ts";

const GB = 1_000_000_000;

describe("models", () => {
  it("formats sizes people can read", () => {
    assert.equal(formatBytes(500, MODEL_SIZE), "1 KB");
    assert.equal(formatBytes(42_000_000, MODEL_SIZE), "42 MB");
    assert.equal(formatBytes(6.6 * GB, MODEL_SIZE), "6.6 GB");
    assert.equal(formatBytes(12 * GB, MODEL_SIZE), "12 GB");
    assert.equal(formatBytes(-1, MODEL_SIZE), "unknown");
  });

  it("says how big each known model is, and admits when it does not know", () => {
    assert.equal(downloadSizeText("gemma4:12b"), "about 12 GB");
    assert.equal(downloadSizeText("qwen3.5:4b"), "about 3.3 GB");
    assert.equal(downloadSizeText("QWEN3.5:4B:latest"), "about 3.3 GB");
    assert.equal(downloadSizeText("qwen3.5:9b"), "of unknown size");
    assert.equal(downloadSizeText("llama3.3:70b"), "of unknown size");
  });

  it("picks the model to download: the fallback on request, else the active one", () => {
    const pick = (requested, fallback, active) =>
      modelToPull({ requested, fallback, active });
    assert.equal(pick(undefined, true, "gemma4:12b"), FALLBACK_MODEL);
    assert.equal(pick("  ", false, "qwen3.5:4b"), "qwen3.5:4b");
    assert.equal(pick("gemma4:12b", false, "qwen3.5:4b"), "gemma4:12b");
  });

  it("only offers the configured default and the fallback", () => {
    assert.equal(isPullable("gemma4:12b", "gemma4:12b"), true);
    assert.equal(isPullable(FALLBACK_MODEL, "gemma4:12b"), true);
    assert.equal(isPullable("llama3.3:70b", "gemma4:12b"), false);
    assert.equal(isPullable("evil/model", "gemma4:12b"), false);
  });

  it("compares model tags the way Ollama does", () => {
    assert.equal(sameModel("gemma4:12b", "GEMMA4:12b"), true);
    assert.equal(sameModel("llama3.2", "llama3.2:latest"), true);
    assert.equal(sameModel("gemma4:12b", "gemma4:27b"), false);
  });

  it("blocks a pull that cannot fit and warns when space or memory is tight", () => {
    const ram = (gb) => gb * 1024 ** 3;
    assert.match(
      preflight({ model: "gemma4:12b", freeDiskBytes: 5 * GB, totalRamBytes: ram(32) })
        .blocked,
      /not enough free disk space/,
    );
    const tight = preflight({
      model: "gemma4:12b",
      freeDiskBytes: 14 * GB,
      totalRamBytes: ram(32),
    });
    assert.equal(tight.blocked, null);
    assert.match(tight.warnings[0], /Disk space is tight/);
    const smallRam = preflight({
      model: "gemma4:12b",
      freeDiskBytes: 200 * GB,
      totalRamBytes: ram(8),
    });
    assert.match(smallRam.warnings[0], /8 GB of memory.*qwen3\.5:4b/);
    assert.deepEqual(
      preflight({ model: "gemma4:12b", freeDiskBytes: 200 * GB, totalRamBytes: ram(32) }),
      { blocked: null, warnings: [] },
    );
    assert.deepEqual(
      preflight({ model: "unknown:1b", freeDiskBytes: 1, totalRamBytes: 1 }),
      { blocked: null, warnings: [] },
    );
    assert.equal(
      preflight({ model: "gemma4:12b", freeDiskBytes: null, totalRamBytes: ram(32) })
        .blocked,
      null,
    );
  });
});

describe("probeOutlook", () => {
  const reply = (table) => async (command, args) => {
    const key = command === "reg.exe" ? args[1] : "appx";
    if (!(key in table)) throw new Error(`unexpected ${key}`);
    const value = table[key];
    return typeof value === "number" ? { status: value, stdout: "", stderr: "" } : value;
  };
  const COM = "HKCR\\Outlook.Application\\CLSID";
  const APP =
    "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\OUTLOOK.EXE";

  it("reads registry keys and the installed packages, nothing else", async () => {
    const seen = [];
    const run = async (command, args) => {
      seen.push([command, args[0]]);
      return command === "reg.exe"
        ? { status: 0, stdout: "", stderr: "" }
        : { status: 0, stdout: "no\r\n", stderr: "" };
    };
    // classic Outlook is registered, so the slow "new Outlook" question is skipped
    assert.deepEqual(await probeOutlook(run, "win32"), {
      comRegistered: true,
      classicInstalled: true,
      newOutlook: null,
    });
    assert.deepEqual(seen.map(([c]) => c).sort(), ["reg.exe", "reg.exe"]);
    assert.ok(seen.filter(([c]) => c === "reg.exe").every(([, a]) => a === "query"));
  });

  it("asks about the new Outlook when classic is not registered", async () => {
    const seen = [];
    const run = async (command) => {
      seen.push(command);
      return command === "reg.exe"
        ? { status: 1, stdout: "", stderr: "" }
        : { status: 0, stdout: "no", stderr: "" };
    };
    assert.deepEqual(await probeOutlook(run, "win32"), {
      comRegistered: false,
      classicInstalled: false,
      newOutlook: false,
    });
    assert.ok(seen.includes("powershell.exe"));
  });

  it("reports classic missing and new Outlook present", async () => {
    const run = reply({
      [COM]: 1,
      [APP]: 1,
      appx: { status: 0, stdout: "yes", stderr: "" },
    });
    assert.deepEqual(await probeOutlook(run, "win32"), {
      comRegistered: false,
      classicInstalled: false,
      newOutlook: true,
    });
  });

  it("reports unknown when the tools themselves fail, and on other systems", async () => {
    const run = reply({ [COM]: 5, [APP]: 5, appx: 1 });
    assert.deepEqual(await probeOutlook(run, "win32"), {
      comRegistered: null,
      classicInstalled: null,
      newOutlook: null,
    });
    const throwing = async () => {
      throw new Error("spawn failed");
    };
    assert.deepEqual(await probeOutlook(throwing, "win32"), {
      comRegistered: null,
      classicInstalled: null,
      newOutlook: null,
    });
    assert.deepEqual(await probeOutlook(throwing, "linux"), {
      comRegistered: null,
      classicInstalled: null,
      newOutlook: null,
    });
  });
});

describe("OneDrive and the inbox folder", () => {
  const dirs = new Set([
    "C:\\Users\\me\\OneDrive - Contoso",
    "C:\\Users\\me\\OneDrive",
    "C:\\Users\\me\\OneDrive - Contoso\\PMO-Inbox",
  ]);
  const isDir = (p) => dirs.has(p);

  it("is signed in when a sync root variable points at a real folder", () => {
    const facts = oneDriveFacts(
      {
        OneDriveCommercial: "C:\\Users\\me\\OneDrive - Contoso",
        OneDrive: "C:\\Users\\me\\OneDrive - Contoso",
        ONEDRIVECONSUMER: "C:\\Users\\me\\OneDrive",
      },
      isDir,
    );
    assert.equal(facts.signedIn, true);
    assert.deepEqual(facts.roots, [
      "C:\\Users\\me\\OneDrive - Contoso",
      "C:\\Users\\me\\OneDrive",
    ]);
  });

  it("is not signed in without the variables or when the folder is gone", () => {
    assert.deepEqual(oneDriveFacts({}, isDir), { signedIn: false, roots: [] });
    assert.equal(oneDriveFacts({ OneDrive: "D:\\gone" }, isDir).signedIn, false);
  });

  it("suggests PMO-Inbox in the AI-OS folder of each root, an older one first, never the current one", () => {
    const facts = {
      signedIn: true,
      roots: ["C:\\Users\\me\\OneDrive", "C:\\Users\\me\\OneDrive - Contoso"],
    };
    assert.deepEqual(inboxSuggestions(facts, "C:\\somewhere\\else", isDir), [
      `C:\\Users\\me\\OneDrive - Contoso\\${INBOX_FOLDER_NAME}`,
      `C:\\Users\\me\\OneDrive\\AI-OS\\${INBOX_FOLDER_NAME}`,
      `C:\\Users\\me\\OneDrive - Contoso\\AI-OS\\${INBOX_FOLDER_NAME}`,
    ]);
    assert.deepEqual(
      inboxSuggestions(facts, `c:\\users\\me\\onedrive - contoso\\pmo-inbox`, isDir),
      [
        `C:\\Users\\me\\OneDrive\\AI-OS\\${INBOX_FOLDER_NAME}`,
        `C:\\Users\\me\\OneDrive - Contoso\\AI-OS\\${INBOX_FOLDER_NAME}`,
      ],
    );
  });

  it("accepts only an existing absolute folder", () => {
    const abs = (p) => /^[A-Za-z]:\\/.test(p);
    assert.deepEqual(validateInboxChoice('"C:\\Users\\me\\OneDrive"', isDir, abs), {
      ok: true,
      path: "C:\\Users\\me\\OneDrive",
    });
    assert.match(validateInboxChoice("", isDir, abs).reason, /Choose a folder/);
    assert.match(validateInboxChoice(7, isDir, abs).reason, /Choose a folder/);
    assert.match(validateInboxChoice("PMO-Inbox", isDir, abs).reason, /full path/);
    assert.match(validateInboxChoice("C:\\nope", isDir, abs).reason, /does not exist/);
  });
});

describe("saving the inbox choice", () => {
  const FOLDER = "D:/Mail/PMO-Inbox";
  const isDir = (p) => p === FOLDER;
  const abs = (p) => /^([A-Za-z]:[\\/]?|\\\\)/.test(p) || /^[A-Za-z]:$/.test(p);
  const SAFE = { home: "C:\\Users\\nobody", sampleJsonFiles: () => [] };
  const makeStore = () => {
    const saved = [];
    return {
      saved,
      loadConfig: async () => ({ inboxDir: "C:/old", retentionDays: 90 }),
      saveConfig: async (config) => void saved.push(config),
    };
  };

  it("keeps every other setting and replaces only the folder", async () => {
    const store = makeStore();
    const result = await saveInboxChoice({
      raw: FOLDER,
      env: {},
      store,
      isDirectory: isDir,
      isAbsolute: abs,
      safety: SAFE,
    });
    assert.deepEqual(result, { ok: true });
    assert.deepEqual(store.saved, [{ inboxDir: FOLDER, retentionDays: 90 }]);
  });

  it("saves nothing for a folder that is not there", async () => {
    const store = makeStore();
    const result = await saveInboxChoice({
      raw: "D:/nope",
      env: {},
      store,
      isDirectory: isDir,
      isAbsolute: abs,
      safety: SAFE,
    });
    assert.equal(result.ok, false);
    assert.deepEqual(store.saved, []);
  });

  it("refuses when the environment fixes the inbox", async () => {
    const store = makeStore();
    const result = await saveInboxChoice({
      raw: FOLDER,
      env: { AI_OS_PMO_INBOX_DIR: "E:/elsewhere" },
      store,
      isDirectory: isDir,
      isAbsolute: abs,
      safety: SAFE,
    });
    assert.match(result.reason, /AI_OS_PMO_INBOX_DIR/);
    assert.deepEqual(store.saved, []);
  });

  describe("D-3: folders that cannot be the inbox", () => {
    const HOME = "C:\\Users\\pat";
    const intake = '{"schema":"pmo-intake/1","source":"outlook"}';
    const attempt = async (raw, safety = {}, confirmNonEmpty = false) => {
      const store = makeStore();
      const result = await saveInboxChoice({
        raw,
        env: {},
        store,
        isDirectory: () => true,
        isAbsolute: abs,
        confirmNonEmpty,
        safety: {
          home: HOME,
          protectedDirs: [
            "C:\\Program Files\\PMO Desk",
            "C:\\Users\\pat\\AppData\\Local\\PMO Desk",
          ],
          libraryRoots: ["C:\\Users\\pat\\OneDrive - Deloitte"],
          sampleJsonFiles: () => [],
          ...safety,
        },
      });
      return { result, store };
    };

    for (const [label, raw, pattern] of [
      ["a drive root", "D:\\", /whole drive/],
      ["a drive root without slash", "D:", /whole drive/],
      ["a network share", "\\\\server\\share", /whole drive|network share/],
      ["the home folder", "c:/users/PAT/", /user folder/],
      ["Documents", "C:\\Users\\pat\\Documents", /Documents/],
      ["Desktop", "C:\\Users\\pat\\Desktop", /Desktop/],
      ["Downloads", "C:\\Users\\pat\\Downloads", /Downloads/],
      [
        "OneDrive Documents",
        "C:\\Users\\pat\\OneDrive - Deloitte\\Documents",
        /Documents/,
      ],
      ["the install folder", "C:\\Program Files\\PMO Desk", /PMO Desk itself/],
      ["C:\\Windows", "C:\\Windows", /Windows or program folder/],
      ["C:\\Windows\\System32", "c:/windows/system32/", /Windows or program folder/],
      [
        "Program Files (x86)",
        "D:\\Program Files (x86)\\Foo",
        /Windows or program folder/,
      ],
      ["ProgramData", "C:\\ProgramData", /Windows or program folder/],
      [
        "inside the data folder",
        "C:\\Users\\pat\\AppData\\Local\\PMO Desk\\pmo\\inbox",
        /PMO Desk itself/,
      ],
    ]) {
      it(`refuses ${label} with a plain reason and saves nothing`, async () => {
        const { result, store } = await attempt(raw);
        assert.equal(result.ok, false);
        assert.match(result.reason, pattern);
        assert.equal(result.needsConfirmation, undefined);
        assert.deepEqual(store.saved, []);
      });
    }

    it("a folder inside Documents is fine", async () => {
      const { result } = await attempt("C:\\Users\\pat\\Documents\\PMO-Inbox");
      assert.deepEqual(result, { ok: true });
    });

    it("refuses a folder holding other JSON unless confirmed, and names the files", async () => {
      const sample = () => [
        { name: "settings.json", text: '{"a":1}' },
        { name: "msg.json", text: intake },
      ];
      const first = await attempt("D:\\Stuff", { sampleJsonFiles: sample });
      assert.equal(first.result.ok, false);
      assert.equal(first.result.needsConfirmation, true);
      assert.match(first.result.reason, /1 JSON file/);
      assert.match(first.result.reason, /settings\.json/);
      assert.doesNotMatch(first.result.reason, /msg\.json/);
      assert.deepEqual(first.store.saved, []);

      const confirmed = await attempt("D:\\Stuff", { sampleJsonFiles: sample }, true);
      assert.deepEqual(confirmed.result, { ok: true });
      assert.equal(confirmed.store.saved.length, 1);
    });

    it("accepts a folder that holds only intake files (even broken ones)", async () => {
      const sample = () => [
        { name: "a.json", text: intake },
        { name: "b.json", text: '{"schema": "pmo-intake/1", "source": ' },
      ];
      const { result } = await attempt("D:\\Inbox", { sampleJsonFiles: sample });
      assert.deepEqual(result, { ok: true });
    });

    it("never lets confirmNonEmpty override a drive root or a known folder", async () => {
      const { result } = await attempt("D:\\", {}, true);
      assert.equal(result.ok, false);
    });
  });
});

describe("Job", () => {
  it("runs one at a time, keeps the latest progress and can be started again", async () => {
    const job = new Job(() => 42);
    assert.deepEqual(job.snapshot(), { running: false, progress: null, startedAt: null });
    let release;
    const gate = new Promise((resolve) => (release = resolve));
    let runs = 0;
    const first = job.start(async (update) => {
      runs += 1;
      update({ n: 1 });
      await gate;
      update({ n: 2 });
    });
    const second = job.start(async () => {
      runs += 1;
    });
    assert.equal(second, first, "a second start returns the running job");
    assert.deepEqual(job.snapshot(), {
      running: true,
      progress: { n: 1 },
      startedAt: 42,
    });
    release();
    await first;
    assert.deepEqual(job.snapshot(), {
      running: false,
      progress: { n: 2 },
      startedAt: 42,
    });
    await job.start(async (update) => update({ n: 3 }));
    assert.equal(runs, 1);
    assert.deepEqual(job.snapshot().progress, { n: 3 });
  });

  it("cancels through the signal and survives a failing run", async () => {
    const job = new Job();
    let sawAbort = false;
    const running = job.start(
      (update, signal) =>
        new Promise((resolve) => {
          signal.addEventListener("abort", () => {
            sawAbort = true;
            resolve();
          });
        }),
    );
    assert.equal(job.cancel(), true);
    await running;
    assert.equal(sawAbort, true);
    assert.equal(job.cancel(), false, "nothing left to cancel");
    await assert.rejects(
      job.start(async () => Promise.reject(new Error("boom"))),
      /boom/,
    );
    assert.equal(job.running, false);
  });

  it("the registry hands out one job per kind", () => {
    const registry = new JobRegistry();
    assert.equal(registry.job("selftest"), registry.job("selftest"));
    assert.notEqual(registry.job("selftest"), registry.job("pull-model"));
  });
});
