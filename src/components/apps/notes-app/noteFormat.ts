// The editor toolbar's formatting, as pure text edits. A note stays plain text; the markers are
// "# " for a heading, "- " for a bullet, "- [ ] " / "- [x] " for a checklist and "**" for bold,
// "[text](address)" for a link, a ``` fenced block for code and a | pipe | table for a table
// (the Preview in noteMarkdown.ts draws them).
import { safeLinkUrl } from "./noteMarkdown.ts";

export type NoteFormat =
  "heading" | "bullet" | "check" | "bold" | "link" | "code" | "table";
type LineFormat = "heading" | "bullet" | "check";

export interface TextEdit {
  text: string;
  start: number;
  end: number;
}

const LINE_PREFIX: Record<LineFormat, { marker: string; has: RegExp }> = {
  heading: { marker: "# ", has: /^# / },
  bullet: { marker: "- ", has: /^- (?!\[[ xX]\] )/ },
  check: { marker: "- [ ] ", has: /^- \[[ xX]\] / },
};
// Any prefix a line can already carry, so switching a bullet to a checklist replaces it.
const ANY_PREFIX = /^(?:# |- \[[ xX]\] |- )/;

function formatLines(
  text: string,
  start: number,
  end: number,
  kind: LineFormat,
): TextEdit {
  const { marker, has } = LINE_PREFIX[kind];
  const blockStart = text.lastIndexOf("\n", start - 1) + 1;
  const stop = end > start && text[end - 1] === "\n" ? end - 1 : end;
  const nl = text.indexOf("\n", stop);
  const blockEnd = nl === -1 ? text.length : nl;
  const lines = text.slice(blockStart, blockEnd).split("\n");
  // A lone blank line (the cursor on an empty line) is formatted; blank lines in a block are not.
  const targets = lines.map((line) => lines.length === 1 || line.trim() !== "");
  const allMarked = lines.every((line, i) => !targets[i] || has.test(line));

  let delta = 0;
  let firstDelta = 0;
  const next = lines.map((line, i) => {
    if (!targets[i]) return line;
    const bare = line.replace(ANY_PREFIX, "");
    const out = allMarked ? bare : marker + bare;
    if (i === 0) firstDelta = out.length - line.length;
    delta += out.length - line.length;
    return out;
  });
  return {
    text: text.slice(0, blockStart) + next.join("\n") + text.slice(blockEnd),
    start: Math.max(blockStart, start + firstDelta),
    end: Math.max(blockStart, end + delta),
  };
}

function toggleBold(text: string, start: number, end: number): TextEdit {
  const selected = text.slice(start, end);
  const around =
    text.slice(start - 2, start) === "**" && text.slice(end, end + 2) === "**";
  if (around) {
    return {
      text: text.slice(0, start - 2) + selected + text.slice(end + 2),
      start: start - 2,
      end: end - 2,
    };
  }
  if (selected.length >= 4 && selected.startsWith("**") && selected.endsWith("**")) {
    return {
      text: text.slice(0, start) + selected.slice(2, -2) + text.slice(end),
      start,
      end: end - 4,
    };
  }
  return {
    text: `${text.slice(0, start)}**${selected}**${text.slice(end)}`,
    start: start + 2,
    end: end + 2,
  };
}

const LINK_TEXT = "link text";
const LINK_URL = "https://";
const WRITTEN_LINK = /^\[([^[\]\n]*)\]\([^()\s]*\)$/;

/** The written link `[text](address)` that holds the whole selection, if any. */
function enclosingLink(
  text: string,
  start: number,
  end: number,
): { from: number; to: number; label: string } | null {
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const nl = text.indexOf("\n", start);
  const lineEnd = nl === -1 ? text.length : nl;
  for (const match of text
    .slice(lineStart, lineEnd)
    .matchAll(/\[([^[\]\n]*)\]\(([^()\s]*)\)/g)) {
    const from = lineStart + match.index;
    const to = from + match[0].length;
    if (start >= from && end <= to) return { from, to, label: match[1] };
  }
  return null;
}

function toggleLink(text: string, start: number, end: number): TextEdit {
  const inside = enclosingLink(text, start, end);
  // Pressing Link again on a link takes it back to its words instead of nesting another.
  if (inside) {
    return {
      text: text.slice(0, inside.from) + inside.label + text.slice(inside.to),
      start: inside.from,
      end: inside.from + inside.label.length,
    };
  }
  const selected = text.slice(start, end);
  const edit = (inserted: string, from: number, to: number, at = end): TextEdit => ({
    text: text.slice(0, start) + inserted + text.slice(at),
    start: start + from,
    end: start + to,
  });
  const written = WRITTEN_LINK.exec(selected);
  if (written) return edit(written[1], 0, written[1].length);
  const oneLine = selected !== "" && !selected.includes("\n");
  if (oneLine && safeLinkUrl(selected)) {
    // An address is already selected: it becomes the link's address; type the words for it.
    return edit(`[${LINK_TEXT}](${selected.trim()})`, 1, 1 + LINK_TEXT.length);
  }
  if (oneLine) {
    // Words are selected: they become the link's text; type the address next.
    const from = selected.length + 3;
    return edit(`[${selected}](${LINK_URL})`, from, from + LINK_URL.length);
  }
  // Nothing (or several lines) selected: a skeleton after the selection, its text selected.
  const at = end;
  return {
    text: `${text.slice(0, at)}[${LINK_TEXT}](${LINK_URL})${text.slice(at)}`,
    start: at + 1,
    end: at + 1 + LINK_TEXT.length,
  };
}

/** Puts `block` on lines of its own at [start, end) (the selection it replaces). */
function placeBlock(
  text: string,
  start: number,
  end: number,
  block: string,
  select: { from: number; to: number },
  consumedBreak = false,
): TextEdit {
  const lead = start > 0 && text[start - 1] !== "\n" ? "\n" : "";
  const trail = consumedBreak || (end < text.length && text[end] !== "\n") ? "\n" : "";
  return {
    text: text.slice(0, start) + lead + block + trail + text.slice(end),
    start: start + lead.length + select.from,
    end: start + lead.length + select.to,
  };
}

const FENCE = "```";

/** The fenced block holding the selection, as the character range of its opening and closing lines. */
function enclosingCodeBlock(
  text: string,
  start: number,
  end: number,
): { from: number; to: number; body: string } | null {
  const fences: { from: number; to: number }[] = [];
  let at = 0;
  for (const line of text.split("\n")) {
    if (line.startsWith(FENCE)) fences.push({ from: at, to: at + line.length });
    at += line.length + 1;
  }
  for (let i = 0; i + 1 < fences.length; i += 2) {
    const open = fences[i];
    const close = fences[i + 1];
    if (start >= open.from && end <= close.to) {
      return {
        from: open.from,
        to: close.to,
        body: text.slice(open.to + 1, close.from - 1),
      };
    }
  }
  return null;
}

function insertCodeBlock(text: string, start: number, end: number): TextEdit {
  // Pressing Code block again inside a block removes the fences instead of nesting.
  const inside = enclosingCodeBlock(text, start, end);
  if (inside) {
    return {
      text: text.slice(0, inside.from) + inside.body + text.slice(inside.to),
      start: inside.from,
      end: inside.from + inside.body.length,
    };
  }
  const selected = text.slice(start, end);
  const consumedBreak = selected.endsWith("\n");
  const body = consumedBreak ? selected.slice(0, -1) : selected;
  const from = FENCE.length + 1;
  return placeBlock(
    text,
    start,
    end,
    `${FENCE}\n${body}\n${FENCE}`,
    { from, to: from + body.length },
    consumedBreak,
  );
}

const TABLE_FIRST_HEADING = "Column 1";
const TABLE_SKELETON = [
  `| ${TABLE_FIRST_HEADING} | Column 2 | Column 3 |`,
  "| --- | --- | --- |",
  "|  |  |  |",
  "|  |  |  |",
].join("\n");

function insertTable(text: string, start: number, end: number): TextEdit {
  // Inside a table already: pressing Table again leaves it alone rather than adding a second one.
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  if (text.startsWith("|", lineStart)) return { text, start, end };
  // Placed after the selection, which is left as it is.
  const from = 2;
  return placeBlock(text, end, end, TABLE_SKELETON, {
    from,
    to: from + TABLE_FIRST_HEADING.length,
  });
}

/** Applies a toolbar format to the text for the current selection; returns the new text and selection. */
export function applyFormat(
  text: string,
  start: number,
  end: number,
  kind: NoteFormat,
): TextEdit {
  const a = Math.min(Math.max(0, Math.min(start, end)), text.length);
  const b = Math.min(Math.max(0, Math.max(start, end)), text.length);
  switch (kind) {
    case "bold":
      return toggleBold(text, a, b);
    case "link":
      return toggleLink(text, a, b);
    case "code":
      return insertCodeBlock(text, a, b);
    case "table":
      return insertTable(text, a, b);
    default:
      return formatLines(text, a, b, kind);
  }
}

/** Flips a checklist line between "- [ ] " and "- [x] "; returns null when the line is not one. */
export function toggleCheck(line: string): string | null {
  const match = /^(\s*- \[)([ xX])(\] .*)$/.exec(line);
  if (!match) return null;
  return `${match[1]}${match[2] === " " ? "x" : " "}${match[3]}`;
}
