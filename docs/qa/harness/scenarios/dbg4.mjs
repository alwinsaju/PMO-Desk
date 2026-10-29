import { connect, sleep } from "file:///C:/Projects/AI%20OS/docs/qa/harness/cdp.mjs";
const c = await connect();
const r = await c.rectOf("[role=dialog] button", "Close"); console.log(JSON.stringify(r)); await c.click(r.x, r.y); await sleep(700);
console.log("dialog:", await c.eval("!!document.querySelector('[role=dialog]')"));
c.close();
