import { connect, sleep, DESCRIBE } from "file:///C:/Projects/AI%20OS/docs/qa/harness/cdp.mjs";
const c = await connect();
for (const [tab, shot] of [["Review Queue","10-pmo-queue2"],["Filtered","10-pmo-filtered"],["Reports","10-pmo-reports"]]) {
  await c.clickSel("button[role=tab]", tab); await sleep(1200);
  const d = await c.eval(DESCRIBE);
  console.log("=====", tab, "\n", d.text.slice(0, 1500).replace(/\n+/g, " | "));
  console.log(await c.shot(shot));
}
c.close();
