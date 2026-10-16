// tools/sound42.mjs — interface sounds, the rivals' speed and the menu that sets them (#42, P1 ⑤ ⑭).
// Orchestrator's instrument: a peer may run it, does not edit it. Needs Chrome and a running LOCAL dev server
// (it opens a room).
//
//   node tools/sound42.mjs http://127.0.0.1:8787/president_2000/
//
// Owner, 2026-10-15, approving the P1 designs. Contract:
//   - public/sound.js play(name), name tap|play|cube|uncube|hit|miss|turn; every request fires a window event
//     "p2000:sound" with detail { name, muted }; muted when the sound is off, and then no audio node starts;
//     no AudioContext is made before the page's first real tap or key;
//   - settings in localStorage: "p2000.sound" = {"on":true,"vol":0.7} by default, "p2000.speed" = "normal" by
//     default (slow|normal|fast|step); solo and room pages share them;
//   - the menu (solo #gmenu, room #rmenu) holds four [data-speed="slow|normal|fast|step"] buttons (aria-pressed, one
//     true), a [data-sound] switch (role=switch, aria-checked) and an input[type=range][data-volume] 0–100;
//   - solo bots step every 640 / 400 / 160 ms (slow / normal / fast); "step" waits for a tap on [data-botnext], one
//     step per tap;
//   - sounds: tap on a hand card or a county; play for each card played (log "play"); cube/uncube for blocks placed
//     or taken; hit/miss for each support check (log "check"), at most 3 of one name per step; turn at a new turn.
// Taps here are real mouse events (CDP Input), not el.click(): the first-gesture rule depends on it.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import * as S from "../public/solo.js";

const base = process.argv[2];
if (!base) { console.log("usage: node tools/sound42.mjs <base url ending in /president_2000/>"); process.exit(2); }
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Chrome picks a free port (--remote-debugging-port=0) and writes it to DevToolsActivePort in its own profile
// folder, one per run: fixed ports and folders collided when several agents ran tools at once (#43's checker).
// Folders this tool left more than 10 minutes ago are removed first.
async function launch() {
  const root = process.env.TEMP || "/tmp", dir = `${root}/sound42_${process.pid}_${Date.now()}`;
  for (const old of readdirSync(root).filter((d) => d.startsWith("sound42_"))) { try { if (Date.now() - statSync(`${root}/${old}`).mtimeMs > 600000) rmSync(`${root}/${old}`, { recursive: true, force: true }); } catch { /* in use */ } }
  mkdirSync(dir, { recursive: true });
  const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "--remote-debugging-port=0", `--user-data-dir=${dir}`, "about:blank"], { stdio: "ignore" });
  let port = 0;
  for (let i = 0; i < 100 && !port; i++) { try { port = Number.parseInt(readFileSync(`${dir}/DevToolsActivePort`, "utf8"), 10) || 0; } catch { /* starting */ } if (!port) await sleep(100); }
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break; } catch { /* starting */ } await sleep(200); }
  return { port, close: () => proc.kill() };
}
// Counts AudioContexts made and audio nodes started, and records every p2000:sound request, from the first script on.
const SPY = `(() => {
  window.__audio = { made: 0, started: 0 }; window.__sounds = [];
  const C = window.AudioContext || window.webkitAudioContext;
  if (C) { const W = function (...a) { window.__audio.made++; return new C(...a); }; W.prototype = C.prototype; window.AudioContext = W; window.webkitAudioContext = W; }
  // every kind of source: AudioBufferSourceNode (noise) has its own start(), the parent's patch never saw it (#42, FE)
  for (const K of ["AudioScheduledSourceNode", "AudioBufferSourceNode", "OscillatorNode", "ConstantSourceNode"]) { const P = window[K] && window[K].prototype; if (!P || !Object.prototype.hasOwnProperty.call(P, "start")) continue; const st = P.start; P.start = function (...a) { window.__audio.started++; return st.apply(this, a); }; }
  addEventListener("p2000:sound", (e) => window.__sounds.push({ name: e.detail && e.detail.name, muted: !!(e.detail && e.detail.muted), t: performance.now() }));
  // every save of the game; window.__steps also says whether that step played or triggered a card (#47: a card step
  // is replayed for ~1.4 s by design, so the speed is read on the gaps after the steps without a card)
  window.__saves = []; window.__steps = []; let last = null, lastLen = null;
  setInterval(() => { try { const v = sessionStorage.getItem("p2000.solo.session"); if (v !== last) { const now = performance.now(); let log = []; try { log = JSON.parse(v).st.log; } catch { /* not a game */ }
    if (last !== null) { window.__saves.push(now); const add = lastLen === null ? [] : log.slice(lastLen); window.__steps.push({ t: now, card: add.some((e) => (e.t === "play" && e.card) || e.t === "trigger") }); }
    last = v; lastLen = log.length; } } catch { /* storage */ } }, 20);
})();`;
async function tab(br, w, h, mobile) {
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
  await send("Page.addScriptToEvaluateOnNewDocument", { source: SPY });
  const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); return r.result ? r.result.value : undefined; };
  const go = async (u, wait = 2200) => { await send("Page.navigate", { url: u }); await sleep(wait); };
  // A real tap at the centre of the first element matching sel (scrolled into view first). → its label or null.
  const tap = async (sel) => {
    const at = JSON.parse(await ev(`JSON.stringify((() => { const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.getClientRects().length && !e.disabled); if (!el) return null;
      el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, label: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 16) }; })())`));
    if (!at) return null;
    await sleep(120);
    for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: at.x, y: at.y, button: "left", clickCount: 1 });
    return at.label;
  };
  return { ev, go, tap, close: () => { try { ws.close(); } catch { /* closed */ } } };
}

// Saved games, made with the game's own code. Any tap on the table while the rivals are animating skips them (the
// page's rule), so the first tap that is allowed to start sound must be the human's own last move: `pre` is a
// decision where one visible button (`last`, e.g. 結束行動) ends the human's action and then the rivals take ≥ 3 steps;
// `queued` is the game right after it, the rivals about to move.
const botSteps = (s) => { let n = 0, x = s; while (S.botsToMove(x).length && n < 50) { x = S.stepBot(x); n++; } return n; };
const esc = (j) => j.replace(/"/g, "&quot;");
let pre = null, last = null;
for (const seed of [7, 11, 21, 33]) {
  let s = S.advance(S.newSolo({ seat: 0, level: 2, seed }));
  for (let n = 0; n < 60 && !pre; n++) {
    const ch = S.choices(s, "zh-Hant"); if (!ch.length) break;
    const html = S.screen(s, "zh-Hant");
    const c = ch.find((x) => html.includes('data-move="' + esc(JSON.stringify(x.move)) + '"') && botSteps(S.act(s, x.move)) >= 3);
    if (c) { pre = s; last = c; break; }
    s = S.advance(S.act(s, ch[0].move));
  }
  if (pre) break;
}
const queued = pre ? S.act(pre, last.move) : null;
const LAST = last ? `[data-move='${JSON.stringify(last.move)}']` : "none";
const first = S.advance(S.newSolo({ seat: 0, level: 2, seed: 3700 }));
let placing = null;
{ const cp = S.choices(first, "zh-Hant").find((c) => c.move.type === "play" && c.move.mode === "cp");
  if (cp) { const s1 = S.act(first, cp.move); const k = S.choices(s1, "zh-Hant").find((c) => c.move.type === "action" && c.move.kind === "campaign"); if (k) placing = S.act(s1, k.move); } }
const fillMove = placing && S.choices(placing, "zh-Hant").find((c) => c.move.type === "fill" && /免檢定/.test(c.label));
const crossMove = placing && S.choices(placing, "zh-Hant").find((c) => c.move.type === "cross" && /檢定/.test(c.label));

const out = [];
const rule = (ok, what) => out.push({ ok, what });
const sounds = async (t) => JSON.parse(await t.ev("JSON.stringify(window.__sounds || [])"));
const audio = async (t) => JSON.parse(await t.ev("JSON.stringify(window.__audio || null)"));
const count = (list, name) => list.filter((x) => x.name === name).length;
const load = async (t, s, extra = "") => {
  await t.go(base, 1200);
  await t.ev(`(()=>{ sessionStorage.setItem("p2000.solo.session", ${JSON.stringify(JSON.stringify(s))}); ${extra} return 1; })()`);
  await t.go(`${base}?play`, 150);
  // the table is up once the map is drawn (the rivals start right after)
  for (let i = 0; i < 100; i++) { try { if (await t.ev(`!!document.querySelector("[data-county]")`)) break; } catch { /* navigating */ } await sleep(50); }
  // a turn card (#44) shows on a saved game whose turn was not seen yet; wait until it has gone before tapping
  // (it may be drawn a moment after the map: count it gone only after 0.4 s in a row without it)
  for (let i = 0, clear = 0; i < 160 && clear < 8; i++) { let up = true; try { up = await t.ev(`(() => { const c = document.querySelector("[data-turncard]"); if (!c) return false; const r = c.getBoundingClientRect(); return r.width > 0 && Number(getComputedStyle(c).opacity) > 0.05; })()`); } catch { /* navigating */ } clear = up ? 0 : clear + 1; await sleep(50); }
};
const logOf = async (t) => JSON.parse((await t.ev(`JSON.stringify((JSON.parse(sessionStorage.getItem("p2000.solo.session") || "null") || { st: { log: [] } }).st.log)`)) || "[]");

const br = await launch();
try {
  for (const [w, h, mob] of [[390, 844, true], [1440, 900, false]]) {
    if (!queued || !placing || !fillMove || !crossMove) { rule(false, `instrument: saved games (rivals after a last move ${!!queued}, placing ${!!placing}, fill ${!!fillMove}, cross ${!!crossMove})`); break; }
    // 1. The rivals move before any tap: sounds are asked for, no AudioContext is made.
    let t = await tab(br, w, h, mob);
    await t.go(base, 1200); await t.ev(`localStorage.removeItem("p2000.sound"); localStorage.removeItem("p2000.speed"); 1`);
    await load(t, queued);
    await sleep(4000);
    const early = await sounds(t), preAudio = await audio(t);
    rule(early.length > 0 && preAudio && preAudio.made === 0, `${w}: before any tap the rivals' moves ask for ${early.length} sounds (${[...new Set(early.map((x) => x.name))].join(",") || "none"}) and ${preAudio ? preAudio.made : "?"} AudioContext is made`);
    t.close();
    // 2. A tap on a hand card: "tap", an AudioContext, a started node.
    t = await tab(br, w, h, mob);
    await load(t, first);
    const tapped = await t.tap(".tbl [data-sel]"); await sleep(500);
    const afterTap = await sounds(t), a2 = await audio(t);
    rule(!!tapped && count(afterTap, "tap") >= 1 && a2.made >= 1 && a2.started >= 1, `${w}: tapping the hand card 「${tapped}」 → tap sounds ${count(afterTap, "tap")}, AudioContext ${a2.made}, nodes started ${a2.started}`);
    t.close();
    // 3. The human's last move (the first tap), then the rivals: one "play" per card played, hit/miss for the checks.
    t = await tab(br, w, h, mob);
    await load(t, pre);
    const log0 = (await logOf(t)).length, s0 = (await sounds(t)).length;
    const okLast = await t.tap(LAST);
    await sleep(6000);
    const log1 = await logOf(t), got = (await sounds(t)).slice(s0), newLog = log1.slice(log0);
    const plays = newLog.filter((e) => e.t === "play").length, checks = newLog.filter((e) => e.t === "check").length;
    const hm = count(got, "hit") + count(got, "miss");
    rule(!!okLast && plays > 0 && count(got, "play") === plays && (checks === 0 ? hm === 0 : hm >= 1 && hm <= checks), `${w}: 「${last.label}」 (${okLast ? "tapped" : "no button"}), then the rivals — ${newLog.length} log entries, ${plays} cards played → ${count(got, "play")} play sounds; ${checks} checks → ${hm} hit/miss sounds`);
    t.close();
    // 4. Placing: a free fill → cube; a cross-camp fill → hit or miss as the log says.
    t = await tab(br, w, h, mob);
    await load(t, placing);
    await t.tap(`[data-county="${fillMove.move.county}"]`); await sleep(600); // the first tap: open the county
    const before = (await sounds(t)).length;
    const okFill = await t.tap(`[data-popover] [data-move='${JSON.stringify(fillMove.move)}']`); await sleep(900);
    const f = (await sounds(t)).slice(before);
    rule(!!okFill && count(f, "cube") >= 1, `${w}: 「${fillMove.label}」 → ${okFill ? count(f, "cube") + " cube sounds" : "no button to tap"}`);
    t.close();
    t = await tab(br, w, h, mob);
    await load(t, placing);
    await t.tap(`[data-county="${crossMove.move.county}"]`); await sleep(600);
    const before2 = (await sounds(t)).length, lg0 = (await logOf(t)).length;
    const okCross = await t.tap(`[data-popover] [data-move='${JSON.stringify(crossMove.move)}']`); await sleep(900);
    const c = (await sounds(t)).slice(before2), chk = (await logOf(t)).slice(lg0).find((e) => e.t === "check");
    const want = chk ? (chk.ok ? "hit" : "miss") : null;
    rule(!!okCross && !!want && count(c, want) >= 1 && count(c, want === "hit" ? "miss" : "hit") === 0, `${w}: 「${crossMove.label}」 → the check was ${chk ? (chk.ok ? "a hit" : "a miss") : "not found"}; sounds ${c.map((x) => x.name).join(",") || "none"}`);
    t.close();
    // 5. The menu: controls there and tappable, one speed pressed.
    t = await tab(br, w, h, mob);
    await load(t, first);
    await t.tap("[data-menu], [data-menu-top]"); await sleep(400);
    const menu = JSON.parse(await t.ev(`JSON.stringify((() => { const m = document.querySelector("#gmenu"); if (!m || m.hidden) return { open: false };
      const hit = (el) => { if (!el || !el.getClientRects().length) return false; const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2; const at = document.elementFromPoint(x, y); return !!at && (at === el || el.contains(at)); };
      const sp = [...m.querySelectorAll("[data-speed]")], snd = m.querySelector("[data-sound]"), vol = m.querySelector("input[type=range][data-volume]");
      return { open: true, speeds: sp.map((b) => b.getAttribute("data-speed")).join(","), pressed: sp.filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.getAttribute("data-speed")),
        tappable: [...sp, snd, vol].every(hit), sound: snd ? snd.getAttribute("role") + ":" + snd.getAttribute("aria-checked") : null, vol: vol ? vol.min + "-" + vol.max + ":" + vol.value : null }; })())`));
    rule(menu.open && menu.speeds === "slow,normal,fast,step" && menu.pressed.join() === "normal" && menu.tappable && menu.sound === "switch:true" && menu.vol === "0-100:70",
      `${w}: menu ${menu.open ? `speeds ${menu.speeds}, pressed ${menu.pressed.join() || "none"}, sound ${menu.sound}, volume ${menu.vol}, ${menu.tappable ? "all tappable" : "NOT all tappable"}` : "did not open"}`);
    t.close();
  }

  // 6. Sound off: muted requests, nothing started, kept after a reload. Volume kept. (390)
  if (queued) {
    const t = await tab(br, 390, 844, true);
    await load(t, first);
    await t.tap("[data-menu], [data-menu-top]"); await sleep(300);
    await t.tap("#gmenu [data-sound]"); await sleep(300);
    const st = JSON.parse(await t.ev(`JSON.stringify({ aria: (document.querySelector("#gmenu [data-sound]") || {}).getAttribute ? document.querySelector("#gmenu [data-sound]").getAttribute("aria-checked") : null, store: localStorage.getItem("p2000.sound") })`));
    await t.ev(`(() => { const v = document.querySelector("#gmenu input[data-volume]"); if (v) { v.value = "30"; v.dispatchEvent(new Event("input", { bubbles: true })); v.dispatchEvent(new Event("change", { bubbles: true })); } return 1; })()`);
    await load(t, pre);
    const a0 = await audio(t);
    await t.tap(LAST);
    await sleep(4000);
    const got = await sounds(t), a1 = await audio(t);
    const stored = JSON.parse(await t.ev(`localStorage.getItem("p2000.sound")`) || "null");
    await t.tap("[data-menu], [data-menu-top]"); await sleep(300);
    const aria2 = await t.ev(`(document.querySelector("#gmenu [data-sound]") || { getAttribute: () => null }).getAttribute("aria-checked")`);
    rule(st.aria === "false" && got.length > 0 && got.every((x) => x.muted) && a1.started === a0.started && stored && stored.on === false && aria2 === "false",
      `390: sound off — switch ${st.aria}, ${got.length} requests all muted ${got.every((x) => x.muted)}, nodes started while off ${a1.started - a0.started}, after reload stored ${JSON.stringify(stored)} and switch ${aria2}`);
    rule(!!stored && Math.abs(stored.vol - 0.3) < 0.011, `390: volume set to 30 → stored ${stored ? stored.vol : "nothing"}`);
    t.close();
  }

  // 7. Speed: the gap between the rivals' steps (each step saves the game once).
  const gaps = {};
  for (const sp of ["slow", "normal", "fast"]) {
    if (!queued) break;
    const t = await tab(br, 390, 844, true);
    await t.go(base, 1200); await t.ev(`localStorage.setItem("p2000.speed", ${JSON.stringify(sp)}); 1`);
    await load(t, queued);
    await sleep(sp === "slow" ? 6000 : 4000);
    const steps = JSON.parse(await t.ev("JSON.stringify(window.__steps || [])"));
    const d = steps.slice(1).map((x, i) => (steps[i].card ? null : x.t - steps[i].t)).filter((x) => x !== null && x > 60).sort((a, b) => a - b);
    gaps[sp] = d.length ? Math.round(d[Math.floor(d.length / 2)]) : null;
    t.close();
  }
  rule(gaps.slow >= 560 && gaps.normal >= 320 && gaps.normal <= 520 && gaps.fast !== null && gaps.fast <= 240, `rivals' step gap (median): slow ${gaps.slow} ms (≥ 560), normal ${gaps.normal} ms (320–520), fast ${gaps.fast} ms (≤ 240)`);

  // 8. Step by step: nothing moves until 下一步, then one step per tap.
  if (queued) {
    const t = await tab(br, 390, 844, true);
    await t.go(base, 1200); await t.ev(`localStorage.setItem("p2000.speed", "step"); 1`);
    await load(t, queued);
    const t0 = await t.ev("performance.now()"); // a save while the page settles in is not a rival's step
    await sleep(2500);
    const idle = JSON.parse(await t.ev("JSON.stringify(window.__saves || [])")).filter((x) => x > t0 + 300).length;
    const okNext = await t.tap("[data-botnext]"); await sleep(1000);
    const one = JSON.parse(await t.ev("JSON.stringify(window.__saves || [])")).filter((x) => x > t0 + 300).length;
    rule(idle === 0 && !!okNext && one === 1, `390 step by step: ${idle} rival steps in 2.5 s before 下一步, ${okNext ? "tapped 下一步" : "no [data-botnext] to tap"}, then ${one - idle} step`);
    t.close();
  }

  // 9. The room menu has the same controls (a room with bots, 390).
  {
    const t = await tab(br, 390, 844, true);
    await t.go(`${base}?host`, 1500);
    await t.ev(`(() => { const f = document.querySelector("form.rform"); if (!f) return 0; f.elements.name.value = "測試"; f.requestSubmit(); return 1; })()`);
    await sleep(2500);
    await t.tap("[data-menu], [data-menu-top]"); await sleep(400);
    const r = JSON.parse(await t.ev(`JSON.stringify((() => { const m = document.querySelector("#rmenu"); if (!m) return null; return { speeds: [...m.querySelectorAll("[data-speed]")].map((b) => b.getAttribute("data-speed")).join(","), sound: !!m.querySelector("[data-sound]"), vol: !!m.querySelector("input[type=range][data-volume]") }; })())`));
    rule(!!r && r.speeds === "slow,normal,fast,step" && r.sound && r.vol, `390 room: menu ${r ? `speeds ${r.speeds || "none"}, sound switch ${r.sound}, volume ${r.vol}` : "not found (#rmenu)"}`);
    t.close();
  }
} finally { br.close(); }
let bad = 0;
for (const x of out) { if (!x.ok) bad++; console.log(`${x.ok ? "✓" : "✗"} ${x.what}`); }
console.log(bad ? `FAIL: ${bad} of ${out.length}` : `PASS: ${out.length} checks`);
process.exit(bad ? 1 : 0);
