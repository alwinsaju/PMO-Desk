// Times one case on one model straight against Ollama (no 280 s cap) and reports token counts.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../..");
const src = (p) => import(pathToFileURL(path.join(root, "src", p)).href);
const { AiModelTasksSchema } = await src("lib/pmo/types.ts");
const { toOllamaFormat, loadAiRuntimeConfig } = await src("lib/ai-runtime/core.ts");
const { buildSystemPrompt, buildUserPrompt } = await src("lib/pmo/structurePrompt.ts");
const { prepareForModelDetailed } = await src("lib/pmo/preprocess.ts");
const { CASES, ME, NOW, TIME_ZONE } = await import(pathToFileURL(path.join(here, "cases.mjs")).href);
const [model, id] = process.argv.slice(2);
const c = CASES.find((x) => x.id.startsWith(id));
const body = prepareForModelDetailed(c.intake).text;
const config = loadAiRuntimeConfig();
const t0 = Date.now();
const res = await fetch(`${config.baseUrl}/api/chat`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    model, stream: false, think: false, format: toOllamaFormat(AiModelTasksSchema),
    options: { temperature: 0, num_ctx: config.numCtx, num_predict: config.maxOutputTokens },
    keep_alive: "2m",
    messages: [
      { role: "system", content: buildSystemPrompt(ME, TIME_ZONE) },
      { role: "user", content: buildUserPrompt(c.intake, body, NOW, TIME_ZONE) },
    ],
  }),
  signal: AbortSignal.timeout(900_000),
});
const j = await res.json();
console.log(JSON.stringify({
  model, id: c.id, wallSeconds: Math.round((Date.now() - t0) / 1000), status: res.status,
  loadS: Math.round((j.load_duration ?? 0) / 1e9), promptTokens: j.prompt_eval_count, promptS: Math.round((j.prompt_eval_duration ?? 0) / 1e9),
  outTokens: j.eval_count, genS: Math.round((j.eval_duration ?? 0) / 1e9), tokPerS: +(j.eval_count / ((j.eval_duration ?? 1) / 1e9)).toFixed(2),
  doneReason: j.done_reason, error: j.error,
}));
console.log(String(j.message?.content ?? "").slice(0, 1500));
