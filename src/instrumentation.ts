// Runs once when the Next.js server starts (`pnpm dev`, `next start`, and the
// server the Electron shell spawns). Brings the local Ollama server up in the
// background so AI features are ready without blocking startup. Stopping it
// is src/lib/ai-runtime/lifecycle.ts's job (exit hook) and, for the desktop
// app, desktop/main.cjs calling /api/ai/runtime/stop.
export async function register() {
  // The literal `=== "nodejs"` guard is what lets Next drop this branch from
  // the Edge instrumentation bundle (which can't resolve node: imports).
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NEXT_PHASE !== "phase-production-build"
  ) {
    const { ensureRuntime } = await import("./lib/ai-runtime");
    void ensureRuntime().then((result) => {
      if (!result.running) console.warn(`[ai-runtime] not available: ${result.reason}`);
    });
  }
}
