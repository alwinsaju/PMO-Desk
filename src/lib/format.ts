// The one byte-size formatter. Pure, relative-import friendly (no React, no
// node: imports) so `pnpm test` and the browser both load it (see format.test.mjs).

const UNITS = ["B", "KB", "MB", "GB"] as const;
export type ByteUnit = (typeof UNITS)[number];

export interface FormatBytesOptions {
  /** 1024 (binary, default) or 1000 (decimal, how Ollama reports model sizes). */
  base?: 1000 | 1024;
  /** Smallest unit shown; anything smaller reads "1 <min>" (or "0 <min>" for 0). */
  min?: ByteUnit;
  /** Largest unit shown; bigger values stay in it. */
  max?: ByteUnit;
  /** Returned for negative / NaN / infinite input. Defaults to "0 <min>". */
  invalid?: string;
  /** Show the largest unit with one decimal even from 10 up ("12.0 MB"). */
  decimalAtMax?: boolean;
}

/** Files the user uploads: "512 B", "2.0 KB", "12.0 MB". */
export const FILE_SIZE: FormatBytesOptions = {
  base: 1024,
  max: "MB",
  decimalAtMax: true,
};
/** Model downloads and disk space: "1 KB", "42 MB", "6.6 GB", "unknown". */
export const MODEL_SIZE: FormatBytesOptions = {
  base: 1000,
  min: "KB",
  invalid: "unknown",
};
/** Model memory in the log view: "420 MB", "8.1 GB". */
export const MEMORY_SIZE: FormatBytesOptions = {
  base: 1024,
  min: "MB",
  decimalAtMax: true,
};

/** One decimal below 10 of a unit ("6.6 GB"), none from 10 up ("12 GB"). */
export function formatBytes(bytes: number, options: FormatBytesOptions = {}): string {
  const { base = 1024, min = "B", max = "GB", invalid, decimalAtMax = false } = options;
  if (!Number.isFinite(bytes) || bytes < 0) return invalid ?? `0 ${min}`;
  const lo = UNITS.indexOf(min);
  const hi = UNITS.indexOf(max);
  let unit = lo;
  let value = bytes / base ** lo;
  while (unit < hi && value >= base) {
    value /= base;
    unit += 1;
  }
  if (value === 0) return `0 ${UNITS[unit]}`;
  if (unit > 0 && value < 1) return `1 ${UNITS[unit]}`;
  const oneDecimal = unit > 0 && (value < 10 || (decimalAtMax && unit === hi));
  return `${value.toFixed(oneDecimal ? 1 : 0)} ${UNITS[unit]}`;
}
