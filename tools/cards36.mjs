// tools/cards36.mjs — are the cards in their camp's colour, without frame lines, the picture full-bleed? (#36)
// Orchestrator's instrument: a peer may run it, does not edit it. Needs Chrome and a running dev server.
//
//   node tools/cards36.mjs http://127.0.0.1:8787/president_2000/
//
// Owner, 2026-10-15: 「不要有那麼多線條的框。用陣營顏色當成卡牌的背景色」, version two (滿版圖). It opens a solo game at 390
// and 1440 wide, measures every event or local card in the hand ([data-camp]) and the big card face of the first one
// (tap it: [data-face]), and the cards on the rules page (rules#allcards, [data-camp]):
//   - the card's own background is its camp's colour (±8 per channel): 陳 #2f7d46, 宋 #c25a12, 連 #2456a6,
//     外力 #3d3732, 地方 #86683a;
//   - no frame lines: the card, everything in it and their ::before / ::after have no border and no outline;
//   - in the hand and the face, the picture is full-bleed at the top (its left, right and top edges are the card's,
//     ±1 px, measured with the fan's rotation taken off) and the CP ([data-cp]) sits in the top-left corner;
//   - text below the picture reads on the colour: contrast ≥ 4.5:1 against the card's colour;
//   - the page does not scroll sideways.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";

const base = process.argv[2];
if (!base) { console.log("usage: node tools/cards36.mjs <base url ending in /president_2000/>"); process.exit(2); }
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function launch(port) {
  const dir = `${process.env.TEMP || "/tmp"}/cards36_${port}`;
  mkdirSync(dir, { recursive: true });
  const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, "about:blank"], { stdio: "ignore" });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break; } catch { /* starting */ } await sleep(200); }
  return { port, close: () => proc.kill() };
}
async function tab(br, url, w, h, mobile) {
  const t = await (await fetch(`http://127.0.0.1:${br.port}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pend = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, (m) => res(m.result || {})); ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile });
  const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); return r.result ? r.result.value : undefined; };
  await send("Page.navigate", { url }); await sleep(2200);
  await ev("document.fonts.ready.then(()=>1)");
  return { ev, close: () => { try { ws.close(); } catch { /* closed */ } } };
}

// One card measured in the page: colour, lines, picture, CP, contrast. Returns a list of problems ([] = fine).
const CHECK = `window.__card = (el, opts) => {
  const CAMP = { chen: [47,125,70], soong: [194,90,18], lien: [36,86,166], ext: [61,55,50], local: [134,104,58] };
  const out = [], camp = el.getAttribute("data-camp"), want = CAMP[camp];
  const rgb = (s) => (s.match(/[\\d.]+/g) || []).slice(0, 3).map(Number);
  if (!want) return ["data-camp is " + camp];
  const bg = rgb(getComputedStyle(el).backgroundColor);
  if (bg.length < 3 || bg.some((v, i) => Math.abs(v - want[i]) > 8)) out.push("background " + getComputedStyle(el).backgroundColor + " is not " + camp + "'s rgb(" + want.join(",") + ")");
  const lined = (node, pseudo) => { const s = getComputedStyle(node, pseudo); if (pseudo && (s.content === "none" || s.content === "normal")) return false;
    return ["Top","Right","Bottom","Left"].some((k) => parseFloat(s["border" + k + "Width"]) > 0 && s["border" + k + "Style"] !== "none") || (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0); };
  for (const node of [el, ...el.querySelectorAll("*")]) for (const ps of [null, "::before", "::after"]) if (lined(node, ps)) { out.push("a line on " + (node === el ? "the card" : node.tagName.toLowerCase() + "." + node.className) + (ps || "")); break; }
  const lum = (c) => { const v = c.map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
  const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const tf = el.style.transform; el.style.transform = "none";
  const parentTf = el.parentElement && el.parentElement.style.transform; if (el.parentElement) el.parentElement.style.transform = "none";
  const cr = el.getBoundingClientRect();
  if (opts.picture) {
    const img = el.querySelector("img");
    if (!img) out.push("no picture");
    else { const ir = img.getBoundingClientRect(); if (Math.abs(ir.left - cr.left) > 1 || Math.abs(ir.right - cr.right) > 1 || Math.abs(ir.top - cr.top) > 1) out.push("picture not full-bleed (" + [ir.left - cr.left, cr.right - ir.right, ir.top - cr.top].map((n) => n.toFixed(1)).join("/") + ")");
      const cp = el.querySelector("[data-cp]");
      if (!cp) out.push("no [data-cp]"); else { const pr = cp.getBoundingClientRect(); if (pr.left - cr.left > cr.width * 0.4 || pr.top - cr.top > cr.height * 0.3) out.push("CP not top-left"); }
      for (const node of el.querySelectorAll("*")) { if (![...node.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue; const r = node.getBoundingClientRect(); if (r.width === 0 || r.top < ir.bottom - 2) continue;
        const c = contrast(rgb(getComputedStyle(node).color), bg); if (c < 4.5) { out.push("text 「" + node.textContent.trim().slice(0, 10) + "」 contrast " + c.toFixed(2)); break; } } }
  }
  el.style.transform = tf; if (el.parentElement) el.parentElement.style.transform = parentTf || "";
  return out;
}; 1`;

const out = [];
const rule = (ok, what) => out.push({ ok, what });
const br = await launch(9498);
try {
  for (const [w, h, mob] of [[390, 844, true], [1440, 900, false]]) {
    const t = await tab(br, `${base}?play`, w, h, mob);
    await t.ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.offsetParent&&/開始選戰|Start/.test(x.textContent)); b&&b.click(); return 1;})()`);
    await sleep(8000);
    await t.ev(CHECK);
    const hand = JSON.parse(await t.ev(`JSON.stringify([...document.querySelectorAll(".tbl [data-sel][data-camp], .tbl [data-pick][data-camp]")].map((el) => ({ id: el.getAttribute("data-sel") || el.getAttribute("data-pick"), camp: el.getAttribute("data-camp"), bad: __card(el, { picture: true }) })))`));
    rule(hand.length >= 4 && hand.every((c) => !c.bad.length), `${w}: ${hand.length} hand cards in their camp's colour, no lines, picture full-bleed, CP top-left, text readable${hand.filter((c) => c.bad.length).map((c) => ` — ${c.id}: ${c.bad.join("; ")}`).join("")}`);
    const opened = await t.ev(`(()=>{ const c = document.querySelector(".tbl [data-sel][data-camp]"); if (!c) return null; c.click(); return c.getAttribute("data-sel"); })()`);
    await sleep(600);
    const face = JSON.parse(await t.ev(`(()=>{ const f = document.querySelector("[data-face][data-camp]"); return JSON.stringify(f ? { id: f.getAttribute("data-face"), bad: __card(f, { picture: true }) } : null); })()`));
    rule(!!face && face.id === opened && !face.bad.length, `${w}: the big card face of ${opened}${face ? (face.bad.length ? " — " + face.bad.join("; ") : " in its colour, no lines, picture full-bleed") : " not found ([data-face][data-camp])"}`);
    rule(JSON.parse(await t.ev(`JSON.stringify(document.documentElement.scrollWidth <= innerWidth)`)), `${w}: no sideways scroll`);
    t.close();
  }
  const r = await tab(br, `${base}rules#allcards`, 1280, 900, false);
  await r.ev(CHECK);
  const rc = JSON.parse(await r.ev(`JSON.stringify([...document.querySelectorAll("#allcards [data-camp]")].map((el) => ({ camp: el.getAttribute("data-camp"), bad: __card(el, { picture: false }) })))`));
  const camps = new Set(rc.map((c) => c.camp));
  rule(rc.length >= 70 && camps.size === 5 && rc.every((c) => !c.bad.length), `rules page: ${rc.length} cards with data-camp (≥ 70, five camps: ${[...camps].join(",") || "none"}) in their colour, no lines${rc.filter((c) => c.bad.length).slice(0, 2).map((c) => ` — ${c.camp}: ${c.bad.join("; ")}`).join("")}`);
  r.close();
} finally { br.close(); }
let bad = 0;
for (const x of out) { if (!x.ok) bad++; console.log(`${x.ok ? "✓" : "✗"} ${x.what}`); }
console.log(bad ? `FAIL: ${bad} of ${out.length}` : `PASS: ${out.length} checks`);
process.exit(bad ? 1 : 0);
