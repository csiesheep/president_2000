// tools/tips96.mjs — the first-time boxes on the page (#96): on screen, the buttons tappable, 「知道了」 and 「不再提示」 kept
// on this device. Which box and what it says is tests/tips96.test.js (node). Orchestrator's instrument: a peer may run
// it, does not edit it. Needs Chrome and a server of this tree (static is enough: py -3 tools/serve.py <port> <tree>).
//
//   node tools/tips96.mjs http://127.0.0.1:8787/public/
//
// Contract (orchestrator, #96), solo:
//   - at a moment whose first tip is the one wanted (nothing seen yet on this device), phone 390×844 (zh, en), 360×740 and desk 1280×800:
//     [data-tip] is on screen with [data-tip-ok] and [data-tip-off] on top at their centres;
//   - [data-tip-ok]: that box goes within 1 s, and once no box is left the decision's buttons (#act) are on top at
//     their centres; after a reload the same moment does not show that tip again (the next one may come);
//   - [data-tip-off]: the box goes within 1 s, and later, at another tip's moment (another game), no box shows.
// Reports 尚未實作 until the page shows [data-tip].
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import * as E from "../public/shared/engine.js";
import * as S from "../public/solo.js";
import * as D from "../tests/driver.js";
import { EVENTS } from "../public/shared/cards.js";

const base = process.argv[2];
if (!base) { console.log("usage: node tools/tips96.mjs <base url>"); process.exit(2); }
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OWNER = Object.fromEntries(EVENTS.map((e) => [e.id, e.owner]));

// The moments of the contract (as tests/tips96.test.js reads them); a session where the wanted one comes first.
function held(s, ch) {
  const st = s.st, me = s.seat, out = [];
  const log = st.log, ti = log.map((e) => e.t).lastIndexOf("trigger"), tr = log[ti], fx = st.pending && st.pending.fx;
  if (tr && tr.seat === me && OWNER[tr.card] === ["chen", "soong", "lien"][me] && fx && fx.card === tr.card && !log.slice(ti + 1).some((e) => e.t === "play")) out.push("trigger");
  if (ch.some((c) => (c.move.type === "steal" || c.move.type === "remove") && c.move.target != null && c.move.target !== me)) out.push("steal");
  if (st.phase === "save" && ch.length > 1) out.push("save");
  if (st.phase === "debate" && ch.some((c) => c.move.type === "reveal")) out.push("debate");
  if (st.phase === "election" && ch.some((c) => c.move.type === "canvass")) out.push("canvass");
  if (st.phase === "election") out.push("strategic");
  if ((st.endorse || []).includes(me)) out.push("endorse");
  return out;
}
function moment(want, from) {
  for (let seed = from; seed < from + 60; seed++) {
    let s = S.advance(S.newSolo({ seat: 0, level: 2, seed }));
    const R = D.rng(seed);
    for (let n = 0; n < 600 && s.st.phase !== "end"; n++) {
      const ch = S.choices(s, "zh-Hant");
      if (!ch.length) { s = S.advance(s); continue; }
      const h = held(s, ch);
      if (h[0] === want) return { seed, s: { ...s, cardSeen: s.st.turn }, held: h };
      s = S.advance(S.act(s, ch[Math.floor(R() * ch.length)].move));
    }
  }
  return null;
}

async function launch() {
  const root = process.env.TEMP || "/tmp", dir = `${root}/tips96_${process.pid}_${Date.now()}`;
  for (const old of readdirSync(root).filter((d) => d.startsWith("tips96_"))) { try { if (Date.now() - statSync(`${root}/${old}`).mtimeMs > 600000) rmSync(`${root}/${old}`, { recursive: true, force: true }); } catch { /* in use */ } }
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
  const go = async (url, wait = 2500) => { await send("Page.navigate", { url }); await sleep(wait); await ev("document.fonts.ready.then(()=>1)"); };
  const tapAt = async (x, y) => { for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 }); };
  return { ev, go, tapAt, close: () => { try { ws.close(); } catch { /* closed */ } } };
}
const put = (sess, keepLocal) => `(()=>{ ${keepLocal ? "" : "localStorage.clear(); "}localStorage.setItem("p2000.sound", JSON.stringify({ on: false, vol: 0 })); sessionStorage.setItem("p2000.solo.session", ${JSON.stringify(JSON.stringify(sess))}); return 1; })()`;
const BOX = `(()=>{
  const vw = innerWidth, vh = innerHeight;
  const at = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2; const top = document.elementFromPoint(x, y); return { x, y, on: r.width > 0 && r.top >= -0.5 && r.bottom <= vh + 0.5 && r.left >= -0.5 && r.right <= vw + 0.5, hit: !!top && (top === e || e.contains(top)) }; };
  const box = document.querySelector("[data-tip]");
  return { id: box ? box.getAttribute("data-tip") : null, box: at(box), ok: at(document.querySelector("[data-tip] [data-tip-ok]")), off: at(document.querySelector("[data-tip] [data-tip-off]")),
    act: [...document.querySelectorAll("#act button")].filter((b) => b.getClientRects().length).map((b) => { b.scrollIntoView({ block: "nearest" }); return at(b); }) };
})()`;

const rows = [];
const row = (name, fn) => { try { const r = fn(); rows.push(r === true ? { name, ok: true } : typeof r === "string" && r.startsWith("TODO:") ? { name, todo: r.slice(5).trim() } : r && r.pass ? { name, ok: true, msg: r.msg } : { name, ok: false, msg: String(r) }); } catch (e) { rows.push({ name, ok: false, msg: `instrument: ${e.message}` }); } };
const okm = (c, msg) => (c ? { pass: true, msg } : msg);

const A = moment("steal", 1), B = moment("save", 61) || moment("debate", 61);
if (!A || !B) { console.log("FAIL: no session at a steal moment, or at a save or forum moment (instrument)"); process.exit(1); }
console.log(`moments: ${A.held.join(",")} (seed ${A.seed}, ${A.s.st.phase}), ${B.held.join(",")} (seed ${B.seed}, ${B.s.st.phase})`);
const br = await launch(), M = { views: {} };
try {
  for (const [name, w, h, mob, lang] of [["手機 390×844 中文", 390, 844, true, ""], ["手機 390×844 英文", 390, 844, true, "&lang=en"], ["手機 360×740 中文", 360, 740, true, ""], ["桌機 1280×800 中文", 1280, 800, false, ""]]) {
    const t = await tab(br, w, h, mob);
    await t.go(base, 800); await t.ev(put(A.s)); await t.go(`${base}?play${lang}`);
    M.views[name] = await t.ev(BOX); t.close();
  }
  // OK, then the decision, then a reload
  const t = await tab(br, 390, 844, true);
  await t.go(base, 800); await t.ev(put(A.s)); await t.go(`${base}?play`);
  const b0 = await t.ev(BOX); M.before = b0;
  if (b0.ok) {
    await t.tapAt(b0.ok.x, b0.ok.y); const t0 = Date.now(); let b; do { await sleep(100); b = await t.ev(BOX); } while (b.id === b0.id && Date.now() - t0 < 1500); M.afterOk = b; M.okMs = Date.now() - t0;
    // the rest of this moment's boxes, one OK each, then the decision
    for (let i = 0; i < 7 && b.id && b.ok; i++) { await t.tapAt(b.ok.x, b.ok.y); await sleep(400); b = await t.ev(BOX); }
    M.clear = b;
  }
  await t.ev(put(A.s, true)); await t.go(`${base}?play`); M.reload = await t.ev(BOX);
  // off, then another moment
  await t.ev(put(B.s)); await t.go(`${base}?play`);
  const b1 = await t.ev(BOX); M.beforeOff = b1;
  if (b1.off) { await t.tapAt(b1.off.x, b1.off.y); const t0 = Date.now(); let b; do { await sleep(100); b = await t.ev(BOX); } while (b.id && Date.now() - t0 < 1500); M.afterOff = b; M.offMs = Date.now() - t0; }
  await t.ev(put(A.s, true)); await t.go(`${base}?play`); M.later = await t.ev(BOX);
  t.close();
} finally { br.close(); }

const ready = Object.values(M.views).some((v) => v.id);
const R0 = (name, fn) => row(name, () => (!ready ? "頁面上沒有 [data-tip]：#96 已上線（4160c94），這是退步，不是尚未實作" : fn()));
R0("框在畫面上，「知道了」與「不再提示」都按得到（手機中英、360 寬、桌機）", () => {
  const bad = [];
  for (const [name, v] of Object.entries(M.views)) {
    if (!v.id) { bad.push(`${name}：沒有框`); continue; }
    if (!v.box.on) bad.push(`${name}：框不在畫面上`);
    for (const k of ["ok", "off"]) if (!v[k] || !v[k].on || !v[k].hit) bad.push(`${name}：[data-tip-${k}] ${v[k] ? "被蓋住或在畫面外" : "沒有"}`);
  }
  return okm(!bad.length, bad.join("；") || Object.keys(M.views).join("、"));
});
R0("按「知道了」：1 秒內收起，決定的按鈕按得到；重新整理後同一刻不再出現", () => {
  const bad = [];
  if (!M.afterOk || M.afterOk.id === M.before.id) bad.push(`按了之後 ${M.okMs} ms 框還在`);
  else if (!M.clear || M.clear.id) bad.push(`一直按「知道了」，框還在（${M.clear && M.clear.id}）`);
  else if (!M.clear.act.length || M.clear.act.some((a) => !a.hit)) bad.push(`收起後決定的按鈕 ${M.clear.act.length} 顆，${M.clear.act.filter((a) => !a.hit).length} 顆被蓋住`);
  if (M.reload && M.reload.id === M.before.id) bad.push(`重新整理後又出現 ${M.reload.id}`);
  return okm(!bad.length, bad.join("；") || `${M.before.id} ${M.okMs} ms 收起，${M.clear.act.length} 顆按鈕都按得到，重新整理後沒有 ${M.before.id}`);
});
R0("按「不再提示」：1 秒內收起，之後另一件事的時刻也不出框", () => {
  const bad = [];
  if (!M.beforeOff.id) bad.push("另一刻沒有出框，無從按「不再提示」");
  else if (!M.afterOff || M.afterOff.id) bad.push(`按了之後 ${M.offMs} ms 框還在`);
  if (M.later && M.later.id) bad.push(`之後又出現 ${M.later.id}`);
  return okm(!bad.length, bad.join("；") || `${M.offMs} ms 收起，之後沒有框`);
});

let bad = 0, pend = 0;
for (const r of rows) { if (r.todo) pend++; else if (!r.ok) bad++; console.log(`${r.todo ? "…" : r.ok ? "✓" : "✗"} ${r.name}${r.todo ? " — " + r.todo : r.msg ? " — " + r.msg : ""}`); }
console.log(`${bad ? "FAIL" : pend ? "TODO" : "PASS"}: ${rows.length - bad - pend} pass, ${bad} fail, ${pend} 尚未實作`);
process.exit(bad ? 1 : 0);
