import { connect, sleep } from "file:///C:/Projects/AI%20OS/docs/qa/harness/cdp.mjs";
const c = await connect();
await c.send("Page.reload"); await sleep(3500);
await c.clickSel("button[aria-label=Settings]"); await sleep(900);
console.log((await c.eval("document.querySelector('[role=menu]')?.innerText||''")).split(String.fromCharCode(10)).join(" | "));
console.log(JSON.stringify(await c.eval("window.aiOsDesktop.display.getState()")));
console.log(await c.shot("18-gpu-state-menu"));
c.close();
