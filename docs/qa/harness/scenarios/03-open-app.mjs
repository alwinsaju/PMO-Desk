// usage: 03-open-app.mjs <dock button label> <shot name>
import { connect, DESCRIBE, sleep } from "file:///C:/Projects/AI%20OS/docs/qa/harness/cdp.mjs";
const [label, name] = process.argv.slice(2);
const c = await connect();
const t0 = Date.now();
await c.clickSel("button", label);
await sleep(300);
const first = await c.eval(`document.querySelectorAll('[role=dialog],[data-window-id]').length`);
await sleep(1500);
const d = await c.eval(DESCRIBE);
console.log("ms since click:", Date.now() - t0);
console.log(d.text.slice(0, 1200));
console.log(d.interactive.map((i) => `${i.tag}${i.role ? "[" + i.role + "]" : ""} "${i.label}" @${i.x},${i.y} ${i.w}x${i.h}${i.dis ? " DIS" : ""}`).join("\n"));
console.log(await c.shot(name));
c.close();
