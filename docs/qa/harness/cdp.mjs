// QA harness - tiny Chrome DevTools Protocol client. Runs under the installed app's
// electron.exe with ELECTRON_RUN_AS_NODE=1 (Node with global fetch/WebSocket), no npm needed.
// Test tooling only; not part of the app.
import fs from "node:fs";
import path from "node:path";

export const PORT = Number(process.env.QA_CDP_PORT || 9222);
export const RESULTS = process.env.QA_RESULTS || "C:\\Results";
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function targets() {
  const r = await fetch(`http://127.0.0.1:${PORT}/json`);
  return r.json();
}

/** Connect to the main AI OS page (type=page, url starting http://127.0.0.1:31xx). */
export async function connect(filter = (t) => t.type === "page" && /^http:\/\/127\.0\.0\.1:\d+/.test(t.url)) {
  let list = [];
  for (let i = 0; i < 120; i++) {
    try { list = (await targets()).filter(filter); if (list.length) break; } catch { /* not up yet */ }
    await sleep(500);
  }
  if (!list.length) throw new Error("no CDP target");
  const t = list[0];
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = (e) => rej(new Error("ws error")); });
  let id = 0; const pending = new Map(); const handlers = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result); }
    else if (msg.method && handlers.has(msg.method)) for (const h of handlers.get(msg.method)) h(msg.params);
  };
  const c = {
    target: t,
    send: (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); }),
    on: (ev, h) => { if (!handlers.has(ev)) handlers.set(ev, []); handlers.get(ev).push(h); },
    close: () => ws.close(),
  };
  await c.send("Runtime.enable"); await c.send("Page.enable");
  c.eval = async (expr, opts = {}) => {
    const r = await c.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, ...opts });
    if (r.exceptionDetails) throw new Error("eval: " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  };
  c.shot = async (name, clip) => {
    const r = await c.send("Page.captureScreenshot", { format: "png", ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
    const dir = process.env.QA_SHOTS || path.join(RESULTS, "shots"); fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, name.endsWith(".png") ? name : name + ".png"); fs.writeFileSync(p, Buffer.from(r.data, "base64")); return p;
  };
  // real input
  c.mouse = async (type, x, y, extra = {}) => c.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1, ...extra });
  c.click = async (x, y, opts = {}) => { await c.mouse("mouseMoved", x, y); await c.mouse("mousePressed", x, y, opts); await c.mouse("mouseReleased", x, y, opts); };
  c.rightClick = async (x, y) => { await c.mouse("mouseMoved", x, y); await c.mouse("mousePressed", x, y, { button: "right" }); await c.mouse("mouseReleased", x, y, { button: "right" }); };
  c.dblClick = async (x, y) => { await c.mouse("mouseMoved", x, y); for (const n of [1, 2]) { await c.mouse("mousePressed", x, y, { clickCount: n }); await c.mouse("mouseReleased", x, y, { clickCount: n }); } };
  c.drag = async (x1, y1, x2, y2, steps = 12) => { await c.mouse("mouseMoved", x1, y1); await c.mouse("mousePressed", x1, y1); for (let i = 1; i <= steps; i++) { await c.mouse("mouseMoved", x1 + ((x2 - x1) * i) / steps, y1 + ((y2 - y1) * i) / steps, { buttons: 1 }); await sleep(16); } await c.mouse("mouseReleased", x2, y2); };
  c.hover = async (x, y) => c.mouse("mouseMoved", x, y, { button: "none" });
  c.type = async (text) => { for (const ch of text) { await c.send("Input.dispatchKeyEvent", { type: "keyDown", text: ch, key: ch, unmodifiedText: ch }); await c.send("Input.dispatchKeyEvent", { type: "keyUp", key: ch }); } };
  c.insert = async (text) => c.send("Input.insertText", { text });
  const KEYS = { Enter: 13, Escape: 27, Tab: 9, Backspace: 8, Delete: 46, ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39, Space: 32, Home: 36, End: 35, F11: 122 };
  c.press = async (key, mods = 0) => { const code = KEYS[key] || key.toUpperCase().charCodeAt(0); const o = { key: key === "Space" ? " " : key, code: key.length === 1 ? "Key" + key.toUpperCase() : key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers: mods }; const txt = key === "Enter" ? "\r" : key === "Space" ? " " : undefined; await c.send("Input.dispatchKeyEvent", { type: txt ? "keyDown" : "rawKeyDown", ...(txt ? { text: txt, unmodifiedText: txt } : {}), ...o }); await c.send("Input.dispatchKeyEvent", { type: "keyUp", ...o }); };
  c.chord = async (key, mods) => c.press(key, mods); // mods: alt=1 ctrl=2 meta=4 shift=8
  /** centre of the first visible element matching a CSS selector (optionally whose text includes `text`) */
  c.rectOf = async (sel, text) => c.eval(`(() => { const els=[...document.querySelectorAll(${JSON.stringify(sel)})].filter(e=>{const r=e.getBoundingClientRect();const s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'}); const e=els.find(e=>!${JSON.stringify(text ?? null)}||(e.innerText||e.getAttribute('aria-label')||e.title||e.value||e.placeholder||'').replace(/\\s+/g,' ').toLowerCase().includes(${JSON.stringify((text ?? "").toLowerCase())})); if(!e) return null; e.scrollIntoView({block:'nearest',inline:'nearest'}); const r=e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height,l:r.left,t:r.top}; })()`);
  c.clickSel = async (sel, text) => { const r = await c.rectOf(sel, text); if (!r) throw new Error(`clickSel: no visible ${sel} ${text ?? ""}`); await c.click(r.x, r.y); return r; };
  /** click by visible text of any button/link/menu item/tab */
  c.clickText = async (text, sel = "button,a,[role=button],[role=menuitem],[role=tab],[role=option],[role=checkbox],[role=switch],label,li,div") => { for (const s of [sel]) { const r = await c.rectOf(s, text); if (r) { await c.click(r.x, r.y); return r; } } throw new Error("clickText: " + text); };
  c.waitFor = async (expr, ms = 15000, step = 200) => { const end = Date.now() + ms; let v; while (Date.now() < end) { try { v = await c.eval(expr); if (v) return v; } catch { /* retry */ } await sleep(step); } throw new Error("waitFor timeout: " + expr.slice(0, 120)); };
  return c;
}

/** Compact description of what is on screen: visible text lines + interactive elements. */
export const DESCRIBE = `(() => {
  const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth; };
  const inter = [...document.querySelectorAll('button,a[href],input,textarea,select,[role=button],[role=menuitem],[role=tab],[role=switch],[role=checkbox],[role=dialog],[role=option],[contenteditable=true],[tabindex]')].filter(vis).map((e) => { const r = e.getBoundingClientRect(); return { tag: e.tagName.toLowerCase(), role: e.getAttribute('role') || '', label: (e.getAttribute('aria-label') || e.innerText || e.value || e.placeholder || e.title || '').trim().replace(/\\s+/g, ' ').slice(0, 60), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), dis: e.disabled || e.getAttribute('aria-disabled') === 'true' || undefined }; });
  return { url: location.href, title: document.title, vw: innerWidth, vh: innerHeight, dpr: devicePixelRatio, text: document.body.innerText.slice(0, 4000), interactive: inter.slice(0, 150) };
})()`;

export function writeJson(name, obj) {
  fs.mkdirSync(RESULTS, { recursive: true });
  fs.writeFileSync(path.join(RESULTS, name), JSON.stringify(obj, null, 2));
}
