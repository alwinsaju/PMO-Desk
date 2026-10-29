import { connect, DESCRIBE, sleep } from "file:///C:/Projects/AI%20OS/docs/qa/harness/cdp.mjs";
import { WINS } from "./lib.mjs";
const c = await connect();
const wins = async (label) => { const w = JSON.parse(await c.eval(WINS)); console.log(label, JSON.stringify(w)); return w; };
await c.clickSel("button","Files"); await sleep(1500); let w = await wins("start");
const f = w[0];
// drag by title bar
await c.drag(f.x + 300, f.y + 34, f.x + 300 + 150, f.y + 34 + 120);
await sleep(400); w = await wins("after drag +150,+120");
// resize bottom-right corner
const g = w[0];
await c.drag(g.x + g.w - 2, g.y + g.h - 2, g.x + g.w - 202, g.y + g.h - 152);
await sleep(400); w = await wins("after resize -200,-150");
// resize below min?
const g2 = w[0];
await c.drag(g2.x + g2.w - 2, g2.y + g2.h - 2, g2.x + 100, g2.y + 100);
await sleep(400); w = await wins("after shrink to tiny");
console.log(await c.shot("06-shrunk"));
// drag partly off-screen
const g3 = w[0];
await c.drag(g3.x + 100, g3.y + 30, -400, -300, 20);
await sleep(400); w = await wins("after drag far off top-left");
console.log(await c.shot("06-offscreen-drag"));
// double click title to maximize
const g4 = w[0];
await c.dblClick(Math.max(g4.x + 60, 60), Math.max(g4.y + 30, 30));
await sleep(900); w = await wins("after dblclick title");
console.log(await c.shot("06-maximized"));
await c.dblClick(700, w[0].y + 30);
await sleep(900); w = await wins("after dblclick again");
c.close();
