// When to retry the UI server on a fresh port (pure; no Electron imports).

const PORT_IN_USE = /EADDRINUSE|address already in use/i;

/**
 * The UI server failed to come up. Retry on another port when it reported the
 * port as taken, or when it died before answering (the usual shape of a lost
 * port race: another instance grabbed it between our probe and its bind).
 * A plain timeout with no such output is not retried.
 * @param {{output?: string[], exitedBeforeReady?: boolean}} failure
 */
function shouldRetryOnFreshPort({ output = [], exitedBeforeReady = false } = {}) {
  return (
    exitedBeforeReady ||
    output.some((line) => typeof line === "string" && PORT_IN_USE.test(line))
  );
}

module.exports = { shouldRetryOnFreshPort };
