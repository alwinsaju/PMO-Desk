// Environment for child processes the shell spawns (pure; no Electron imports).
//
// NODE_TLS_REJECT_UNAUTHORIZED=0 switches certificate checking off for every
// HTTPS request the UI server makes (Ollama installer download, model pulls),
// so it must never be inherited. A corporate proxy's CA belongs in
// NODE_EXTRA_CA_CERTS, which is left alone.

const TLS_OVERRIDE_NAME = "NODE_TLS_REJECT_UNAUTHORIZED";

/**
 * A copy of `env` without the TLS override. Windows env names are
 * case-insensitive, so every casing is removed.
 * @returns {{env: Record<string, string | undefined>, removed: string[]}}
 *          `removed` lists the names that were present (empty when none).
 */
function sanitizeChildEnv(env) {
  const clean = {};
  const removed = [];
  for (const [name, value] of Object.entries(env || {})) {
    if (name.toUpperCase() === TLS_OVERRIDE_NAME) {
      removed.push(name);
    } else {
      clean[name] = value;
    }
  }
  return { env: clean, removed };
}

/**
 * Node's fetch ignores HTTP(S)_PROXY unless NODE_USE_ENV_PROXY=1. When a proxy
 * is configured and nothing set that switch, return it so the Ollama installer
 * and model downloads go through the proxy.
 * @returns {Record<string, string>}
 */
function proxyEnv(env) {
  const set = new Map(
    Object.entries(env || {}).map(([name, value]) => [
      name.toUpperCase(),
      String(value ?? "").trim(),
    ]),
  );
  const hasProxy = Boolean(set.get("HTTPS_PROXY") || set.get("HTTP_PROXY"));
  return hasProxy && !set.has("NODE_USE_ENV_PROXY") ? { NODE_USE_ENV_PROXY: "1" } : {};
}

module.exports = { TLS_OVERRIDE_NAME, sanitizeChildEnv, proxyEnv };
