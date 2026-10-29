import { connect, sleep } from "file:///C:/Projects/AI%20OS/docs/qa/harness/cdp.mjs";
import { WINS } from "./lib.mjs";
const c = await connect();
const wins = async (label) => { const w = JSON.parse(await c.eval(WINS)); console.log(label, JSON.stringify(w.map(({id,...r})=>r))); return w; };
let w = await wins("start");
// move window then maximize by double click on title
await c.dblClick(w[0].x + 500, w[0].y + 30); await sleep(900); w = await wins("dblclick title -> maximize");
console.log(await c.shot("06-maximized"));
await c.dblClick(700, w[0].y + 30); await sleep(900); w = await wins("dblclick title -> restore");
// maximize via button, restore via button
await c.clickSel("button","Maximize"); await sleep(900); await wins("max button");
await c.clickSel("button","Restore"); await sleep(900); await wins("restore button (label Restore?)");
// minimize, dock indicator, restore from dock
await c.clickSel("button","Minimize"); await sleep(900); await wins("minimized");
console.log("dock Files tile:", await c.eval(`document.querySelector('button[aria-label=Files]')?.outerHTML.slice(0,300)`));
console.log(await c.shot("06-minimized"));
await c.clickSel("button","Files"); await sleep(900); await wins("restored from dock");
// click dock Files again while focused = ?
await c.clickSel("button","Files"); await sleep(900); await wins("dock click while focused");
// open Notes + Browser, check z/focus
await c.clickSel("button","Notes"); await sleep(1200); await c.clickSel("button","Browser"); await sleep(1500);
w = await wins("3 windows");
console.log(await c.shot("06-three-windows"));
// click the first window to focus it
await c.click(w[0].x + 400, w[0].y + 400); await sleep(400); await wins("focus first by click");
// Escape / keyboard: close focused window by clicking Close
await c.clickSel("button","Close"); await sleep(700); await wins("closed one (which?)");
c.close();
