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
import { engineUrlFor, findRunningEngine, isTasksEngine, pickFreePort } from "./shared.ts";

const servers = [];

function serve(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    servers.push(server);
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
}

const engineHandler = (req, res) => {
  res.setHeader("content-type", "application/json");
  res.end(req.url === "/health" ? JSON.stringify({ ok: true, service: "tasks-engine" }) : "[]");
};

afterEach(async () => {
  delete process.env.AI_OS_TASKS_ENGINE_URL;
  delete process.env.AI_OS_TASKS_PYTHON;
  globalThis.aiOsTasksEngineUrl = undefined;
  await Promise.all(servers.splice(0).map((s) => new Promise((done) => s.close(done))));
});

describe("isTasksEngine", () => {
  it("is true only for a service that names itself tasks-engine", async () => {
    assert.equal(await isTasksEngine(await serve(engineHandler)), true);
  });

  it("is false for something else answering /health, an old service without it, or nothing", async () => {
    const other = await serve((req, res) => res.end(JSON.stringify({ ok: true, service: "other" })));
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
