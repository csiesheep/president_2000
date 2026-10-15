// tools/end33.mjs — does the end page show who won, the votes and the shares on the first screen? (#33)
// Orchestrator's instrument: a peer may run it, does not edit it. Needs Chrome and a running dev server.
//
//   node tools/end33.mjs http://127.0.0.1:8787/president_2000/
//
// It plays a solo game to the end with the game's own code (陳, level 2, seed 4101: 連 wins, 陳 third), puts it in
// the page's saved session, opens ?play, and measures:
//   phone 390×844, zh and en: the hero picture ([data-end-hero]) has loaded and is on screen, and the three result
//     rows ([data-result]) end within the first screen (≤ 844 px from the top); the winner ([data-winner]) is on
//     the first screen; nothing sticks out of a result row; no sideways scroll;
//   desk 1440×900, zh: the hero and the three rows are on the first screen; no sideways scroll.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import * as S from "../public/solo.js";
import * as D from "../tests/driver.js";

const base = process.argv[2];
if (!base) { console.log("usage: node tools/end33.mjs <base url ending in /president_2000/>"); process.exit(2); }
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function finishedGame() {
  let s = S.advance(S.newSolo({ seat: 0, level: 2, seed: 4101 }));
  const R = D.rng(4101);
  for (let n = 0; n < 900 && s.st.phase !== "end"; n++) {
    const ch = S.choices(s, "zh-Hant");
    if (!ch.length) break;
    s = S.advance(S.act(s, ch[Math.floor(R() * ch.length)].move));
  }
  return s.st.phase === "end" ? s : null;
}
// Chrome picks a free port (--remote-debugging-port=0) and writes it to DevToolsActivePort in its own profile
// folder, one per run: fixed ports and folders collided when several agents ran tools at once (#43's checker).
// Folders this tool left more than 10 minutes ago are removed first.
async function launch() {
  const root = process.env.TEMP || "/tmp", dir = `${root}/end33_${process.pid}_${Date.now()}`;
  for (const old of readdirSync(root).filter((d) => d.startsWith("end33_"))) { try { if (Date.now() - statSync(`${root}/${old}`).mtimeMs > 600000) rmSync(`${root}/${old}`, { recursive: true, force: true }); } catch { /* in use */ } }
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
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, (m) => res(m.result || {})); ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile });
  const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); return r.result ? r.result.value : undefined; };
  const go = async (url, wait = 2200) => { await send("Page.navigate", { url }); await sleep(wait); await ev("document.fonts.ready.then(()=>1)"); };
  return { ev, go, close: () => { try { ws.close(); } catch { /* closed */ } } };
}
const MEASURE = `(async()=>{
  const vis = (e) => { if (!e) return false; const r = e.getBoundingClientRect(), s = getComputedStyle(e); return e.getClientRects().length > 0 && r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  const hero = document.querySelector("[data-end-hero]");
  if (hero && !hero.complete) await new Promise((r) => { hero.onload = hero.onerror = r; setTimeout(r, 3000); });
  const R = (e) => { const r = e.getBoundingClientRect(); return { y: r.top + scrollY, b: r.bottom + scrollY, x: r.left, r: r.right }; };
  const rows = [...document.querySelectorAll("[data-result]")].filter(vis);
  const stick = rows.map((row) => { const br = R(row); for (const el of row.querySelectorAll("*")) { if (!vis(el) || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue; const r = R(el); if (r.r > br.r + 1 || r.x < br.x - 1) return el.textContent.trim().slice(0, 16); } return null; }).filter(Boolean);
  const win = document.querySelector("[data-winner]");
  return JSON.stringify({ hero: hero && vis(hero) ? { ...R(hero), loaded: hero.naturalWidth > 0, src: hero.getAttribute("src") } : null,
    rows: rows.map((r) => ({ seat: r.dataset.result, ...R(r) })), win: win && vis(win) ? R(win) : null, stick, sw: document.documentElement.scrollWidth, iw: innerWidth, ih: innerHeight });
})()`;

const out = [];
const rule = (ok, what) => out.push({ ok, what });
const s = finishedGame();
if (!s) { console.log("FAIL: the game did not reach the end (instrument)"); process.exit(1); }
const br = await launch();
try {
  for (const [w, h, mob, lang] of [[390, 844, true, "zh"], [390, 844, true, "en"], [1440, 900, false, "zh"]]) {
    const t = await tab(br, w, h, mob);
    await t.go(base, 800);
    await t.ev(`(()=>{ sessionStorage.setItem("p2000.solo.session", ${JSON.stringify(JSON.stringify(s))}); return 1; })()`);
    await t.go(`${base}?play${lang === "en" ? "&lang=en" : ""}`);
    const m = JSON.parse(await t.ev(MEASURE)), tag = `${w}×${h} ${lang}`;
    rule(!!m.hero && m.hero.loaded && m.hero.y < m.ih, `${tag}: hero picture loaded and on the first screen (${m.hero ? `${m.hero.src}, top ${Math.round(m.hero.y)}, loaded ${m.hero.loaded}` : "missing"})`);
    rule(!!m.win && m.win.b <= m.ih, `${tag}: the winner's name on the first screen (${m.win ? "bottom " + Math.round(m.win.b) : "missing"})`);
    rule(m.rows.length === 3 && Math.max(...m.rows.map((r) => r.b)) <= m.ih, `${tag}: three result rows end on the first screen (${m.rows.length ? "last bottom " + Math.round(Math.max(...m.rows.map((r) => r.b))) + " ≤ " + m.ih : "none"})`);
    if (mob) rule(!m.stick.length, `${tag}: nothing sticks out of a result row${m.stick.length ? " (「" + m.stick[0] + "」)" : ""}`);
    rule(m.sw <= m.iw, `${tag}: no sideways scroll (${m.sw} ≤ ${m.iw})`);
    t.close();
  }
} finally { br.close(); }
let bad = 0;
for (const r of out) { if (!r.ok) bad++; console.log(`${r.ok ? "✓" : "✗"} ${r.what}`); }
console.log(bad ? `FAIL: ${bad} of ${out.length}` : `PASS: ${out.length} checks`);
process.exit(bad ? 1 : 0);
