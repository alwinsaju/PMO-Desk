// desktop.log writer (pure; fs and clock injected): rotates by size and folds
// consecutive identical messages into one "repeated N times" line.

const DEFAULT_MAX_BYTES = 1024 * 1024;
const DEFAULT_KEEP = 3;

/** file -> file.1 -> file.2 ... -> file.<keep>; the oldest one is dropped. */
function rotateFiles(file, fs, keep = DEFAULT_KEEP) {
  const oldest = `${file}.${keep}`;
  if (fs.existsSync(oldest)) fs.unlinkSync(oldest);
  for (let n = keep - 1; n >= 1; n--) {
    const from = `${file}.${n}`;
    if (fs.existsSync(from)) fs.renameSync(from, `${file}.${n + 1}`);
  }
  if (fs.existsSync(file)) fs.renameSync(file, `${file}.1`);
}

function createLogWriter({
  file,
  fs,
  now = () => new Date(),
  maxBytes = DEFAULT_MAX_BYTES,
  keep = DEFAULT_KEEP,
}) {
  let size = null;
  let last = null;
  let repeats = 0;

  const currentSize = () => {
    if (size === null) {
      try {
        size = fs.statSync(file).size;
      } catch {
        size = 0;
      }
    }
    return size;
  };

  const append = (text) => {
    const bytes = Buffer.byteLength(text);
    if (currentSize() > 0 && size + bytes > maxBytes) {
      rotateFiles(file, fs, keep);
      size = 0;
    }
    fs.appendFileSync(file, text);
    size += bytes;
  };

  const stamp = (message) => `[${now().toISOString()}] ${message}\n`;

  const flush = () => {
    if (repeats === 0) return;
    const times = repeats;
    repeats = 0;
    append(stamp(`(previous message repeated ${times} times)`));
  };

  return {
    /** Never throws: logging must not take the app down. */
    write(message) {
      try {
        if (message === last) {
          repeats++;
          return;
        }
        flush();
        last = message;
        append(stamp(message));
      } catch {
        // ignore
      }
    },
    flush() {
      try {
        flush();
      } catch {
        // ignore
      }
    },
  };
}

module.exports = { createLogWriter, rotateFiles, DEFAULT_MAX_BYTES, DEFAULT_KEEP };
