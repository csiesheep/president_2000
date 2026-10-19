// tools/handclip45.mjs — a lifted hand card is seen whole at the top, not cut by the hand's strip (#45).
// Orchestrator's instrument: a peer may run it, does not edit it. Needs Chrome and a running dev server.
//
//   node tools/handclip45.mjs http://127.0.0.1:8787/president_2000/
//
// Owner, 2026-10-15, a desktop screenshot: 「desktop 版，牌上方被切掉」 — hovering a hand card lifts it, and the hand's
// strip (.hs, which scrolls sideways on phones) cut off everything above its own top, the whole picture since #36. At
// 1280×800, 1346×720 (the owner's) and 1440×900 it hovers each hand card in turn (the candidate card too) with a real
// mouse, and at 390×844 it taps one (a tapped card is lifted as selected), and asks: is the card's top seen — the
// point 12 px below its top edge, at its centre, hits the card itself, and the top is on the screen?
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import * as S from "../public/solo.js";

const base = process.argv[2];
if (!base) { console.log("usage: node tools/handclip45.mjs <base url ending in /president_2000/>"); process.exit(2); }
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function launch() {
  const root = process.env.TEMP || "/tmp", dir = `${root}/handclip45_${process.pid}_${Date.now()}`;
  for (const old of readdirSync(root).filter((d) => d.startsWith("handclip45_"))) { try { if (Date.now() - statSync(`${root}/${old}`).mtimeMs > 600000) rmSync(`${root}/${old}`, { recursive: true, force: true }); } catch { /* in use */ } }
  mkdirSync(dir, { recursive: true });
  const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "--remote-debugging-port=0", `--user-data-dir=${dir}`, "about:blank"], { stdio: "ignore" });
  let port = 0;
  for (let i = 0; i < 100 && !port; i++) { try { port = Number.parseInt(readFileSync(`${dir}/DevToolsActivePort`, "utf8"), 10) || 0; } catch { /* starting */ } if (!port) await sleep(100); }
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break; } catch { /* starting */ } await sleep(200); }
  return { port, close: () => proc.kill() };
}
async function tab(br, w, h, mobile) {
  const t = await (await fetch(`http://127.0.0.1:${br.port}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pend = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id;
    const tm = setTimeout(() => { pend.delete(i); rej(new Error(`instrument: CDP ${method} got no reply in 20 s`)); }, 20000);
    pend.set(i, (m) => { clearTimeout(tm); res(m.result || {}); }); ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Page.enable"); // #96: the first-time boxes are a modal of the first game, measured by tools/tips96.mjs; off here unless set
  await send("Page.addScriptToEvaluateOnNewDocument", { source: 'try { if (!localStorage.getItem("p2000.tips")) localStorage.setItem("p2000.tips", JSON.stringify({ seen: [], off: true })); } catch (e) { /* no storage */ }' });
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile });
  const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); return r.result ? r.result.value : undefined; };
  const go = async (u, wait = 2200) => { await send("Page.navigate", { url: u }); await sleep(wait); };
  return { ev, go, send, close: () => { try { ws.close(); } catch { /* closed */ } } };
}
const first = S.advance(S.newSolo({ seat: 0, level: 2, seed: 3700 }));
// The top of card i: is the point 12 px under its top edge, at its centre, the card itself, and on screen?
const TOP = (sel) => `JSON.stringify((() => { const c = document.querySelector(${JSON.stringify(sel)}); if (!c) return null; const r = c.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + 12;
  const at = y >= 0 && y < innerHeight ? document.elementFromPoint(x, y) : null; return { top: Math.round(r.top), seen: !!at && (at === c || c.contains(at)), hit: at ? String(at.className && at.className.baseVal !== undefined ? at.tagName : at.className || at.tagName).slice(0, 24) : "off screen" }; })())`;
const out = [];
const rule = (ok, what) => out.push({ ok, what });
const load = async (t) => {
  await t.go(base, 1200);
  await t.ev(`(()=>{ sessionStorage.setItem("p2000.solo.session", ${JSON.stringify(JSON.stringify(first))}); return 1; })()`);
  await t.go(`${base}?play`, 100);
  for (let i = 0; i < 100; i++) { try { if (await t.ev(`!!document.querySelector("[data-county]")`)) break; } catch { /* navigating */ } await sleep(30); }
  // a turn card (#44) may show first; wait until it has been gone 0.4 s
  for (let i = 0, clear = 0; i < 160 && clear < 8; i++) { let up = true; try { up = await t.ev(`(() => { const c = document.querySelector("[data-turncard]"); if (!c) return false; const r = c.getBoundingClientRect(); return r.width > 0 && Number(getComputedStyle(c).opacity) > 0.05; })()`); } catch { /* navigating */ } clear = up ? 0 : clear + 1; await sleep(50); }
  await sleep(300);
};
const br = await launch();
try {
  for (const [w, h] of [[1280, 800], [1346, 720], [1440, 900]]) {
    const t = await tab(br, w, h, false);
    await load(t);
    const sels = JSON.parse(await t.ev(`JSON.stringify([...document.querySelectorAll(".tbl .hs > .hc")].map((c, i) => c.hasAttribute("data-cand") ? ".tbl [data-cand]" : \`.tbl [data-sel="\${c.getAttribute("data-sel")}"]\`))`));
    const bad = [], tops = [];
    for (const sel of sels) {
      const at = JSON.parse(await t.ev(`JSON.stringify((() => { const c = document.querySelector(${JSON.stringify(sel)}); const r = c.getBoundingClientRect(); return { x: r.left + r.width / 2, y: Math.min(innerHeight - 6, r.top + 30) }; })())`));
      await t.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x, y: at.y }); await sleep(450);
      const m = JSON.parse(await t.ev(TOP(sel)));
      tops.push(m ? m.top : "?");
      if (!m || !m.seen) bad.push(`${sel.replace(".tbl ", "")}: top ${m ? m.top : "?"} under ${m ? m.hit : "?"}`);
    }
    await t.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 5 });
    rule(sels.length >= 4 && !bad.length, `${w}×${h}: ${sels.length} hand cards hovered, tops ${tops.join("/")}${bad.length ? " — cut: " + bad.join("; ") : " — each top seen"}`);
    t.close();
  }
  {
    const t = await tab(br, 390, 844, true);
    await load(t);
    const sel = await t.ev(`(() => { const c = [...document.querySelectorAll(".tbl [data-sel]")][1]; c.click(); return \`.tbl [data-sel="\${c.getAttribute("data-sel")}"]\`; })()`);
    await sleep(600);
    const m = JSON.parse(await t.ev(TOP(sel)));
    rule(!!m && m.seen, `390×844: the tapped (selected) card's top ${m ? `${m.top}, ${m.seen ? "seen" : "cut under " + m.hit}` : "not found"}`);
    t.close();
  }
} finally { br.close(); }
let bad = 0;
for (const x of out) { if (!x.ok) bad++; console.log(`${x.ok ? "✓" : "✗"} ${x.what}`); }
console.log(bad ? `FAIL: ${bad} of ${out.length}` : `PASS: ${out.length} checks`);
process.exit(bad ? 1 : 0);
