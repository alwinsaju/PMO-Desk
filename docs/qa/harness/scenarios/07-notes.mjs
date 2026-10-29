import { connect, sleep } from "file:///C:/Projects/AI%20OS/docs/qa/harness/cdp.mjs";
const c = await connect();
const count = () => c.eval(`[...document.querySelectorAll('button')].filter(b=>/^Delete /.test(b.getAttribute('aria-label')||'')).length`);
console.log("notes before", await count());
await c.clickSel("button[aria-label='New note']"); await sleep(500);
console.log("notes after +", await count(), "active:", await c.eval("document.activeElement?.tagName+':'+document.activeElement?.getAttribute('aria-label')"));
await c.clickSel("textarea"); await sleep(200);
await c.insert("Zażółć gęślą jaźń — 日本語 — emoji 😀 — C:\Users\Zoë\Dokumente\Ärger.txt");
await sleep(300);
console.log("textarea value:", await c.eval("document.querySelector('textarea').value"));
// long text 50k chars: typing time
const long = "Lorem ipsum dolor sit amet ".repeat(2000);
const t0 = Date.now(); await c.insert(long); const dt = Date.now() - t0; await sleep(500);
console.log("inserted 54k chars in ms:", dt, "len", await c.eval("document.querySelector('textarea').value.length"));
console.log("list title of new note:", await c.eval(`[...document.querySelectorAll('button')].filter(b=>/Zażółć/.test(b.innerText)).map(b=>b.innerText.slice(0,80))`));
console.log(await c.shot("07-notes-typed"));
// delete confirmation?
await c.clickSel("button","Delete \"Zażółć"); await sleep(500);
console.log("notes after delete click", await count(), "dialog?", await c.eval("!!document.querySelector('[role=alertdialog],[role=dialog]')"));
await c.send("Page.reload"); await sleep(3500);
await c.clickSel("button","Notes"); await sleep(1500);
console.log("notes after reload", await count(), await c.eval(`document.body.innerText.includes('Zażółć')`));
c.close();
