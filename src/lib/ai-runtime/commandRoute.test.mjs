// Run with `pnpm test`. Source checks on /api/ai/command: it sends the shared
// keep_alive and its timeouts leave room for waking the sleeping model.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (...parts) => readFileSync(path.join(here, "..", "..", ...parts), "utf8");
const route = read("app", "api", "ai", "command", "route.ts");
const bar = read("components", "ai-layer", "CommandBar.tsx");
const num = (source, name) =>
  Number(new RegExp(`const ${name} = ([\\d_]+)`).exec(source)[1].replaceAll("_", ""));

describe("/api/ai/command", () => {
  it("sends the same keep_alive as the runtime (2 minutes by default), not Ollama's own", () => {
    assert.match(route, /keep_alive: call\.keepAlive/);
    assert.match(route, /startExternalCall\(/);
  });

  it("gives a command that must wake the model enough time, and the bar waits longer still", () => {
    const normal = num(route, "REQUEST_TIMEOUT_MS");
    const wake = num(route, "WAKE_TIMEOUT_MS");
    const client = num(bar, "CLIENT_TIMEOUT_MS");
    assert.ok(wake >= 120_000, "a wake (load) can take minutes on a cold disk cache");
    assert.ok(wake > normal);
    assert.ok(wake < 280_000, "under fetch's own 300 s silence limit");
    assert.ok(client > wake, "the route's timeout must be the one that fires first");
    assert.match(
      route,
      /call\.modelLoaded === true \? REQUEST_TIMEOUT_MS : WAKE_TIMEOUT_MS/,
    );
    assert.match(route, /AbortSignal\.timeout\(timeoutMs\)/);
  });
});
