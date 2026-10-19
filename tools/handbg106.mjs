// tools/handbg106.mjs — on a desktop the hand lies on the wooden table, with no dark band behind it (#106). Orchestrator's
// instrument: a peer may run it, does not edit it. Needs Chrome and a server of this tree (a static one is enough:
// `py -3 tools/serve.py <port> <this tree>`, base http://127.0.0.1:<port>/public/), about 20 seconds.
//
//   node tools/handbg106.mjs http://127.0.0.1:8787/public/
//
// The owner, 2026-10-19, with a screenshot of the desktop table: 「桌機上，手牌有個黑背景，請移除」. The band is the hand
// tray's own background (rgba(20, 12, 4, .74) and a light line along its top) at every width.
// Contract (orchestrator, #106): at desktop widths (1100×720, 1280×800, 1440×900) the hand tray ([.t-hand] of the
// table) has no background colour (alpha 0), no background image and no line along its top; the cards still show (at
// least four card tops on screen) and the two buttons above them (the hand count and 「規則」) keep their own dark pill
// so they stay readable. (Its phone row, "the dark band stays on a phone", is gone: the owner asked for it away there too,
// #107, measured by tools/handbg107.mjs.)
// #106 landed (0c8d153): the band at every desktop width is a failure now (it reported 尚未實作 before).
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import * as S from "../public/solo.js";

const base = (process.argv[2] || "").replace(/\/?$/, "/");
if (!process.argv[2]) { console.log("usage: node tools/handbg106.mjs <base url of the page, ending in />"); process.exit(2); }
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DESK = [[1100, 720], [1280, 800], [1440, 900]], PHONE = [390, 844];

async function launch() {
  const root = process.env.TEMP || "/tmp", dir = `${root}/handbg106_${process.pid}_${Date.now()}`;
  for (const old of readdirSync(root).filter((d) => d.startsWith("handbg106_"))) { try { if (Date.now() - statSync(`${root}/${old}`).mtimeMs > 600000) rmSync(`${root}/${old}`, { recursive: true, force: true }); } catch { /* in use */ } }
  mkdirSync(dir, { recursive: true });
  const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--remote-debugging-port=0", `--user-data-dir=${dir}`, "about:blank"], { stdio: "ignore" });
  let port = 0;
  for (let i = 0; i < 100 && !port; i++) { try { port = Number.parseInt(readFileSync(`${dir}/DevToolsActivePort`, "utf8"), 10) || 0; } catch { /* starting */ } if (!port) await sleep(100); }
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break; } catch { /* starting */ } await sleep(200); }
  return { port, close: () => proc.kill() };
}
async function tab(br, w, h) {
  const t = await (await fetch(`http://127.0.0.1:${br.port}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pend = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result || {}); pend.delete(m.id); } };
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; const tm = setTimeout(() => { pend.delete(i); res({ timeout: true }); }, 20000); pend.set(i, (r) => { clearTimeout(tm); res(r); }); ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Page.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", { source: 'try { localStorage.setItem("p2000.tips", JSON.stringify({ seen: [], off: true })); localStorage.setItem("p2000.sound", JSON.stringify({ on: false, vol: 0 })); } catch (e) { /* no storage */ }' });
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: w < 768 });
  const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.timeout) throw new Error(`the tab did not answer: ${expr.slice(0, 60)}`); return r.result ? r.result.value : undefined; };
  const go = async (u, wait = 2500) => { await send("Page.navigate", { url: u }); await sleep(wait); };
  return { ev, go, close: () => { try { ws.close(); } catch { /* closed */ } } };
}
// The human (陳) at the first decision of a game, with a full hand.
const game = S.advance(S.newSolo({ seat: 0, level: 1, seed: 7 }));
const OVERLAY = `[...document.querySelectorAll("[data-turncard], [data-handoff], [data-tip]")].some((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && Number(getComputedStyle(e).opacity) > 0.05; })`;
const READ = `JSON.stringify((() => {
  const alpha = (c) => { if (!c || c === "transparent") return 0; const m = c.match(/rgba?\\(([^)]*)\\)/); if (!m) return 1; const p = m[1].split(",").map((x) => x.trim()); return p.length > 3 ? Number(p[3]) : 1; };
  const h = document.querySelector(".tbl .t-hand"); if (!h) return null;
  const cs = getComputedStyle(h), hs = h.querySelector(".hs"), hss = hs ? getComputedStyle(hs) : null;
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.top < innerHeight && r.bottom > 0; };
  const pill = (e) => e ? { text: e.textContent.trim().slice(0, 12), alpha: alpha(getComputedStyle(e).backgroundColor) } : null;
  return {
    bg: alpha(cs.backgroundColor), bgColor: cs.backgroundColor, img: cs.backgroundImage, line: parseFloat(cs.borderTopWidth) > 0 && alpha(cs.borderTopColor) > 0 ? cs.borderTopWidth + " " + cs.borderTopColor : null,
    hsBg: hss ? alpha(hss.backgroundColor) : 0, hsImg: hss ? hss.backgroundImage : "none",
    cards: [...h.querySelectorAll(".hc")].filter(vis).length,
    count: pill(h.querySelector(".hh .hh-t")), rules: pill(h.querySelector(".hh a")),
  };
})())`;

const M = {};
const br = await launch();
try {
  for (const [w, hgt] of DESK) {
    const t = await tab(br, w, hgt);
    await t.go(base, 1200);
    await t.ev(`(()=>{ sessionStorage.setItem("p2000.solo.session", ${JSON.stringify(JSON.stringify(game))}); return 1; })()`);
    await t.go(`${base}?play`, 300);
    for (let i = 0, clear = 0; i < 200 && clear < 8; i++) { let up = true; try { up = (await t.ev(OVERLAY)) || !(await t.ev(`!!document.querySelector(".tbl .t-hand .hc")`)); } catch { /* navigating */ } clear = up ? 0 : clear + 1; await sleep(50); }
    M[`${w}x${hgt}`] = JSON.parse((await t.ev(READ)) || "null");
    t.close();
  }
} catch (e) { M.err = e.message; } finally { br.close(); }

const rows = [];
const row = (name, fn) => { try { const r = fn(); rows.push(r === true ? { name, ok: true } : typeof r === "string" && r.startsWith("TODO:") ? { name, todo: r.slice(5).trim() } : r && r.pass ? { name, ok: true, msg: r.msg } : { name, ok: false, msg: String(r) }); } catch (e) { rows.push({ name, ok: false, msg: `instrument: ${e.message}` }); } };
const okm = (c, msg) => (c ? { pass: true, msg } : msg);
const desk = () => DESK.map(([w, h]) => [`${w}x${h}`, M[`${w}x${h}`]]);
const banded = (x) => x.bg > 0 || (x.img && x.img !== "none") || !!x.line || x.hsBg > 0 || (x.hsImg && x.hsImg !== "none");
row("桌機（1100×720、1280×800、1440×900）：手牌那一條沒有底色、沒有底圖、上緣沒有線", () => {
  if (M.err) return `儀器中途停下：${M.err}`;
  const d = desk(); if (d.some(([, x]) => !x)) return `有一種寬度沒有牌桌的手牌（${d.filter(([, x]) => !x).map(([k]) => k).join("、")}）（instrument）`;
  // as on main: the band's colour is still there at every width (a band gone but its top line kept is a failure)
  if (d.every(([, x]) => x.bg > 0)) return `#106 上線之後是失敗：三種寬度都還有黑色底（${d[0][1].bgColor}${d[0][1].line ? "，上緣 " + d[0][1].line : ""}）`;
  const bad = d.filter(([, x]) => banded(x)).map(([k, x]) => `${k}：底色 ${x.bgColor}${x.img !== "none" ? "、底圖 " + x.img.slice(0, 30) : ""}${x.line ? "、上緣 " + x.line : ""}${x.hsBg ? "、牌列底色" : ""}`);
  return okm(!bad.length, bad.join("；") || "三種寬度都沒有");
});
row("桌機：牌照舊在畫面上（至少 4 張的上緣），「手牌 N」與「規則」兩顆照舊有自己的深色底", () => {
  if (M.err) return `儀器中途停下：${M.err}`;
  const bad = [];
  for (const [k, x] of desk()) {
    if (!x) { bad.push(`${k} 沒量到`); continue; }
    if (x.cards < 4) bad.push(`${k} 只有 ${x.cards} 張牌在畫面上`);
    for (const p of [x.count, x.rules]) if (!p) bad.push(`${k} 少了一顆按鈕`); else if (p.alpha < 0.6) bad.push(`${k}「${p.text}」的底不夠深（${p.alpha}）`);
  }
  return okm(!bad.length, bad.join("；") || desk().map(([k, x]) => `${k} ${x.cards} 張`).join("、"));
});

let bad = 0, pend = 0;
for (const r of rows) { if (r.todo) pend++; else if (!r.ok) bad++; console.log(`${r.todo ? "…" : r.ok ? "✓" : "✗"} ${r.name}${r.todo ? " — " + r.todo : r.msg ? " — " + r.msg : ""}`); }
console.log(`${bad ? "FAIL" : pend ? "TODO" : "PASS"}: ${rows.length - bad - pend} pass, ${bad} fail, ${pend} 尚未實作`);
process.exit(bad ? 1 : 0);
