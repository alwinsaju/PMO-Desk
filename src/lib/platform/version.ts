// Comparing version numbers like "5.7.0" or "v6.0". Pure; used on the page and the server.

/** Numbers of "5.7.0" or "v6.0" (missing parts are 0); null when it is not a version. */
export function parseVersion(text: string): number[] | null {
  const match = /^v?(\d{1,4})(?:\.(\d{1,4}))?(?:\.(\d{1,4}))?(?:[-+].*)?$/.exec(
    text.trim(),
  );
  return match ? [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)] : null;
}

/** 1 when `a` is newer, -1 when older, 0 when equal or either is not a version. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i]) return x[i]! < y[i]! ? -1 : 1;
  }
  return 0;
}

export const isNewer = (candidate: string, current: string): boolean =>
  compareVersions(candidate, current) === 1;
