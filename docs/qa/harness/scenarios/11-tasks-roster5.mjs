import { connect, sleep, DESCRIBE } from "file:///C:/Projects/AI%20OS/docs/qa/harness/cdp.mjs";
const c = await connect();
const dlg = () => c.eval("!!document.querySelector('[role=dialog]')");
await c.clickSel("[role=dialog] [role=radio]", "Dec 2026 - Jan 2027"); await sleep(600);
console.log("dialog", await dlg(), "start disabled?", await c.eval(`[...document.querySelectorAll('[role=dialog] button')].find(b=>b.innerText.trim()==='Start')?.disabled`));
console.log(await c.shot("11-tasks-cycle-selected"));
const t0 = Date.now();
await c.clickSel("[role=dialog] button", "Start");
for (let i = 0; i < 90; i++) {
  await sleep(1000);
  const t = await c.eval("document.body.innerText");
  const hasGate = /Answer the questions|questions need your answer|Needs you 1/i.test(t) && !(await c.eval("!!document.querySelector('[role=dialog]')")) ;
  if (i % 6 === 0) console.log(i, "dialog:", await dlg(), (t.match(/Shift Roster[\s\S]{0,160}/)||[''])[0].replace(/\n+/g," | "));
  if (hasGate) break;
}
console.log("elapsed s", (Date.now() - t0) / 1000);
console.log(await c.shot("11-tasks-after-start"));
c.close();
