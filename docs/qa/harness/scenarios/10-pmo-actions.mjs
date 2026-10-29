import { connect, sleep, DESCRIBE } from "file:///C:/Projects/AI%20OS/docs/qa/harness/cdp.mjs";
const c = await connect();
const txt = async (n=900) => (await c.eval(DESCRIBE)).text.slice(0, n).replace(/\n+/g, " | ");
// close dialog, look at filter chips
await c.clickSel("button", "Close"); await sleep(600);
console.log((await txt(900)));
await c.clickSel("button", "Waiting"); await sleep(600);
console.log("waiting filter:", (await txt(1200)).split("Sort")[1]?.slice(0,400));
// New todo dialog
await c.clickSel("button", "New to-do"); await sleep(900);
console.log("NEW:", (await c.eval(DESCRIBE)).interactive.filter(i=>i.y>60).map(i=>`${i.tag} "${i.label}"`).slice(-25).join("; "));
console.log(await c.shot("10-pmo-new"));
await c.press("Escape"); await sleep(500);
console.log("dialog after Esc:", await c.eval("!!document.querySelector('[role=dialog]')"));
// Paste dialog
await c.clickSel("button", "Paste a message"); await sleep(900);
console.log("PASTE:", (await c.eval(DESCRIBE)).interactive.filter(i=>i.y>60).map(i=>`${i.tag} "${i.label}"`).slice(-12).join("; "));
console.log(await c.shot("10-pmo-paste"));
c.close();
