import { connect, sleep, DESCRIBE } from "file:///C:/Projects/AI%20OS/docs/qa/harness/cdp.mjs";
const c = await connect();
await c.clickSel("[role=dialog] button","Cancel").catch(()=>{}); await sleep(500);
console.log("fx mode before:", await c.eval("document.documentElement.dataset.fx||'(none)'"), "aiOsDesktop:", await c.eval("JSON.stringify({d:window.aiOsDesktop?.isDesktop,m:window.aiOsDesktop?.displayMode})"));
await c.press("Escape"); await sleep(300); if (!(await c.rectOf("[role=menu]"))) { await c.clickSel("button[aria-label=Settings]"); await sleep(700); }
await c.clickSel("[role=menuitemcheckbox]", "Hardware acceleration"); await sleep(1200);
const t = await c.eval("document.querySelector('[role=menu]')?.innerText||''"); console.log(t.split(String.fromCharCode(10)).join(" | "));
console.log(await c.shot("18-hwaccel-menu"));
console.log("restart btn:", JSON.stringify(await c.rectOf("[role=menu] button, [role=menuitem]", "Restart")));
c.close();
