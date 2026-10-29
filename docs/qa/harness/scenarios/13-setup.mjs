import { connect, sleep, DESCRIBE } from "file:///C:/Projects/AI%20OS/docs/qa/harness/cdp.mjs";
const c = await connect();
await c.clickSel("button", "Settings"); await sleep(600);
await c.clickSel("[role=menuitem]", "Setup and health check"); await sleep(2500);
const d = await c.eval(DESCRIBE);
console.log(d.text.slice(0, 2500).split(String.fromCharCode(10)).join(" | "));
console.log(d.interactive.filter(i=>i.y>60&&i.x>300&&i.x<1300).map(i=>`${i.tag}${i.role?'['+i.role+']':''} "${i.label}"${i.dis?' DIS':''}`).join("; ").slice(0,1200));
console.log(await c.shot("13-setup"));
c.close();
