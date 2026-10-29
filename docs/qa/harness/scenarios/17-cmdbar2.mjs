import { connect, sleep, DESCRIBE } from "file:///C:/Projects/AI%20OS/docs/qa/harness/cdp.mjs";
const c = await connect();
await c.clickSel("button[aria-label]", "AI agent"); await sleep(1200);
const d = await c.eval(DESCRIBE);
console.log((d.text.split("AI ACTIVITY")[1]||"").slice(0, 700).split(String.fromCharCode(10)).join(" | "));
console.log(await c.shot("17-ai-history"));
// try the API directly (same-origin POST from the page, as the UI does) to see the failure contract
const r = await c.eval(`fetch('/api/ai/command',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({command:'open notes',windows:[]})}).then(async r=>r.status+' '+(await r.text()).slice(0,400))`);
console.log("direct:", r);
c.close();
