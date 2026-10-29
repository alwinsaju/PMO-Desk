import { connect, sleep, DESCRIBE } from "file:///C:/Projects/AI%20OS/docs/qa/harness/cdp.mjs";
const c = await connect();
await c.press("Escape"); await sleep(400);
const sh = async (n) => console.log(await c.shot(n));
await c.clickSel("input[aria-label='Ask the AI agent']"); await c.insert("open the notes app and write a grocery list"); await sleep(300);
console.log("send enabled:", await c.eval(`![...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==='Send').disabled`));
const t0 = Date.now(); await c.press("Enter");
for (let i = 0; i < 40; i++) { await sleep(500); const t = await c.eval("document.body.innerText"); if (/couldn|not running|unavailable|failed|error|try again/i.test(t.split("AI ACTIVITY")[1] || "")) { console.log("response after ms", Date.now() - t0); break; } }
await sleep(1000);
const txt = await c.eval("document.body.innerText"); console.log("AI ACTIVITY panel:", (txt.split("AI ACTIVITY")[1]||"").slice(0, 500).split(String.fromCharCode(10)).join(" | "));
console.log("windows now:", await c.eval("document.querySelectorAll('[data-window-chrome]').length"), "input value:", JSON.stringify(await c.eval("document.querySelector(\"input[aria-label='Ask the AI agent']\").value")));
await sh("17-cmdbar-after");
c.close();
