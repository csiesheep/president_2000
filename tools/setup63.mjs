// tools/setup63.mjs — the solo setup page (?play, 「你要替誰打這場選戰？」) fits an iPhone screen without scrolling (#63).
// Orchestrator's file: a peer may run it, and does not edit it.
//
//   node tools/setup63.mjs <base url ending in /president_2000/>
//
// Owner, 2026-10-16: 「選候選人頁，縮減一下空間，iPhone 上看不需要 scroll」. The phone is taken as an iPhone 14/15 in
// Safari with its toolbars showing: 390 × 664 CSS px (CDP device metrics, mobile). On main (65a67ba, before #63) the page
// is 760 px tall in Chinese and 916 px in English, the start button's foot at 683 / 822.
// Counted (both languages, 390 × 664):
//   - the page does not scroll: documentElement.scrollHeight ≤ innerHeight, and no sideways scroll;
//   - everything to choose and press is on screen: the three candidate cards ([data-seat] in .setup), the three levels
//     ([data-level]), the start button ([data-start]) and the tutorial link (a[href*="tutorial"]) all inside the viewport;
//   - still easy to tap: each candidate card and level button at least 44 px high, the start button at least 48 px;
//   - each candidate keeps its name and its blurb (a line of text under the name), not cut off.
// Printed, never counted: the same page at 375 × 548 (an iPhone SE in Safari) and at 1440 × 900.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";

const base = process.argv[2];
if (!base) { console.log("usage: node tools/setup63.mjs <base url ending in /president_2000/>"); process.exit(2); }
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch() {
  const root = process.env.TEMP || "/tmp", dir = `${root}/setup63_${process.pid}_${Date.now()}`;
  for (const old of readdirSync(root).filter((d) => d.startsWith("setup63_"))) { try { if (Date.now() - statSync(`${root}/${old}`).mtimeMs > 600000) rmSync(`${root}/${old}`, { recursive: true, force: true }); } catch { /* in use */ } }
  mkdirSync(dir, { recursive: true });
  const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--remote-debugging-port=0", `--user-data-dir=${dir}`, "about:blank"], { stdio: "ignore" });
  let port = 0;
  for (let i = 0; i < 100 && !port; i++) { try { port = Number.parseInt(readFileSync(`${dir}/DevToolsActivePort`, "utf8"), 10) || 0; } catch { /* starting */ } if (!port) await sleep(100); }
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
  await send("Page.enable"); // #96: the first-time boxes are a modal of the first game, measured by tools/tips96.mjs; off here unless set
  await send("Page.addScriptToEvaluateOnNewDocument", { source: 'try { if (!localStorage.getItem("p2000.tips")) localStorage.setItem("p2000.tips", JSON.stringify({ seen: [], off: true })); } catch (e) { /* no storage */ }' });
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile });
  const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); return r.result ? r.result.value : undefined; };
  await send("Page.navigate", { url }); await sleep(2500);
  await ev("document.fonts.ready.then(()=>1)");
  return { ev, close: () => { try { ws.close(); } catch { /* closed */ } } };
}

const MEASURE = `(() => {
  const R = (e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top + scrollY), r: Math.round(r.right), b: Math.round(r.bottom + scrollY), h: Math.round(r.height) }; };
  const drawn = (e) => !!e && e.getClientRects().length > 0 && e.getBoundingClientRect().height > 0 && getComputedStyle(e).visibility !== "hidden";
  const setup = document.querySelector(".setup");
  const cands = setup ? [...setup.querySelectorAll("[data-seat]")].filter(drawn) : [];
  const levels = setup ? [...setup.querySelectorAll("[data-level]")].filter(drawn) : [];
  const go = document.querySelector("[data-start]"), tut = setup && setup.querySelector('a[href*="tutorial"]');
  const textOf = (c) => [...c.querySelectorAll("*")].filter((e) => drawn(e) && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())).map((e) => ({ t: e.textContent.trim(), cut: e.scrollHeight > e.clientHeight + 1 && getComputedStyle(e).overflow !== "visible" }));
  return JSON.stringify({ sh: document.documentElement.scrollHeight, sw: document.documentElement.scrollWidth, ih: innerHeight, iw: innerWidth,
    cands: cands.map((c) => ({ ...R(c), texts: textOf(c) })), levels: levels.map(R), go: go && drawn(go) ? R(go) : null, tut: tut && drawn(tut) ? R(tut) : null });
})()`;

const out = [];
const rule = (ok, what) => out.push({ ok, what });
const br = await launch();
try {
  for (const lang of ["zh", "en"]) {
    const t = await tab(br, `${base}?play${lang === "en" ? "&lang=en" : ""}`, 390, 664, true);
    const m = JSON.parse(await t.ev(MEASURE));
    const on = (r) => !!r && r.y >= 0 && r.b <= m.ih && r.x >= 0 && r.r <= m.iw;
    rule(m.sh <= m.ih && m.sw <= m.iw, `${lang} 390×664: the page does not scroll (height ${m.sh} ≤ ${m.ih}, width ${m.sw} ≤ ${m.iw})`);
    rule(m.cands.length === 3 && m.cands.every(on), `${lang}: the three candidate cards on screen (${m.cands.map((c) => `${c.y}–${c.b}`).join(", ") || "none found"})`);
    rule(m.levels.length === 3 && m.levels.every(on), `${lang}: the three levels on screen (${m.levels.map((c) => `${c.y}–${c.b}`).join(", ") || "none found"})`);
    rule(on(m.go) && on(m.tut), `${lang}: the start button and the tutorial link on screen (start ${m.go ? `${m.go.y}–${m.go.b}` : "not found"}, tutorial ${m.tut ? `${m.tut.y}–${m.tut.b}` : "not found"})`);
    rule(m.cands.every((c) => c.h >= 44) && m.levels.every((c) => c.h >= 44) && m.go && m.go.h >= 48, `${lang}: easy to tap (cards ${m.cands.map((c) => c.h).join("/")}, levels ${m.levels.map((c) => c.h).join("/")}, start ${m.go ? m.go.h : "?"} px)`);
    const thin = m.cands.filter((c) => c.texts.length < 2 || c.texts.some((x) => x.cut));
    rule(m.cands.length === 3 && !thin.length, `${lang}: each candidate keeps a name and a blurb, nothing cut (${m.cands.map((c) => c.texts.length).join("/")} text lines)`);
    t.close();
  }
  console.log("reading (not counted):");
  for (const [w, h] of [[375, 548], [1440, 900]]) for (const lang of ["zh", "en"]) {
    const t = await tab(br, `${base}?play${lang === "en" ? "&lang=en" : ""}`, w, h, w < 700);
    const m = JSON.parse(await t.ev(MEASURE));
    console.log(`  ${lang} ${w}×${h}: page ${m.sh} px for a ${m.ih} px screen${m.sh <= m.ih ? " (fits)" : ` (${m.sh - m.ih} px to scroll)`}; start button foot at ${m.go ? m.go.b : "?"}`);
    t.close();
  }
} finally { br.close(); }
for (const o of out) console.log(`${o.ok ? "✓" : "✗"} ${o.what}`);
const bad = out.filter((o) => !o.ok).length;
console.log(bad ? `FAIL: ${bad} of ${out.length} checks` : `PASS: ${out.length} checks`);
process.exit(bad ? 1 : 0);
