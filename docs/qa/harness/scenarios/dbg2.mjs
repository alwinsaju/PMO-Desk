import { connect, sleep } from "file:///C:/Projects/AI%20OS/docs/qa/harness/cdp.mjs";
const c = await connect(); await c.send("Page.reload"); await sleep(3500); await c.clickSel("button","Files"); await sleep(1500); c.close();
