import { connect, sleep, DESCRIBE } from "file:///C:/Projects/AI%20OS/docs/qa/harness/cdp.mjs";
import { cardButton } from "./lib.mjs";
const BS = String.fromCharCode(92);
const FIX = process.argv[2].split("/").join(BS);
const c = await connect();
const cardText = () => c.eval(`(()=>{const h=[...document.querySelectorAll('h2,h3,[class*=title]')].find(h=>h.innerText.trim()==='Shift Roster'); let e=h; for(let i=0;i<6&&e;i++){ if(e.querySelector('button')) return e.innerText.replace(/\s+/g,' ').slice(0,260); e=e.parentElement;} return ''})()`);
const r = await c.eval(cardButton("Shift Roster", "Run")); await c.click(r.x, r.y); await sleep(1200);
await c.send("DOM.enable");
const up = async (idx, f) => { const doc = await c.send("DOM.getDocument", { depth: 1 }); const ids = (await c.send("DOM.querySelectorAll", { nodeId: doc.root.nodeId, selector: "input[type=file]" })).nodeIds; await c.send("DOM.setFileInputFiles", { nodeId: ids[idx], files: [FIX + BS + "input" + BS + f] }); await sleep(2500); };
await up(0, "roster.xlsx"); await up(1, "holiday-roster.xlsx");
await c.clickSel("[role=dialog] button", "Check"); await sleep(4000);
await c.clickSel("[role=dialog] [role=radio]", "Dec 2026 - Jan 2027"); await sleep(500);
await c.clickSel("[role=dialog] button", "Start");
const t0 = Date.now();
for (let i = 0; i < 40; i++) { const t = await cardText(); if (/Running|Step 1/.test(t)) { console.log("running seen after ms", Date.now() - t0, "|", t); break; } await sleep(100); }
const fr = await c.eval(cardButton("Shift Roster", "Force reset")); console.log("force reset btn", JSON.stringify(fr));
if (fr) { await c.click(fr.x, fr.y); await sleep(1500); console.log("dialog:", await c.eval("[...document.querySelectorAll('[role=dialog],[role=alertdialog]')].map(d=>d.innerText.replace(/\s+/g,' ').slice(0,300))")); console.log(await c.shot("11-tasks-force-confirm")); }
c.close();
