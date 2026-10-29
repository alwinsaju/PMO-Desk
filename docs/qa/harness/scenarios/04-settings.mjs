import { connect, DESCRIBE, sleep } from "file:///C:/Projects/AI%20OS/docs/qa/harness/cdp.mjs";
const c = await connect();
await c.clickSel("button", "Settings");
await sleep(700);
const d = await c.eval(DESCRIBE);
console.log(d.interactive.filter(i=>i.y>60 && i.x>1000).map((i) => `${i.tag}[${i.role}] "${i.label}" @${i.x},${i.y} ${i.w}x${i.h}`).join("\n"));
console.log(await c.shot("04-settings-menu"));
c.close();
