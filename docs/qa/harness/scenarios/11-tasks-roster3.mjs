import { connect, sleep, DESCRIBE } from "file:///C:/Projects/AI%20OS/docs/qa/harness/cdp.mjs";
const c = await connect();
await c.clickSel("button, label, [role=radio]", "Dec 2026 - Jan 2027"); await sleep(600);
console.log(await c.shot("11-tasks-cycle-selected"));
const t0 = Date.now();
await c.clickSel("button", "Start"); 
let state = "";
for (let i = 0; i < 60; i++) { await sleep(1000); state = await c.eval(`(document.body.innerText.match(/(Needs you|Running|Review|Failed|Error)[^\n]*/g)||[]).slice(0,6).join(' | ')`); if (i % 5 === 0) console.log(i, state); if (/Needs you 1|needs? your|Answer the questions/i.test(await c.eval("document.body.innerText"))) break; }
console.log("elapsed s", (Date.now() - t0) / 1000);
let d = await c.eval(DESCRIBE);
console.log(d.text.slice(0, 1500).replace(/\n+/g, " | "));
console.log(await c.shot("11-tasks-after-start"));
c.close();
