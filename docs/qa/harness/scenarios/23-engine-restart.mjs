import { connect, sleep } from "file:///C:/Projects/AI%20OS/docs/qa/harness/cdp.mjs";
const c = await connect();
await c.press("Escape"); await sleep(300);
await c.clickSel("button[aria-label=Settings]"); await sleep(700);
await c.clickSel("[role=menuitem]", "Restart Tasks engine"); const t0 = Date.now();
for (let i = 0; i < 80; i++) { await sleep(400); const s = await c.eval("fetch('/api/tasks-engine/status').then(r=>r.json())"); if (s.running && Date.now() - t0 > 2500) { console.log("engine back ms", Date.now() - t0); break; } }
c.close();
