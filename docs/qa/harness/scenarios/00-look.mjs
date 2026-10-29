import { connect, DESCRIBE } from "file:///C:/Projects/AI%20OS/docs/qa/harness/cdp.mjs";
const c = await connect();
const name = process.argv[2] || "look";
const d = await c.eval(DESCRIBE);
console.log(JSON.stringify({ url: d.url, title: d.title, vw: d.vw, vh: d.vh, dpr: d.dpr }));
console.log(d.text.slice(0, 1500));
console.log(d.interactive.map((i) => `${i.tag}${i.role ? "[" + i.role + "]" : ""} "${i.label}" @${i.x},${i.y} ${i.w}x${i.h}${i.dis ? " DISABLED" : ""}`).join("\n"));
console.log(await c.shot(name));
c.close();
