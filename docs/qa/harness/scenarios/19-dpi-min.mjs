import { connect, sleep, DESCRIBE } from "file:///C:/Projects/AI%20OS/docs/qa/harness/cdp.mjs";
import { WINS } from "./lib.mjs";
const c = await connect();
const ov = (w, h, dsf) => c.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: dsf, mobile: false });
const clear = () => c.send("Emulation.clearDeviceMetricsOverride");
const dockVisible = () => c.eval(`(()=>{const b=document.querySelector('button[aria-label=Tasks]'); const r=b.getBoundingClientRect(); const s=document.querySelector('button[aria-label=Settings]').getBoundingClientRect(); return JSON.stringify({dock:[Math.round(r.x),Math.round(r.y)], gear:[Math.round(s.x),Math.round(s.y)], hscroll: document.documentElement.scrollWidth>innerWidth, vscroll: document.documentElement.scrollHeight>innerHeight})})()`);
await c.press("Escape");
await c.clickSel("button[aria-label=Tasks]"); await sleep(2500);
for (const [w, h, d, name] of [[1010, 680, 1.25, "min-window-125"], [1426, 850, 1.5, "dpi150"], [1426, 850, 2, "dpi200"], [1280, 720, 1, "1280x720-100"]]) {
  await ov(w, h, d); await sleep(1200);
  console.log(name, await dockVisible(), JSON.parse(await c.eval(WINS)).map(x=>`${x.title.slice(0,8)}:${x.x},${x.y} ${x.w}x${x.h}`).join(" ; "));
  console.log(await c.shot("19-" + name));
}
await clear();
c.close();
