import { connect, sleep, DESCRIBE } from "file:///C:/Projects/AI%20OS/docs/qa/harness/cdp.mjs";
const c = await connect();
await c.clickSel("button", "Write highlights with AI"); await sleep(4000);
console.log("narrative:", (await c.eval("document.querySelector('textarea')?.value")||"").slice(0,700));
await c.clickSel("button", "Save"); await sleep(1500);
console.log((await c.eval(DESCRIBE)).text.split("PREVIOUS REPORTS")[1]?.slice(0,300).replace(/\n+/g," | "));
console.log(await c.shot("10-pmo-report-saved"));
c.close();
