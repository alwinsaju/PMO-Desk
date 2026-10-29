import { connect, sleep } from "file:///C:/Projects/AI%20OS/docs/qa/harness/cdp.mjs";
const c = await connect();
const open = async () => { if (!(await c.rectOf("[role=menu]"))) { await c.clickSel("button[aria-label=Settings]"); await sleep(800); } };
await open();
await c.clickSel("[role=menuitemcheckbox]", "Hardware acceleration"); await sleep(1200);
await open();
const r = await c.rectOf("[role=menuitem]", "Restart to apply"); console.log("restart item", JSON.stringify(r));
await c.click(r.x, r.y); console.log("clicked restart", new Date().toISOString());
c.close();
