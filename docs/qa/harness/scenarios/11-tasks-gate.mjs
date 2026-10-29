import { connect, sleep, DESCRIBE } from "file:///C:/Projects/AI%20OS/docs/qa/harness/cdp.mjs";
const c = await connect();
await c.clickSel("button", "Answer questions"); await sleep(2000);
const d = await c.eval(DESCRIBE);
console.log(d.text.slice(0, 200));
console.log(d.interactive.filter(i=>i.y>60).map(i=>`${i.tag}${i.role?'['+i.role+']':''} "${i.label}"${i.dis?' DIS':''}`).join("; ").slice(0, 1500));
console.log(await c.shot("11-tasks-form-gate"));
c.close();
