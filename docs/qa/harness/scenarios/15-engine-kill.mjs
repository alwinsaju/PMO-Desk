import { connect, sleep, DESCRIBE } from "file:///C:/Projects/AI%20OS/docs/qa/harness/cdp.mjs";
import { execSync } from "node:child_process";
const c = await connect();
await c.send("Page.reload"); await sleep(3500);
await c.clickSel("button[aria-label]", "Tasks"); await sleep(3000);
console.log("before:", (await c.eval("document.body.innerText")).match(/\d+ need you[^\n]*/)?.[0]);
const pid = execSync(`powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \\"Name='pythonw.exe'\\" | ? { $_.ExecutablePath -like '*scratchpad*host*app*' } | select -First 1 -ExpandProperty ProcessId)"`).toString().trim();
console.log("engine pid", pid);
execSync(`powershell -NoProfile -Command "Stop-Process -Id ${pid} -Force"`);
const t0 = Date.now();
for (let i = 0; i < 40; i++) { await sleep(500); const t = await c.eval("document.body.innerText"); if (/engine|offline|couldn.t|not running|reconnect|start/i.test(t.slice(0, 600))) { console.log("UI reacted after ms", Date.now() - t0); break; } }
await sleep(3000);
const d = await c.eval(DESCRIBE); console.log(d.text.slice(0, 700).split(String.fromCharCode(10)).join(" | "));
console.log(d.interactive.filter(i=>i.y>60&&i.x>100&&i.x<1300&&i.y<800).map(i=>`${i.tag} "${i.label}"`).slice(0,15).join("; "));
console.log(await c.shot("15-engine-killed"));
c.close();
