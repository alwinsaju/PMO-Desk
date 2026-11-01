// Run with `pnpm test`. The Ollama install flow against fakes only: no download,
// no installer is ever started, no process is spawned.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OLLAMA_INSTALLER_ARGS,
  OLLAMA_INSTALLER_URL,
  describeDownloadFailure,
  installOllama,
  isOllamaSignature,
  manualInstallSteps,
  parseSignature,
} from "./ollamaInstall.ts";

const OLLAMA_SUBJECT = "CN=Ollama Inc., O=Ollama Inc., L=Toronto, S=Ontario, C=CA";
const signedBy = (subject, status = "Valid") => JSON.stringify({ status, subject });

function body(bytes, chunk = 4) {
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) return controller.close();
      controller.enqueue(bytes.slice(offset, offset + chunk));
      offset += chunk;
    },
  });
}

function setup(overrides = {}) {
  const log = { writes: [], runs: [], removed: [], progress: [], fetched: [] };
  const payload = new Uint8Array(20);
  const deps = {
    fetchImpl: async (url) => {
      log.fetched.push(url);
      return new Response(body(payload), {
        headers: { "content-length": String(payload.length) },
      });
    },
    makeTempDir: async () => "C:\\tmp\\ai-os-1",
    openWrite: async (path) => ({
      write: async (chunk) => log.writes.push([path, chunk.length]),
      close: async () => {},
    }),
    removeDir: async (path) => log.removed.push(path),
    joinPath: (dir, name) => `${dir}\\${name}`,
    run: async (command, args, options) => {
      log.runs.push({ command, args, options });
      if (command === "powershell.exe")
        return { status: 0, stdout: signedBy(OLLAMA_SUBJECT), stderr: "" };
      if (command.endsWith("OllamaSetup.exe"))
        return { status: 0, stdout: "", stderr: "" };
      if (args[0] === "--version")
        return { status: 0, stdout: "ollama version is 0.41.0", stderr: "" };
      throw new Error(`unexpected command ${command}`);
    },
    findOllama: () => "C:\\Users\\me\\AppData\\Local\\Programs\\Ollama\\ollama.exe",
    onProgress: (p) => log.progress.push(p),
    ...overrides,
  };
  return { deps, log };
}

describe("signature parsing", () => {
  it("accepts only a valid signature whose publisher is Ollama Inc.", () => {
    assert.deepEqual(parseSignature(signedBy(OLLAMA_SUBJECT)), {
      valid: true,
      publisher: "Ollama Inc.",
    });
    assert.equal(isOllamaSignature(parseSignature(signedBy(OLLAMA_SUBJECT))), true);
    assert.equal(
      isOllamaSignature(parseSignature(signedBy(OLLAMA_SUBJECT, "NotSigned"))),
      false,
    );
    assert.equal(
      isOllamaSignature(parseSignature(signedBy("CN=Somebody Else, O=X"))),
      false,
    );
    assert.equal(
      isOllamaSignature(parseSignature(signedBy("CN=Ollama Inc. Fake, O=X"))),
      false,
    );
    assert.deepEqual(parseSignature("garbage"), { valid: false, publisher: "" });
  });
});

describe("installOllama", () => {
  it("downloads the official installer, checks its signature, installs silently and verifies", async () => {
    const { deps, log } = setup();
    const outcome = await installOllama(deps);

    assert.equal(outcome.phase, "done");
    assert.equal(outcome.version, "0.41.0");
    assert.deepEqual(log.fetched, [OLLAMA_INSTALLER_URL]);
    assert.equal(
      log.writes.reduce((n, [, size]) => n + size, 0),
      20,
    );
    assert.ok(log.writes.every(([path]) => path === "C:\\tmp\\ai-os-1\\OllamaSetup.exe"));

    const [signature, installer, version] = log.runs;
    assert.equal(signature.command, "powershell.exe");
    assert.deepEqual(signature.options.env, {
      AI_OS_VERIFY_PATH: "C:\\tmp\\ai-os-1\\OllamaSetup.exe",
    });
    assert.equal(installer.command, "C:\\tmp\\ai-os-1\\OllamaSetup.exe");
    assert.deepEqual(installer.args, OLLAMA_INSTALLER_ARGS);
    assert.ok(installer.args.includes("/VERYSILENT"));
    assert.equal(version.args[0], "--version");
    assert.deepEqual(log.removed, ["C:\\tmp\\ai-os-1"]);

    const phases = log.progress.map((p) => p.phase);
    assert.deepEqual(
      [...new Set(phases)],
      ["downloading", "verifying", "installing", "checking", "done"],
    );
    assert.equal(
      log.progress.find((p) => p.phase === "downloading" && p.percent === 100)
        .downloadedBytes,
      20,
    );
  });

  it("falls back to manual steps when the download is blocked (proxy), and runs nothing", async () => {
    const { deps, log } = setup({
      fetchImpl: async () => {
        throw new TypeError("fetch failed");
      },
    });
    const outcome = await installOllama(deps);

    assert.equal(outcome.phase, "error");
    assert.match(outcome.message, /proxy may be blocking ollama\.com/);
    assert.deepEqual(outcome.manualSteps, manualInstallSteps());
    assert.match(outcome.manualSteps.join(" "), /OllamaSetup\.exe/);
    assert.deepEqual(log.runs, []);
    assert.deepEqual(log.removed, ["C:\\tmp\\ai-os-1"]);
  });

  it("treats a non-200 answer or a truncated download as a failed download", async () => {
    const refused = setup({
      fetchImpl: async () => new Response("denied", { status: 407 }),
    });
    const a = await installOllama(refused.deps);
    assert.match(a.message, /HTTP 407/);
    assert.ok(a.manualSteps);

    const short = setup({
      fetchImpl: async () =>
        new Response(body(new Uint8Array(8)), { headers: { "content-length": "20" } }),
    });
    const b = await installOllama(short.deps);
    assert.match(b.message, /ended early/);
    assert.deepEqual(short.log.runs, []);
  });

  it("never runs an installer with a bad or foreign signature", async () => {
    for (const stdout of [
      signedBy("", "NotSigned"),
      signedBy("CN=Somebody Else", "Valid"),
      signedBy(OLLAMA_SUBJECT, "HashMismatch"),
      "not json",
    ]) {
      const { deps, log } = setup({
        run: async (command, args, options) => {
          log.runs.push({ command, args, options });
          return { status: 0, stdout, stderr: "" };
        },
      });
      const outcome = await installOllama(deps);
      assert.equal(outcome.phase, "error", stdout);
      assert.match(outcome.message, /signature|signed by/);
      assert.equal(log.runs.length, 1, "only the signature check ran");
      assert.ok(outcome.manualSteps);
    }
  });

  it("reports an installer that fails or times out", async () => {
    for (const [status, pattern] of [
      [3, /stopped with code 3/],
      [null, /did not finish in time/],
    ]) {
      const { deps } = setup();
      const base = deps.run;
      deps.run = async (command, ...rest) =>
        command.endsWith("OllamaSetup.exe")
          ? { status, stdout: "", stderr: "" }
          : base(command, ...rest);
      const outcome = await installOllama(deps);
      assert.equal(outcome.phase, "error");
      assert.match(outcome.message, pattern);
    }
  });

  it("verifies afterwards: not found, or --version failing, is an error", async () => {
    const missing = await installOllama(setup({ findOllama: () => undefined }).deps);
    assert.match(missing.message, /not found afterwards/);

    const { deps } = setup();
    const base = deps.run;
    deps.run = async (command, args, options) =>
      args[0] === "--version"
        ? { status: 1, stdout: "", stderr: "boom" }
        : base(command, args, options);
    const broken = await installOllama(deps);
    assert.match(broken.message, /did not start when checked/);
  });

  it("can be cancelled during the download without a manual-install message", async () => {
    const controller = new AbortController();
    const { deps } = setup({
      signal: controller.signal,
      fetchImpl: async () => {
        controller.abort();
        throw new DOMException("aborted", "AbortError");
      },
    });
    const outcome = await installOllama(deps);
    assert.equal(outcome.message, "The installation was cancelled.");
    assert.equal(outcome.manualSteps, undefined);
  });
});

describe("download failures", () => {
  const withCode = (code) =>
    new TypeError("fetch failed", { cause: Object.assign(new Error("inner"), { code }) });

  it("names the network cause and the proxy setting", () => {
    for (const code of ["ECONNRESET", "CERT_HAS_EXPIRED", "ENOTFOUND", "ETIMEDOUT"]) {
      const message = describeDownloadFailure(withCode(code));
      assert.match(message, new RegExp(`fetch failed, ${code}\\)`));
      assert.match(
        message,
        /If your company uses a proxy, set HTTPS_PROXY and restart PMO Desk\./,
      );
    }
    assert.doesNotMatch(describeDownloadFailure(new Error("boom")), /, [A-Z_]{5,}\)/);
  });

  it("shows the cause in the install result", async () => {
    const { deps } = setup({
      fetchImpl: async () => {
        throw withCode("ECONNRESET");
      },
    });
    const outcome = await installOllama(deps);
    assert.match(outcome.message, /ECONNRESET/);
    assert.ok(outcome.manualSteps);
  });
});

describe("resuming an interrupted download", () => {
  const bytes = new Uint8Array(20).map((_, i) => i);
  const dropAfter = (count) => {
    let offset = 0;
    return new ReadableStream({
      pull(controller) {
        if (offset >= count) {
          return controller.error(
            Object.assign(new TypeError("terminated"), {
              cause: { code: "ECONNRESET" },
            }),
          );
        }
        controller.enqueue(bytes.slice(offset, offset + 4));
        offset += 4;
      },
    });
  };
  const track = (log) => ({
    openWrite: async (path, options) => {
      log.opens = [...(log.opens ?? []), options?.append === true];
      return {
        write: async (chunk) => log.writes.push([path, chunk.length]),
        close: async () => {},
      };
    },
  });

  it("asks for the rest with a Range request and appends it", async () => {
    const { deps, log } = setup();
    const requests = [];
    deps.fetchImpl = async (url, init) => {
      requests.push(init?.headers?.Range);
      return requests.length === 1
        ? new Response(dropAfter(8), { headers: { "content-length": "20" } })
        : new Response(body(bytes.slice(8)), {
            status: 206,
            headers: { "content-length": "12" },
          });
    };
    Object.assign(deps, track(log));
    const outcome = await installOllama(deps);

    assert.equal(outcome.phase, "done");
    assert.deepEqual(requests, [undefined, "bytes=8-"]);
    assert.deepEqual(log.opens, [false, true]);
    assert.equal(
      log.writes.reduce((n, [, size]) => n + size, 0),
      20,
    );
  });

  it("starts over when the server ignores Range", async () => {
    const { deps, log } = setup();
    let calls = 0;
    deps.fetchImpl = async () =>
      ++calls === 1
        ? new Response(dropAfter(8), { headers: { "content-length": "20" } })
        : new Response(body(bytes), { headers: { "content-length": "20" } });
    Object.assign(deps, track(log));
    const outcome = await installOllama(deps);

    assert.equal(outcome.phase, "done");
    assert.deepEqual(log.opens, [false, false]);
  });

  it("gives up after a few resumes and reports the cause", async () => {
    const { deps, log } = setup();
    let calls = 0;
    deps.fetchImpl = async () => {
      calls++;
      return new Response(dropAfter(8), { headers: { "content-length": "20" } });
    };
    Object.assign(deps, track(log));
    const outcome = await installOllama(deps);

    assert.equal(outcome.phase, "error");
    assert.equal(calls, 4);
    assert.match(outcome.message, /HTTPS_PROXY/);
    assert.deepEqual(log.runs, []);
  });

  it("does not resume a refusal", async () => {
    const { deps } = setup();
    let calls = 0;
    deps.fetchImpl = async () => {
      calls++;
      return new Response("no", { status: 407 });
    };
    await installOllama(deps);
    assert.equal(calls, 1);
  });
});
