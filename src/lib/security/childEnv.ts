// The environment for any process this server launches. NODE_TLS_REJECT_UNAUTHORIZED=0
// switches off certificate checks for Node; it must not leak into the Tasks engine, Ollama
// or the setup commands, where it would silently weaken every HTTPS call they make.
const TLS_VAR = "NODE_TLS_REJECT_UNAUTHORIZED";

let warned = false;

/** `base` without NODE_TLS_REJECT_UNAUTHORIZED (any casing); warns once if it was there. */
export function withoutTlsOverride(
  base: NodeJS.ProcessEnv = process.env,
  warn: (message: string) => void = console.warn,
): NodeJS.ProcessEnv {
  const env = {} as NodeJS.ProcessEnv;
  let found = false;
  for (const [key, value] of Object.entries(base)) {
    if (key.toUpperCase() === TLS_VAR) found = true;
    else env[key] = value;
  }
  if (found && !warned) {
    warned = true;
    warn(`[ai-os] ${TLS_VAR} is set; it is not passed to child processes.`);
  }
  return env;
}

/** Test hook: forget that the warning was already given. */
export function resetTlsWarning(): void {
  warned = false;
}
