import { connect, sleep } from "file:///C:/Projects/AI%20OS/docs/qa/harness/cdp.mjs";
const c = await connect();
const before = await c.eval("document.body.innerText");
await c.clickSel("input[aria-label='Ask the AI agent']"); await c.insert("open notes"); 
const t0 = Date.now(); await c.press("Enter");
let seen = null, first = null, last = null, shot = false;
for (let i = 0; i < 150; i++) { await sleep(100); const t = await c.eval("document.body.innerText"); const add = t.split(String.fromCharCode(10)).filter(l => !before.includes(l) && l.trim()); if (add.length) { first ??= Date.now() - t0; last = Date.now() - t0; seen = add.join(" | "); if (!shot) { shot = true; console.log(await c.shot("17-cmdbar-notice")); } } else if (seen && Date.now() - t0 > last + 1500) break; }
console.log("new text:", seen, "first ms", first, "last ms", last);
c.close();
