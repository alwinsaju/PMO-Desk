// Background collector: console/exception/log/network-failure events + long tasks + periodic metrics -> collector.jsonl
import fs from "node:fs";
import path from "node:path";
import { connect, sleep, RESULTS } from "file:///C:/Projects/AI%20OS/docs/qa/harness/cdp.mjs";
const out = path.join(RESULTS, "collector.jsonl");
const log = (o) => fs.appendFileSync(out, JSON.stringify({ t: new Date().toISOString(), ...o }) + "\n");
const c = await connect();
const INJECT = `(() => { if (window.__qaLT) return; window.__qaLT = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__qaLT.push({ s: Math.round(e.startTime), d: Math.round(e.duration) }); }).observe({ type: 'longtask', buffered: true }); } catch (e) {} })()`;
await c.send("Page.addScriptToEvaluateOnNewDocument", { source: INJECT });
await c.eval(INJECT);
await c.send("Log.enable"); await c.send("Network.enable"); await c.send("Performance.enable");
c.on("Runtime.consoleAPICalled", (p) => { if (["error", "warning", "assert"].includes(p.type)) log({ k: "console." + p.type, text: p.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 600) }); });
c.on("Runtime.exceptionThrown", (p) => log({ k: "exception", text: (p.exceptionDetails.exception?.description || p.exceptionDetails.text).slice(0, 800) }));
c.on("Log.entryAdded", (p) => { if (["error", "warning"].includes(p.entry.level)) log({ k: "log." + p.entry.level, text: p.entry.text.slice(0, 300), url: p.entry.url }); });
const reqs = new Map();
c.on("Network.requestWillBeSent", (p) => reqs.set(p.requestId, { url: p.request.url, method: p.request.method }));
c.on("Network.responseReceived", (p) => { const r = reqs.get(p.requestId); if (p.response.status >= 400) log({ k: "http", status: p.response.status, url: p.response.url, method: r?.method }); });
c.on("Network.loadingFailed", (p) => { const r = reqs.get(p.requestId); log({ k: "netfail", err: p.errorText, url: r?.url, method: r?.method }); });
log({ k: "collector-start" });
while (true) {
  await sleep(5000);
  try {
    const m = Object.fromEntries((await c.send("Performance.getMetrics")).metrics.map((x) => [x.name, x.value]));
    const lt = await c.eval("window.__qaLT ? window.__qaLT.length : -1");
    const heap = await c.eval("(performance.memory||{}).usedJSHeapSize||0");
    log({ k: "metrics", heap, nodes: m.Nodes, listeners: m.JSEventListeners, layoutCount: m.LayoutCount, recalc: m.RecalcStyleCount, taskDur: m.TaskDuration, scriptDur: m.ScriptDuration, lt });
  } catch (e) { log({ k: "collector-err", text: String(e).slice(0, 200) }); await sleep(2000); }
}
