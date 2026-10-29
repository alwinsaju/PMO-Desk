import { connect, sleep, DESCRIBE } from "file:///C:/Projects/AI%20OS/docs/qa/harness/cdp.mjs";
const c = await connect();
await sleep(500);

await c.clickSel("button", "PMO settings"); await sleep(1200);
const cb = await c.rectOf("[role=checkbox], input[type=checkbox], [role=switch]", "Keep running in the tray");
console.log("tray control", JSON.stringify(cb));
const lab = await c.eval(`(()=>{const e=[...document.querySelectorAll('label,[role=checkbox],[role=switch],button')].find(e=>(e.innerText||e.getAttribute('aria-label')||'').includes('Keep running in the tray')); if(!e) return null; e.scrollIntoView({block:'center'}); const r=e.getBoundingClientRect(); return {x:r.x+20,y:r.y+r.height/2,tag:e.tagName}})()`);
console.log(JSON.stringify(lab));
await c.click(lab.x, lab.y); await sleep(500);
console.log("checked now:", await c.eval(`[...document.querySelectorAll('input[type=checkbox],[role=checkbox],[role=switch]')].map(e=>(e.getAttribute('aria-checked')||e.checked))`));
await c.clickSel("button", "Save settings"); await sleep(2000);
console.log("dialog open after save:", await c.eval("!!document.querySelector('[role=dialog]')"));
console.log(await c.eval("fetch('/api/pmo/config').then(r=>r.json()).then(j=>JSON.stringify(j.config.reminders))"));
c.close();
