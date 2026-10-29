import { connect, sleep, DESCRIBE } from "file:///C:/Projects/AI%20OS/docs/qa/harness/cdp.mjs";
const c = await connect();
for (const [path, shot] of [["/offline", "22-offline"], ["/no-such-page", "22-404"], ["/design", "22-design"]]) {
  await c.send("Page.navigate", { url: "http://127.0.0.1:3100" + path }); await sleep(3000);
  const d = await c.eval(DESCRIBE); console.log(path, "=>", d.title, "|", d.text.slice(0, 200).split(String.fromCharCode(10)).join(" | "));
  console.log(await c.shot(shot));
}
console.log("sw:", await c.eval("navigator.serviceWorker.getRegistrations().then(r=>r.map(x=>x.scope+' '+(x.active&&x.active.state)))"));
// api surface GETs only
for (const p of ["/api/ai/runtime", "/sw.js", "/manifest.webmanifest"]) { const r = await c.eval(`fetch('${p}').then(async r=>r.status+' '+r.headers.get('content-type')+' '+(await r.text()).length)`); console.log(p, r); }
await c.send("Page.navigate", { url: "http://127.0.0.1:3100/" }); await sleep(3000);
c.close();
