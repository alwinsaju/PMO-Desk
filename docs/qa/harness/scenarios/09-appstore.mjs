import { connect, sleep, DESCRIBE } from "file:///C:/Projects/AI%20OS/docs/qa/harness/cdp.mjs";
const c = await connect();
const dock = () => c.eval(`[...document.querySelectorAll('button[aria-label]')].filter(b=>{const r=b.getBoundingClientRect();return r.y<100&&r.y>0&&r.height>30&&r.x>400&&r.x<1000}).map(b=>b.getAttribute('aria-label')).join(',')`);
console.log("dock before:", await dock());
await c.clickSel("input[aria-label='Search apps']"); await c.insert("wiki"); await sleep(600);
console.log(await c.eval(`document.body.innerText.includes('Wikipedia')`));
console.log(await c.shot("09-appstore-search"));
// click Install of Wikipedia
const r = await c.rectOf("button", "Install"); console.log("install btn", JSON.stringify(r));
await c.click(r.x, r.y); await sleep(1500);
console.log("dock after install:", await dock());
console.log(await c.shot("09-appstore-installed"));
// click the app card to see detail
await c.clickSel("button, [role=button]", "Wikipedia"); await sleep(1000);
const d = await c.eval(DESCRIBE); console.log(d.text.slice(0, 600).replace(/\s+/g, " "));
console.log(await c.shot("09-appstore-detail"));
c.close();
