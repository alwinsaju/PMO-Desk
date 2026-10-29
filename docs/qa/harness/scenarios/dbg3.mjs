import { connect, sleep } from "file:///C:/Projects/AI%20OS/docs/qa/harness/cdp.mjs";
const c = await connect(); await sleep(300);
const b = await c.rectOf("[role=dialog] button", "Not now"); if (b) await c.click(b.x, b.y); await sleep(600);
console.log("dialog open:", await c.eval("!!document.querySelector('[role=dialog]')"));
await c.clickSel("button[aria-label]", "PMO To-Do"); await sleep(2500); c.close();
