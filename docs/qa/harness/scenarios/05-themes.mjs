import { connect, DESCRIBE, sleep } from "file:///C:/Projects/AI%20OS/docs/qa/harness/cdp.mjs";
const c = await connect();
async function toggle(text) { 
  if (!(await c.rectOf("[role=menu]"))) { await c.clickSel("button", "Settings"); await sleep(500); }
  await c.clickSel("[role=menuitemcheckbox]", text); await sleep(600);
}
const state = () => c.eval(`JSON.stringify({cls:document.documentElement.className.split(' ').filter(x=>/dark|brand|light|deloitte/.test(x)), data:Object.fromEntries([...document.documentElement.attributes].filter(a=>a.name.startsWith('data-')).map(a=>[a.name,a.value])), bg:getComputedStyle(document.body).backgroundColor, font:getComputedStyle(document.body).fontFamily.slice(0,40), ls:Object.fromEntries(Object.entries(localStorage).map(([k,v])=>[k,v.slice(0,80)]))})`);
console.log("initial", await state());
await toggle("Dark mode"); await c.press("Escape"); await sleep(500);
console.log("dark", await state()); console.log(await c.shot("05-dark"));
await toggle("Deloitte mode"); await c.press("Escape"); await sleep(500);
console.log("dark+brand", await state()); console.log(await c.shot("05-dark-brand"));
await toggle("Dark mode"); await c.press("Escape"); await sleep(500);
console.log("brand", await state()); console.log(await c.shot("05-brand"));
// reload persistence
await c.send("Page.reload"); await sleep(3500);
console.log("after reload", await state());
console.log("locked after reload?", await c.eval("!!document.querySelector('input[aria-label=Password]')"));
console.log(await c.shot("05-after-reload-brand"));
c.close();
