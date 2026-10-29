import { connect, sleep } from "file:///C:/Projects/AI%20OS/docs/qa/harness/cdp.mjs";
import { WINS } from "./lib.mjs";
const c = await connect();
console.log("fx:", await c.eval("document.documentElement.dataset.fx||'(lean)'"), "gpu:", await c.eval(`(()=>{const gl=document.createElement('canvas').getContext('webgl'); if(!gl) return 'no webgl'; const e=gl.getExtension('WEBGL_debug_renderer_info'); return e? gl.getParameter(e.UNMASKED_RENDERER_WEBGL):'?'})()`));
const probe = `(()=>{ window.__fr=[]; let last=performance.now(); window.__frOn=true; function f(t){ if(!window.__frOn) return; window.__fr.push(t-last); last=t; requestAnimationFrame(f)} requestAnimationFrame(f); })()`;
const stop = `(()=>{ window.__frOn=false; const a=window.__fr.slice(1).sort((x,y)=>x-y); const n=a.length; return JSON.stringify({frames:n, p50:a[Math.floor(n*.5)]?.toFixed(1), p95:a[Math.floor(n*.95)]?.toFixed(1), max:a[n-1]?.toFixed(1)}) })()`;
const idle = async (label) => { await c.eval(probe); await sleep(2500); console.log(label, await c.eval(stop)); };
await c.send("Page.reload"); await sleep(4000);
await idle("0 windows");
const seq = ["Files","Notes","Tasks","PMO To-Do","App Store"];
for (const n of seq) { const before = JSON.parse(await c.eval(WINS)).length; for (let k = 0; k < 3; k++) { await c.clickSel("button[aria-label]", n); await sleep(800); if (JSON.parse(await c.eval(WINS)).length > before) break; } await sleep(800); await idle(`+${n} => ${JSON.parse(await c.eval(WINS)).length} windows`); }
c.close();
