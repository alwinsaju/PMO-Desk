// usage: tasks-run.mjs <task display name> <fixture input dir> <shotname> [--radio <text>] [--start] -- idx=file idx=file ...
import { connect, sleep, DESCRIBE } from "file:///C:/Projects/AI%20OS/docs/qa/harness/cdp.mjs";
import { cardButton } from "./lib.mjs";
const BS = String.fromCharCode(92);
const argv = process.argv.slice(2);
const [name, dir, shot] = argv;
const radio = argv.includes("--radio") ? argv[argv.indexOf("--radio") + 1] : null;
const start = argv.includes("--start");
const uploads = argv.slice(argv.indexOf("--") + 1).map((s) => s.split("="));
if (/mailer|aging|backlog|monthly/i.test(name)) throw new Error("refusing: mail task");
const c = await connect();
const r = await c.eval(cardButton(name, "Run")); if (!r) throw new Error("no card " + name);
await c.click(r.x, r.y); await sleep(1500);
await c.send("DOM.enable");
for (const [idx, f] of uploads) {
  const doc = await c.send("DOM.getDocument", { depth: 1 });
  const ids = (await c.send("DOM.querySelectorAll", { nodeId: doc.root.nodeId, selector: "input[type=file]" })).nodeIds;
  await c.send("DOM.setFileInputFiles", { nodeId: ids[Number(idx)], files: [dir.split("/").join(BS) + BS + f.split("/").join(BS)] }); await sleep(2500);
}
await c.clickSel("[role=dialog] button", "Check"); await sleep(5000);
const t = await c.eval("document.querySelector('[role=dialog]')?.innerText||''");
console.log(t.split("CHECK")[1]?.slice(0, 1800).split(String.fromCharCode(10)).join(" | "));
console.log(await c.shot(shot + "-checked"));
if (radio) { await c.clickSel("[role=dialog] [role=radio]", radio); await sleep(500); }
if (start) { await c.clickSel("[role=dialog] button", "Start"); await sleep(1500); console.log("started; dialog open:", await c.eval("!!document.querySelector('[role=dialog]')")); }
c.close();
