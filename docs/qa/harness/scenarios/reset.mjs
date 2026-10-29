import { connect, sleep } from "file:///C:/Projects/AI%20OS/docs/qa/harness/cdp.mjs";
const c = await connect(); await c.send("Page.reload"); await sleep(3500); console.log("reloaded", await c.eval("document.title")); c.close();
