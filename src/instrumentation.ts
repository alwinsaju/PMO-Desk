// Runs once when the Next.js server starts (`pnpm dev`, `next start`, and the
// server the Electron shell spawns). Brings the local Ollama SERVER up in the
// background (cheap) without blocking startup. It does NOT load the model: that
// is ~12 GB and loads on the first call that needs it (AI_OS_AI_PREWARM=1 opts
// back in to loading it here). Stopping the server is
// src/lib/ai-runtime/lifecycle.ts's job (exit hook) and, for the desktop app,
// desktop/main.cjs calling /api/ai/runtime/stop.
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
