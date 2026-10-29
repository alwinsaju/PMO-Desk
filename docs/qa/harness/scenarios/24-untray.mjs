import { connect, sleep } from "file:///C:/Projects/AI%20OS/docs/qa/harness/cdp.mjs";
const c = await connect();
await c.press("Escape"); await sleep(300);
await c.clickSel("button[aria-label=PMO\ To-Do]").catch(async()=>{ await c.clickSel("button[aria-label]", "PMO To-Do"); }); await sleep(2500);
await c.clickSel("button", "PMO settings"); await sleep(1200);
const lab = await c.eval(`(()=>{const e=[...document.querySelectorAll('label')].find(e=>(e.innerText||'').includes('Keep running in the tray')); e.scrollIntoView({block:'center'}); const r=e.getBoundingClientRect(); const cb=e.querySelector('input,[role=checkbox],[role=switch]'); return {x:r.x+20,y:r.y+r.height/2,checked: cb? (cb.checked ?? cb.getAttribute('aria-checked')):null}})()`);
console.log("tray checked before:", JSON.stringify(lab));
if (lab.checked === true || lab.checked === "true") { await c.click(lab.x, lab.y); await sleep(400); }
await c.clickSel("button", "Save settings"); await sleep(1500);
console.log("prefs saved");
c.close();
