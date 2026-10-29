import { connect, sleep } from "file:///C:/Projects/AI%20OS/docs/qa/harness/cdp.mjs";
const c = await connect();
await c.clickSel("button", "Cancel").catch(()=>{});
await sleep(300);
await c.send("Page.close");
c.close();
