import { connect, sleep, DESCRIBE } from "file:///C:/Projects/AI%20OS/docs/qa/harness/cdp.mjs";
const c = await connect();
await c.clickSel("button[role=tab]", "Reports"); await sleep(600);
await c.clickSel("button", "Generate"); await sleep(2500);
let d = await c.eval(DESCRIBE);
console.log(d.text.slice(0, 2500).replace(/\n+/g, " | ").split("PERIOD")[1]?.slice(0,1800));
console.log(d.interactive.filter(i=>i.y>200&&i.tag==='button'&&i.x>100).map(i=>`"${i.label}"${i.dis?' DIS':''}`).join("; "));
console.log(await c.shot("10-pmo-report"));
c.close();
