import { connect, sleep } from "file:///C:/Projects/AI%20OS/docs/qa/harness/cdp.mjs";
const c = await connect();
// close PMO window
await c.send("Page.reload"); await sleep(3500);
await c.clickSel("button","Tasks"); await sleep(3500);
console.log("ok");
c.close();
