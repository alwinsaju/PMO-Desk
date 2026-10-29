import { connect, sleep } from "file:///C:/Projects/AI%20OS/docs/qa/harness/cdp.mjs";
import { WINS } from "./lib.mjs";
const c = await connect();
const mark = (n) => console.log("MARK", n, new Date().toISOString());
const frameProbe = `(()=>{ window.__fr=[]; let last=performance.now(); window.__frOn=true; function f(t){ if(!window.__frOn) return; window.__fr.push(t-last); last=t; requestAnimationFrame(f)} requestAnimationFrame(f); })()`;
const frameStop = `(()=>{ window.__frOn=false; const a=window.__fr.slice(1).sort((x,y)=>x-y); const n=a.length; return JSON.stringify({frames:n, p50:a[Math.floor(n*.5)]?.toFixed(1), p95:a[Math.floor(n*.95)]?.toFixed(1), p99:a[Math.floor(n*.99)]?.toFixed(1), max:a[n-1]?.toFixed(1), over33:a.filter(x=>x>33.4).length, over100:a.filter(x=>x>100).length}) })()`;
const ltCount = () => c.eval("window.__qaLT?window.__qaLT.length:-1");
const t0 = Date.now();
const names = ["Files","Notes","Tasks","PMO To-Do","App Store","Files","Notes","Tasks","PMO To-Do","App Store","Files","Notes"];
const opens = [];
for (const n of names) { const s = Date.now(); const before = JSON.parse(await c.eval(WINS)).length; for (let k = 0; k < 3; k++) { await c.clickSel("button[aria-label]", n); await sleep(700); if (JSON.parse(await c.eval(WINS)).length > before) break; } opens.push(Date.now() - s); await sleep(250); }
console.log("open ms each:", opens.join(","), " total windows:", JSON.parse(await c.eval(WINS)).length);
await sleep(2500);
console.log(await c.shot("14-twelve-windows"));
mark("12windows-idle-start"); await sleep(45000); mark("12windows-idle-end");
// drag top window with frame probe
let w = JSON.parse(await c.eval(WINS)).sort((a,b)=>b.z-a.z)[0];
const lt0 = await ltCount();
await c.eval(frameProbe);
await c.drag(w.x + 300, w.y + 34, w.x + 700, w.y + 200, 60);
await c.drag(w.x + 700, w.y + 200, w.x + 200, w.y + 60, 60);
console.log("DRAG frames:", await c.eval(frameStop), "longtasks during:", (await ltCount()) - lt0);
w = JSON.parse(await c.eval(WINS)).sort((a,b)=>b.z-a.z)[0];
await c.eval(frameProbe); const lt1 = await ltCount();
await c.drag(w.x + w.w - 2, w.y + w.h - 2, w.x + w.w + 150, w.y + w.h + 60, 50);
await c.drag(w.x + w.w + 148, w.y + w.h + 58, w.x + w.w - 200, w.y + w.h - 150, 50);
console.log("RESIZE frames:", await c.eval(frameStop), "longtasks during:", (await ltCount()) - lt1);
// drag while PMO is scanning + task running? just focus switching
console.log(await c.eval(`JSON.stringify({heapMB:(performance.memory.usedJSHeapSize/1e6).toFixed(1), nodes: document.getElementsByTagName('*').length, lt: window.__qaLT.length})`));
console.log(await c.shot("14-after-drag-resize"));
c.close();
