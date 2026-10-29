import { connect, sleep } from "file:///C:/Projects/AI%20OS/docs/qa/harness/cdp.mjs";
const c = await connect();
console.log(await c.eval(`document.visibilityState+' focus='+document.hasFocus()`));
console.log(await c.eval(`new Promise(r=>{let n=0;const t=performance.now();function f(){n++; if(performance.now()-t>1000) r('frames in 1s: '+n); else requestAnimationFrame(f)}; requestAnimationFrame(f); setTimeout(()=>r('rAF stalled n='+n),1500)})`));
console.log(await c.eval(`[...document.querySelectorAll('[role=dialog],[data-state]')].filter(e=>e.getAttribute('role')==='dialog'||/dialog|overlay/i.test(e.className)).map(e=>e.tagName+' '+e.getAttribute('data-state')+' op='+getComputedStyle(e).opacity).slice(0,8)`));
c.close();
