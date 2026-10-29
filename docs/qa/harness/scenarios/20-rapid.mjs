import { connect, sleep } from "file:///C:/Projects/AI%20OS/docs/qa/harness/cdp.mjs";
import { WINS } from "./lib.mjs";
const c = await connect();
await c.send("Page.reload"); await sleep(3500);
const heap0 = await c.eval("performance.memory.usedJSHeapSize");
const nodes0 = await c.eval("document.getElementsByTagName('*').length");
const t0 = Date.now();
let maxWins = 0;
for (let i = 0; i < 60; i++) {
  const name = ["Notes", "Files", "Browser", "Tasks", "App Store", "PMO To-Do"][i % 6];
  await c.eval(`document.querySelector('button[aria-label="${name}"]').click()`);
  await sleep(40);
  const w = JSON.parse(await c.eval(WINS)); maxWins = Math.max(maxWins, w.length);
  if (i % 2 === 1) { // close the newest window immediately via its Close button
    await c.eval(`(()=>{const ws=[...document.querySelectorAll('[data-window-chrome]')]; const top=ws.sort((a,b)=>getComputedStyle(b).zIndex-getComputedStyle(a).zIndex)[0]; top&&[...top.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==='Close')?.click()})()`);
    await sleep(30);
  }
}
await sleep(2500);
const left = JSON.parse(await c.eval(WINS)).length;
console.log("60 rapid opens (every 2nd closed): max concurrent", maxWins, "left", left, "ms", Date.now() - t0);
// close all the rest
for (let k = 0; k < 40; k++) { const n = await c.eval(`(()=>{const b=[...document.querySelectorAll('[data-window-chrome] button')].find(b=>b.getAttribute('aria-label')==='Close'); if(!b) return 0; b.click(); return 1})()`); if (!n) break; await sleep(350); }
await sleep(1500);
console.log("windows after closing all:", JSON.parse(await c.eval(WINS)).length, "heap delta MB", ((await c.eval("performance.memory.usedJSHeapSize")) - heap0) / 1e6, "nodes", nodes0, "->", await c.eval("document.getElementsByTagName('*').length"));
console.log(await c.shot("20-after-rapid"));
c.close();
