import { connect, sleep } from "file:///C:/Projects/AI%20OS/docs/qa/harness/cdp.mjs";
import { WINS } from "./lib.mjs";
const c = await connect();
console.log("fx:", await c.eval("document.documentElement.dataset.fx||'(lean)'"));
const names = ["Files","Notes","Tasks","PMO To-Do","App Store","Files","Notes","Tasks","PMO To-Do","App Store"];
for (const n of names) { const before = JSON.parse(await c.eval(WINS)).length; for (let k = 0; k < 3; k++) { await c.clickSel("button[aria-label]", n); await sleep(700); if (JSON.parse(await c.eval(WINS)).length > before) break; } }
console.log("windows", JSON.parse(await c.eval(WINS)).length); await sleep(2000);
c.close();
