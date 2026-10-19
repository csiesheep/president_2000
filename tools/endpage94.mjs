// tools/endpage94.mjs — the end page's record, next challenge, share and first screen (#94), in a browser. What the
// page says about the game itself is tests/endpage94.test.js (node). Orchestrator's instrument: a peer may run it, does
// not edit it. Needs Chrome and a server of this tree (a static one is enough: py -3 tools/serve.py <port> <tree>).
//
//   node tools/endpage94.mjs http://127.0.0.1:8787/public/
//
// Owner, 2026-10-18, to the wave-2 canvas (① 結局頁: 「你的戰績 4 局 2 勝・陳 2 宋 0 連 0 · 存在這台裝置」, 「下一個挑戰：
// 換宋楚瑜試試 / 挑戰助選員」, 「分享這張號外」; ② 落選: 「再來一局 / 同一位再戰一次 / 開軍師再試」): 「可以 開工」.
// Contract (orchestrator, #94), solo games on this device:
//   - [data-end-record data-games="<n>" data-wins="<w>" data-streak="<losses in a row>"]: a game counts once, the first
//     time its end page shows on this device (opening it again, or reloading, does not count it again); both numbers in
//     its text;
//   - [data-end-next]: buttons [data-next="…"] that start a new game at once (the saved session is a new game, turn 1,
//     another seed): when you won, "seat:<k>" (another candidate; one you have not won with yet when there is one) and
//     "level:<level + 1>" (absent at the hardest); when you lost, "again" (same candidate and level) and "advisor"
//     (the same with the advisor on; absent when it was on);
//   - [data-end-share]: navigator.share({ text, url }) with the winner's name and the three votes (zh N × 10 萬, en
//     blocks / 10 with one decimal) in text, and url the game's address without ?play;
//   - the first screen (390×844 zh and en, 1280×800): [data-end-paper], [data-end-head] and the three [data-result]
//     rows are on it; no sideways scroll; the buttons of [data-end-next] can be tapped once scrolled to.
// Reports 尚未實作 until the end page has [data-end-record].
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import * as S from "../public/solo.js";
import * as D from "../tests/driver.js";
import { SEATS } from "../public/shared/board.js";
import { bind } from "../public/table.js";

const base = process.argv[2];
if (!base) { console.log("usage: node tools/endpage94.mjs <base url>"); process.exit(2); }
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const X = { zh: bind("zh-Hant"), en: bind("en") };

// Finished games of 陳 against 新手 bots (level 0, so a harder level exists), the human at random: one won, one lost,
// each with the advisor off.
function games() {
  const out = {};
  for (let seed = 1; seed < 400 && !(out.won && out.lost); seed++) {
    let s = S.advance(S.newSolo({ seat: 0, level: 0, seed }));
    const R = D.rng(seed * 13 + 7);
    for (let n = 0; n < 900 && s.st.phase !== "end"; n++) { const ch = S.choices(s, "zh-Hant"); if (!ch.length) { s = S.advance(s); continue; } s = S.advance(S.act(s, ch[Math.floor(R() * ch.length)].move)); }
    if (s.st.phase !== "end") continue;
    const k = s.st.result.winner === 0 ? "won" : "lost";
    if (!out[k]) out[k] = { seed, s: { ...s, advisor: false } };
  }
  if (!out.won || !out.lost) throw new Error("no won and lost games in 400 seeds (instrument)");
  return out;
}

async function launch() {
  const root = process.env.TEMP || "/tmp", dir = `${root}/endpage94_${process.pid}_${Date.now()}`;
  for (const old of readdirSync(root).filter((d) => d.startsWith("endpage94_"))) { try { if (Date.now() - statSync(`${root}/${old}`).mtimeMs > 600000) rmSync(`${root}/${old}`, { recursive: true, force: true }); } catch { /* in use */ } }
  mkdirSync(dir, { recursive: true });
  const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--remote-debugging-port=0", `--user-data-dir=${dir}`, "about:blank"], { stdio: "ignore" });
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
  const go = async (url, wait = 2000) => { await send("Page.navigate", { url }); await sleep(wait); await ev("document.fonts.ready.then(()=>1)"); };
  const tapAt = async (x, y) => { for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 }); };
  const tap = async (sel) => {
    const c = await ev(`(()=>{ const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: "center" }); const r = e.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return r.width ? [r.left + r.width / 2, r.top + r.height / 2, !!top && (top === e || e.contains(top))] : null; })()`);
    if (!c) return null;
    await sleep(150);
    await tapAt(c[0], c[1]); return { hit: c[2] };
  };
  return { ev, go, tap, close: () => { try { ws.close(); } catch { /* closed */ } } };
}
const put = (sess) => `(()=>{ sessionStorage.setItem("p2000.solo.session", ${JSON.stringify(JSON.stringify(sess))}); return 1; })()`;
const READ = `(()=>{
  const q = (s) => document.querySelector(s), txt = (e) => (e ? e.textContent.replace(/\\s+/g, " ").trim() : "");
  const rec = q("[data-end-record]");
  let sess = null; try { sess = JSON.parse(sessionStorage.getItem("p2000.solo.session")); } catch { /* none */ }
  return {
    rec: rec ? { games: rec.getAttribute("data-games"), wins: rec.getAttribute("data-wins"), streak: rec.getAttribute("data-streak"), text: txt(rec) } : null,
    next: [...document.querySelectorAll("[data-end-next] [data-next]")].map((e) => e.getAttribute("data-next")),
    share: !!q("[data-end-share]"),
    sess: sess && sess.st ? { phase: sess.st.phase, turn: sess.st.turn, seed: sess.seed, seat: sess.seat, level: sess.level, advisor: !!sess.advisor } : null,
  };
})()`;
const FIRST = `(()=>{
  scrollTo(0, 0);
  const vh = innerHeight, vw = innerWidth;
  const on = (e) => { if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.top >= -0.5 && r.bottom <= vh + 0.5 && r.left >= -0.5 && r.right <= vw + 0.5; };
  return { paper: on(document.querySelector("[data-end-paper]")), head: on(document.querySelector("[data-end-head]")), rows: [...document.querySelectorAll("[data-result]")].filter(on).length, sw: document.scrollingElement.scrollWidth, vw };
})()`;

const rows = [];
const row = (name, fn) => { try { const r = fn(); rows.push(r === true ? { name, ok: true } : typeof r === "string" && r.startsWith("TODO:") ? { name, todo: r.slice(5).trim() } : r && r.pass ? { name, ok: true, msg: r.msg } : { name, ok: false, msg: String(r) }); } catch (e) { rows.push({ name, ok: false, msg: `instrument: ${e.message}` }); } };
const okm = (c, msg) => (c ? { pass: true, msg } : msg);

const G = games();
console.log(`won: seed ${G.won.seed} (${G.won.s.st.result.votes.join("/")}); lost: seed ${G.lost.seed} (${G.lost.s.st.result.votes.join("/")})`);
const br = await launch();
const M = {};
try {
  // the record: won game, again, reload, then the lost game
  const t = await tab(br, 390, 844, true);
  await t.go(base, 800);
  await t.ev(`(()=>{ localStorage.clear(); localStorage.setItem("p2000.sound", JSON.stringify({ on: false, vol: 0 })); return 1; })()`);
  await t.ev(put(G.won.s)); await t.go(`${base}?play`);
  M.r1 = await t.ev(READ);
  await t.go(`${base}?play`); M.r2 = await t.ev(READ);
  await t.ev(put(G.won.s)); await t.go(`${base}?play`); M.r3 = await t.ev(READ);
  await t.ev(put(G.lost.s)); await t.go(`${base}?play`); M.r4 = await t.ev(READ);
  // share, on the lost game's page
  await t.ev(`(()=>{ window.__shared = null; navigator.share = (d) => { window.__shared = d; return Promise.resolve(); }; return 1; })()`);
  M.shareTap = await t.tap("[data-end-share]"); await sleep(500);
  M.shared = await t.ev("window.__shared");
  M.home = await t.ev("location.origin + location.pathname");
  t.close();
  // the next challenge: each button from a fresh end page
  M.next = {};
  for (const [k, g] of [["won", G.won], ["lost", G.lost]]) {
    const t2 = await tab(br, 390, 844, true);
    await t2.go(base, 800); await t2.ev(put(g.s)); await t2.go(`${base}?play`);
    const r = await t2.ev(READ); t2.close();
    M.next[k] = { list: r.next, taps: {} };
    for (const n of r.next) {
      const t3 = await tab(br, 390, 844, true);
      await t3.go(base, 800); await t3.ev(put(g.s)); await t3.go(`${base}?play`);
      const hit = await t3.tap(`[data-end-next] [data-next="${n}"]`);
      let s = null; for (let i = 0; i < 30; i++) { await sleep(100); s = (await t3.ev(READ)).sess; if (s && s.phase !== "end") break; }
      M.next[k].taps[n] = { hit, sess: s };
      t3.close();
    }
  }
  // the first screen
  M.first = {};
  for (const [name, w, h, mob, lang] of [["手機 390×844 中文", 390, 844, true, "zh"], ["手機 390×844 英文", 390, 844, true, "en"], ["桌機 1280×800", 1280, 800, false, "zh"]]) {
    const t4 = await tab(br, w, h, mob);
    await t4.go(base, 800); await t4.ev(put(G.won.s)); await t4.go(`${base}?play${lang === "en" ? "&lang=en" : ""}`);
    M.first[name] = await t4.ev(FIRST); t4.close();
  }
} finally { br.close(); }

const ready = M.r1 && M.r1.rec;
const R0 = (name, fn) => row(name, () => (!ready ? "TODO: 結局頁還沒有 [data-end-record]" : fn()));
R0("戰績：每一局第一次出現結局頁時算一次；重新整理、再打開同一局不重算；輸了算連續落選", () => {
  const n = (r) => r && r.rec ? `${r.rec.games}/${r.rec.wins}/${r.rec.streak}` : "沒有";
  const want = ["1/1/0", "1/1/0", "1/1/0", "2/1/1"], have = [M.r1, M.r2, M.r3, M.r4].map(n);
  const bad = have.map((h, i) => (h !== want[i] ? `第 ${i + 1} 次（${["贏的局", "重新整理", "再打開同一局", "輸的局"][i]}）局/勝/連敗 ${h}，應是 ${want[i]}` : null)).filter(Boolean);
  for (const r of [M.r1, M.r4]) if (r.rec && !(r.rec.text.includes(r.rec.games) && r.rec.text.includes(r.rec.wins))) bad.push(`「${r.rec.text.slice(0, 50)}」沒有寫局數或勝場`);
  return okm(!bad.length, bad.join("；") || `局/勝/連敗：${have.join(" → ")}`);
});
R0("下一個挑戰：贏了是換一位候選人（還沒贏過的）與更高一級；輸了是同一位再戰與開軍師再試", () => {
  const w = M.next.won.list.slice().sort(), l = M.next.lost.list.slice().sort(), bad = [];
  if (JSON.stringify(w) !== JSON.stringify(["level:1", "seat:1"]) && JSON.stringify(w) !== JSON.stringify(["level:1", "seat:2"])) bad.push(`贏了（陳、新手）的按鈕 ${JSON.stringify(w)}，應是 level:1 和 seat:1 或 seat:2`);
  if (JSON.stringify(l) !== JSON.stringify(["advisor", "again"])) bad.push(`輸了（軍師關著）的按鈕 ${JSON.stringify(l)}，應是 again 和 advisor`);
  return okm(!bad.length, bad.join("；") || `贏：${w.join("、")}；輸：${l.join("、")}`);
});
R0("按下去就開一局新的：座位、難度、軍師照按鈕（第 1 回合、不同的種子）", () => {
  const bad = []; let n = 0;
  for (const [k, g] of [["won", G.won], ["lost", G.lost]]) for (const [b, r] of Object.entries(M.next[k].taps)) {
    n++;
    const s = r.sess, want = { seat: 0, level: 0, advisor: false };
    if (b.startsWith("seat:")) want.seat = Number(b.slice(5));
    if (b.startsWith("level:")) want.level = Number(b.slice(6));
    if (b === "advisor") want.advisor = true;
    if (!r.hit || !r.hit.hit) bad.push(`${b}：按鈕被蓋住或不在畫面上`);
    if (!s || s.phase === "end") { bad.push(`${b}：按了之後沒有新的一局（${s ? s.phase : "沒有存檔"}）`); continue; }
    if (s.turn !== 1 || s.seed === g.s.seed || s.seat !== want.seat || s.level !== want.level || s.advisor !== want.advisor) bad.push(`${b}：新局 ${JSON.stringify(s)}，應是 ${JSON.stringify(want)}、第 1 回合、別的種子`);
  }
  const z = n ? true : "沒有按鈕可以按"; if (z !== true) return z;
  return okm(!bad.length, bad.join("；") || `${n} 個按鈕都對`);
});
R0("分享：navigator.share 的文字有當選人與三家票數，網址是遊戲首頁", () => {
  if (!M.shareTap) return "沒有 [data-end-share]";
  const d = M.shared; if (!d) return "按了分享，navigator.share 沒有被叫到";
  const r = G.lost.s.st.result, x = X.zh, text = String(d.text || ""), bad = [];
  if (!text.includes(x.full(r.winner))) bad.push(`文字「${text.slice(0, 60)}」沒有 ${x.full(r.winner)}`);
  for (let p = 0; p < 3; p++) if (!text.includes(String(r.votes[p] * 10))) bad.push(`文字沒有 ${x.short(p)} 的 ${r.votes[p] * 10} 萬`);
  if (d.url !== M.home) bad.push(`網址 ${JSON.stringify(d.url)}，應是 ${M.home}`);
  return okm(!bad.length, bad.join("；") || `「${text.slice(0, 50)}…」${d.url}`);
});
R0("第一個畫面：報頭、標題、三列得票都在畫面上，不能左右捲", () => {
  const bad = [];
  for (const [name, f] of Object.entries(M.first)) {
    if (!f.paper) bad.push(`${name}：報頭不在第一個畫面`);
    if (!f.head) bad.push(`${name}：標題不在第一個畫面`);
    if (f.rows < 3) bad.push(`${name}：第一個畫面只有 ${f.rows} 列得票`);
    if (f.sw > f.vw + 1) bad.push(`${name}：可以左右捲（${f.sw} > ${f.vw}）`);
  }
  return okm(!bad.length, bad.join("；") || "三種畫面都對");
});

let bad = 0, pend = 0;
for (const r of rows) { if (r.todo) pend++; else if (!r.ok) bad++; console.log(`${r.todo ? "…" : r.ok ? "✓" : "✗"} ${r.name}${r.todo ? " — " + r.todo : r.msg ? " — " + r.msg : ""}`); }
console.log(`${bad ? "FAIL" : pend ? "TODO" : "PASS"}: ${rows.length - bad - pend} pass, ${bad} fail, ${pend} 尚未實作`);
process.exit(bad ? 1 : 0);
