import { connect, sleep, DESCRIBE } from "file:///C:/Projects/AI%20OS/docs/qa/harness/cdp.mjs";
const c = await connect();
const items = () => c.eval(`JSON.stringify([...document.querySelectorAll('[role=menu] [role^=menuitem]')].map(e=>e.innerText.replace(/\s+/g,' ').trim()))`);
await c.rightClick(700, 500); await sleep(500); console.log("desktop ctx:", await items()); console.log(await c.shot("21-desktop-ctx")); await c.press("Escape"); await sleep(300);
const r = await c.rectOf("button[aria-label=Notes]"); await c.rightClick(r.x, r.y); await sleep(500); console.log("dock tile ctx:", await items()); console.log(await c.shot("21-dock-ctx")); await c.press("Escape"); await sleep(300);
await c.hover(r.x, r.y); await sleep(900); console.log("tooltip:", await c.eval(`[...document.querySelectorAll('[role=tooltip]')].map(e=>e.innerText)`)); await c.hover(10, 400);
// keyboard: tab sequence from body
await c.eval("document.activeElement.blur()");
const seq = []; for (let i = 0; i < 14; i++) { await c.press("Tab"); seq.push(await c.eval(`(()=>{const e=document.activeElement; const s=getComputedStyle(e); return (e.getAttribute('aria-label')||e.innerText||e.tagName).slice(0,20)+'|ring:'+(s.outlineStyle!=='none'||s.boxShadow!=='none')})()`)); }
console.log("tab order:", seq.join(" > "));
// Esc closes things; Enter on dock tile opens app
await c.eval("document.querySelector('button[aria-label=Notes]').focus()"); await c.press("Enter"); await sleep(1500);
console.log("Enter on focused dock tile opened window:", await c.eval("document.querySelectorAll('[data-window-chrome]').length"));
await c.press("Escape"); await sleep(300);
console.log("focus after open:", await c.eval("document.activeElement.tagName+':'+(document.activeElement.getAttribute('aria-label')||'')"));
c.close();
