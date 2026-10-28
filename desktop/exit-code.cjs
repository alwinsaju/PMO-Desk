// Formats a child-process exit code for people. Windows reports failures as
// unsigned 32-bit values (4294967295 for -1); show them as signed plus hex.

/** "-1 (0xFFFFFFFF)" for unsigned values >= 0x80000000, else the plain number. */
function describeExitCode(code) {
  if (typeof code !== "number" || !Number.isInteger(code)) return "unknown";
  if (code >= 0x80000000 && code <= 0xffffffff) {
    const hex = code.toString(16).toUpperCase().padStart(8, "0");
    return `${code | 0} (0x${hex})`;
  }
  return String(code);
}

module.exports = { describeExitCode };
