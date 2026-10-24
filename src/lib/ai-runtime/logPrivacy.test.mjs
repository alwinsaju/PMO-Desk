// Run with `pnpm test`. Source scans: the session log can never carry a prompt,
// a model reply or a message body, and is never written to disk. These read the
// code, so a future edit that breaks the rule fails here even if no value test
// would notice.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (...parts) => path.join(here, "..", "..", ...parts);
const read = (file) => readFileSync(file, "utf8");

/** The text inside every `<name>(...)` call, balancing parentheses. */
function callArguments(source, name) {
  const out = [];
  let from = 0;
  for (;;) {
    const at = source.indexOf(name, from);
    if (at < 0) return out;
    let depth = 0;
    let i = at + name.length - 1; // the "("
    const start = i + 1;
    for (; i < source.length; i++) {
      if (source[i] === "(") depth++;
      else if (source[i] === ")" && --depth === 0) break;
    }
    out.push(source.slice(start, i));
    from = i;
  }
}

/** The text inside every `{ ... }` that follows `marker` (which ends in "{"). */
function braceBlocks(source, marker) {
  const out = [];
  let from = 0;
  for (;;) {
    const at = source.indexOf(marker, from);
    if (at < 0) return out;
    let depth = 0;
    let i = at + marker.length - 1;
    const start = i + 1;
    for (; i < source.length; i++) {
      if (source[i] === "{") depth++;
      else if (source[i] === "}" && --depth === 0) break;
    }
    out.push(source.slice(start, i));
    from = i;
  }
}

/** Strip comments and string literals, so only identifiers are left to look at. */
function identifiersOf(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""');
}

const RUNTIME_FILES = [
  "core.ts",
  "index.ts",
  "controls.ts",
  "lifecycle.ts",
  "modelWatch.ts",
];
const FORBIDDEN =
  /\b(prompt|messages|content|reply|response|raw|system|payload|output)\b/;

describe("nothing the model reads or writes reaches the log", () => {
  it("no emit() call in the runtime mentions a prompt, reply or message body", () => {
    let emits = 0;
    for (const file of RUNTIME_FILES) {
      const source = read(path.join(here, file));
      for (const args of callArguments(source, ".emit(")) {
        emits++;
        const idents = identifiersOf(args);
        const hit = FORBIDDEN.exec(idents);
        assert.equal(
          hit,
          null,
          `${file}: emit(${args.slice(0, 80)}...) mentions "${hit?.[0]}"`,
        );
      }
    }
    assert.ok(
      emits >= 12,
      `expected the runtime's emit sites to be scanned, found ${emits}`,
    );
  });

  it("error text in call-end comes from logMessage, which hides invalid-output detail", () => {
    const core = read(path.join(here, "core.ts"));
    assert.match(core, /const \{ code, message \} = logMessage\(error\)/);
    assert.match(core, /errorCode: code,\s*message,/);
    const index = read(path.join(here, "index.ts"));
    assert.match(
      index,
      /failWith: \(error: unknown\) => \{\s*const \{ code, message \} = logMessage\(error\)/,
    );
  });

  it("the event types have no field that could hold such text", () => {
    const log = read(path.join(here, "log.ts"));
    const block = log.slice(
      log.indexOf("export type AiLogBody"),
      log.indexOf("export type AiLogKind"),
    );
    assert.ok(block.length > 500);
    const fields = [...block.matchAll(/^\s+([a-zA-Z]+)\??:/gm)].map((m) => m[1]);
    assert.ok(fields.includes("label") && fields.includes("durationMs"));
    for (const field of fields) {
      assert.doesNotMatch(
        field,
        /^(prompt|content|reply|response|text|body|messages|system|raw|output|result|answer|issues)$/,
      );
    }
  });

  it("free text is cut to a short label / note / message at the ring buffer itself", () => {
    const log = read(path.join(here, "log.ts"));
    assert.match(log, /cleanText\(out\.label, LABEL_MAX\)/);
    assert.match(log, /cleanText\(out\.note, NOTE_MAX\)/);
    assert.match(log, /cleanText\(out\.message, MESSAGE_MAX\)/);
    assert.match(log, /export const LABEL_MAX = 60/);
  });

  it("the PMO call sites pass only a subject / title / period as the label", () => {
    const pmo = src("lib", "pmo", "server");
    const structure = read(path.join(pmo, "structure.ts"));
    const labels = [...structure.matchAll(/label: ([^,}]+)/g)].map((m) => m[1].trim());
    assert.deepEqual(labels, ["intake.subject", "intake.subject"]);
    assert.match(
      read(path.join(pmo, "chaserDrafts.ts")),
      /draftChaser\(\{ system, prompt, label \}\)/,
    );
    assert.match(
      read(path.join(pmo, "chaserDrafts.ts")),
      /waitingOn,\s*todo\.title,?\s*\)/,
    );
    assert.match(read(path.join(pmo, "signoffDrafts.ts")), /prompt, todo\.title\)/);
    assert.match(read(path.join(pmo, "reportDrafts.ts")), /label: job\.key\.replace/);

    // And inside aiGenerator's log options: label is the request's label, notes are counts.
    const generator = read(path.join(pmo, "aiGenerator.ts"));
    const blocks = braceBlocks(generator, "log: {");
    assert.ok(blocks.length >= 5, `found ${blocks.length} log option blocks`);
    for (const block of blocks) {
      const idents = identifiersOf(block);
      assert.doesNotMatch(idents, /\b(prompt|system)\b/);
      assert.match(block, /label/);
    }
  });

  it("the command route logs a fixed task and the app title, and only fixed error text", () => {
    const route = read(src("app", "api", "ai", "command", "route.ts"));
    assert.match(
      route,
      /startExternalCall\(\{\s*task: "command",\s*label: body\.focusedApp\.title,/,
    );
    for (const args of callArguments(route, "call.fail(")) {
      assert.doesNotMatch(
        identifiersOf(args),
        /\b(payload|body|response|content|text|prompt)\b/,
      );
    }
    assert.match(route, /keep_alive: call\.keepAlive/);
  });
});

describe("the log is never written to disk", () => {
  it("the log, tracker, controls, views and routes import no file-writing code", () => {
    const files = [
      path.join(here, "log.ts"),
      path.join(here, "modelWatch.ts"),
      path.join(here, "controls.ts"),
      path.join(here, "logView.ts"),
      path.join(here, "serverLog.ts"),
      path.join(here, "routeLogic.ts"),
      path.join(here, "types.ts"),
      src("app", "api", "ai", "runtime", "log", "route.ts"),
      src("app", "api", "ai", "runtime", "load", "route.ts"),
      src("app", "api", "ai", "runtime", "unload", "route.ts"),
      src("components", "ai-runtime", "api.ts"),
      src("components", "ai-runtime", "useModelLog.ts"),
    ];
    for (const file of files) {
      const code = identifiersOf(read(file));
      assert.doesNotMatch(
        read(file),
        /from "node:fs"|from "fs"/,
        `${path.basename(file)} imports fs`,
      );
      assert.doesNotMatch(
        code,
        /\b(writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|rmSync|unlink|unlinkSync|rename|renameSync|mkdirSync)\b/,
      );
      assert.doesNotMatch(code, /\b(localStorage|sessionStorage|indexedDB)\b/);
    }
  });

  it("the server-log reader opens files read-only, and only the fixed ones", () => {
    const index = read(path.join(here, "index.ts"));
    const fsImport = /import \{([^}]*)\} from "node:fs"/
      .exec(index)[1]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .sort();
    assert.deepEqual(fsImport, [
      "closeSync",
      "fstatSync",
      "openSync",
      "readSync",
      "statSync",
    ]);
    const opens = callArguments(index, "openSync(");
    assert.deepEqual(opens, ['file, "r"']);
    // The path comes from resolveServerLog (fixed locations), never from a request.
    assert.match(index, /readServerLogTail\(\s*resolveServerLog\(\{/);
    const route = read(src("app", "api", "ai", "runtime", "log", "route.ts"));
    assert.doesNotMatch(route, /searchParams\.get\("(path|file)"\)/);
  });
});

describe("the plain-English view words every event kind", () => {
  it("each kind in log.ts has a case in logView.ts", () => {
    const log = read(path.join(here, "log.ts"));
    const block = log.slice(
      log.indexOf("export type AiLogBody"),
      log.indexOf("export type AiLogKind"),
    );
    const kinds = [...block.matchAll(/kind: "([a-z-]+)"/g)].map((m) => m[1]);
    assert.ok(kinds.length >= 11, `found ${kinds.length} kinds`);
    const view = read(path.join(here, "logView.ts"));
    for (const kind of kinds)
      assert.match(view, new RegExp(`case "${kind}"`), `no plain wording for ${kind}`);
  });
});
