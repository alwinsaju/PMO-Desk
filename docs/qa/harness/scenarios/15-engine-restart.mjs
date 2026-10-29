import { connect, sleep, DESCRIBE } from "file:///C:/Projects/AI%20OS/docs/qa/harness/cdp.mjs";
const c = await connect();
console.log("banner btns:", (await c.eval(DESCRIBE)).interactive.filter(i=>i.y>150&&i.y<260&&i.x>90&&i.x<800&&i.tag==='button').map(i=>i.label).join("; "));
console.log(await c.shot("15-engine-banner"));
await c.clickSel("button", "Settings"); await sleep(500);
await c.clickSel("[role=menuitem]", "Restart Tasks engine"); const t0 = Date.now();
for (let i = 0; i < 60; i++) { await sleep(500); const s = await c.eval("fetch('/api/tasks-engine/status').then(r=>r.json())"); if (s.running) { console.log("engine back after ms", Date.now() - t0, JSON.stringify(s)); break; } }
await sleep(1500);
console.log((await c.eval("document.body.innerText")).includes("Can't reach"), "banner still shown?");
console.log(await c.shot("15-engine-restarted"));
c.close();
