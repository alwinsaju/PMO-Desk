// Run with `pnpm test`. Slash shortcuts in the command bar: they become sentences the
// existing routers already understand, and never reach the model.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SLASH_COMMANDS,
  isSlashInput,
  resolveSlash,
  slashSuggestions,
} from "./slashCommands.ts";
import { resolveLocalIntent } from "./localIntent.ts";
import { resolvePmoIntent } from "./pmoIntent.ts";
import { resolveOpenIntent } from "./windowIntent.ts";

const run = (text) => resolveSlash(text);

describe("resolveSlash: commands become sentences the routers understand", () => {
  it("/todo creates a to-do from the rest of the line", () => {
    const r = run("/todo buy milk Fri");
    assert.equal(r.kind, "run");
    assert.equal(r.prompt, "remind me to buy milk Fri");
    assert.deepEqual(resolveLocalIntent(r.prompt), {
      kind: "create_todo",
      text: "buy milk Fri",
    });
  });

  it("/open opens a known app", () => {
    const r = run("/open staff");
    assert.equal(r.kind, "run");
    assert.equal(r.prompt, "open staff");
    assert.equal(resolveOpenIntent(r.prompt), "staff");
  });

  it("/overdue, /chasers, /todos, /status, /changes, /off and /back are PMO questions", () => {
    const cases = [
      ["/overdue", { kind: "pmo_status", topic: "overdue" }],
      ["/chasers", { kind: "pmo_status", topic: "chasers" }],
      ["/todos", { kind: "pmo_status", topic: "open" }],
      ["/status", { kind: "pmo_status", topic: "summary" }],
      ["/changes", { kind: "changes", since: "yesterday" }],
      ["/changes last friday", { kind: "changes", since: "last friday" }],
      ["/off", { kind: "whos_off", when: "this week" }],
      ["/off next Monday", { kind: "whos_off", when: "next Monday" }],
      ["/back Ana", { kind: "person_back", name: "Ana" }],
    ];
    for (const [text, intent] of cases) {
      const r = run(text);
      assert.equal(r.kind, "run", text);
      assert.deepEqual(resolvePmoIntent(r.prompt), intent, text);
    }
  });

  it("/snooze, /done and /chase are to-do actions", () => {
    assert.deepEqual(resolveLocalIntent(run("/snooze invoice to Monday").prompt), {
      kind: "todo_action",
      action: "snooze",
      query: "invoice",
      until: "Monday",
    });
    assert.deepEqual(resolveLocalIntent(run("/done send the deck").prompt), {
      kind: "todo_action",
      action: "done",
      query: "send the deck",
      until: "",
    });
    assert.deepEqual(resolveLocalIntent(run("/chase Ana on the invoice").prompt), {
      kind: "todo_action",
      action: "chase",
      query: "invoice",
      until: "Ana",
    });
  });

  it("/focus, /focus 40, /focus off and /explain map to local intents", () => {
    assert.equal(resolveLocalIntent(run("/focus").prompt).kind, "focus");
    assert.deepEqual(resolveLocalIntent(run("/focus 40").prompt), {
      kind: "focus",
      minutes: 40,
    });
    assert.deepEqual(resolveLocalIntent(run("/focus off").prompt), {
      kind: "focus",
      minutes: 0,
    });
    assert.deepEqual(resolveLocalIntent(run("/explain").prompt), { kind: "explain" });
  });

  it("every command's own example, with typical text, is understood by a router", () => {
    for (const command of SLASH_COMMANDS) {
      const args = command.takesText
        ? {
            todo: "send the deck Fri",
            open: "notes",
            off: "tomorrow",
            changes: "yesterday",
            back: "Ana",
            snooze: "invoice to Friday",
            done: "send the deck",
            chase: "Ana on the invoice",
            focus: "25",
          }[command.name]
        : "";
      const r = run(`/${command.name} ${args}`);
      assert.equal(r.kind, "run", command.name);
      assert.ok(
        resolveOpenIntent(r.prompt) ||
          resolveLocalIntent(r.prompt) ||
          resolvePmoIntent(r.prompt),
        command.name,
      );
    }
  });

  it("is case-insensitive on the command, keeps the case of the text, and takes aliases", () => {
    assert.equal(run("/TODO Call Ana").prompt, "remind me to Call Ana");
    assert.equal(run("/remind call Ana").prompt, "remind me to call Ana");
    assert.equal(run("  /Open   Notes ").prompt, "open Notes");
    assert.equal(run("/away friday").kind, "run");
  });

  it("collapses spaces and keeps the command name for the log", () => {
    const r = run("/todo   buy    milk");
    assert.equal(r.prompt, "remind me to buy milk");
    assert.equal(r.command, "todo");
  });
});

describe("resolveSlash: messages, never the model", () => {
  it("a command that needs text and has none shows its usage", () => {
    assert.deepEqual(run("/todo"), { kind: "say", text: "Usage: /todo <what> [day]" });
    assert.deepEqual(run("/open"), { kind: "say", text: "Usage: /open <app>" });
    assert.deepEqual(run("/back"), { kind: "say", text: "Usage: /back <person>" });
  });

  it("a chase without 'on <to-do>' and a bad focus length show usage", () => {
    assert.equal(run("/chase Ana").kind, "say");
    assert.match(run("/chase Ana").text, /^Usage: \/chase/);
    assert.match(run("/focus soon").text, /^Usage: \/focus/);
  });

  it("an unknown app says so and offers the closest one", () => {
    const near = run("/open staf");
    assert.equal(near.kind, "say");
    assert.match(near.text, /Did you mean \/open staff\?/);
    const far = run("/open qqqqqqq");
    assert.match(far.text, /don't know an app called "qqqqqqq"/);
    assert.doesNotMatch(far.text, /Did you mean/);
  });

  it("an unknown command says did-you-mean for a near spelling or a prefix", () => {
    assert.match(
      run("/tdo buy milk").text,
      /There is no \/tdo command\. Did you mean \/todo\?/,
    );
    assert.match(run("/ovrdue").text, /Did you mean \/overdue\?/);
    assert.match(run("/ov").text, /Did you mean \/overdue\?/);
    assert.match(run("/chaser").text, /Did you mean \/chasers\?/);
    assert.equal(run("/tdo").kind, "say");
  });

  it("an unknown command with nothing near still answers plainly", () => {
    const r = run("/qwertyuiop");
    assert.equal(r.kind, "say");
    assert.equal(r.text, "There is no /qwertyuiop command. Type / to see them all.");
  });

  it("a bare / and /help list the commands", () => {
    for (const text of ["/", " / ", "/help"]) {
      const r = run(text);
      assert.equal(r.kind, "say", text);
      assert.match(r.text, /\/todo, \/open, \/overdue/);
    }
  });

  it("never returns a run for a sentence the routers would leave to the model", () => {
    for (const text of ["/todo", "/chase x", "/focus x", "/open", "/zzz", "/"]) {
      assert.notEqual(run(text).kind, "run", text);
    }
  });
});

describe("resolveSlash: ordinary text is left alone", () => {
  it("does not touch questions, paths, or a slash that does not start a command", () => {
    for (const text of [
      "what's overdue?",
      "remind me to call Ana",
      "/usr/bin/node",
      "/ not a command",
      "//",
      "/12",
      "and/or",
      "",
      "   ",
    ]) {
      assert.deepEqual(run(text), { kind: "none" }, JSON.stringify(text));
    }
  });
});

describe("isSlashInput", () => {
  it("is true when the text starts with a slash, ignoring leading spaces", () => {
    assert.equal(isSlashInput("/"), true);
    assert.equal(isSlashInput("  /to"), true);
    assert.equal(isSlashInput("open /staff"), false);
    assert.equal(isSlashInput(""), false);
  });
});

describe("slashSuggestions", () => {
  it("a bare / offers the commands, todo first", () => {
    const list = slashSuggestions("/");
    assert.equal(list[0].text, "/todo ");
    assert.equal(list[0].hint, "add a to-do");
    assert.deepEqual(list.map((s) => s.text).slice(0, 4), [
      "/todo ",
      "/open ",
      "/overdue",
      "/chasers",
    ]);
    // Every command is listed (no cap), /focus and /explain included.
    assert.deepEqual(
      list.map((s) => s.text.trim().slice(1)),
      SLASH_COMMANDS.map((c) => c.name),
    );
    assert.ok(list.some((s) => s.text === "/focus "));
  });

  it("narrows to commands that start with what is typed, including aliases", () => {
    assert.deepEqual(
      slashSuggestions("/o").map((s) => s.text),
      ["/open ", "/overdue", "/off "],
    );
    assert.deepEqual(
      slashSuggestions("/rem").map((s) => s.text),
      ["/todo "],
    );
  });

  it("a command that takes text ends in a space so the text can follow", () => {
    assert.equal(slashSuggestions("/ope")[0].text, "/open ");
    assert.equal(slashSuggestions("/overd")[0].text, "/overdue");
  });

  it("offers nothing once arguments are being typed, or for a complete no-text command", () => {
    assert.deepEqual(slashSuggestions("/todo "), []);
    assert.deepEqual(slashSuggestions("/todo buy milk"), []);
    assert.deepEqual(slashSuggestions("/overdue"), []);
  });

  it("a mistyped command suggests the nearest one", () => {
    assert.deepEqual(
      slashSuggestions("/tdo").map((s) => s.text),
      ["/todo "],
    );
    assert.deepEqual(slashSuggestions("/qwertyuiop"), []);
  });

  it("ignores text that is not a slash command", () => {
    assert.deepEqual(slashSuggestions("what"), []);
    assert.deepEqual(slashSuggestions("a/b"), []);
    assert.deepEqual(slashSuggestions(""), []);
  });
});
