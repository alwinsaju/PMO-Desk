import { connect, sleep } from "file:///C:/Projects/AI%20OS/docs/qa/harness/cdp.mjs";
const c = await connect();
await c.press("Escape"); await sleep(300);
await c.clickSel("button[aria-label=Settings]"); await sleep(800);
const r = await c.rectOf("[role=menu] button, [role=menu] [role=menuitem], [role=menuitem]", "Restart to apply");
console.log("restart item", JSON.stringify(r));
await c.click(r.x, r.y);
console.log("clicked restart", new Date().toISOString());
c.close();
