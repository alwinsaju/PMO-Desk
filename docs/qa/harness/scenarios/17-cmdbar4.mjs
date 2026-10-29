import { connect, sleep } from "file:///C:/Projects/AI%20OS/docs/qa/harness/cdp.mjs";
const c = await connect();
const probe = `(()=>{const ps=[...document.querySelectorAll('p')].filter(p=>p.closest('.pointer-events-none')&&p.innerText.trim()); return JSON.stringify(ps.map(p=>({t:p.innerText.slice(0,120),o:getComputedStyle(p).opacity})))})()`;
console.log("before:", await c.eval(probe));
// make sure a window is focused: click on PMO window body
await c.click(700, 600); await sleep(300);
await c.clickSel("input[aria-label='Ask the AI agent']"); await c.insert("summarise my notes"); 
const t0 = Date.now(); await c.press("Enter");
let shot=false;
for (let i = 0; i < 80; i++) { await sleep(150); const p = await c.eval(probe); const arr = JSON.parse(p); if (arr.some(a=>+a.o>0.5)) { if(!shot){shot=true; console.log("visible after ms", Date.now()-t0, p); console.log(await c.shot("17-cmdbar-notice"));} } else if (shot) { console.log("hidden after ms", Date.now()-t0); break; } }
c.close();
