// Run with `pnpm test`. The Tasks engine's identity probe and URL discovery,
// against throw-away loopback servers only: nothing here starts the engine or
// touches a port the real one could be using.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { resolvePython } from "./python.ts";
import { getEngineAuth } from "../../../lib/tasks-engine/engineAuth.ts";
import {
  engineEnv,
  engineUrlFor,
  findRunningEngine,
  isTasksEngine,
  pickFreePort,
} from "./shared.ts";

const servers = [];

function serve(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    servers.push(server);
    server.listen(0, "127.0.0.1", () =>
      resolve(`http://127.0.0.1:${server.address().port}`),
    );
  });
}

const engineHandler = (req, res) => {
  res.setHeader("content-type", "application/json");
  res.end(
    req.url === "/health" ? JSON.stringify({ ok: true, service: "tasks-engine" }) : "[]",
  );
};

afterEach(async () => {
  delete process.env.AI_OS_TASKS_ENGINE_URL;
  delete process.env.AI_OS_TASKS_PYTHON;
  delete process.env.AI_OS_DESKTOP_MODE;
  globalThis.aiOsTasksEngineUrl = undefined;
  globalThis.aiOsEngineAuth = undefined;
  await Promise.all(servers.splice(0).map((s) => new Promise((done) => s.close(done))));
});

describe("isTasksEngine", () => {
  it("is true only for a service that names itself tasks-engine", async () => {
    assert.equal(await isTasksEngine(await serve(engineHandler)), true);
  });

  it("is false for something else answering /health, an old service without it, or nothing", async () => {
    const other = await serve((req, res) =>
      res.end(JSON.stringify({ ok: true, service: "other" })),
    );
    const old = await serve((req, res) => {
      res.statusCode = 404;
      res.end("not found");
    });
    const html = await serve((req, res) => res.end("<html></html>"));
    assert.equal(await isTasksEngine(other), false);
    assert.equal(await isTasksEngine(old), false);
    assert.equal(await isTasksEngine(html), false);
    assert.equal(await isTasksEngine("http://127.0.0.1:1"), false);
  });
});

describe("findRunningEngine", () => {
  it("uses AI_OS_TASKS_ENGINE_URL when an engine answers there", async () => {
    const url = await serve(engineHandler);
    process.env.AI_OS_TASKS_ENGINE_URL = `${url}/`;
    assert.equal(await findRunningEngine(), url);
  });

  it("returns null when the configured URL is dead, without scanning other ports", async () => {
    process.env.AI_OS_TASKS_ENGINE_URL = "http://127.0.0.1:1";
    assert.equal(await findRunningEngine(), null);
  });

  it("prefers the engine this server already launched", async () => {
    const url = await serve(engineHandler);
    globalThis.aiOsTasksEngineUrl = url;
    assert.equal(await findRunningEngine(), url);
  });
});

describe("engine identity and token", () => {
  /** An engine that reports `instance` and demands `token` on everything but /health. */
  const authedEngine = ({ instance, token }) =>
    serve((req, res) => {
      res.setHeader("content-type", "application/json");
      if (req.url === "/health") {
        return res.end(JSON.stringify({ ok: true, service: "tasks-engine", instance }));
      }
      if (req.headers["x-ai-os-token"] !== token) {
        res.statusCode = 403;
        return res.end("{}");
      }
      res.end("[]");
    });

  it("isTasksEngine can require a specific instance id", async () => {
    const url = await authedEngine({ instance: "abc", token: "t" });
    assert.equal(await isTasksEngine(url, "abc"), true);
    assert.equal(await isTasksEngine(url, "other"), false);
    assert.equal(await isTasksEngine(url), true);
    assert.equal(await isTasksEngine(await serve(engineHandler), "abc"), false);
  });

  it("desktop mode adopts only an engine reporting this process's instance id", async () => {
    process.env.AI_OS_DESKTOP_MODE = "1";
    const { instance, token } = getEngineAuth();
    const foreign = await authedEngine({ instance: "someone-else", token });
    const unnamed = await serve(engineHandler);
    globalThis.aiOsTasksEngineUrl = foreign;
    assert.notEqual(await findRunningEngine(), foreign);
    globalThis.aiOsTasksEngineUrl = unnamed;
    assert.notEqual(await findRunningEngine(), unnamed);

    const ours = await authedEngine({ instance, token });
    globalThis.aiOsTasksEngineUrl = ours;
    assert.equal(await findRunningEngine(), ours);
  });

  it("dev mode adopts an engine that accepts our token and skips one that refuses it", async () => {
    const { token } = getEngineAuth();
    const mine = await authedEngine({ instance: "x", token });
    const stale = await authedEngine({ instance: "x", token: "another-session" });
    globalThis.aiOsTasksEngineUrl = mine;
    assert.equal(await findRunningEngine(), mine);
    globalThis.aiOsTasksEngineUrl = stale;
    assert.notEqual(await findRunningEngine(), stale);
  });

  it("builds the engine env: no PYTHON*/TLS override, token and instance set", () => {
    const env = engineEnv({
      PATH: "p",
      PYTHONHOME: "x",
      pythonpath: "y",
      NODE_TLS_REJECT_UNAUTHORIZED: "0",
      NODE_EXTRA_CA_CERTS: "ca.pem",
      AI_OS_ENGINE_TOKEN: "stale",
    });
    const { token, instance } = getEngineAuth();
    assert.equal(env.PATH, "p");
    assert.equal(env.NODE_EXTRA_CA_CERTS, "ca.pem");
    assert.equal(env.PYTHONHOME, undefined);
    assert.equal(env.pythonpath, undefined);
    assert.equal(env.NODE_TLS_REJECT_UNAUTHORIZED, undefined);
    assert.equal(env.PYTHONNOUSERSITE, "1");
    assert.equal(env.AI_OS_ENGINE_TOKEN, token);
    assert.equal(env.AI_OS_ENGINE_INSTANCE, instance);
  });

  it("points task scripts at the template library folder", () => {
    const explicit = engineEnv({ AI_OS_TEMPLATES_DIR: "C:\\data\\tpl" });
    assert.equal(explicit.AI_OS_TEMPLATES_DIR, path.resolve("C:\\data\\tpl"));
    const derived = engineEnv({ AI_OS_PMO_DATA_DIR: "C:\\data\\pmo" });
    assert.equal(derived.AI_OS_TEMPLATES_DIR, path.join(path.resolve("C:\\data\\pmo"), "templates"));
  });
});

describe("pickFreePort", () => {
  it("returns a port in 8000-8019 that can really be bound on 127.0.0.1", async () => {
    const port = await pickFreePort();
    if (port === null) return; // every port in the range is taken on this machine
    assert.ok(port >= 8000 && port < 8020);
    await new Promise((resolve, reject) => {
      const probe = net.createServer();
      probe.once("error", reject);
      probe.listen(port, "127.0.0.1", () => probe.close(resolve));
    });
  });

  it("builds loopback URLs", () => {
    assert.equal(engineUrlFor(8123), "http://127.0.0.1:8123");
  });
});

describe("resolvePython", () => {
  it("honours AI_OS_TASKS_PYTHON only when the file exists", () => {
    const exe = path.join(mkdtempSync(path.join(tmpdir(), "ai-os-py-")), "python.exe");
    writeFileSync(exe, "");
    assert.equal(resolvePython({ AI_OS_TASKS_PYTHON: exe }), exe);
    assert.equal(resolvePython({ AI_OS_TASKS_PYTHON: `${exe}.missing` }), null);
  });
});
