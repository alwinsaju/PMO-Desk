// Removes secrets and personal details from text that leaves this computer (the
// diagnostics bundle). Pure. It errs on the side of removing too much.

const RULES: {
  name: string;
  pattern: RegExp;
  replace: string | ((m: string, ...g: string[]) => string);
}[] = [
  // Key/value pairs that look like credentials: token=abc, "password": "x", Authorization: Bearer x
  {
    name: "credential",
    pattern:
      /("?(?:password|passwd|pwd|secret|token|api[_-]?key|apikey|authorization|auth|cookie|session|credential)[a-z_-]*"?\s*[:=]\s*)("[^"\r\n]*"|'[^'\r\n]*'|(?:Bearer\s+)?[^\s,;"'}\]]+)/gi,
    replace: (_m, key) => `${key}[removed]`,
  },
  {
    name: "bearer",
    pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/g,
    replace: "Bearer [removed]",
  },
  {
    name: "email",
    pattern: /[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    replace: "[email]",
  },
  // Long hex or base64-ish strings (ids, tokens, hashes of secrets)
  { name: "long-hex", pattern: /\b[0-9a-f]{32,}\b/gi, replace: "[id]" },
  { name: "long-token", pattern: /\b[A-Za-z0-9_-]{40,}\b/g, replace: "[id]" },
  // The Windows user folder: C:\Users\name\... and \\server\share paths
  {
    name: "user-path",
    pattern: /([A-Za-z]:[\\/]+Users[\\/]+)[^\\/\s"']+/gi,
    replace: (_m, head) => `${head}[user]`,
  },
  { name: "unc", pattern: /\\\\[^\\\s"']+\\[^\s"']+/g, replace: "[network path]" },
  {
    name: "ipv4",
    pattern: /\b(?!127\.0\.0\.1\b)\d{1,3}(?:\.\d{1,3}){3}\b/g,
    replace: "[ip]",
  },
];

/** The text with credentials, email addresses, long ids, user names in paths and network paths replaced. */
export function redact(text: string, extra: readonly string[] = []): string {
  let out = text;
  for (const rule of RULES) {
    out = out.replace(rule.pattern, rule.replace as never);
  }
  for (const word of extra) {
    const clean = word.trim();
    if (clean.length >= 3) {
      out = out.replace(
        new RegExp(clean.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"),
        "[user]",
      );
    }
  }
  return out;
}

/** Keep the last `maxLines` lines (the recent part of a log). */
export function tailLines(text: string, maxLines: number): string {
  const lines = text.split(/\r?\n/);
  return lines.slice(Math.max(0, lines.length - maxLines)).join("\n");
}
