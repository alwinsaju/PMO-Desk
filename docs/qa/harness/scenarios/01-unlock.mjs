import { connect, DESCRIBE, sleep } from "file:///C:/Projects/AI%20OS/docs/qa/harness/cdp.mjs";
const c = await connect();
// keyboard/focus on the lock screen: where is focus, can Tab escape to the dock behind the overlay?

await c.clickSel("input[aria-label=Password]");
const t0 = Date.now();
await c.press("Enter");
await c.waitFor("!document.querySelector('input[aria-label=Password]')", 10000);
console.log("unlock transition ms:", Date.now() - t0);
await sleep(1500);
const d = await c.eval(DESCRIBE);
console.log(d.text.slice(0, 800));
console.log(d.interactive.map((i) => `${i.tag} "${i.label}" @${i.x},${i.y} ${i.w}x${i.h}`).join("\n"));
console.log(await c.shot("02-desktop-after-unlock"));
c.close();
