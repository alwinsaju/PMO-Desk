// The Notes preview's markdown reader, as pure functions. A note stays plain text; this turns that
// text into a small tree (headings, paragraphs, bullet / numbered / checklist items, fenced code,
// tables, rules; bold, inline code and links) that NotePreview.tsx draws as React elements.
//
// Safety rules, on purpose:
//  - Nothing here produces HTML. Every piece of text stays a string in the tree and React escapes
//    it, so "<script>" in a note is shown as the characters it is.
//  - A link is only made when `safeLinkUrl` accepts the address: http, https or mailto, no
//    whitespace or control characters, no user:password@ part, at most 2048 characters. A
//    javascript:, data:, file: or relative address stays plain text, brackets and all.
//  - Reading is one pass with bounded look-ahead, and the input, line, line-length, table size and
//    nesting are capped, so a huge or hostile note cannot hang the window or flood the page.

export type InlineNode =
  | { kind: "text"; text: string }
  | { kind: "bold"; children: InlineNode[] }
  | { kind: "code"; text: string }
  | { kind: "link"; href: string; children: InlineNode[] };

export type TableAlign = "left" | "center" | "right" | null;

export type ListMarker = "bullet" | "number" | "todo" | "done";

export interface ListItem {
  depth: number;
  marker: ListMarker;
  /** The number as written, for a numbered item. */
  number?: number;
  children: InlineNode[];
}

export type Block =
  | { kind: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; children: InlineNode[] }
  | { kind: "paragraph"; lines: InlineNode[][] }
  | { kind: "code"; language: string; text: string; closed: boolean }
  | { kind: "list"; items: ListItem[] }
  | {
      kind: "table";
      align: TableAlign[];
      header: InlineNode[][];
      rows: InlineNode[][][];
    }
  | { kind: "rule" };

export interface ParsedNote {
  blocks: Block[];
  /** True when the note was longer than the preview reads; the rest is only in the editor. */
  truncated: boolean;
}

/** Limits; the preview reads at most this much of a note. */
export const MAX_PREVIEW_CHARS = 100_000;
export const MAX_PREVIEW_LINES = 4_000;
export const MAX_URL_CHARS = 2_048;
export const MAX_TABLE_COLUMNS = 20;
export const MAX_TABLE_ROWS = 500;
/** A longer line is read in pieces of about this size, which bounds the look-ahead below. */
export const MAX_INLINE_CHARS = 4_000;
const MAX_NESTING = 3;
const MAX_LINK_TEXT = 500;
const MAX_LIST_DEPTH = 5;

// ---------------------------------------------------------------- links

/** Whitespace and control characters (URL parsers silently drop some), line and paragraph
 *  separators, backslashes, and the characters that could end an attribute or start a tag. */
function hasUnsafeChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x20 || (code >= 0x7f && code <= 0x9f)) return true;
    if (code === 0x2028 || code === 0x2029) return true;
    if (code === 0x5c || code === 0x3c || code === 0x3e || code === 0x22) return true;
  }
  return false;
}

/**
 * The address to link to, or null when it is not one the preview may link. Only http(s) and mailto:
 * qualify (the same schemes the desktop shell hands to the OS, desktop/url-guard.cjs). The result is
 * the parsed, normalised address, so what is linked is exactly what was checked.
 */
export function safeLinkUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value || value.length > MAX_URL_CHARS) return null;
  if (!/^(?:https?:\/\/|mailto:)/i.test(value)) return null;
  if (hasUnsafeChar(value)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol === "http:" || url.protocol === "https:") {
    // https://trusted.example@evil.example looks like one site and is another.
    if (!url.hostname || url.username || url.password) return null;
    return url.href;
  }
  if (url.protocol === "mailto:") return url.pathname ? url.href : null;
  return null;
}

// --------------------------------------------------------------- inline

const isWordChar = (ch: string | undefined): boolean =>
  ch !== undefined && /[\p{L}\p{N}_]/u.test(ch);
const isSpace = (ch: string | undefined): boolean => ch === undefined || /\s/.test(ch);

/** Reads a link written as [text](address); returns the end index, or null when it is not one. */
function readBracketLink(
  text: string,
  at: number,
): { end: number; label: string; url: string } | null {
  let j = at + 1;
  const limit = Math.min(text.length, at + 1 + MAX_LINK_TEXT);
  while (j < limit && text[j] !== "]" && text[j] !== "[") j++;
  if (j >= limit || text[j] !== "]" || text[j + 1] !== "(") return null;
  // The address runs to the matching ")" (one level of parentheses inside is allowed).
  let k = j + 2;
  let open = 0;
  const urlLimit = Math.min(text.length, k + MAX_URL_CHARS + 1);
  while (k < urlLimit) {
    const ch = text[k];
    if (ch === "(") open++;
    else if (ch === ")") {
      if (open === 0) break;
      open--;
    } else if (/\s/.test(ch)) return null;
    k++;
  }
  if (k >= urlLimit || text[k] !== ")") return null;
  return { end: k + 1, label: text.slice(at + 1, j), url: text.slice(j + 2, k) };
}

const TRAILING_PUNCTUATION = /[.,;:!?'"*]/;

/** Reads a bare http(s) address starting at `at`, leaving sentence punctuation outside the link. */
function readBareUrl(text: string, at: number): { end: number; url: string } | null {
  const head = text.slice(at, at + 8).toLowerCase();
  if (!head.startsWith("http://") && !head.startsWith("https://")) return null;
  let end = at;
  const limit = Math.min(text.length, at + MAX_URL_CHARS + 1);
  while (end < limit && !/[\s<>"]/.test(text[end])) end++;
  while (end > at) {
    const last = text[end - 1];
    const bracket = last === ")" ? "(" : last === "]" ? "[" : "";
    if (TRAILING_PUNCTUATION.test(last)) {
      end--;
    } else if (bracket) {
      // Keep the bracket only when the address has its opening one.
      const slice = text.slice(at, end);
      const opens = slice.split(bracket).length - 1;
      const closes = slice.split(last).length - 1;
      if (closes > opens) end--;
      else break;
    } else break;
  }
  const url = text.slice(at, end);
  return url.length > 8 ? { end, url } : null;
}

function parseInline(text: string, depth: number, allowLinks: boolean): InlineNode[] {
  const out: InlineNode[] = [];
  let buffer = "";
  const flush = () => {
    if (buffer) out.push({ kind: "text", text: buffer });
    buffer = "";
  };
  // Once a search for a closer has found none, none can appear later in this text.
  let noBold = false;
  const noCode = new Set<number>();

  let i = 0;
  while (i < text.length) {
    const ch = text[i];

    if (ch === "\\" && "*`[]".includes(text[i + 1] ?? "\0")) {
      buffer += text[i + 1];
      i += 2;
      continue;
    }

    if (ch === "`") {
      let run = 1;
      while (text[i + run] === "`") run++;
      if (!noCode.has(run)) {
        // The closer is a run of exactly the same length.
        const ticks = "`".repeat(run);
        let close = text.indexOf(ticks, i + run);
        while (close !== -1 && (text[close + run] === "`" || text[close - 1] === "`")) {
          close = text.indexOf(ticks, close + 1);
        }
        if (close !== -1 && close > i + run) {
          let code = text.slice(i + run, close);
          if (code.length > 2 && code.startsWith(" ") && code.endsWith(" ")) {
            code = code.slice(1, -1);
          }
          flush();
          out.push({ kind: "code", text: code });
          i = close + run;
          continue;
        }
        noCode.add(run);
      }
      buffer += "`".repeat(run);
      i += run;
      continue;
    }

    if (ch === "*") {
      let run = 1;
      while (text[i + run] === "*") run++;
      if (run === 2 && !noBold && depth < MAX_NESTING && !isSpace(text[i + 2])) {
        let close = text.indexOf("**", i + 2);
        while (
          close !== -1 &&
          (isSpace(text[close - 1]) || text[close + 2] === "*" || text[close - 1] === "*")
        ) {
          close = text.indexOf("**", close + 1);
        }
        if (close === -1) {
          noBold = true;
        } else {
          flush();
          out.push({
            kind: "bold",
            children: parseInline(text.slice(i + 2, close), depth + 1, allowLinks),
          });
          i = close + 2;
          continue;
        }
      }
      buffer += "*".repeat(run);
      i += run;
      continue;
    }

    if (ch === "[" && allowLinks) {
      const link = readBracketLink(text, i);
      const href = link ? safeLinkUrl(link.url) : null;
      if (link && href) {
        flush();
        const label = link.label.trim();
        out.push({
          kind: "link",
          href,
          children: label
            ? parseInline(label, depth + 1, false)
            : [{ kind: "text", text: link.url.trim() }],
        });
        i = link.end;
        continue;
      }
    }

    if ((ch === "h" || ch === "H") && allowLinks && !isWordChar(text[i - 1])) {
      const bare = readBareUrl(text, i);
      const href = bare ? safeLinkUrl(bare.url) : null;
      if (bare && href) {
        flush();
        out.push({ kind: "link", href, children: [{ kind: "text", text: bare.url }] });
        i = bare.end;
        continue;
      }
    }

    buffer += ch;
    i++;
  }
  flush();
  return out;
}

/** Reads one line of text; a very long line is read in pieces so the work stays bounded. */
function parseInlineLine(line: string): InlineNode[] {
  if (line.length <= MAX_INLINE_CHARS) return parseInline(line, 0, true);
  const out: InlineNode[] = [];
  let from = 0;
  while (from < line.length) {
    let to = Math.min(line.length, from + MAX_INLINE_CHARS);
    if (to < line.length) {
      const space = line.lastIndexOf(" ", to);
      if (space > from) to = space + 1;
    }
    out.push(...parseInline(line.slice(from, to), 0, true));
    from = to;
  }
  return out;
}

/** The inline reading of a piece of text (exported for tests and for one-line uses). */
export function parseInlineText(text: string): InlineNode[] {
  return parseInlineLine(text);
}

// --------------------------------------------------------------- blocks

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*)$/;
const RULE = /^ {0,3}(?:-{3,}|\*{3,}|_{3,})[ \t]*$/;
const LIST_ITEM = /^([ \t]*)([-*+]|\d{1,9}[.)])[ \t]+(.*)$/;
const TASK = /^\[([ xX])\][ \t]+(.*)$/;
const TABLE_RULE_CELL = /^:?-+:?$/;

function openingFence(
  line: string,
): { char: string; length: number; info: string } | null {
  const match = FENCE.exec(line);
  if (!match) return null;
  const info = match[2].trim();
  // A backtick fence cannot carry a backtick in its info text ("```code``` in a sentence").
  if (match[1][0] === "`" && info.includes("`")) return null;
  return { char: match[1][0], length: match[1].length, info };
}

function closesFence(line: string, char: string, length: number): boolean {
  const match = FENCE.exec(line);
  return (
    !!match && match[1][0] === char && match[1].length >= length && match[2].trim() === ""
  );
}

/** The cells of a table row; a pipe written as \| stays inside its cell. */
function splitRow(line: string): string[] {
  let text = line.trim();
  if (text.startsWith("|")) text = text.slice(1);
  const cells: string[] = [];
  let cell = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\" && text[i + 1] === "|") {
      cell += "|";
      i++;
    } else if (ch === "|") {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += ch;
    }
  }
  // A closing pipe leaves nothing after it; without one the last cell is still a cell.
  const closedByPipe = /(?:^|[^\\])\|$/.test(line.trim()) || line.trim() === "|";
  if (!(closedByPipe && cell.trim() === "")) cells.push(cell.trim());
  return cells;
}

/** Whether `lines[at]` and the line after it start a table: a header row, then a --- row. */
function startsTable(lines: readonly string[], at: number): boolean {
  const header = lines[at];
  const rule = lines[at + 1];
  if (rule === undefined || !header.includes("|") || !rule.includes("|")) return false;
  if (!rule.includes("-")) return false;
  const ruleCells = splitRow(rule);
  if (ruleCells.length === 0 || ruleCells.length > MAX_TABLE_COLUMNS) return false;
  if (!ruleCells.every((cell) => TABLE_RULE_CELL.test(cell))) return false;
  return splitRow(header).length === ruleCells.length;
}

function alignOf(cell: string): TableAlign {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  if (left) return "left";
  return null;
}

/** Whether a line begins something other than a paragraph, so it ends the paragraph above. */
function interruptsParagraph(lines: readonly string[], at: number): boolean {
  const line = lines[at];
  return (
    openingFence(line) !== null ||
    HEADING.test(line) ||
    RULE.test(line) ||
    LIST_ITEM.test(line) ||
    startsTable(lines, at)
  );
}

function listItemOf(line: string): ListItem | null {
  const match = LIST_ITEM.exec(line);
  if (!match) return null;
  const width = [...match[1]].reduce((sum, ch) => sum + (ch === "\t" ? 2 : 1), 0);
  const depth = Math.min(MAX_LIST_DEPTH, Math.floor(width / 2));
  const marker = match[2];
  if (/^\d/.test(marker)) {
    return {
      depth,
      marker: "number",
      number: Number.parseInt(marker, 10),
      children: parseInlineLine(match[3]),
    };
  }
  const task = TASK.exec(match[3]);
  if (task) {
    return {
      depth,
      marker: task[1] === " " ? "todo" : "done",
      children: parseInlineLine(task[2]),
    };
  }
  // "- [ ]" with nothing after it (the toolbar's checklist on an empty line) is still a checklist.
  const bare = /^\[([ xX])\]$/.exec(match[3].trim());
  if (bare) {
    return { depth, marker: bare[1] === " " ? "todo" : "done", children: [] };
  }
  return { depth, marker: "bullet", children: parseInlineLine(match[3]) };
}

/** Reads a note's text into blocks. Never throws; any text gives some tree. */
export function parseNote(content: string): ParsedNote {
  let text = typeof content === "string" ? content : "";
  let truncated = false;
  if (text.length > MAX_PREVIEW_CHARS) {
    text = text.slice(0, MAX_PREVIEW_CHARS);
    // Drop the line the cut went through, so no half line is shown as if whole.
    const lastBreak = Math.max(text.lastIndexOf("\n"), text.lastIndexOf("\r"));
    text = lastBreak > 0 ? text.slice(0, lastBreak) : text;
    truncated = true;
  }
  let lines = text.split(/\r\n|\r|\n/);
  if (lines.length > MAX_PREVIEW_LINES) {
    lines = lines.slice(0, MAX_PREVIEW_LINES);
    truncated = true;
  }

  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i++;
      continue;
    }

    const fence = openingFence(line);
    if (fence) {
      const body: string[] = [];
      let j = i + 1;
      let closed = false;
      while (j < lines.length) {
        if (closesFence(lines[j], fence.char, fence.length)) {
          closed = true;
          j++;
          break;
        }
        body.push(lines[j]);
        j++;
      }
      const language = /^[\w+#.-]{1,20}/.exec(fence.info)?.[0] ?? "";
      blocks.push({ kind: "code", language, text: body.join("\n"), closed });
      i = j;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({
        kind: "heading",
        level: heading[1].length as 1 | 2 | 3 | 4 | 5 | 6,
        children: parseInlineLine(heading[2].trim()),
      });
      i++;
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ kind: "rule" });
      i++;
      continue;
    }

    if (startsTable(lines, i)) {
      const align = splitRow(lines[i + 1]).map(alignOf);
      const columns = align.length;
      const normalise = (row: string) => {
        const cells = splitRow(row).slice(0, columns);
        while (cells.length < columns) cells.push("");
        return cells.map(parseInlineLine);
      };
      const header = normalise(lines[i]);
      const rows: InlineNode[][][] = [];
      let j = i + 2;
      while (
        j < lines.length &&
        rows.length < MAX_TABLE_ROWS &&
        lines[j].trim() !== "" &&
        lines[j].includes("|") &&
        openingFence(lines[j]) === null
      ) {
        rows.push(normalise(lines[j]));
        j++;
      }
      blocks.push({ kind: "table", align, header, rows });
      i = j;
      continue;
    }

    if (LIST_ITEM.test(line)) {
      const items: ListItem[] = [];
      let j = i;
      while (j < lines.length) {
        const item = listItemOf(lines[j]);
        if (!item || RULE.test(lines[j])) break;
        items.push(item);
        j++;
      }
      blocks.push({ kind: "list", items });
      i = j;
      continue;
    }

    const paragraph: InlineNode[][] = [parseInlineLine(line.trimEnd())];
    let j = i + 1;
    while (j < lines.length && lines[j].trim() !== "" && !interruptsParagraph(lines, j)) {
      paragraph.push(parseInlineLine(lines[j].trimEnd()));
      j++;
    }
    blocks.push({ kind: "paragraph", lines: paragraph });
    i = j;
  }
  return { blocks, truncated };
}
