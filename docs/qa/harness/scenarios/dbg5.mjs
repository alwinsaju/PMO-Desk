import { connect, sleep } from "file:///C:/Projects/AI%20OS/docs/qa/harness/cdp.mjs";
const c = await connect();
await c.press("Escape"); await sleep(400);
await c.clickSel("button[aria-label=Settings]"); await sleep(900);
console.log(JSON.stringify(await c.eval(`[...document.querySelectorAll('[role^=menu]')].map(e=>e.getAttribute('role')+':'+(e.innerText||'').replace(/\s+/g,' ').slice(0,50))`)));
console.log(await c.shot("18-menu-debug"));
c.close();
