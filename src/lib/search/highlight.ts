// Marks the typed words inside a result's text. Pure: returns pieces, the panel wraps
// the matching ones in <mark>.

export interface HighlightPart {
  text: string;
  match: boolean;
}

const escape = (word: string): string => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Splits `text` at every case-insensitive occurrence of any word of `query`. */
export function highlightParts(text: string, query: string): HighlightPart[] {
  const words = [...new Set(query.toLowerCase().split(/\s+/).filter(Boolean))].sort(
    (a, b) => b.length - a.length,
  );
  if (words.length === 0 || text === "") return [{ text, match: false }];
  const pattern = new RegExp(`(${words.map(escape).join("|")})`, "gi");
  const parts: HighlightPart[] = [];
  let last = 0;
  for (const found of text.matchAll(pattern)) {
    const at = found.index ?? 0;
    if (at > last) parts.push({ text: text.slice(last, at), match: false });
    parts.push({ text: found[0], match: true });
    last = at + found[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), match: false });
  return parts.length > 0 ? parts : [{ text, match: false }];
}
