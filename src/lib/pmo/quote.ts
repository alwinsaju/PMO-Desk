// Hallucination guard for the model's `quote` field: is it really in the
// message? Whitespace is normalised (and curly quotes straightened, which
// mail clients do to text); nothing else is forgiven. Also used by the UI to
// highlight the quote inside the original message.
interface Normalised {
  text: string;
  /** map[i] = index in the source string of normalised char i. */
  map: number[];
}

function normalise(source: string): Normalised {
  let text = "";
  const map: number[] = [];
  for (let i = 0; i < source.length; i++) {
    let ch = source[i];
    if (/\s/.test(ch)) {
      if (text !== "" && !text.endsWith(" ")) {
        text += " ";
        map.push(i);
      }
      continue;
    }
    if (ch === "\u2018" || ch === "\u2019") ch = "'";
    else if (ch === "\u201c" || ch === "\u201d") ch = '"';
    text += ch;
    map.push(i);
  }
  if (text.endsWith(" ")) {
    text = text.slice(0, -1);
    map.pop();
  }
  return { text, map };
}

/** Where `quote` sits in `body` (indexes into `body`), or null if it doesn't. */
export function locateQuote(
  body: string,
  quote: string | null | undefined,
): { start: number; end: number } | null {
  if (!quote) return null;
  const needle = normalise(quote);
  if (needle.text === "") return null;
  const haystack = normalise(body);
  const at = haystack.text.indexOf(needle.text);
  if (at < 0) return null;
  return {
    start: haystack.map[at],
    end: haystack.map[at + needle.text.length - 1] + 1,
  };
}

export interface QuoteSegment {
  text: string;
  /** This part is the model's verified quote. */
  mark: boolean;
}

/** `body` cut into the text before, the quote itself and the text after, for
 *  highlighting it in the original message. Empty parts are left out; a quote
 *  that is not found gives the whole body unmarked. */
export function quoteSegments(
  body: string,
  quote: string | null | undefined,
): QuoteSegment[] {
  const at = locateQuote(body, quote);
  const parts: QuoteSegment[] = at
    ? [
        { text: body.slice(0, at.start), mark: false },
        { text: body.slice(at.start, at.end), mark: true },
        { text: body.slice(at.end), mark: false },
      ]
    : [{ text: body, mark: false }];
  return parts.filter((part) => part.text !== "");
}

export const verifyQuote = (body: string, quote: string | null | undefined): boolean =>
  locateQuote(body, quote) !== null;

/** A quote shorter than this that only partly matches is not trusted. */
export const MIN_GROUNDED_CHARS = 15;

/**
 * Grounds the model's quote in the message. A small model often copies the
 * right sentence and then keeps going (into the prompt's own metadata, or
 * repeats the body), so when the whole quote is not found the longest leading
 * run of whole words that IS found is kept instead, provided it is at least
 * MIN_GROUNDED_CHARS long. That trimmed text is what gets highlighted; the
 * invented tail is dropped. Nothing found -> unverified, and the UI shows the
 * "check against original" badge.
 */
export function groundQuote(
  body: string,
  quote: string | null | undefined,
): { quote: string; verified: boolean } {
  const text = (quote ?? "").trim();
  if (text === "") return { quote: "", verified: false };
  if (locateQuote(body, text)) return { quote: text, verified: true };

  const words = text.split(/\s+/);
  for (let count = words.length - 1; count >= 1; count--) {
    const prefix = words.slice(0, count).join(" ");
    if (prefix.length < MIN_GROUNDED_CHARS) break;
    if (locateQuote(body, prefix)) return { quote: prefix, verified: true };
  }
  return { quote: text, verified: false };
}
