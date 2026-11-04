// Run with `pnpm test`. The ui-state file module against a throwaway data dir.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  MAX_BODY_BYTES,
  isUiStateKey,
  parsePutBody,
  readUiState,
  removeUiState,
  uiStatePath,
  writeUiState,
} from "./server.ts";

let dir;
let env;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "aios-uistate-"));
  env = { AI_OS_PMO_DATA_DIR: dir };
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("key allow-list", () => {
  it("accepts the allow-listed keys", () => {
    for (const key of [
      "notes",
      "pinned-apps",
      "installed-apps",
      "preferences",
      "appearance",
    ]) {
      assert.equal(isUiStateKey(key), true);
      assert.equal(uiStatePath(key, env), path.join(dir, "ui-state", `${key}.json`));
    }
  });

  it("keeps the appearance mirror apart from the preferences store", async () => {
    await writeUiState(
      "preferences",
      { state: { reducedMotion: true }, version: 1 },
      env,
    );
    await writeUiState("appearance", { theme: "dark", brand: "default" }, env);
    assert.deepEqual(await readUiState("preferences", env), {
      state: { reducedMotion: true },
      version: 1,
    });
    assert.deepEqual(await readUiState("appearance", env), {
      theme: "dark",
      brand: "default",
    });
  });

  it("rejects anything else", () => {
    for (const key of [
      "x",
      "../notes",
      "notes/../../x",
      "NOTES",
      "notes.json",
      "",
      "notes\\x",
    ]) {
      assert.equal(isUiStateKey(key), false, key);
      assert.equal(uiStatePath(key, env), null, key);
    }
  });

  it("never reads or writes for a rejected key", async () => {
    assert.equal(await readUiState("../notes", env), null);
    await assert.rejects(writeUiState("x", { a: 1 }, env));
    await assert.rejects(readdir(path.join(dir, "ui-state")));
  });
});

describe("read / write", () => {
  it("returns null when nothing is stored", async () => {
    assert.equal(await readUiState("notes", env), null);
  });

  it("round-trips objects and arrays", async () => {
    await writeUiState("notes", { state: { notes: [{ id: "1" }] }, version: 0 }, env);
    await writeUiState("pinned-apps", ["a", "b"], env);
    assert.deepEqual(await readUiState("notes", env), {
      state: { notes: [{ id: "1" }] },
      version: 0,
    });
    assert.deepEqual(await readUiState("pinned-apps", env), ["a", "b"]);
  });

  it("last write wins and leaves no temp files behind", async () => {
    await Promise.all([
      writeUiState("notes", { n: 1 }, env),
      writeUiState("notes", { n: 2 }, env),
      writeUiState("notes", { n: 3 }, env),
    ]);
    assert.deepEqual(await readUiState("notes", env), { n: 3 });
    assert.deepEqual(await readdir(path.join(dir, "ui-state")), ["notes.json"]);
  });

  it("returns null for a corrupt file", async () => {
    await mkdir(path.join(dir, "ui-state"), { recursive: true });
    await writeFile(path.join(dir, "ui-state", "notes.json"), '{"half":', "utf8");
    assert.equal(await readUiState("notes", env), null);
    await writeFile(path.join(dir, "ui-state", "notes.json"), "", "utf8");
    assert.equal(await readUiState("notes", env), null);
  });

  it("returns null for a file holding a non-object", async () => {
    await mkdir(path.join(dir, "ui-state"), { recursive: true });
    await writeFile(path.join(dir, "ui-state", "preferences.json"), "42", "utf8");
    assert.equal(await readUiState("preferences", env), null);
  });

  it("stores valid JSON on disk", async () => {
    await writeUiState("preferences", { theme: "dark" }, env);
    const text = await readFile(path.join(dir, "ui-state", "preferences.json"), "utf8");
    assert.deepEqual(JSON.parse(text), { theme: "dark" });
  });
});

describe("removeUiState", () => {
  it("deletes a stored key and tolerates a missing one", async () => {
    await writeUiState("notes", { n: 1 }, env);
    await removeUiState("notes", env);
    assert.equal(await readUiState("notes", env), null);
    await removeUiState("notes", env);
    await assert.rejects(removeUiState("../notes", env));
  });
});

describe("parsePutBody", () => {
  it("accepts { value: object | array }", () => {
    assert.deepEqual(parsePutBody('{"value":{"a":1}}'), { ok: true, value: { a: 1 } });
    assert.deepEqual(parsePutBody('{"value":[1,2]}'), { ok: true, value: [1, 2] });
  });

  it("rejects bodies over 1 MB with 413", () => {
    const big = JSON.stringify({ value: { blob: "x".repeat(MAX_BODY_BYTES) } });
    const result = parsePutBody(big);
    assert.equal(result.ok, false);
    assert.equal(result.status, 413);
  });

  it("measures bytes, not characters", () => {
    const text = JSON.stringify({ value: { blob: "é".repeat(MAX_BODY_BYTES / 2) } });
    assert.ok(text.length < MAX_BODY_BYTES);
    assert.equal(parsePutBody(text).status, 413);
  });

  it("rejects non-JSON and wrong shapes with 400", () => {
    for (const text of [
      "",
      "nope",
      "{}",
      '{"value":null}',
      '{"value":"s"}',
      '{"value":3}',
      "[1]",
    ]) {
      const result = parsePutBody(text);
      assert.equal(result.ok, false, text);
      assert.equal(result.status, 400, text);
    }
  });
});
