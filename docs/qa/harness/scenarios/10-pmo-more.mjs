import { connect, sleep, DESCRIBE } from "file:///C:/Projects/AI%20OS/docs/qa/harness/cdp.mjs";
const c = await connect();
await c.clickSel("button", "+2 more"); await sleep(800);
let d = await c.eval(DESCRIBE); console.log("NOTICES:", d.text.slice(0, 1200).replace(/\n+/g, " | "));
console.log(await c.shot("10-pmo-notices"));
await c.clickSel("button", "PMO settings"); await sleep(1200);
d = await c.eval(DESCRIBE); console.log("SETTINGS:", d.text.slice(0, 3000).replace(/\n+/g, " | "));
console.log(await c.shot("10-pmo-settings"));
c.close();
