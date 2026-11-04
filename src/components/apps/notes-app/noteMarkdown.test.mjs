import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_PREVIEW_CHARS,
  MAX_PREVIEW_LINES,
  MAX_TABLE_COLUMNS,
  MAX_TABLE_ROWS,
  parseInlineText,
  parseNote,
  safeLinkUrl,
} from "./noteMarkdown.ts";

/** Every link in an inline tree or block list, to check what could become an <a>. */
function linksIn(node, found = []) {
  if (Array.isArray(node)) {
    node.forEach((n) => linksIn(n, found));
  } else if (node && typeof node === "object") {
    if (node.kind === "link") found.push(node.href);
    Object.values(node).forEach((v) => {
      if (v && typeof v === "object") linksIn(v, found);
    });
  }
  return found;
}

/** The visible text of an inline tree. */
const textOf = (nodes) =>
  nodes
    .map((n) => (n.kind === "text" || n.kind === "code" ? n.text : textOf(n.children)))
    .join("");

describe("safeLinkUrl", () => {
  it("accepts http, https and mailto, returning the normalised address", () => {
    assert.equal(safeLinkUrl("https://example.com"), "https://example.com/");
    assert.equal(
      safeLinkUrl("  http://example.com/a?b=1#c "),
      "http://example.com/a?b=1#c",
    );
    assert.equal(safeLinkUrl("HTTPS://Example.COM/x"), "https://example.com/x");
    assert.equal(safeLinkUrl("mailto:pat@example.com"), "mailto:pat@example.com");
  });
  it("refuses every other scheme, in any spelling", () => {
    for (const bad of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      " javascript:alert(1)",
      "java\tscript:alert(1)",
      "java\nscript:alert(1)",
      "&#106;avascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "file:///C:/Windows/win.ini",
      "ftp://example.com",
      "tel:+441234",
      "blob:https://example.com/abc",
    ]) {
      assert.equal(safeLinkUrl(bad), null, bad);
    }
  });
  it("refuses relative, scheme-less and malformed addresses", () => {
    for (const bad of [
      "",
      "   ",
      "example.com",
      "/path",
      "//example.com",
      "http:example.com",
      "https://",
      "http://exa mple.com",
      "mailto:",
      "mailto:?subject=x",
    ]) {
      assert.equal(safeLinkUrl(bad), null, JSON.stringify(bad));
    }
    assert.equal(safeLinkUrl(undefined), null);
    assert.equal(safeLinkUrl(42), null);
    assert.equal(safeLinkUrl(null), null);
  });
  it("refuses addresses that carry a login, quotes, angle brackets, backslashes or control characters", () => {
    for (const bad of [
      "https://trusted.example@evil.example/",
      "https://user:pw@example.com",
      'https://example.com/"onmouseover="x',
      "https://example.com/<script>",
      "https://example.com\\@evil.example",
      "https://example.com/\u0000",
      "https://example.com/\u202e",
    ]) {
      const got = safeLinkUrl(bad);
      // The right-to-left override is not a control or space character; it is only encoded.
      if (bad.endsWith("\u202e")) assert.ok(got === null || !got.includes("\u202e"));
      else assert.equal(got, null, JSON.stringify(bad));
    }
  });
  it("refuses an address longer than 2048 characters", () => {
    assert.ok(safeLinkUrl(`https://example.com/${"a".repeat(2000)}`));
    assert.equal(safeLinkUrl(`https://example.com/${"a".repeat(2100)}`), null);
  });
});

describe("parseNote: blocks", () => {
  it("reads headings by level and ignores #tags and a missing space", () => {
    const { blocks } = parseNote("# One\n## Two\n###### Six\n#tag\n####### seven");
    assert.deepEqual(
      blocks.slice(0, 3).map((b) => [b.kind, b.level]),
      [
        ["heading", 1],
        ["heading", 2],
        ["heading", 6],
      ],
    );
    const rest = blocks[3];
    assert.equal(rest.kind, "paragraph");
    assert.equal(rest.lines.length, 2);
    assert.equal(textOf(rest.lines[0]), "#tag");
  });

  it("keeps each line of a paragraph and splits paragraphs at blank lines", () => {
    const { blocks } = parseNote("a\nb\n\n\nc");
    assert.equal(blocks.length, 2);
    assert.deepEqual(
      blocks[0].lines.map((l) => textOf(l)),
      ["a", "b"],
    );
  });

  it("handles Windows and old Mac line endings", () => {
    assert.equal(parseNote("a\r\nb\r\n\r\nc").blocks.length, 2);
    assert.equal(parseNote("a\rb").blocks[0].lines.length, 2);
  });

  it("reads bullets, numbers and checklist items, with their depth", () => {
    const { blocks } = parseNote(
      "- plain\n- [ ] todo\n- [x] done\n- [X] done too\n  - nested\n1. first\n2) second",
    );
    assert.equal(blocks.length, 1);
    const items = blocks[0].items;
    assert.deepEqual(
      items.map((i) => [i.marker, i.depth]),
      [
        ["bullet", 0],
        ["todo", 0],
        ["done", 0],
        ["done", 0],
        ["bullet", 1],
        ["number", 0],
        ["number", 0],
      ],
    );
    assert.equal(items[5].number, 1);
    assert.equal(items[6].number, 2);
  });

  it("treats the toolbar's empty checklist line as a checklist item", () => {
    const { blocks } = parseNote("- [ ] ");
    assert.equal(blocks[0].items[0].marker, "todo");
    assert.equal(parseNote("- [ ]").blocks[0].items[0].marker, "todo");
  });

  it("ends a paragraph at a list, heading, table or fence without a blank line", () => {
    const kinds = parseNote("text\n- item\nmore\n# Head\nafter").blocks.map(
      (b) => b.kind,
    );
    assert.deepEqual(kinds, ["paragraph", "list", "paragraph", "heading", "paragraph"]);
  });

  it("reads --- as a rule but not a bullet marker or a table row", () => {
    assert.deepEqual(
      parseNote("a\n\n---\n\n***").blocks.map((b) => b.kind),
      ["paragraph", "rule", "rule"],
    );
  });

  it("does not turn a bold line starting with ** into a bullet", () => {
    const { blocks } = parseNote("**Decision** made");
    assert.equal(blocks[0].kind, "paragraph");
  });
});

describe("parseNote: code blocks", () => {
  it("reads a fenced block verbatim, including markers that would otherwise format", () => {
    const { blocks } = parseNote(
      "```js\n# not a heading\n**not bold** <b>x</b>\n```\nafter",
    );
    assert.equal(blocks[0].kind, "code");
    assert.equal(blocks[0].language, "js");
    assert.equal(blocks[0].text, "# not a heading\n**not bold** <b>x</b>");
    assert.equal(blocks[0].closed, true);
    assert.equal(blocks[1].kind, "paragraph");
  });

  it("keeps blank lines and indentation inside the block", () => {
    const { blocks } = parseNote("```\n  a\n\n    b\n```");
    assert.equal(blocks[0].text, "  a\n\n    b");
  });

  it("reads an empty block (what the toolbar inserts)", () => {
    const { blocks } = parseNote("```\n\n```");
    assert.equal(blocks[0].kind, "code");
    assert.equal(blocks[0].text, "");
    assert.equal(blocks[0].closed, true);
  });

  it("runs an unclosed fence to the end of the note and says so", () => {
    const { blocks } = parseNote("intro\n```\nline 1\n- not a list\n| a | b |");
    assert.equal(blocks.length, 2);
    assert.equal(blocks[1].kind, "code");
    assert.equal(blocks[1].closed, false);
    assert.equal(blocks[1].text, "line 1\n- not a list\n| a | b |");
  });

  it("needs a closing fence at least as long as the opening one, of the same kind", () => {
    const longer = parseNote("````\n```\nstill code\n````\nout");
    assert.equal(longer.blocks[0].text, "```\nstill code");
    assert.equal(longer.blocks[1].kind, "paragraph");
    const tilde = parseNote("~~~\n```\n~~~");
    assert.equal(tilde.blocks[0].text, "```");
  });

  it("does not treat three backticks in a sentence as a fence", () => {
    const { blocks } = parseNote("```inline``` in a sentence");
    assert.equal(blocks[0].kind, "paragraph");
  });

  it("keeps only a short, plain language label", () => {
    assert.equal(parseNote("```c++ extra words\nx\n```").blocks[0].language, "c++");
    assert.equal(parseNote('```"><script>\nx\n```').blocks[0].language, "");
    assert.equal(
      parseNote("```" + "a".repeat(100) + "\nx\n```").blocks[0].language.length,
      20,
    );
  });
});

describe("parseNote: tables", () => {
  const cells = (row) => row.map((c) => textOf(c));

  it("reads a header, an alignment row and body rows", () => {
    const { blocks } = parseNote(
      "| Name | Qty | Note |\n| :--- | ---: | :-: |\n| Pens | 3 | ok |\n| Ink | 12 | low |",
    );
    assert.equal(blocks[0].kind, "table");
    assert.deepEqual(cells(blocks[0].header), ["Name", "Qty", "Note"]);
    assert.deepEqual(blocks[0].align, ["left", "right", "center"]);
    assert.deepEqual(blocks[0].rows.map(cells), [
      ["Pens", "3", "ok"],
      ["Ink", "12", "low"],
    ]);
  });

  it("reads the toolbar's skeleton as a table with empty cells", () => {
    const skeleton =
      "| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |";
    const { blocks } = parseNote(skeleton);
    assert.equal(blocks[0].kind, "table");
    assert.equal(blocks[0].rows.length, 2);
    assert.deepEqual(blocks[0].align, [null, null, null]);
    assert.deepEqual(cells(blocks[0].rows[0]), ["", "", ""]);
  });

  it("works without outer pipes", () => {
    const { blocks } = parseNote("a | b\n--- | ---\n1 | 2");
    assert.equal(blocks[0].kind, "table");
    assert.deepEqual(blocks[0].rows.map(cells), [["1", "2"]]);
  });

  it("pads short rows and cuts long ones to the header's width", () => {
    const { blocks } = parseNote(
      "| a | b | c |\n|---|---|---|\n| 1 |\n| 1 | 2 | 3 | 4 | 5 |\n|",
    );
    assert.deepEqual(blocks[0].rows.map(cells), [
      ["1", "", ""],
      ["1", "2", "3"],
      ["", "", ""],
    ]);
    for (const row of blocks[0].rows) assert.equal(row.length, 3);
  });

  it("keeps an escaped pipe inside its cell", () => {
    const { blocks } = parseNote("| a | b |\n|---|---|\n| x \\| y | z |");
    assert.deepEqual(cells(blocks[0].rows[0]), ["x | y", "z"]);
  });

  it("keeps empty cells at the end of a row that ends in a pipe", () => {
    const { blocks } = parseNote("| a | b |\n|---|---|\n| 1 | |");
    assert.deepEqual(cells(blocks[0].rows[0]), ["1", ""]);
  });

  it("reads formatting inside cells", () => {
    const { blocks } = parseNote(
      "| a | b |\n|---|---|\n| **bold** | [x](https://example.com) |",
    );
    assert.equal(blocks[0].rows[0][0][0].kind, "bold");
    assert.deepEqual(linksIn(blocks), ["https://example.com/"]);
  });

  it("ends at a blank line or a line with no pipe, and what follows is its own block", () => {
    const { blocks } = parseNote("| a |\n|---|\n| 1 |\nplain\n\n| 2 |");
    assert.deepEqual(
      blocks.map((b) => b.kind),
      ["table", "paragraph", "paragraph"],
    );
    assert.equal(blocks[0].rows.length, 1);
  });

  it("is not a table when the alignment row is missing or does not match the header", () => {
    assert.equal(parseNote("| a | b |\n| 1 | 2 |").blocks[0].kind, "paragraph");
    assert.equal(parseNote("| a | b |\n|---|").blocks[0].kind, "paragraph");
    assert.equal(parseNote("| a | b |\n| -- | x |").blocks[0].kind, "paragraph");
    assert.equal(parseNote("a | b\n---").blocks[0].kind, "paragraph");
  });

  it("is not a table inside a code block", () => {
    const { blocks } = parseNote("```\n| a |\n|---|\n```");
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].kind, "code");
  });

  it("refuses a header wider than the limit and caps the rows", () => {
    const wide = `${"|a".repeat(MAX_TABLE_COLUMNS + 1)}|\n${"|-".repeat(MAX_TABLE_COLUMNS + 1)}|`;
    assert.equal(parseNote(wide).blocks[0].kind, "paragraph");
    const tall = `| a |\n|---|\n${"| x |\n".repeat(MAX_TABLE_ROWS + 50)}`;
    const table = parseNote(tall).blocks[0];
    assert.equal(table.kind, "table");
    assert.equal(table.rows.length, MAX_TABLE_ROWS);
  });

  it("does not let a one-pipe-per-line note build a huge table", () => {
    const header = `${"|a".repeat(MAX_TABLE_COLUMNS)}|\n${"|-".repeat(MAX_TABLE_COLUMNS)}|\n`;
    const { blocks } = parseNote(header + "|\n".repeat(3000));
    const cellCount = blocks[0].rows.reduce((n, r) => n + r.length, 0);
    assert.ok(cellCount <= MAX_TABLE_COLUMNS * MAX_TABLE_ROWS);
  });
});

describe("parseInlineText: formatting", () => {
  it("reads bold, inline code and plain text together", () => {
    const nodes = parseInlineText("a **b** c `d` e");
    assert.deepEqual(
      nodes.map((n) => n.kind),
      ["text", "bold", "text", "code", "text"],
    );
    assert.equal(nodes[3].text, "d");
  });

  it("nests bold around code and links", () => {
    const nodes = parseInlineText("**see `x` and [y](https://example.com)**");
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].kind, "bold");
    assert.deepEqual(
      nodes[0].children.map((n) => n.kind),
      ["text", "code", "text", "link"],
    );
  });

  it("does not format inside inline code", () => {
    const nodes = parseInlineText("`**not bold** [x](https://example.com)`");
    assert.deepEqual(nodes, [
      { kind: "code", text: "**not bold** [x](https://example.com)" },
    ]);
  });

  it("leaves an unclosed marker as the characters typed", () => {
    for (const text of ["**open", "open**", "`open", "[open", "[open]("]) {
      const nodes = parseInlineText(text);
      assert.equal(textOf(nodes), text, text);
      assert.ok(
        nodes.every((n) => n.kind === "text"),
        text,
      );
    }
  });

  it("leaves a lone **, star runs and spaced stars alone", () => {
    for (const text of ["2 ** 3 ** 4", "****", "***x***", "a * b * c", "**  **"]) {
      const nodes = parseInlineText(text);
      assert.equal(textOf(nodes), text, text);
      assert.ok(
        nodes.every((n) => n.kind === "text"),
        text,
      );
    }
  });

  it("closes a second bold run on its own marker rather than nesting it", () => {
    const nodes = parseInlineText("**a** and **b**");
    assert.deepEqual(
      nodes.map((n) => n.kind),
      ["bold", "text", "bold"],
    );
  });

  it("supports a backslash before a marker to write it literally", () => {
    assert.equal(textOf(parseInlineText("\\*\\*x\\*\\* \\`y\\` \\[z]")), "**x** `y` [z]");
    assert.ok(parseInlineText("\\*\\*x\\*\\*").every((n) => n.kind === "text"));
  });

  it("leaves other backslashes alone (paths, UNC shares)", () => {
    assert.equal(
      textOf(parseInlineText("\\\\server\\share\\file.txt")),
      "\\\\server\\share\\file.txt",
    );
    assert.equal(textOf(parseInlineText("C:\\Users\\me")), "C:\\Users\\me");
  });

  it("matches a longer backtick run to a run of the same length", () => {
    const nodes = parseInlineText("``a ` b``");
    assert.deepEqual(nodes, [{ kind: "code", text: "a ` b" }]);
  });

  it("nests no deeper than a few levels of bold", () => {
    const deep = "**a **b **c **d **e** d** c** b** a**";
    const nodes = parseInlineText(deep);
    assert.equal(textOf(nodes).replace(/\*\*/g, ""), "a b c d e d c b a");
  });
});

describe("parseInlineText: links", () => {
  it("makes a link from [text](address) for web and mail addresses", () => {
    const nodes = parseInlineText(
      "go [here](https://example.com/a) or [mail](mailto:a@b.co)",
    );
    assert.deepEqual(linksIn(nodes), ["https://example.com/a", "mailto:a@b.co"]);
    assert.equal(textOf(nodes), "go here or mail");
  });

  it("allows parentheses inside the address", () => {
    const nodes = parseInlineText("[w](https://en.wikipedia.org/wiki/Foo_(bar)) next");
    assert.deepEqual(linksIn(nodes), ["https://en.wikipedia.org/wiki/Foo_(bar)"]);
    assert.equal(textOf(nodes), "w next");
  });

  it("shows the address as the text when the text is empty", () => {
    const nodes = parseInlineText("[](https://example.com)");
    assert.equal(textOf(nodes), "https://example.com");
    assert.equal(linksIn(nodes).length, 1);
  });

  it("makes bold text inside a link, but no link inside a link", () => {
    const bold = parseInlineText("[**big** text](https://a.example)");
    assert.equal(linksIn(bold).length, 1);
    assert.equal(bold[0].children[0].kind, "bold");
    // Inner brackets stop the outer link from being read; the inner one links on its own and the
    // leftover address is linked as a bare address, never as a link inside a link.
    const nodes = parseInlineText("[x [inner](https://a.example)](https://b.example)");
    assert.deepEqual(linksIn(nodes), ["https://a.example/", "https://b.example/"]);
    assert.ok(
      nodes.every((n) => n.kind !== "link" || n.children.every((c) => c.kind === "text")),
    );
    const nested = parseInlineText("[see https://a.example](https://b.example)");
    assert.deepEqual(linksIn(nested), ["https://b.example/"]);
    assert.equal(textOf(nested), "see https://a.example");
  });

  it("links bare web addresses and leaves sentence punctuation out", () => {
    const nodes = parseInlineText(
      "see https://example.com/a, then (http://x.example/b). Done!",
    );
    assert.deepEqual(linksIn(nodes), ["https://example.com/a", "http://x.example/b"]);
    assert.equal(
      textOf(nodes),
      "see https://example.com/a, then (http://x.example/b). Done!",
    );
  });

  it("keeps a closing parenthesis that belongs to the address", () => {
    const nodes = parseInlineText("https://en.wikipedia.org/wiki/Foo_(bar) x");
    assert.deepEqual(linksIn(nodes), ["https://en.wikipedia.org/wiki/Foo_(bar)"]);
  });

  it("does not link inside a word, or a bare scheme with no host", () => {
    assert.deepEqual(linksIn(parseInlineText("xhttps://example.com")), []);
    assert.deepEqual(linksIn(parseInlineText("https:// and http://")), []);
  });

  it("never links bare mail addresses or www. addresses", () => {
    assert.deepEqual(linksIn(parseInlineText("pat@example.com www.example.com")), []);
  });

  it("keeps a refused link as plain text, brackets and all", () => {
    for (const text of [
      "[click](javascript:alert(1))",
      "[click](JaVaScRiPt:alert(1))",
      "[click](data:text/html;base64,PHNjcmlwdD4=)",
      "[click](file:///C:/x)",
      "[click](/relative)",
      "[click](example.com)",
      "[click](https://user:pw@example.com)",
      "[click]( https://example.com)",
      "[click](https://exa mple.com)",
      '[click](https://example.com "title")',
    ]) {
      const nodes = parseInlineText(text);
      const hrefs = linksIn(nodes);
      for (const href of hrefs)
        assert.ok(/^(https?:|mailto:)/.test(href), `${text} -> ${href}`);
      assert.ok(!hrefs.some((h) => /javascript|data:|file:/i.test(h)), text);
      assert.ok(textOf(nodes).startsWith("[click]"), text);
    }
  });

  it("does not link text hidden by an image or reference style", () => {
    assert.deepEqual(linksIn(parseInlineText("[ref][1]\n\n[1]: https://x.example")), [
      "https://x.example/",
    ]);
  });

  it("only ever produces http, https or mailto links, whatever the note says", () => {
    const hostile = [
      '[a](javascript:alert(1)) <a href="javascript:alert(1)">x</a>',
      "<img src=x onerror=alert(1)> [b](https://ok.example) javascript:alert(1)",
      "[c](  javascript:alert(1))",
      "[d](java\u0000script:alert(1))",
      "[e](\u0001javascript:alert(1))",
      "[f](https://ok.example/\u0007)",
      "[g](&#x6A;avascript:alert(1))",
      "[h](%6Aavascript:alert(1))",
      "[i](https://ok.example)[j](vbscript:x)[k](data:,x)",
    ];
    for (const line of hostile) {
      for (const href of linksIn(parseNote(line).blocks)) {
        assert.ok(/^(https?:\/\/|mailto:)/.test(href), `${line} -> ${href}`);
        assert.ok(!/[\s\u0000-\u001f<>"]/.test(href), `${line} -> ${href}`);
      }
    }
  });
});

describe("parseNote: HTML-looking text and hostile input", () => {
  it("keeps tags, entities and scripts as plain text nodes", () => {
    const html = '<script>alert(1)</script> <b>x</b> &lt;i&gt; <img src=x onerror="y">';
    const { blocks } = parseNote(html);
    assert.equal(blocks.length, 1);
    assert.equal(textOf(blocks[0].lines[0]), html);
    assert.deepEqual(linksIn(blocks), []);
  });

  it("keeps HTML in headings, lists, tables and code as text too", () => {
    const { blocks } = parseNote(
      "# <h1>x</h1>\n- <b>y</b>\n\n| <i>a</i> |\n|---|\n| <u>b</u> |\n\n```\n<div>\n```",
    );
    assert.equal(textOf(blocks[0].children), "<h1>x</h1>");
    assert.equal(textOf(blocks[1].items[0].children), "<b>y</b>");
    assert.equal(textOf(blocks[2].header[0]), "<i>a</i>");
    assert.equal(textOf(blocks[2].rows[0][0]), "<u>b</u>");
    assert.equal(blocks[3].text, "<div>");
  });

  it("returns only plain data: kinds from a fixed set and strings, no functions or html fields", () => {
    const tree = parseNote(
      "# a\n\n- b\n\n| c |\n|---|\n| d |\n\n```\ne\n```\n\n[f](https://g.example)",
    );
    const walk = (v) => {
      if (Array.isArray(v)) return v.forEach(walk);
      if (v && typeof v === "object") {
        assert.ok(!("html" in v) && !("dangerouslySetInnerHTML" in v));
        Object.values(v).forEach(walk);
      } else {
        assert.ok(v === null || ["string", "number", "boolean"].includes(typeof v));
      }
    };
    walk(tree);
  });

  it("copes with empty, blank, null and non-string content", () => {
    assert.deepEqual(parseNote("").blocks, []);
    assert.deepEqual(parseNote("  \n \t\n").blocks, []);
    assert.deepEqual(parseNote(undefined).blocks, []);
    assert.deepEqual(parseNote(null).blocks, []);
    assert.deepEqual(parseNote(42).blocks, []);
  });

  it("existing notes written with the old toolbar read as before", () => {
    const { blocks } = parseNote(
      "# Plan\n- [ ] call Sam\n- [x] send **minutes**\n\nplain text",
    );
    assert.deepEqual(
      blocks.map((b) => b.kind),
      ["heading", "list", "paragraph"],
    );
    assert.equal(blocks[1].items[1].children[1].kind, "bold");
  });
});

describe("parseNote: very long input", () => {
  it("cuts a huge note at the limit, at a line boundary, and says so", () => {
    const line = "word ".repeat(19) + "end";
    const note = Array.from({ length: 5000 }, () => line).join("\n");
    assert.ok(note.length > MAX_PREVIEW_CHARS);
    const parsed = parseNote(note);
    assert.equal(parsed.truncated, true);
    const shown = parsed.blocks[0].lines;
    assert.ok(shown.length <= MAX_PREVIEW_LINES);
    for (const l of shown) assert.equal(textOf(l), line);
  });

  it("cuts a note with too many lines", () => {
    const parsed = parseNote("a\n".repeat(MAX_PREVIEW_LINES + 100));
    assert.equal(parsed.truncated, true);
    assert.equal(parsed.blocks[0].lines.length, MAX_PREVIEW_LINES);
  });

  it("does not flag a note that fits", () => {
    assert.equal(parseNote("short").truncated, false);
  });

  it("reads one enormous line without losing text", () => {
    const line = "lorem ipsum ".repeat(7000);
    const nodes = parseInlineText(line);
    assert.equal(textOf(nodes), line);
  });

  it("reads a long unbroken run of characters", () => {
    const text = "a".repeat(50_000);
    assert.equal(textOf(parseInlineText(text)), text);
  });

  it("stays fast on input built to defeat naive matching", () => {
    const attacks = [
      "[".repeat(50_000),
      "[a](".repeat(12_000),
      "**a ".repeat(25_000),
      "`".repeat(50_000),
      "`a``b```c".repeat(5_000),
      "[a](https://x.example/".repeat(3_000),
      "* ".repeat(40_000),
      "|".repeat(60_000),
      "| a | b |\n|---|---|\n".repeat(4_000),
      "http://".repeat(14_000),
      "(".repeat(60_000),
      "https://a.example/(".repeat(5_000),
    ];
    for (const attack of attacks) {
      const started = Date.now();
      const parsed = parseNote(attack);
      assert.ok(Array.isArray(parsed.blocks));
      assert.ok(Date.now() - started < 3000, `slow: ${attack.slice(0, 20)}`);
    }
  });

  it("keeps list depth bounded however far a line is indented", () => {
    const { blocks } = parseNote(`${" ".repeat(400)}- deep`);
    assert.ok(blocks[0].items[0].depth <= 5);
  });
});
