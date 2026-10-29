import { connect, sleep, DESCRIBE } from "file:///C:/Projects/AI%20OS/docs/qa/harness/cdp.mjs";
const c = await connect();
await c.clickSel("button", "Send consolidated RAID log to Pat Owner"); await sleep(1500);
const d = await c.eval(DESCRIBE);
console.log(d.text.slice(0, 2500).replace(/\n+/g, " | "));
console.log(d.interactive.filter(i=>i.y>60 && !/^(Files|Notes|Browser|Tasks|App Store|PMO To-Do|Open )/.test(i.label)).map((i) => `${i.tag}${i.role ? "[" + i.role + "]" : ""} "${i.label}" @${i.x},${i.y}${i.dis ? " DIS" : ""}`).join("\n"));
console.log(await c.shot("10-pmo-detail"));
c.close();
