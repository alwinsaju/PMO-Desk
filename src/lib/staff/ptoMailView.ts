// Pure helpers for showing a PTO email in the Time off detail dialog.

export interface TextPart {
  text: string;
  /** True for the part the AI quoted as its evidence. */
  quoted: boolean;
}

/** Splits the email text so the sentence the AI quoted can be marked. Matching ignores
 *  case and runs of whitespace, as the app's own check of the quote does. */
export function splitAroundQuote(text: string, quote: string): TextPart[] {
  const words = quote.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0 || text === "") return text ? [{ text, quoted: false }] : [];
  const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const match = new RegExp(escaped.join("\\s+"), "i").exec(text);
  if (!match) return [{ text, quoted: false }];
  const end = match.index + match[0].length;
  return [
    { text: text.slice(0, match.index), quoted: false },
    { text: match[0], quoted: true },
    { text: text.slice(end), quoted: false },
  ].filter((part) => part.text !== "");
}
