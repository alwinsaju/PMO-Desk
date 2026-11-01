// The editor toolbar's formatting, as pure text edits. A note stays plain text; the markers are
// "# " for a heading, "- " for a bullet, "- [ ] " / "- [x] " for a checklist and "**" for bold.

export type NoteFormat = "heading" | "bullet" | "check" | "bold";

export interface TextEdit {
  text: string;
  start: number;
  end: number;
}

const LINE_PREFIX: Record<
  Exclude<NoteFormat, "bold">,
  { marker: string; has: RegExp }
> = {
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
  kind: keyof typeof LINE_PREFIX,
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

/** Applies a toolbar format to the text for the current selection; returns the new text and selection. */
export function applyFormat(
  text: string,
  start: number,
  end: number,
  kind: NoteFormat,
): TextEdit {
  const a = Math.min(Math.max(0, Math.min(start, end)), text.length);
  const b = Math.min(Math.max(0, Math.max(start, end)), text.length);
  return kind === "bold" ? toggleBold(text, a, b) : formatLines(text, a, b, kind);
}

/** Flips a checklist line between "- [ ] " and "- [x] "; returns null when the line is not one. */
export function toggleCheck(line: string): string | null {
  const match = /^(\s*- \[)([ xX])(\] .*)$/.exec(line);
  if (!match) return null;
  return `${match[1]}${match[2] === " " ? "x" : " "}${match[3]}`;
}
