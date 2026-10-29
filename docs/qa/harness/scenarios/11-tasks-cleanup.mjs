import { connect, sleep } from "file:///C:/Projects/AI%20OS/docs/qa/harness/cdp.mjs";
import { cardButton } from "./lib.mjs";
const c = await connect();
await c.clickSel("[role=dialog] button", "Close"); await sleep(600);
for (const n of ["December Disconnect", "Shift Roster"]) { const r = await c.eval(cardButton(n, "Reject")); if (r) { await c.click(r.x, r.y); await sleep(1500); } console.log(n, "reject", !!r); }
console.log((await c.eval("document.body.innerText")).match(/\d+ need you[^\n]*/)?.[0]);
c.close();
