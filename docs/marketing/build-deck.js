// Build script for the PMO Desk pilot deck (docs/marketing/pmo-desk-pilot-deck.pptx).
// Run:  node build-deck.js   (needs pptxgenjs, react, react-dom, react-icons, sharp on NODE_PATH)
// Design tokens are copied from src/styles/tokens.css and the .wp-lt wallpaper in src/app/globals.css.
// Everything on the slides is fictional (Priya, Acme ...). No app source is touched.

const path = require("path");
const pptxgen = require("pptxgenjs");
const React = require("react");
const ReactDOMServer = require("react-dom/server");
const sharp = require("sharp");
const PI = require("react-icons/pi");

// ---------------------------------------------------------------- swappable name
const APP_NAME = "PMO Desk";
const TAGLINE = "Your PMO to-do list, structured by AI that never leaves your laptop.";
const DISCLAIMER =
  "Unofficial internal pilot; confirm data handling with firm IT/risk before wider use.";
const OUT = path.join(__dirname, "pmo-desk-pilot-deck.pptx");

// ---------------------------------------------------------------- app tokens
const INK = "14171C"; // --color-ink (neutral-900)
const INK_SOFT = "464D5A"; // neutral-700
const INK_MUTED = "626B7A"; // neutral-600
const ACCENT = "1F6F5E"; // --color-accent (accent-600, deep teal)
const ACCENT_50 = "EAF3F1";
const ACCENT_100 = "D2E6E1";
const AMBER = "8A5A07";
const AMBER_SOFT = "F6E8CC";
const RED = "B4372D";
const SUCCESS = "17785A";
const LINE = "D6DAE1";
const WHITE = "FFFFFF";
// wallpaper blob colours (.wp-lt)
const WP = ["B9C6E8", "D8C5E2", "F4CDD4", "F7D9C2"];

const THEME = {
  name: APP_NAME + " pilot",
  headFontFace: "Calibri", // app font is Figtree (bundled in the app, not in PowerPoint)
  bodyFontFace: "Calibri",
  colors: {
    dk1: INK, lt1: WHITE, dk2: INK_SOFT, lt2: "F4F5F7",
    accent1: ACCENT, accent2: "4F8F82", accent3: "8FA8FF", accent4: "FF9FC4",
    accent5: "FFD2A1", accent6: "8FD8CC", hlink: ACCENT, folHlink: INK_MUTED,
  },
};

const W = 13.333, H = 7.5, MX = 0.7;

// ---------------------------------------------------------------- assets
async function makeBackgrounds() {
  const w = 2667, h = 1500;
  const blob = (cx, cy, r, c, o) =>
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#${c}" opacity="${o}" filter="url(#b)"/>`;
  const svg = (wash) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#${WP[0]}"/><stop offset="0.27" stop-color="#${WP[1]}"/>
        <stop offset="0.5" stop-color="#${WP[2]}"/><stop offset="0.7" stop-color="#${WP[3]}"/>
        <stop offset="1" stop-color="#F9E3D0"/></linearGradient>
      <filter id="b" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="150"/></filter>
    </defs>
    <rect width="${w}" height="${h}" fill="url(#g)"/>
    ${blob(150, 100, 600, "8FA8FF", 0.6)}${blob(2500, 450, 520, "FF9FC4", 0.5)}
    ${blob(1300, 1550, 650, "FFD2A1", 0.75)}${blob(250, 1300, 450, "8FD8CC", 0.45)}
    <rect width="${w}" height="${h}" fill="#FBFBFA" opacity="${wash}"/></svg>`;
  const dusk = await sharp(Buffer.from(svg(0))).png().toBuffer();
  const mist = await sharp(Buffer.from(svg(0.62))).png().toBuffer();
  return {
    dusk: "image/png;base64," + dusk.toString("base64"),
    mist: "image/png;base64," + mist.toString("base64"),
  };
}

const iconCache = {};
async function icon(name, color = ACCENT) {
  const key = name + color;
  if (iconCache[key]) return iconCache[key];
  const Comp = PI[name];
  if (!Comp) throw new Error("missing icon " + name);
  const markup = ReactDOMServer.renderToStaticMarkup(
    React.createElement(Comp, { color: "#" + color, size: 256 })
  );
  const buf = await sharp(Buffer.from(markup)).resize(256, 256).png().toBuffer();
  return (iconCache[key] = "image/png;base64," + buf.toString("base64"));
}

// ---------------------------------------------------------------- helpers
let pres, BG;
const shadow = () => ({ type: "outer", color: "1B2A4A", blur: 14, offset: 3, angle: 90, opacity: 0.12 });

function newSlide(kind, section) {
  const s = pres.addSlide();
  s.background = { data: kind === "dusk" ? BG.dusk : BG.mist };
  return s;
}

function header(s, n, eyebrow, title) {
  s.addText(`${String(n).padStart(2, "0")}  ·  ${eyebrow.toUpperCase()}`, {
    x: MX, y: 0.42, w: 9, h: 0.3, fontSize: 12, bold: true, color: ACCENT,
    charSpacing: 2, margin: 0, isTextBox: true,
  });
  s.addText(title, {
    x: MX, y: 0.74, w: W - 2 * MX, h: 0.85, fontSize: 36, bold: true, color: INK,
    margin: 0, valign: "top", isTextBox: true,
  });
}

let LOGO_DATA = "";
function footer(s, n) {
  if (LOGO_DATA) s.addImage({ data: LOGO_DATA, x: MX, y: 7.0, w: 0.28, h: 0.28, altText: APP_NAME + " logo" });
  s.addText(`${APP_NAME}  ·  internal pilot`, {
    x: MX + 0.38, y: 7.03, w: 5, h: 0.25, fontSize: 10, color: INK_MUTED, margin: 0, isTextBox: true,
  });
  s.addText(String(n), {
    x: W - MX - 1, y: 7.03, w: 1, h: 0.25, fontSize: 10, color: INK_MUTED, align: "right",
    margin: 0, isTextBox: true,
  });
}

// frosted-glass card (--color-glass + glass-edge)
function glass(s, x, y, w, h, o = {}) {
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x, y, w, h, rectRadius: o.r ?? 0.22,
    fill: { color: WHITE, transparency: o.t ?? 28 },
    line: { color: WHITE, width: 1, transparency: 25 },
    shadow: shadow(), objectName: o.name || "glass card",
  });
}

async function iconDisc(s, name, x, y, d = 0.62, o = {}) {
  s.addShape(pres.shapes.OVAL, {
    x, y, w: d, h: d, fill: { color: o.bg || ACCENT_50 }, line: { color: o.bg || ACCENT_50, width: 0 },
    objectName: "icon disc",
  });
  const p = d * 0.26;
  s.addImage({
    data: await icon(name, o.color || ACCENT), x: x + p, y: y + p, w: d - 2 * p, h: d - 2 * p,
    altText: name.replace(/^Pi/, "") + " icon",
  });
}

function chip(s, text, x, y, w, o = {}) {
  s.addText(text, {
    x, y, w, h: o.h ?? 0.3, shape: pres.shapes.ROUNDED_RECTANGLE, rectRadius: (o.h ?? 0.3) / 2,
    fill: { color: o.bg || ACCENT_50 }, color: o.color || ACCENT, fontSize: o.fs ?? 11, bold: true,
    align: "center", valign: "middle", margin: 0, isTextBox: true,
  });
}

// ---- UI moments, native shapes
async function dock(s, x, y) {
  const tiles = [
    ["PiClipboardText", "D2E6E1", ACCENT], ["PiUsersThree", "D9E1FA", "2B4FD0"],
    ["PiListChecks", "FADCE6", "B0328F"], ["PiNotebook", "FBE8D2", "A9610A"],
    ["PiSquaresFour", "DDF1EC", "1A8F86"], ["PiGearSix", "E4E7EC", INK_SOFT],
  ];
  const tw = 0.56, gap = 0.2, pad = 0.3;
  const w = pad * 2 + tiles.length * tw + (tiles.length - 1) * gap, h = 0.92;
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x, y, w, h, rectRadius: 0.3, fill: { color: WHITE, transparency: 25 },
    line: { color: WHITE, width: 1, transparency: 15 }, shadow: shadow(), objectName: "dock",
  });
  for (let i = 0; i < tiles.length; i++) {
    const tx = x + pad + i * (tw + gap), ty = y + 0.14;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: tx, y: ty, w: tw, h: tw, rectRadius: 0.14, fill: { color: tiles[i][1] },
      line: { color: WHITE, width: 1, transparency: 40 }, objectName: "dock tile",
    });
    s.addImage({ data: await icon(tiles[i][0], tiles[i][2]), x: tx + 0.14, y: ty + 0.14, w: 0.28, h: 0.28, altText: "app icon" });
    if (i < 2) s.addShape(pres.shapes.OVAL, { x: tx + tw / 2 - 0.03, y: ty + tw + 0.06, w: 0.06, h: 0.06, fill: { color: ACCENT }, line: { color: ACCENT, width: 0 } });
  }
  return w;
}

async function commandPill(s, x, y, w, text) {
  const h = 0.62;
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x, y, w, h, rectRadius: h / 2, fill: { color: WHITE, transparency: 20 },
    line: { color: WHITE, width: 1, transparency: 10 }, shadow: shadow(), objectName: "command pill",
  });
  await iconDisc(s, "PiSparkle", x + 0.1, y + 0.09, 0.44, { bg: ACCENT, color: WHITE });
  s.addText(text, { x: x + 0.7, y, w: w - 2.2, h, fontSize: 14, color: INK_MUTED, valign: "middle", margin: 0, isTextBox: true });
  chip(s, "Ctrl+Space", x + w - 1.4, y + 0.16, 1.2, { bg: "ECEEF1", color: INK_MUTED, h: 0.3, fs: 11 });
}

// review-queue proposal card
async function reviewCard(s, x, y, w, h) {
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x, y, w, h, rectRadius: 0.2, fill: { color: WHITE, transparency: 6 },
    line: { color: WHITE, width: 1 }, shadow: shadow(), objectName: "review queue card",
  });
  const p = 0.28;
  chip(s, "REVIEW QUEUE", x + p, y + p, 1.35, { fs: 10 });
  s.addText("from a flagged email", { x: x + p + 1.5, y: y + p, w: w - 2 * p - 1.5, h: 0.3, fontSize: 11, color: INK_MUTED, valign: "middle", margin: 0, isTextBox: true });
  s.addText("Send the RAID log to Priya", { x: x + p, y: y + p + 0.45, w: w - 2 * p, h: 0.4, fontSize: 18, bold: true, color: INK, margin: 0, isTextBox: true });
  s.addText("Due Friday  ·  Project: Acme rollout", { x: x + p, y: y + p + 0.88, w: w - 2 * p, h: 0.3, fontSize: 12, color: INK_SOFT, margin: 0, isTextBox: true });
  // checkpoints
  const cy = y + p + 1.4;
  const steps = ["Acknowledged", "Done"];
  steps.forEach((t, i) => {
    const cx = x + p + i * 1.75;
    s.addShape(pres.shapes.OVAL, { x: cx, y: cy + 0.04, w: 0.2, h: 0.2, fill: { color: i === 0 ? ACCENT : WHITE }, line: { color: ACCENT, width: 1.5 } });
    s.addText(t, { x: cx + 0.28, y: cy, w: 1.4, h: 0.28, fontSize: 12, color: INK_SOFT, valign: "middle", margin: 0, isTextBox: true });
  });
  s.addText("Read on this laptop by a local model", { x: x + p, y: cy + 0.4, w: w - 2 * p, h: 0.28, fontSize: 11, italic: true, color: ACCENT, margin: 0, isTextBox: true });
  const by = y + h - p - 0.42;
  s.addText("Reject", { x: x + w - p - 2.3, y: by, w: 1.05, h: 0.42, shape: pres.shapes.ROUNDED_RECTANGLE, rectRadius: 0.21, fill: { color: WHITE }, line: { color: LINE, width: 1 }, color: INK, fontSize: 13, bold: true, align: "center", valign: "middle", margin: 0, isTextBox: true });
  s.addText("Approve", { x: x + w - p - 1.15, y: by, w: 1.15, h: 0.42, shape: pres.shapes.ROUNDED_RECTANGLE, rectRadius: 0.21, fill: { color: ACCENT }, color: WHITE, fontSize: 13, bold: true, align: "center", valign: "middle", margin: 0, isTextBox: true });
}

// Tasks-app workflow card with step timeline
async function taskCard(s, x, y, w, h) {
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x, y, w, h, rectRadius: 0.2, fill: { color: WHITE, transparency: 6 }, line: { color: WHITE, width: 1 },
    shadow: shadow(), objectName: "task card",
  });
  const p = 0.26;
  await iconDisc(s, "PiFileText", x + p, y + p, 0.5);
  s.addText("Weekly report", { x: x + p + 0.65, y: y + p - 0.02, w: w - 2 * p - 0.65, h: 0.3, fontSize: 15, bold: true, color: INK, margin: 0, isTextBox: true });
  s.addText("Example workflow", { x: x + p + 0.65, y: y + p + 0.26, w: w - 2 * p - 0.65, h: 0.26, fontSize: 11, color: INK_MUTED, margin: 0, isTextBox: true });
  const ty = y + 0.95;
  const steps = [["Prepare", 2], ["Review", 1], ["Approve", 0], ["Send", 0]];
  const sw = (w - 2 * p) / steps.length;
  steps.forEach(([t, st], i) => {
    const cx = x + p + i * sw;
    if (i < steps.length - 1) s.addShape(pres.shapes.LINE, { x: cx + 0.2, y: ty + 0.1, w: sw - 0.2, h: 0, line: { color: st === 2 ? ACCENT : LINE, width: 2 } });
    s.addShape(pres.shapes.OVAL, { x: cx, y: ty, w: 0.2, h: 0.2, fill: { color: st === 2 ? ACCENT : st === 1 ? AMBER : WHITE }, line: { color: st === 0 ? LINE : st === 1 ? AMBER : ACCENT, width: 1.5 } });
    s.addText(t, { x: cx - 0.1, y: ty + 0.28, w: sw, h: 0.26, fontSize: 11, color: INK_SOFT, margin: 0, isTextBox: true });
  });
  chip(s, "Needs your review", x + p, y + h - p - 0.32, 1.7, { bg: AMBER_SOFT, color: AMBER, fs: 11, h: 0.32 });
}

// =============================================================== build
async function main() {
  BG = await makeBackgrounds();
  LOGO_DATA = "image/png;base64," + (await sharp(path.join(__dirname, "logo", "mark.svg"), { density: 288 }).resize(256, 256).png().toBuffer()).toString("base64");
  pres = new pptxgen();
  pres.layout = "LAYOUT_WIDE";
  pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
  pres.title = `${APP_NAME} pilot`;
  pres.author = "PMO community pilot";

  // ---- 1 Title
  let s = newSlide("dusk", "Intro");
  s.addText("INTERNAL PILOT  ·  PMO COMMUNITY", { x: MX, y: 0.9, w: 8, h: 0.3, fontSize: 13, bold: true, color: ACCENT, charSpacing: 3, margin: 0, isTextBox: true });
  s.addImage({ data: LOGO_DATA, x: MX, y: 0.2, w: 0.6, h: 0.6, altText: APP_NAME + " logo" });
  s.addText(APP_NAME, { x: MX, y: 1.35, w: 7.4, h: 1.5, fontSize: 80, bold: true, color: INK, margin: 0, valign: "middle", isTextBox: true });
  s.addText(TAGLINE, { x: MX, y: 3.0, w: 6.8, h: 1.2, fontSize: 24, color: INK_SOFT, margin: 0, valign: "top", isTextBox: true });
  s.addText("A pilot invitation for colleagues who run PMO work every day", { x: MX, y: 4.35, w: 6.8, h: 0.4, fontSize: 16, color: INK_MUTED, margin: 0, isTextBox: true });
  await reviewCard(s, 8.2, 1.2, 4.4, 3.5);
  await commandPill(s, 2.22, 5.3, 8.9, "Ask anything, or try “what’s overdue?”");
  await dock(s, (W - 4.96) / 2, 6.2);
  s.addNotes("Welcome. This is an invitation to a small, honest pilot of an internal desktop tool for PMO work. " + APP_NAME + " is a working name; we vote on it near the end. The cards you see are mock-ups with fictional data. Nothing here is firm-approved: it is an unofficial internal pilot.");

  // ---- 2 Problem
  s = newSlide("mist", "Why");
  header(s, 2, "The problem", "PMO work arrives everywhere, and then it gets lost");
  const probs = [
    ["PiEnvelopeSimple", "It arrives as flags and pings", "Flagged emails and Teams messages, each hiding a request, a date and a person to chase."],
    ["PiTray", "Things slip through", "A flag sits in a long list. A chat scrolls away. The follow-up you promised on Tuesday is gone by Friday."],
    ["PiFileText", "Status reports eat time", "Pulling the week together from scattered threads is slow, repeated work."],
  ];
  const cw = (W - 2 * MX - 2 * 0.4) / 3;
  for (let i = 0; i < 3; i++) {
    const x = MX + i * (cw + 0.4);
    glass(s, x, 2.0, cw, 3.55, { t: 22 });
    await iconDisc(s, probs[i][0], x + 0.35, 2.35, 0.8);
    s.addText(probs[i][1], { x: x + 0.35, y: 3.35, w: cw - 0.7, h: 0.7, fontSize: 22, bold: true, color: INK, margin: 0, valign: "top", isTextBox: true });
    s.addText(probs[i][2], { x: x + 0.35, y: 4.35, w: cw - 0.7, h: 1.15, fontSize: 15, color: INK_SOFT, margin: 0, valign: "top", isTextBox: true });
  }
  s.addText(`${APP_NAME} is an attempt to catch the request at the moment you notice it.`, { x: MX, y: 5.95, w: W - 2 * MX, h: 0.5, fontSize: 18, italic: true, color: ACCENT, margin: 0, isTextBox: true });
  footer(s, 2);
  s.addNotes("Set the scene in your own words. PMO work lands as flagged emails and Teams messages. Things get lost between the flag and the follow-up, and status reports take time to assemble. Ask the room who recognises this. No numbers on this slide: we are not claiming a measured problem size, we will measure during the pilot.");

  // ---- 3 What it does (flow)
  s = newSlide("mist", "What");
  header(s, 3, "What it does", "Flag it. A local AI reads it. You approve.");
  const flow = [
    ["PiEnvelopeSimple", "Flag or send", "Flag an email, or send a Teams message to " + APP_NAME + "."],
    ["PiSparkle", "Local AI reads it", "A model on your laptop pulls out the task, date and people."],
    ["PiTray", "Review queue", "A structured proposal waits for you. Nothing is created yet."],
    ["PiCheckCircle", "You approve", "Edit anything, then approve or reject."],
    ["PiListChecks", "On your list", "A to-do with checkpoints and reminders."],
  ];
  const fw = 2.05, fg = 0.4;
  for (let i = 0; i < 5; i++) {
    const x = MX + i * (fw + fg);
    glass(s, x, 2.0, fw, 2.9, { t: 20 });
    await iconDisc(s, flow[i][0], x + 0.3, 2.25, 0.68, i === 3 ? { bg: ACCENT, color: WHITE } : {});
    s.addText(flow[i][1], { x: x + 0.3, y: 3.1, w: fw - 0.5, h: 0.4, fontSize: 17, bold: true, color: INK, margin: 0, isTextBox: true });
    s.addText(flow[i][2], { x: x + 0.3, y: 3.55, w: fw - 0.5, h: 1.25, fontSize: 14, color: INK_SOFT, margin: 0, valign: "top", isTextBox: true });
    if (i < 4) {
      s.addShape(pres.shapes.LINE, { x: x + fw + 0.06, y: 3.45, w: fg - 0.12, h: 0, line: { color: ACCENT, width: 2.25, endArrowType: "triangle" } });
    }
  }
  glass(s, MX, 5.3, W - 2 * MX, 1.2, { t: 10, r: 0.3 });
  await iconDisc(s, "PiEnvelopeSimple", MX + 0.35, 5.59, 0.62, { bg: AMBER_SOFT, color: AMBER });
  s.addText([
    { text: "Drafts open as Outlook drafts. ", options: { bold: true, color: INK } },
    { text: `PMO To-Do never sends mail. Tasks automations send only after an explicit confirm.`, options: { color: INK_SOFT } },
  ], { x: MX + 1.2, y: 5.3, w: W - 2 * MX - 1.5, h: 1.2, fontSize: 18, valign: "middle", margin: 0, isTextBox: true });
  footer(s, 3);
  s.addNotes("Walk the five steps left to right. Intake is two small Power Automate flows you set up once with a guide: one for flagged Outlook email, one for a Teams message you pick. A local model structures the item and it lands in a review queue. You approve before it becomes a to-do. Where a chase or reply is needed, it opens as an Outlook draft. PMO To-Do never sends mail; Tasks automations send only after an explicit confirm.");

  // ---- 4 Three promises
  s = newSlide("mist", "Trust");
  header(s, 4, "Three promises", "Built so you stay in control of your data");
  const prom = [
    ["PiLaptop", "AI stays on your laptop", "The model runs locally through Ollama. Internal message text is not sent to a cloud AI."],
    ["PiHandPalm", "Nothing happens without you", "Every item waits in a review queue for your approval. PMO To-Do never sends mail; Tasks automations send only after an explicit confirm."],
    ["PiFunnel", "It only reads what you flag", "Only mail you flag and Teams messages you send. Teams items are filtered by a tenant and chat allowlist."],
  ];
  for (let i = 0; i < 3; i++) {
    const x = MX + i * (cw + 0.4);
    glass(s, x, 2.0, cw, 4.0, { t: 22 });
    s.addText(String(i + 1), { x: x + 0.35, y: 2.2, w: 0.8, h: 0.8, fontSize: 40, bold: true, color: ACCENT_100, margin: 0, isTextBox: true });
    await iconDisc(s, prom[i][0], x + cw - 1.15, 2.3, 0.8, { bg: ACCENT, color: WHITE });
    s.addText(prom[i][1], { x: x + 0.35, y: 3.3, w: cw - 0.7, h: 0.7, fontSize: 22, bold: true, color: INK, margin: 0, valign: "top", isTextBox: true });
    s.addText(prom[i][2], { x: x + 0.35, y: 4.35, w: cw - 0.7, h: 1.15, fontSize: 15, color: INK_SOFT, margin: 0, valign: "top", isTextBox: true });
  }
  s.addText("Your mail and Teams already live in Microsoft 365. The flows copy only the item you flag into a OneDrive folder on your own account; the AI reads it from there on your laptop.", { x: MX, y: 6.2, w: W - 2 * MX, h: 0.65, fontSize: 14, color: INK_MUTED, margin: 0, valign: "top", isTextBox: true });
  footer(s, 4);
  s.addNotes("These are the three design commitments. One: the language model runs on the laptop via Ollama, on loopback only, so message text is not sent to a cloud AI. Two: it proposes, you decide; PMO To-Do never sends mail, and Tasks automations send only after an explicit confirm. Three: it only sees what you flag or send, and Teams items are blocked until your tenant or a specific chat is on your allowlist. Be upfront about the footnote: intake itself uses Microsoft 365 (Power Automate and OneDrive) on your own account. We are not claiming firm approval; check with IT/risk.");

  // ---- 5 Tour 1
  s = newSlide("mist", "Tour");
  header(s, 5, "Feature tour, part 1", "PMO To-Do: from message to done");
  const f1 = [
    ["PiTray", "PMO To-Do and review queue", "Flagged mail and picked Teams messages become proposed to-dos. You edit, approve or reject."],
    ["PiBell", "Checkpoints and reminders", "Each to-do carries checkpoint steps, with reminders and desktop notifications."],
    ["PiHandWaving", "Chasers", "Draft a nudge for something you are waiting on. It opens as an unsent Outlook draft."],
    ["PiChartLineUp", "Status reports", "A weekly report built from your to-dos. Preview it, then save."],
  ];
  const gx = MX, gy = 2.0, gw = 3.55, gh = 2.15, gg = 0.3;
  for (let i = 0; i < 4; i++) {
    const x = gx + (i % 2) * (gw + gg), y = gy + Math.floor(i / 2) * (gh + gg);
    glass(s, x, y, gw, gh, { t: 22 });
    await iconDisc(s, f1[i][0], x + 0.28, y + 0.25, 0.56);
    s.addText(f1[i][1], { x: x + 0.28, y: y + 0.92, w: gw - 0.5, h: 0.35, fontSize: 16, bold: true, color: INK, margin: 0, isTextBox: true });
    s.addText(f1[i][2], { x: x + 0.28, y: y + 1.27, w: gw - 0.5, h: 0.8, fontSize: 13, color: INK_SOFT, margin: 0, valign: "top", isTextBox: true });
  }
  await reviewCard(s, 8.55, 2.0, 4.1, 4.6);
  footer(s, 5);
  s.addNotes("The core of the pilot. The right-hand card is a mock-up of a review-queue proposal with fictional data. Checkpoints are a small fixed set of templates, for example Acknowledged then Done. Chasers and any mail only ever open as unsent Outlook drafts. The status report is assembled by code from your own to-dos, not written by the AI.");

  // ---- 6 Tour 2
  s = newSlide("mist", "Tour");
  header(s, 6, "Feature tour, part 2", "Around the desk: planning, automations and the shell");
  const f2 = [
    ["PiUsersThree", "Shift Roster", "Teams, shifts, holidays and approved time off in Day, Week, Month and Cycle views."],
    ["PiSnowflake", "December Disconnect", "Plans winter holiday coverage as Excel drafts you review. Rules-based, no AI judgment."],
    ["PiGearSix", "Tasks automations", "Weekly reports and mailers run through prepare, review, approve, send."],
    ["PiSquaresFour", "App Store", "A dock to pin and arrange apps, plus a store. App descriptions are sample copy for now."],
    ["PiSparkle", "AI handoff glow", "When the AI drives a window, it glows and shows a cursor. Control passes back and forth."],
  ];
  const c3 = (W - 2 * MX - 2 * 0.3) / 3;
  for (let i = 0; i < 5; i++) {
    const row = Math.floor(i / 3), col = i % 3;
    const x = MX + col * (c3 + 0.3), y = 2.0 + row * 2.35;
    glass(s, x, y, c3, 2.1, { t: 22 });
    await iconDisc(s, f2[i][0], x + 0.28, y + 0.25, 0.56);
    s.addText(f2[i][1], { x: x + 1.0, y: y + 0.25, w: c3 - 1.25, h: 0.56, fontSize: 17, bold: true, color: INK, valign: "middle", margin: 0, isTextBox: true });
    s.addText(f2[i][2], { x: x + 0.28, y: y + 1.0, w: c3 - 0.56, h: 1.0, fontSize: 14, color: INK_SOFT, margin: 0, valign: "top", isTextBox: true });
  }
  chip(s, "Early", MX + c3 - 0.28 - 0.75, 4.35 + 0.38, 0.75, { fs: 11, h: 0.3 });
  await taskCard(s, MX + 2 * (c3 + 0.3), 4.35, c3, 2.1);
  footer(s, 6);
  s.addNotes("Quick tour of the rest. Shift Roster and December Disconnect are deterministic planning tools: the roster is built by rules and shown for review; December Disconnect produces Excel drafts you check. Neither uses AI judgment. Tasks automations run report and mailer workflows through review and approval gates. Be clear that the App Store is early: its app descriptions are sample copy, not a real marketplace. The bottom-right card is a mock-up of a workflow awaiting review.");

  // ---- 7 Fine print
  s = newSlide("mist", "Honest");
  header(s, 7, "Honest fine print", "What you should know before you say yes");
  const fp = [
    ["PiLaptop", "A modern laptop", "Tuned on 31 GB RAM, no GPU. Older or small-memory machines may struggle."],
    ["PiTimer", "Not instant", "About 1 minute per message (median 61 s light model, 67 s Gemma). The first can take about 2 minutes. Like an inbox, not a chat."],
    ["PiWindowsLogo", "Windows only", "The installer is unsigned: expect a SmartScreen warning. Managed laptops may need IT to allow it."],
    ["PiPlugsConnected", "Setup: about 45 min", "A Power Automate flow runs inside your own Microsoft 365 account to flag or send items."],
    ["PiShieldCheck", "Teams is default-deny", "Teams items are filtered out until your tenant or chat is on the allowlist."],
    ["PiFlask", "Pilot software", "Expect rough edges. The AI can be wrong, which is why you approve everything."],
  ];
  for (let i = 0; i < 6; i++) {
    const x = MX + (i % 3) * (c3 + 0.3), y = 1.95 + Math.floor(i / 3) * 2.5;
    glass(s, x, y, c3, 2.3, { t: 22 });
    await iconDisc(s, fp[i][0], x + 0.28, y + 0.25, 0.56, { bg: AMBER_SOFT, color: AMBER });
    s.addText(fp[i][1], { x: x + 1.0, y: y + 0.25, w: c3 - 1.25, h: 0.56, fontSize: 17, bold: true, color: INK, valign: "middle", margin: 0, isTextBox: true });
    s.addText(fp[i][2], { x: x + 0.28, y: y + 0.95, w: c3 - 0.56, h: 1.3, fontSize: 14, color: INK_SOFT, margin: 0, valign: "top", isTextBox: true });
  }
  footer(s, 7);
  s.addNotes("Say this slide plainly; it builds trust. The app was tuned on a laptop with 31 GB of RAM and no GPU (owner figure, not verified in the repo). Measured local timing is about a minute per message (median 61 s on the light model, 67 s on Gemma); the first message can take about two minutes. So treat it like an inbox that fills in behind you, not a chat. Windows only. The installer is not code-signed, so Windows SmartScreen will warn and some managed laptops may block it until IT allows it. The Power Automate flow runs inside your own Microsoft 365 account and takes about 45 minutes to set up the first time. Teams items are default-deny until your tenant or chat is allowlisted. It is pilot software.");

  // ---- 8 Pilot
  s = newSlide("mist", "Pilot");
  header(s, 8, "The pilot", "3 to 5 weeks, a small ask, three things we will measure");
  glass(s, MX, 2.0, 5.7, 4.5, { t: 22 });
  s.addText("What we ask of you", { x: MX + 0.4, y: 2.25, w: 5, h: 0.4, fontSize: 20, bold: true, color: INK, margin: 0, isTextBox: true });
  const asks = [
    ["PiDownloadSimple", "Install it", "and follow the first-run setup."],
    ["PiFlag", "Flag or send 5+ items a week", "from real PMO work."],
    ["PiChatCircleText", "One 10-minute feedback chat", "at the end."],
  ];
  for (let i = 0; i < 3; i++) {
    const y = 3.0 + i * 1.15;
    await iconDisc(s, asks[i][0], MX + 0.4, y, 0.64);
    s.addText([
      { text: asks[i][1], options: { bold: true, color: INK, breakLine: true } },
      { text: asks[i][2], options: { color: INK_SOFT } },
    ], { x: MX + 1.25, y: y - 0.05, w: 4.2, h: 0.75, fontSize: 16, valign: "middle", margin: 0, isTextBox: true });
  }
  const mx = MX + 5.7 + 0.35, mw = W - MX - mx;
  glass(s, mx, 2.0, mw, 4.5, { t: 22 });
  s.addText("What we will measure", { x: mx + 0.4, y: 2.25, w: mw - 0.8, h: 0.4, fontSize: 20, bold: true, color: INK, margin: 0, isTextBox: true });
  const mets = [
    ["Minutes saved per week", "your own estimate"],
    ["% of AI structuring accepted unedited", "from the review queue"],
    ["Trust score", "how far you trust the AI’s proposals"],
  ];
  for (let i = 0; i < 3; i++) {
    const y = 3.0 + i * 1.15;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: mx + 0.4, y, w: mw - 0.8, h: 0.95, rectRadius: 0.16, fill: { color: ACCENT_50 }, line: { color: ACCENT_50, width: 0 } });
    s.addText([
      { text: mets[i][0], options: { bold: true, color: ACCENT, fontSize: 17, breakLine: true } },
      { text: mets[i][1], options: { color: INK_SOFT, fontSize: 14 } },
    ], { x: mx + 0.65, y, w: mw - 1.3, h: 0.95, valign: "middle", margin: 0, isTextBox: true });
  }
  footer(s, 8);
  s.addNotes("The ask is deliberately small: install it, flag or send at least five real items a week, and give one 10-minute feedback chat. The pilot runs 3 to 5 weeks. We will look at three things: minutes saved per week (your own estimate, no stopwatch), the share of AI structuring you accept without editing, and a simple trust score. No numbers exist yet; we are not promising any result.");

  // ---- 9 How to join + timeline
  s = newSlide("mist", "Pilot");
  header(s, 9, "How to join", "Four steps from “yes” to your first approved task");
  const join = [
    ["Say you are in", "Tell Alwin Saju. Contact details are on the last slide."],
    ["Install and set up", "Run the Windows installer. The first-run setup checks the AI runtime, the model, the OneDrive folders and classic Outlook."],
    ["Connect your flows", "Two guided Power Automate flows: flagged email and Teams. Plan on about 45 minutes the first time."],
    ["Use it, then chat", "Work as normal for 3 to 5 weeks, then a 10-minute feedback chat."],
  ];
  const jw = (W - 2 * MX - 3 * 0.3) / 4;
  for (let i = 0; i < 4; i++) {
    const x = MX + i * (jw + 0.3);
    glass(s, x, 2.0, jw, 3.0, { t: 22 });
    s.addShape(pres.shapes.OVAL, { x: x + 0.3, y: 2.25, w: 0.6, h: 0.6, fill: { color: ACCENT }, line: { color: ACCENT, width: 0 } });
    s.addText(String(i + 1), { x: x + 0.3, y: 2.25, w: 0.6, h: 0.6, fontSize: 20, bold: true, color: WHITE, align: "center", valign: "middle", margin: 0, isTextBox: true });
    s.addText(join[i][0], { x: x + 0.3, y: 3.05, w: jw - 0.55, h: 0.4, fontSize: 18, bold: true, color: INK, margin: 0, isTextBox: true });
    s.addText(join[i][1], { x: x + 0.3, y: 3.5, w: jw - 0.55, h: 1.4, fontSize: 14, color: INK_SOFT, margin: 0, valign: "top", isTextBox: true });
  }
  // timeline
  const ty = 5.75;
  s.addShape(pres.shapes.LINE, { x: MX + 0.2, y: ty, w: W - 2 * MX - 0.4, h: 0, line: { color: ACCENT, width: 2.5 } });
  const tl = [["Sign-up", "[date TBC]"], ["Set-up week", "[date TBC]"], ["Pilot, 3 to 5 weeks", "[start TBC]"], ["Feedback chats", "[date TBC]"]];
  const tx = [0, 0.27, 0.54, 0.84];
  tl.forEach(([t, d], i) => {
    const x = MX + 0.2 + tx[i] * (W - 2 * MX - 0.4);
    s.addShape(pres.shapes.OVAL, { x: x - 0.11, y: ty - 0.11, w: 0.22, h: 0.22, fill: { color: WHITE }, line: { color: ACCENT, width: 2.5 } });
    s.addText([
      { text: t, options: { bold: true, color: INK, breakLine: true } },
      { text: d, options: { color: INK_MUTED, fontSize: 12 } },
    ], { x: x - 0.1, y: ty + 0.2, w: 2.6, h: 0.65, fontSize: 14, margin: 0, valign: "top", isTextBox: true });
  });
  footer(s, 9);
  s.addNotes("Four steps. Dates are placeholders until the pilot lead confirms them; fill in before presenting. The first-run setup screen checks for the AI runtime and model, creates the OneDrive folders and checks for classic Outlook. The two Power Automate flows are the longest step (about 45 minutes the first time, following the in-app guide).");

  // ---- 10 FAQ
  s = newSlide("mist", "FAQ");
  header(s, 10, "FAQ", "Questions we expect");
  const q = (W - 2 * MX - 0.3) / 2;
  const faq = [
    ["PiLockKey", "Does my data go to a cloud AI?", "No. The model runs on your laptop through Ollama. Your mail and Teams stay in Microsoft 365; only items you flag are copied to a OneDrive folder on your account."],
    ["PiPaperPlaneTilt", "Does it send emails?", "PMO To-Do never sends mail: drafts open unsent in Outlook. Tasks automations send only after an explicit confirm."],
    ["PiEnvelopeSimple", "Can it see my whole mailbox?", "No. It reads only mail you flag and Teams messages you send. Teams items are filtered by your tenant and chat allowlist."],
    ["PiWarningCircle", "What if the AI gets it wrong?", "Nothing becomes a to-do until you approve it, and you can edit every field first. Reject anything that looks off."],
  ];
  for (let i = 0; i < 4; i++) {
    const x = MX + (i % 2) * (q + 0.3), y = 2.0 + Math.floor(i / 2) * 2.35;
    glass(s, x, y, q, 2.1, { t: 22 });
    await iconDisc(s, faq[i][0], x + 0.3, y + 0.28, 0.6);
    s.addText(faq[i][1], { x: x + 1.1, y: y + 0.25, w: q - 1.4, h: 0.66, fontSize: 18, bold: true, color: INK, valign: "middle", margin: 0, isTextBox: true });
    s.addText(faq[i][2], { x: x + 0.3, y: y + 1.05, w: q - 0.6, h: 0.98, fontSize: 14, color: INK_SOFT, margin: 0, valign: "top", isTextBox: true });
  }
  footer(s, 10);
  s.addNotes("Likely questions. Be honest about the M365 caveat: flagged items pass through Power Automate and OneDrive on the colleague's own account, then are read locally. Mail: PMO To-Do never sends; Tasks automations (for example the weekly aging report) send only after an explicit confirm. Remind people that approval is the safety net, and that we recommend checking data handling with firm IT/risk before wider use.");

  // ---- 11 Name vote
  s = newSlide("mist", "Name");
  header(s, 11, "Name vote", `“${APP_NAME}” is a working name. Help us pick the real one`);
  const names = [
    [APP_NAME, "Says exactly what it is"],
    ["Deskhand", "A helper that tidies your desk"],
    ["Fieldnote", "Captures things as they arrive"],
    ["Waypoint", "Checkpoints on the way to done"],
    ["Local Loop", "Local AI, and closing the loop"],
    ["Quill", "Turns messy text into tidy tasks"],
    ["Clearway", "Clears a path through the inbox"],
    ["Tidy", "Short, calm, a little cheeky"],
  ];
  const nw = (W - 2 * MX - 3 * 0.3) / 4;
  names.forEach(([n, r], i) => {
    const x = MX + (i % 4) * (nw + 0.3), y = 2.0 + Math.floor(i / 4) * 2.15;
    glass(s, x, y, nw, 1.9, { t: 22 });
    s.addText(n, { x: x + 0.25, y: y + 0.2, w: nw - 0.5, h: 0.6, fontSize: 24, bold: true, color: i === 0 ? ACCENT : INK, valign: "middle", margin: 0, isTextBox: true });
    s.addText(r, { x: x + 0.25, y: y + 0.85, w: nw - 0.5, h: 0.5, fontSize: 14, color: INK_SOFT, margin: 0, valign: "top", isTextBox: true });
    chip(s, "open for vote", x + 0.25, y + 1.45, 1.3, { fs: 11, h: 0.3 });
  });
  s.addText("Have a better idea? Bring it to the vote.", { x: MX, y: 6.4, w: 9, h: 0.4, fontSize: 16, italic: true, color: ACCENT, margin: 0, isTextBox: true });
  footer(s, 11);
  s.addNotes("Run a quick show of hands or a poll. All eight are open; the first is the working name only because something had to go on the title slide. None of these names has been checked for trademark or firm-naming conflicts, so treat the winner as provisional.");

  // ---- 12 Closing
  s = newSlide("dusk", "Close");
  s.addText("THANK YOU", { x: MX, y: 1.1, w: 8, h: 0.3, fontSize: 13, bold: true, color: ACCENT, charSpacing: 3, margin: 0, isTextBox: true });
  s.addText(`Try ${APP_NAME} with us`, { x: MX, y: 1.5, w: 11.5, h: 1.2, fontSize: 52, bold: true, color: INK, margin: 0, valign: "middle", isTextBox: true });
  s.addText(TAGLINE, { x: MX, y: 2.85, w: 9.5, h: 0.9, fontSize: 22, color: INK_SOFT, margin: 0, valign: "top", isTextBox: true });
  glass(s, MX, 4.1, 7.2, 1.45, { t: 15, r: 0.3 });
  s.addText([
    { text: "Pilot lead: Alwin Saju", options: { bold: true, color: INK, breakLine: true } },
    { text: "Contact: alsaju@deloitte.com", options: { color: INK_SOFT, breakLine: true } },
    { text: "Sign-up by: [date]", options: { color: INK_SOFT } },
  ], { x: MX + 0.4, y: 4.1, w: 6.5, h: 1.45, fontSize: 18, valign: "middle", margin: 0, isTextBox: true });
  s.addText(DISCLAIMER, { x: MX, y: 5.8, w: 9.5, h: 0.4, fontSize: 16, italic: true, color: INK, margin: 0, isTextBox: true });
  await dock(s, MX, 6.3);
  s.addNotes("Close with the invitation and the contact details (Alwin Saju, alsaju@deloitte.com); fill in the sign-up date before presenting. Repeat the disclaimer out loud: this is an unofficial internal pilot, and data handling should be confirmed with firm IT/risk before wider use.");

  await pres.writeFile({ fileName: OUT });
  const { applyTheme } = require(path.join(process.env.PPTX_SKILL_DIR, "scripts", "apply_theme.js"));
  await applyTheme(OUT, THEME);
  console.log("wrote", OUT);
}

main().catch((e) => { console.error(e); process.exit(1); });
