import { connect, sleep } from "file:///C:/Projects/AI%20OS/docs/qa/harness/cdp.mjs";
const c = await connect();
console.log("fx:", await c.eval("document.documentElement.dataset.fx||'(lean)'"));
c.close();
