// Shared test helpers (not imported by app code).

/** Polls `predicate` every `stepMs` until truthy; throws after `timeoutMs`. */
export async function waitFor(predicate, timeoutMs = 2000, stepMs = 10) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() >= deadline) {
      throw new Error(`waitFor: condition not met within ${timeoutMs} ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
}
