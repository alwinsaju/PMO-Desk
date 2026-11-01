// Run with `pnpm test`. The setup report: every state a computer can be in
// gets a plain sentence, the right buttons and no more.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildReport, missingRequired } from "./report.ts";

const GB = 1024 ** 3;

function facts(overrides = {}) {
  const base = {
    platform: "win32",
    ollama: {
      exe: "C:\\Ollama\\ollama.exe",
      running: true,
      version: "0.41.0",
      installedModels: ["gemma4:12b"],
      defaultModel: "gemma4:12b",
    },
    hardware: { totalRamBytes: 32 * GB, freeDiskBytes: 300 * 1e9 },
    outlook: { comRegistered: true, classicInstalled: true, newOutlook: false },
    engine: {
      python: "C:\\app\\resources\\python\\pythonw.exe",
      selfTest: {
        ok: true,
        python: "3.13.14",
        checks: [
          { id: "python", title: "Python runtime", ok: true, detail: "Python 3.13.14" },
        ],
      },
    },
  };
  return {
    ...base,
    ...overrides,
    ollama: { ...base.ollama, ...overrides.ollama },
    hardware: { ...base.hardware, ...overrides.hardware },
    outlook: { ...base.outlook, ...overrides.outlook },
    engine: { ...base.engine, ...overrides.engine },
  };
}

const check = (report, id) => report.checks.find((c) => c.id === id);
const NOW = () => new Date("2026-10-25T10:00:00Z");

describe("a fully set up computer", () => {
  const report = buildReport(facts(), NOW);

  it("is ready, with every check ok and nothing to do", () => {
    assert.equal(report.ready, true);
    assert.equal(report.generatedAt, "2026-10-25T10:00:00.000Z");
    assert.deepEqual(
      report.checks.map((c) => [c.id, c.state]),
      [
        ["ollama", "ok"],
        ["model", "ok"],
        ["engine", "ok"],
        ["outlook", "ok"],
      ],
    );
    assert.deepEqual(missingRequired(report), []);
    for (const id of ["ollama", "model", "outlook"])
      assert.deepEqual(check(report, id).steps, []);
  });

  it("marks only Outlook as optional", () => {
    assert.deepEqual(
      report.checks.filter((c) => !c.required).map((c) => c.id),
      ["outlook"],
    );
  });
});

describe("Ollama and the model", () => {
  it("offers the install when Ollama is missing, and holds the model back", () => {
    const report = buildReport(
      facts({
        ollama: { exe: null, running: false, version: null, installedModels: null },
      }),
      NOW,
    );
    assert.equal(check(report, "ollama").state, "missing");
    assert.deepEqual(check(report, "ollama").actions, ["install-ollama"]);
    assert.match(check(report, "ollama").steps.join(" "), /blocked on your network/);
    assert.equal(check(report, "model").state, "missing");
    assert.deepEqual(check(report, "model").actions, []);
    assert.equal(report.ready, false);
    assert.deepEqual(missingRequired(report), ["model", "ollama"]);
  });

  it("installed but not running is only a note", () => {
    const c = check(
      buildReport(facts({ ollama: { running: false, installedModels: null } }), NOW),
      "ollama",
    );
    assert.equal(c.state, "attention");
    assert.match(c.summary, /starts it when it is needed/);
  });

  it("asks for the model download when it is not there", () => {
    const c = check(
      buildReport(facts({ ollama: { installedModels: [] } }), NOW),
      "model",
    );
    assert.equal(c.state, "missing");
    assert.deepEqual(c.actions, ["pull-model"]);
    assert.match(c.steps[0], /large download.*12 GB.*carries on where it stopped/);
  });

  it("names the real download size of the model that will be downloaded", () => {
    const stepFor = (defaultModel) =>
      check(
        buildReport(facts({ ollama: { installedModels: [], defaultModel } }), NOW),
        "model",
      ).steps[0];
    assert.match(stepFor("qwen3.5:4b"), /about 3\.3 GB for qwen3\.5:4b/);
    assert.doesNotMatch(stepFor("qwen3.5:4b"), /12 GB/);
    assert.match(stepFor("llama3.2"), /of unknown size for llama3\.2/);
  });

  it("shows why the model differs from the one asked for", () => {
    const note = "Using qwen3.5:4b because gemma4:12b is not installed.";
    const c = check(
      buildReport(
        facts({
          ollama: {
            installedModels: ["qwen3.5:4b"],
            defaultModel: "qwen3.5:4b",
            modelNote: note,
          },
        }),
        NOW,
      ),
      "model",
    );
    assert.equal(c.state, "ok");
    assert.deepEqual(c.details, [note]);
  });

  it("cannot tell when Ollama is not answering, but still offers the download", () => {
    const c = check(
      buildReport(facts({ ollama: { running: false, installedModels: null } }), NOW),
      "model",
    );
    assert.equal(c.state, "unknown");
    assert.deepEqual(c.actions, ["pull-model"]);
  });

  it("warns about memory and offers the smaller model", () => {
    const c = check(
      buildReport(
        facts({ ollama: { installedModels: [] }, hardware: { totalRamBytes: 8 * GB } }),
        NOW,
      ),
      "model",
    );
    assert.deepEqual(c.actions, ["pull-model", "pull-fallback-model"]);
    assert.ok(c.details.some((d) => /8 GB of memory.*qwen3\.5:4b/.test(d)));
  });

  it("blocks the big download on a full disk and says how much is free", () => {
    const c = check(
      buildReport(
        facts({ ollama: { installedModels: [] }, hardware: { freeDiskBytes: 3e9 } }),
        NOW,
      ),
      "model",
    );
    assert.equal(c.state, "missing");
    assert.match(c.summary, /not enough free disk space.*3\.0 GB is free/);
    assert.deepEqual(c.actions, ["pull-model", "pull-fallback-model"]);
  });

  it("notices that only the fallback is installed", () => {
    const c = check(
      buildReport(facts({ ollama: { installedModels: ["qwen3.5:4b"] } }), NOW),
      "model",
    );
    assert.equal(c.state, "attention");
    assert.match(
      c.summary,
      /qwen3\.5:4b is installed, but AI OS is set up for gemma4:12b/,
    );
  });
});

describe("classic Outlook (report only)", () => {
  it("never blocks, whatever it finds", () => {
    for (const outlook of [
      { comRegistered: false, classicInstalled: false, newOutlook: true },
      { comRegistered: false, classicInstalled: false, newOutlook: false },
      { comRegistered: null, classicInstalled: null, newOutlook: null },
    ]) {
      assert.equal(buildReport(facts({ outlook }), NOW).ready, true);
    }
  });

  it("explains new Outlook has no COM and what to do", () => {
    const c = check(
      buildReport(
        facts({
          outlook: { comRegistered: false, classicInstalled: false, newOutlook: true },
        }),
        NOW,
      ),
      "outlook",
    );
    assert.equal(c.state, "attention");
    assert.match(c.summary, /Only the new Outlook is installed/);
    assert.match(c.steps.join(" "), /never opens your mailbox or sends anything/);
  });

  it("says classic Outlook was not found, and that only the four mail tasks need it", () => {
    const c = check(
      buildReport(
        facts({
          outlook: { comRegistered: false, classicInstalled: false, newOutlook: false },
        }),
        NOW,
      ),
      "outlook",
    );
    assert.match(
      c.summary,
      /Classic Outlook was not found.*everything else works without/,
    );
  });

  it("is unknown on other systems", () => {
    assert.equal(
      check(buildReport(facts({ platform: "linux" }), NOW), "outlook").state,
      "unknown",
    );
  });
});

describe("the engine self-test", () => {
  it("asks to be run when it has not been", () => {
    const c = check(buildReport(facts({ engine: { selfTest: null } }), NOW), "engine");
    assert.equal(c.state, "unknown");
    assert.deepEqual(c.actions, ["run-selftest"]);
    assert.equal(buildReport(facts({ engine: { selfTest: null } }), NOW).ready, false);
  });

  it("shows running, and lists every result when it fails", () => {
    assert.match(
      check(buildReport(facts({ engine: { selfTest: "running" } }), NOW), "engine")
        .summary,
      /Running the self-test/,
    );
    const failing = {
      ok: false,
      python: "3.13.14",
      checks: [
        { id: "python", title: "Python runtime", ok: true, detail: "Python 3.13.14" },
        {
          id: "packages",
          title: "Task packages",
          ok: false,
          detail: "ModuleNotFoundError: scipy",
        },
      ],
    };
    const c = check(buildReport(facts({ engine: { selfTest: failing } }), NOW), "engine");
    assert.equal(c.state, "missing");
    assert.match(c.summary, /self-test failed: Task packages/);
    assert.ok(c.details.includes("FAILED: Task packages - ModuleNotFoundError: scipy"));
    assert.deepEqual(c.actions, ["run-selftest"]);
  });

  it("reports a missing Python as a reinstall problem", () => {
    const c = check(
      buildReport(facts({ engine: { python: null, selfTest: null } }), NOW),
      "engine",
    );
    assert.equal(c.state, "missing");
    assert.match(c.steps[0], /Reinstall AI OS/);
  });
});

describe("the AI-OS folders in OneDrive", () => {
  const OD = "C:\\OneDrive";
  const all = { pmoInbox: true, staffExchange: true, ptoInbox: true };
  const withFolders = (folders) => buildReport(facts({ folders }), NOW);

  it("is left out when the facts do not include it", () => {
    assert.equal(check(buildReport(facts(), NOW), "folders"), undefined);
    assert.equal(check(buildReport(facts(), NOW), "flows"), undefined);
  });

  it("is fine when all three folders are there", () => {
    const c = check(
      withFolders({
        signedIn: true,
        oneDriveRoot: OD,
        aiOsRoot: `${OD}\\AI-OS`,
        found: all,
      }),
      "folders",
    );
    assert.equal(c.state, "ok");
    assert.equal(c.required, false);
    assert.deepEqual(c.actions, []);
    assert.ok(c.details.includes(`AI-OS folder: ${OD}\\AI-OS`));
  });

  it("offers to create what is missing, and names it", () => {
    const c = check(
      withFolders({
        signedIn: true,
        oneDriveRoot: OD,
        aiOsRoot: null,
        found: { ...all, ptoInbox: false, staffExchange: false },
      }),
      "folders",
    );
    assert.equal(c.state, "attention");
    assert.match(c.summary, /Staff-Exchange, PTO-Inbox are not in the AI-OS folder/);
    assert.deepEqual(c.actions, ["create-folders"]);
  });

  it("asks for OneDrive when it is not signed in, without blocking anything", () => {
    const report = withFolders({
      signedIn: false,
      oneDriveRoot: null,
      aiOsRoot: null,
      found: { pmoInbox: false, staffExchange: false, ptoInbox: false },
    });
    const c = check(report, "folders");
    assert.equal(c.state, "attention");
    assert.deepEqual(c.actions, []);
    assert.equal(report.ready, true);
  });
});

describe("the Power Automate flows", () => {
  const flows = (over = {}) => ({
    pto: { lastReceivedAt: null, waiting: 0, setAside: 0 },
    staff: { waiting: 0, oldestMinutes: null },
    ...over,
  });
  const run = (f) => check(buildReport(facts({ flows: f }), NOW), "flows");

  it("is unknown until a flow has delivered something, and never blocks", () => {
    const report = buildReport(facts({ flows: flows() }), NOW);
    const c = check(report, "flows");
    assert.equal(c.state, "unknown");
    assert.equal(c.required, false);
    assert.match(c.summary, /No flow has delivered anything yet/);
    assert.equal(report.ready, true);
  });

  it("is fine once PTO emails arrive and nothing is stuck", () => {
    const c = run(
      flows({
        pto: { lastReceivedAt: "2026-10-28T09:00:00.000Z", waiting: 0, setAside: 0 },
      }),
    );
    assert.equal(c.state, "ok");
    assert.ok(c.details.includes("PTO emails: last received 2026-10-28"));
  });

  it("warns when a profile request has waited too long", () => {
    const c = run(flows({ staff: { waiting: 2, oldestMinutes: 95 } }));
    assert.equal(c.state, "attention");
    assert.match(c.summary, /waited 95 minutes|waited 1 hours|waited 2 hours/);
    assert.match(c.summary, /M365 profile flow/);
  });

  it("does not warn about a request that has only just been made", () => {
    assert.equal(
      run(flows({ staff: { waiting: 1, oldestMinutes: 2 } })).state,
      "unknown",
    );
  });

  it("reports PTO emails that were set aside", () => {
    const c = run(
      flows({
        pto: { lastReceivedAt: "2026-10-28T09:00:00.000Z", waiting: 0, setAside: 3 },
      }),
    );
    assert.equal(c.state, "attention");
    assert.match(c.summary, /3 PTO emails were set aside/);
    assert.match(c.summary, /PTO-Inbox\\rejected/);
  });
});
