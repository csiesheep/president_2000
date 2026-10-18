// tools/novice87.mjs — the beginner level in real solo sessions and on the page (#87). Orchestrator's instrument: a peer
// may run it, does not edit it. About 6 min.
//
//   node tools/novice87.mjs <base url, e.g. http://localhost:8787>     (the server of this very tree)
//
// Owner, 2026-10-18: 「請打磨此遊戲，直到其具有商業價值」, 「先免費網頁上線」. Orchestrator's #87: the level 0 of #83 offered
// first, and the bots knowing where the person sits. Rows (they set the exit code):
//   - H: a novice (each decision 50 % what level 1 would play, 50 % a random choice; as tools/balance83.mjs) playing a
//     real solo session against level 0 (S.newSolo, S.stepBot, S.act) wins 25–55 % in each seat, 150 games per seat.
//     The bots get { humans: [the person's seat] } from the session: without it level 0 falls back to one table for all
//     seats and the 宋 seat wins far more (the orchestrator's probe: see the issue);
//   - P1: a first visit (no saved setup) to ?play shows four levels, data-level 0..3 with words, and 新手 (0) is the one
//     pressed; phone 390×844 and desk 1440×900, Chinese and English;
//   - P2: a pick is remembered: press 總幹事 (2), reload, it is the one pressed.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import * as S from "../public/solo.js";
import * as B from "../public/shared/bots.js";

const base = process.argv[2];
if (!base) { console.log("usage: node tools/novice87.mjs <base url>"); process.exit(2); }
const URL0 = base.replace(/\/+$/, "") + "/president_2000/";
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NAMES = ["陳", "宋", "連"];
const simRng = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const out = [];
const rule = (ok, what) => out.push({ ok, what });

// ---- H: real solo sessions
const key = (m) => JSON.stringify(m);
function session(seat, seed) {
  const r = simRng(seed * 7919 + 5), R = simRng(seed * 977 + 13);
  let s = S.newSolo({ seat, level: 0, seed });
  if (s.level !== 0) throw new Error(`S.newSolo({ level: 0 }) gave level ${s.level}`);
  for (let n = 0; n < 30000 && s.st.phase !== "end"; n++) {
    if (S.botsToMove(s).length) { s = S.stepBot(s); continue; }
    const ch = S.choices(s, "zh-Hant");
    if (!ch.length) { s = S.advance(s); continue; }
    let pick = null;
    if (ch.length > 1 && r() < 0.5) { const m = B.chooseMove(s.st, seat, 1, R).move; pick = ch.find((c) => key(c.move) === key(m)) || null; }
    if (!pick) pick = ch[Math.floor(r() * ch.length) % ch.length];
    s = S.act(s, pick.move);
  }
  if (s.st.phase !== "end") throw new Error(`seed ${seed}: did not end`);
  return s.st.result.winner === seat;
}
let hOk = true; const hs = [];
for (let seat = 0; seat < 3; seat++) {
  let wins = 0, n = 0, err = null;
  for (let seed = 1; seed <= 150; seed++) { try { if (session(seat, seed)) wins++; n++; } catch (e) { err = err || e.message.split("\n")[0]; } }
  const p = (100 * wins) / (n || 1); hs.push(`${NAMES[seat]} ${p.toFixed(1)}`);
  if (err || n !== 150 || p < 25 || p > 55) hOk = false;
  if (err) hs.push(`(error: ${err})`);
}
rule(hOk, `H the novice against level 0 in real solo sessions wins 25–55 % in each seat: ${hs.join(" / ")} (150 games per seat)`);

// ---- P1, P2: the page
async function launch() {
  const root = process.env.TEMP || "/tmp", dir = `${root}/novice87_${process.pid}_${Date.now()}`;
  for (const old of readdirSync(root).filter((d) => d.startsWith("novice87_"))) { try { if (Date.now() - statSync(`${root}/${old}`).mtimeMs > 600000) rmSync(`${root}/${old}`, { recursive: true, force: true }); } catch { /* in use */ } }
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
  const go = async (u) => { await send("Page.navigate", { url: u }); await sleep(2000); await ev("document.fonts.ready.then(()=>1)"); };
  return { ev, go, close: () => { try { ws.close(); } catch { /* closed */ } } };
}
const LEVELS = `JSON.stringify([...document.querySelectorAll("[data-level]")].filter((b) => b.getClientRects().length).map((b) => ({ v: b.getAttribute("data-level"), t: b.textContent.trim(), on: b.getAttribute("aria-pressed") === "true" })))`;
const br = await launch();
try {
  for (const [w, h, mob] of [[390, 844, true], [1440, 900, false]]) for (const lang of ["zh", "en"]) {
    const who = `${w} ${lang}`, t = await tab(br, w, h, mob), u = URL0 + "?play" + (lang === "en" ? "&lang=en" : "");
    await t.go(URL0); await t.ev(`(() => { localStorage.clear(); sessionStorage.clear(); return 1; })()`);
    await t.go(u);
    const a = JSON.parse((await t.ev(LEVELS)) || "[]");
    rule(a.map((x) => x.v).join(",") === "0,1,2,3" && a.every((x) => x.t) && a.filter((x) => x.on).map((x) => x.v).join() === "0", `${who} P1 a first visit offers four levels with words, 新手 pressed (${a.map((x) => `${x.v}${x.on ? "*" : ""}「${x.t}」`).join(" ") || "no level buttons"})`);
    await t.ev(`(() => { const b = document.querySelector('[data-level="2"]'); if (b) b.click(); return 1; })()`); await sleep(400);
    await t.go(u);
    const b = JSON.parse((await t.ev(LEVELS)) || "[]");
    rule(b.filter((x) => x.on).map((x) => x.v).join() === "2", `${who} P2 a pick is remembered: pressed 總幹事, reloaded, pressed now ${b.filter((x) => x.on).map((x) => x.v).join() || "none"}`);
    t.close();
  }
} finally { br.close(); }

let bad = 0;
for (const r of out) { if (!r.ok) bad++; console.log(`${r.ok ? "✓" : "✗"} ${r.what}`); }
console.log(bad ? `FAIL: ${bad} of ${out.length}` : `PASS: ${out.length} checks`);
process.exit(bad ? 1 : 0);
