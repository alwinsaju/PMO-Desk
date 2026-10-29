import { connect, sleep, DESCRIBE } from "file:///C:/Projects/AI%20OS/docs/qa/harness/cdp.mjs";
const c = await connect();
await c.clickSel("button", "Model not running"); await sleep(1500);
let d = await c.eval(DESCRIBE);
const dlg = await c.eval("[...document.querySelectorAll('[role=dialog],[role=menu],[data-radix-popper-content-wrapper]')].map(e=>e.innerText.replace(/\s+/g,' ').slice(0,700))");
console.log("STATUS CARD:", JSON.stringify(dlg).slice(0, 1200));
console.log(d.interactive.filter(i=>i.y>60&&i.x>400).map(i=>`${i.tag} "${i.label}"`).join("; ").slice(0,700));
console.log(await c.shot("17-model-card"));
c.close();
