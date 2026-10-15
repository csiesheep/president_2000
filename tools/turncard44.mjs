// tools/turncard44.mjs — the turn card in the page: when it shows, how it leaves, the rivals waiting for it (#44).
// Orchestrator's instrument: a peer may run it, does not edit it. Needs Chrome and a running LOCAL dev server
// (it opens a room).
//
//   node tools/turncard44.mjs http://127.0.0.1:8787/president_2000/
//
// Owner, 2026-10-15, approving the P1 designs (sticky 「開場卡的規格」): at each turn's start the card ([data-turncard])
// shows over the table, stays about 1.5 s and leaves by itself; a tap anywhere closes it at once; while it shows the
// rivals do not move, afterwards they move one step at a time as before (closing it is not a skip); a turn's card
// shows once (closing it and reloading the same turn does not bring it back); it asks for the "turn" sound (#42's
// p2000:sound event); with reduced motion it does not move (transform stays none); in a room it shows for turn 1 at
// the start; the tutorial never shows it. Measured in a solo game at the start of turn 2 (the rivals to move first)
// at 390 and 1440 wide.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import * as S from "../public/solo.js";

const base = process.argv[2];
if (!base) { console.log("usage: node tools/turncard44.mjs <base url ending in /president_2000/>"); process.exit(2); }
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Chrome picks a free port (--remote-debugging-port=0) and writes it to DevToolsActivePort in its own profile
// folder, one per run: fixed ports and folders collided when several agents ran tools at once (#43's checker).
// Folders this tool left more than 10 minutes ago are removed first.
async function launch() {
  const root = process.env.TEMP || "/tmp", dir = `${root}/turncard44_${process.pid}_${Date.now()}`;
  for (const old of readdirSync(root).filter((d) => d.startsWith("turncard44_"))) { try { if (Date.now() - statSync(`${root}/${old}`).mtimeMs > 600000) rmSync(`${root}/${old}`, { recursive: true, force: true }); } catch { /* in use */ } }
  mkdirSync(dir, { recursive: true });
  const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "--remote-debugging-port=0", `--user-data-dir=${dir}`, "about:blank"], { stdio: "ignore" });
  let port = 0;
  for (let i = 0; i < 100 && !port; i++) { try { port = Number.parseInt(readFileSync(`${dir}/DevToolsActivePort`, "utf8"), 10) || 0; } catch { /* starting */ } if (!port) await sleep(100); }
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break; } catch { /* starting */ } await sleep(200); }
  return { port, close: () => proc.kill() };
}
// Records sound requests, every save of the solo game, and when a turn card is on screen.
const SPY = `(() => {
  window.__sounds = []; addEventListener("p2000:sound", (e) => window.__sounds.push({ name: e.detail && e.detail.name, t: performance.now() }));
  window.__saves = []; window.__card = []; let last = null, shown = false;
  const vis = () => { const c = document.querySelector("[data-turncard]"); if (!c) return null; const r = c.getBoundingClientRect(), s = getComputedStyle(c);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && Number(s.opacity) > 0.05 ? c : null; };
  setInterval(() => {
    try { const v = sessionStorage.getItem("p2000.solo.session"); if (v !== last) { if (last !== null) window.__saves.push(performance.now()); last = v; } } catch { /* storage */ }
    const c = vis(); if (!!c !== shown) { shown = !!c; window.__card.push({ on: shown, t: performance.now(), turn: c ? c.getAttribute("data-turncard") : null }); }
  }, 20);
})();`;
async function tab(br, w, h, mobile, reduced = false) {
  const t = await (await fetch(`http://127.0.0.1:${br.port}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pend = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    if (m.method === "Page.javascriptDialogOpening") ws.send(JSON.stringify({ id: ++id, method: "Page.handleJavaScriptDialog", params: { accept: false } })); };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id;
    const tm = setTimeout(() => { pend.delete(i); rej(new Error(`instrument: CDP ${method} got no reply in 20 s (${String(params.expression || params.url || "").replace(/\s+/g, " ").slice(0, 90)})`)); }, 20000);
    pend.set(i, (m) => { clearTimeout(tm); res(m.result || {}); }); ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile });
  if (reduced) await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: SPY });
  const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); return r.result ? r.result.value : undefined; };
  const go = async (u, wait = 2200) => { await send("Page.navigate", { url: u }); await sleep(wait); };
  const tapAt = async (x, y) => { for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 }); };
  return { ev, go, tapAt, close: () => { try { ws.close(); } catch { /* closed */ } } };
}

// A solo game right at the start of turn 2, with the rivals to move first (made with the game's own code).
function turnTwo() {
  for (const seed of [4601, 4602, 4603, 4604, 4605, 4606]) {
    let s = S.newSolo({ seat: 0, level: 2, seed });
    for (let n = 0; n < 3000 && s.st.phase !== "end"; n++) {
      const before = s.st.log.length;
      if (S.botsToMove(s).length) s = S.stepBot(s); else { const ch = S.choices(s, "zh-Hant"); if (!ch.length) break; s = S.act(s, ch[0].move); }
      if (s.st.log.slice(before).some((e) => e.t === "turn" && e.turn === 2)) { if (S.botsToMove(s).length) return s; break; }
    }
  }
  return null;
}
const two = turnTwo();
const out = [];
const rule = (ok, what) => out.push({ ok, what });
const load = async (t, s) => {
  await t.go(base, 1200);
  await t.ev(`(()=>{ sessionStorage.setItem("p2000.solo.session", ${JSON.stringify(JSON.stringify(s))}); return 1; })()`);
  const t0 = Date.now();
  await t.go(`${base}?play`, 100);
  for (let i = 0; i < 100; i++) { try { if (await t.ev(`!!document.querySelector("[data-county]")`)) break; } catch { /* navigating */ } await sleep(30); }
  return t0;
};
const read = async (t) => JSON.parse(await t.ev(`JSON.stringify({ now: performance.now(), card: window.__card || [], saves: window.__saves || [], sounds: window.__sounds || [] })`));

const br = await launch();
try {
  if (!two) rule(false, "instrument: no solo game found at the start of turn 2 with the rivals to move");
  for (const [w, h, mob] of [[390, 844, true], [1440, 900, false]]) {
    if (!two) break;
    // 1–3: shows at once, on screen, leaves by itself; the rivals wait for it, then step one at a time.
    let t = await tab(br, w, h, mob);
    await load(t, two);
    const fit = JSON.parse(await t.ev(`JSON.stringify((() => { const c = document.querySelector("[data-turncard]"); if (!c) return null; const r = c.getBoundingClientRect();
      return { turn: c.getAttribute("data-turncard"), inside: r.top >= -1 && r.left >= -1 && r.bottom <= innerHeight + 1 && r.right <= innerWidth + 1, h: Math.round(r.height) }; })())`));
    await sleep(4500);
    let m = await read(t);
    const on = m.card.find((x) => x.on), off = m.card.find((x) => !x.on && on && x.t > on.t);
    rule(!!fit && fit.turn === "2" && fit.inside && !!on, `${w}: at the start of turn 2 the card shows (${fit ? `data-turncard ${fit.turn}, ${fit.h}px, ${fit.inside ? "on screen" : "NOT all on screen"}` : "no [data-turncard]"})`);
    const stay = on && off ? Math.round(off.t - on.t) : null;
    rule(stay !== null && stay >= 1200 && stay <= 2600, `${w}: it leaves by itself after ${stay === null ? "— (never)" : stay + " ms"} (1200–2600)`);
    const during = on ? m.saves.filter((x) => x > on.t + 100 && (!off || x < off.t)).length : -1;
    const after = off ? m.saves.filter((x) => x > off.t).length : 0;
    rule(during === 0 && after >= 2, `${w}: the rivals wait — ${during} steps while it shows, ${after} after it left`);
    t.close();
    // 4–5: a tap closes it at once and is not a skip; the same turn does not show it again after a reload.
    t = await tab(br, w, h, mob);
    await load(t, two);
    await sleep(300);
    const box = JSON.parse(await t.ev(`JSON.stringify((() => { const c = document.querySelector("[data-turncard]"); if (!c) return null; const r = c.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })())`));
    if (box) await t.tapAt(box.x, box.y);
    const tapped = (await read(t)).now;
    await sleep(3500);
    m = await read(t);
    const closed = m.card.find((x) => !x.on && x.t >= tapped - 50);
    const steps = m.saves.filter((x) => x > tapped);
    const spread = steps.length >= 2 ? Math.round(steps[steps.length - 1] - steps[0]) : 0;
    rule(!!box && !!closed && closed.t - tapped <= 400 && steps.length >= 2 && spread >= 300, `${w}: a tap closes it ${closed ? Math.round(closed.t - tapped) + " ms later" : "— not closed"}; then the rivals take ${steps.length} steps over ${spread} ms (one at a time, not skipped)`);
    await t.go(`${base}?play`, 1500);
    m = await read(t);
    // only counts when the card had shown before the reload (on a page that never shows it, this would be true for nothing)
    rule(!!box && !m.card.some((x) => x.on), `${w}: reloading the same turn ${!box ? "— the card never showed before the reload" : m.card.some((x) => x.on) ? "shows the card AGAIN" : "does not show it again"}`);
    t.close();
  }
  // 6: the turn sound; 7: reduced motion; 8: tutorial.
  if (two) {
    let t = await tab(br, 390, 844, true);
    await load(t, two); await sleep(800);
    let m = await read(t);
    rule(m.sounds.some((x) => x.name === "turn"), `390: the card asks for the turn sound (${m.sounds.map((x) => x.name).join(",") || "no sound requests"})`);
    t.close();
    t = await tab(br, 390, 844, true, true);
    await load(t, two);
    const tf = [];
    for (let i = 0; i < 8; i++) { tf.push(await t.ev(`(() => { const c = document.querySelector("[data-turncard]"); return c ? getComputedStyle(c).transform : "gone"; })()`)); await sleep(40); }
    rule(tf.some((x) => x !== "gone") && tf.every((x) => x === "none" || x === "gone"), `390 reduced motion: the card's transform over its first 320 ms — ${[...new Set(tf)].join(" / ")}`);
    t.close();
  }
  {
    const t = await tab(br, 390, 844, true);
    await t.go(`${base}?tutorial`, 2500);
    for (let i = 0; i < 3; i++) { await t.ev(`(()=>{const b=document.querySelector('[data-tutorial]'); const nb=b&&[...b.querySelectorAll('button')].find(x=>/下一步|Next/.test(x.textContent)); nb&&nb.click(); return 1;})()`); await sleep(900); }
    const m = await read(t);
    rule(!m.card.some((x) => x.on), `390 tutorial: ${m.card.some((x) => x.on) ? "a turn card SHOWED" : "no turn card"}`);
    t.close();
  }
  // 9: a room with bots shows the turn-1 card at the start, and it leaves by itself.
  {
    const t = await tab(br, 390, 844, true);
    await t.go(`${base}?host`, 1500);
    await t.ev(`(() => { const f = document.querySelector("form.rform"); if (!f) return 0; f.elements.name.value = "測試"; f.requestSubmit(); return 1; })()`);
    for (let i = 0; i < 40 && !(await t.ev(`!!document.querySelector(".btn.sit[data-msg]")`)); i++) await sleep(250);
    await t.ev(`(() => { const b = document.querySelector(".btn.sit[data-msg]"); b && b.click(); return 1; })()`); await sleep(800);
    await t.ev(`(() => { const b = document.querySelector(".big.go[data-msg]"); b && b.click(); return 1; })()`);
    await sleep(5000);
    const m = await read(t);
    const on = m.card.find((x) => x.on), off = on && m.card.find((x) => !x.on && x.t > on.t);
    rule(!!on && on.turn === "1" && !!off, `390 room: ${on ? `the turn ${on.turn} card showed and ${off ? "left after " + Math.round(off.t - on.t) + " ms" : "did NOT leave"}` : "no turn card at the start"}`);
    t.close();
  }
} finally { br.close(); }
let bad = 0;
for (const x of out) { if (!x.ok) bad++; console.log(`${x.ok ? "✓" : "✗"} ${x.what}`); }
console.log(bad ? `FAIL: ${bad} of ${out.length}` : `PASS: ${out.length} checks`);
process.exit(bad ? 1 : 0);
