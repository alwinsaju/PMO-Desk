// Message clean-up before the model sees it, plus the readable form of the
// original shown in the UI. Pure string functions, no node: imports, so the
// client bundle can use `displayText` too.
import type { Intake } from "./types.ts";

export const MAX_MODEL_CHARS = 12_000;

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  ndash: "\u2013",
  mdash: "\u2014",
  hellip: "\u2026",
  rsquo: "\u2019",
  lsquo: "\u2018",
  rdquo: "\u201d",
  ldquo: "\u201c",
  bull: "\u2022",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code =
        body[1].toLowerCase() === "x"
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000
        ? String.fromCodePoint(code)
        : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** HTML -> readable plain text (block tags become line breaks). */
export function htmlToText(html: string): string {
  const text = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|head)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/(p|div|tr|li|h[1-6]|table|blockquote)\s*>/gi, "\n")
    .replace(/<\/t[dh]\s*>/gi, "\t")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(text)
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\f\v]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The message body as a person would read it (what the UI shows as the
 *  original, and what the quote is highlighted in). */
export function displayText(intake: Pick<Intake, "body">): string {
  return intake.body.format === "html"
    ? htmlToText(intake.body.text)
    : intake.body.text.replace(/\r\n?/g, "\n").trim();
}

// Everything from the first line that opens a quoted reply chain on is older
// mail the sender was replying to, not the new message.
const ORIGINAL_MESSAGE = /^\s*-{2,}\s*(original message|forwarded message)\s*-{2,}\s*$/i;
const OUTLOOK_DIVIDER = /^\s*_{10,}\s*$/;
const HEADER_FIELD = /^\s*(from|sent|date|to|cc|subject)\s*:/i;

function isHeaderBlockStart(lines: string[], index: number): boolean {
  if (!/^\s*from\s*:/i.test(lines[index])) return false;
  let fields = 0;
  for (let i = index + 1; i < Math.min(lines.length, index + 6); i++) {
    if (HEADER_FIELD.test(lines[i])) fields++;
  }
  return fields >= 2;
}

function startsChain(lines: string[], i: number): boolean {
  const line = lines[i];
  if (ORIGINAL_MESSAGE.test(line)) return true;
  // The divider alone could be a signature rule; Outlook follows it with From:.
  if (OUTLOOK_DIVIDER.test(line)) return /^\s*from\s*:/i.test(lines[i + 1] ?? "");
  if (/^\s*on\s.{5,300}wrote:\s*$/i.test(line)) return true;
  // "On Mon, 3 Mar 2025 at 10:00, Someone" wrapped before "wrote:".
  if (/^\s*on\s/i.test(line) && /wrote:\s*$/i.test(lines[i + 1] ?? "")) return true;
  return isHeaderBlockStart(lines, i);
}

/** Cuts the quoted reply chain (and ">"-quoted lines). If that would leave
 *  nothing, the text is returned untouched. */
export function stripQuotedChain(text: string): string {
  const lines = text.split("\n");
  let cut = lines.findIndex((_, i) => startsChain(lines, i));
  if (cut < 0) cut = lines.length;
  const kept = lines
    .slice(0, cut)
    .filter((line) => !/^\s*>/.test(line))
    .join("\n")
    .trim();
  return kept === "" ? text : kept;
}

/** base64 payloads and long tracking/safe-link URLs only burn the context
 *  window; short links are kept because they can carry meaning. */
export function dropNoise(text: string): string {
  return text
    .replace(/data:[a-z0-9.+/-]+;base64,[a-z0-9+/=\s]{40,}/gi, "[embedded data removed]")
    .replace(/[A-Za-z0-9+/=]{200,}/g, "[encoded data removed]")
    .replace(/https?:\/\/\S+/gi, (url) =>
      url.length > 90 || /safelinks\.protection|[?&]utm_|click\.|track/i.test(url)
        ? "[link]"
        : url,
    );
}

/** Raw intake -> the text the model reads. */
export function prepareForModel(intake: Pick<Intake, "body">): string {
  let text = displayText(intake);
  text = stripQuotedChain(text);
  text = dropNoise(text);
  text = text
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (text.length > MAX_MODEL_CHARS) {
    text = `${text.slice(0, MAX_MODEL_CHARS)}\n[... message truncated ...]`;
  }
  return text;
}
