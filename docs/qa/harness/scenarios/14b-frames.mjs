import { connect, sleep } from "file:///C:/Projects/AI%20OS/docs/qa/harness/cdp.mjs";
import { WINS } from "./lib.mjs";
const c = await connect();
const probe = `(()=>{ window.__fr=[]; let last=performance.now(); window.__frOn=true; function f(t){ if(!window.__frOn) return; window.__fr.push(t-last); last=t; requestAnimationFrame(f)} requestAnimationFrame(f); })()`;
const stop = `(()=>{ window.__frOn=false; const a=window.__fr.slice(1).sort((x,y)=>x-y); const n=a.length; return JSON.stringify({frames:n, p50:a[Math.floor(n*.5)]?.toFixed(1), p95:a[Math.floor(n*.95)]?.toFixed(1), max:a[n-1]?.toFixed(1), over33:a.filter(x=>x>33.4).length}) })()`;
async function run(label) {
  await c.eval(probe); await sleep(3000); console.log(label, "IDLE rAF:", await c.eval(stop));
  const w = JSON.parse(await c.eval(WINS)).sort((a,b)=>b.z-a.z)[0];
  await c.eval(probe);
  const t0 = Date.now();
  await c.drag(w.x + 300, w.y + 34, w.x + 700, w.y + 200, 60);
  const dt = Date.now() - t0;
  console.log(label, "DRAG rAF:", await c.eval(stop), "drag wall ms:", dt, "(60 steps, 16ms sleep each => floor ~", 60*16, "ms)");
}
await run(process.argv[2] || "10-windows");
c.close();
