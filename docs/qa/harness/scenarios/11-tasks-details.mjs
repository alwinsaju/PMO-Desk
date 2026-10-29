import { connect, sleep, DESCRIBE } from "file:///C:/Projects/AI%20OS/docs/qa/harness/cdp.mjs";
import { cardButton } from "./lib.mjs";
const c = await connect();
const r = await c.eval(cardButton("December Disconnect", "Details")); await c.click(r.x, r.y); await sleep(1500);
const d = await c.eval("document.querySelector('[role=dialog]')?.innerText||''");
console.log(d.slice(0, 1800).split(String.fromCharCode(10)).join(" | "));
console.log((await c.eval(DESCRIBE)).interactive.filter(i=>i.y>60&&i.x>300&&i.x<1300).map(i=>`${i.tag}${i.role?'['+i.role+']':''} "${i.label}"`).join("; ").slice(-900));
console.log(await c.shot("12-dd-details"));
c.close();
