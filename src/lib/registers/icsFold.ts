// RFC 5545 asks for calendar lines of at most 75 octets: a longer line is folded by a line break and a
// space. Pure. Folding never splits a multi-byte character, and an already folded file comes back unchanged.

const LIMIT = 75;

function foldLine(line: string): string[] {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= LIMIT) return [line];
  const out: string[] = [];
  let current = "";
  let size = 0;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    // A continuation line starts with one space, which counts toward its 75 octets.
    const room = out.length === 0 ? LIMIT : LIMIT - 1;
    if (size + bytes > room) {
      out.push(out.length === 0 ? current : ` ${current}`);
      current = "";
      size = 0;
    }
    current += char;
    size += bytes;
  }
  out.push(out.length === 0 ? current : ` ${current}`);
  return out;
}

/** The calendar text with every line folded to 75 octets. Lines end with CRLF as in the input. */
export function foldIcs(ics: string): string {
  return ics
    .split("\r\n")
    .flatMap((line) => foldLine(line))
    .join("\r\n");
}
