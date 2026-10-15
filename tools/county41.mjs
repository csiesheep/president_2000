// tools/county41.mjs — does an opened county show its picture at the top, with every button still tappable? (#41)
// Orchestrator's instrument: a peer may run it, does not edit it. Needs Chrome and a running dev server.
//
//   node tools/county41.mjs http://127.0.0.1:8787/president_2000/
//
// Owner, 2026-10-15, approving the P1 designs (⑨ 縣市框插圖): the county box opens with that county's picture across its
// top (the 24 local-card pictures, art/local/<slug>.webp). In a solo game at 390 and 1440 wide, with the human about to
// place blocks (so the boxes carry buttons) and at the first decision, it opens 台北市, 高雄市, 金馬 and the county
// with the most options, and measures:
//   - the box has one <img data-county-pic="<slug>"> with that county's picture, loaded, across the box's top
//     (its left, right and top edges are the box's, ±2 px);
//   - every button in the box is tappable: the point at its centre hits the button itself (not the hand, not off
//     screen; today every box passes this, the picture must not push a button out).
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import * as S from "../public/solo.js";
import { COUNTIES } from "../public/shared/board.js";

const base = process.argv[2];
if (!base) { console.log("usage: node tools/county41.mjs <base url ending in /president_2000/>"); process.exit(2); }
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function launch(port) {
  const dir = `${process.env.TEMP || "/tmp"}/county41_${port}`;
  mkdirSync(dir, { recursive: true });
  const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, "about:blank"], { stdio: "ignore" });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break; } catch { /* starting */ } await sleep(200); }
  return { port, close: () => proc.kill() };
}
async function tab(br, url, w, h, mobile) {
  const t = await (await fetch(`http://127.0.0.1:${br.port}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pend = new Map(), dialogs = [];
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    if (m.method === "Page.javascriptDialogOpening") { dialogs.push(m.params.message); ws.send(JSON.stringify({ id: ++id, method: "Page.handleJavaScriptDialog", params: { accept: false } })); } };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id;
    const tm = setTimeout(() => { pend.delete(i); rej(new Error(`instrument: CDP ${method} got no reply in 20 s (${String(params.expression || params.url || "").replace(/\s+/g, " ").slice(0, 90)})`)); }, 20000);
    pend.set(i, (m) => { clearTimeout(tm); res(m.result || {}); }); ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile });
  const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); return r.result ? r.result.value : undefined; };
  const go = async (u) => { await send("Page.navigate", { url: u }); await sleep(2200); await ev("document.fonts.ready.then(()=>1)"); };
  await go(url);
  return { ev, go, close: () => { try { ws.close(); } catch { /* closed */ } } };
}

// Written here from the county names, not read from the page's own table.
const SLUG = { "台北市": "taipei-city", "台北縣": "taipei-county", "基隆市": "keelung", "桃園縣": "taoyuan", "新竹縣": "hsinchu-county", "新竹市": "hsinchu-city", "苗栗縣": "miaoli", "台中縣": "taichung-county", "台中市": "taichung-city", "彰化縣": "changhua", "南投縣": "nantou", "雲林縣": "yunlin", "嘉義縣": "chiayi-county", "嘉義市": "chiayi-city", "台南縣": "tainan-county", "台南市": "tainan-city", "高雄市": "kaohsiung-city", "高雄縣": "kaohsiung-county", "屏東縣": "pingtung", "宜蘭縣": "yilan", "花蓮縣": "hualien", "台東縣": "taitung", "澎湖縣": "penghu", "金馬": "kinma" };
const NAME = COUNTIES.map((c) => c[0]);

// Saved games: the first decision; the human (陳) about to place blocks (a card spent as CP on 競選).
const first = S.advance(S.newSolo({ seat: 0, level: 2, seed: 3700 }));
let placing = null;
{ const cp = S.choices(first, "zh-Hant").find((c) => c.move.type === "play" && c.move.mode === "cp");
  if (cp) { const s1 = S.act(first, cp.move); const k = S.choices(s1, "zh-Hant").find((c) => c.move.type === "action" && c.move.kind === "campaign"); if (k) placing = S.act(s1, k.move); } }
const busiest = placing ? (() => { const n = new Map(); for (const c of S.choices(placing, "zh-Hant")) if (c.move.county != null) n.set(c.move.county, (n.get(c.move.county) || 0) + 1); return [...n.entries()].sort((a, b) => b[1] - a[1])[0][0]; })() : 14;

const MEASURE = (k) => `JSON.stringify((() => {
  const pop = document.querySelector('[data-popover="${k}"]'); if (!pop) return { pop: false };
  const pr = pop.getBoundingClientRect(), imgs = [...pop.querySelectorAll("img[data-county-pic]")];
  const img = imgs[0], ir = img ? img.getBoundingClientRect() : null;
  const buttons = [...pop.querySelectorAll("button")].filter((b) => b.getClientRects().length);
  const blocked = buttons.filter((b) => { const r = b.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return true; const at = document.elementFromPoint(x, y); return !(at && (at === b || b.contains(at))); })
    .map((b) => (b.getAttribute("aria-label") || b.textContent).trim().slice(0, 14));
  return { pop: true, n: imgs.length, slug: img && img.getAttribute("data-county-pic"), src: img && img.getAttribute("src"), loaded: !!img && img.complete && img.naturalWidth > 0,
    edges: ir ? [ir.left - pr.left, pr.right - ir.right, ir.top - pr.top].map((v) => Math.round(v * 10) / 10) : null, h: ir ? Math.round(ir.height) : 0, buttons: buttons.length, blocked };
})())`;
const OPEN = (k) => `(() => { const el = document.querySelector('[data-county="${k}"]'); if (!el) return false; el.dispatchEvent(new MouseEvent("click", { bubbles: true })); return true; })()`;

const out = [];
const rule = (ok, what) => out.push({ ok, what });
const br = await launch(9496);
try {
  for (const [w, h, mob] of [[390, 844, true], [1440, 900, false]]) {
    for (const [what, s] of [["first decision", first], ["placing blocks", placing]]) {
      if (!s) { rule(false, `${w} ${what}: instrument — no saved game`); continue; }
      const t = await tab(br, base, w, h, mob);
      await t.ev(`(()=>{ sessionStorage.setItem("p2000.solo.session", ${JSON.stringify(JSON.stringify(s))}); return 1; })()`);
      await t.go(`${base}?play`); await sleep(600);
      const ks = [...new Set([0, 16, 23, busiest])];
      const bad = [], seen = [];
      let buttons = 0;
      for (const k of ks) {
        if (!(await t.ev(OPEN(k)))) { bad.push(`${NAME[k]}: no [data-county]`); continue; }
        await sleep(700);
        const m = JSON.parse(await t.ev(MEASURE(k)));
        const want = SLUG[NAME[k]];
        if (!m.pop) { bad.push(`${NAME[k]}: the box did not open`); continue; }
        buttons += m.buttons;
        if (m.n !== 1 || m.slug !== want || !new RegExp(`art/local/${want}\\.webp$`).test(m.src || "")) bad.push(`${NAME[k]}: picture ${m.n} × ${m.slug} ${m.src}, want ${want}`);
        else if (!m.loaded) bad.push(`${NAME[k]}: picture not loaded`);
        else if (m.edges.some((e) => Math.abs(e) > 2)) bad.push(`${NAME[k]}: picture not across the top (${m.edges.join("/")})`);
        if (m.blocked.length) bad.push(`${NAME[k]}: buttons not tappable 「${m.blocked.join("」「")}」`);
        seen.push(`${NAME[k]} ${m.h}px/${m.buttons} buttons`);
        await t.ev(`(() => { const x = document.querySelector('[data-popover] [data-pop-close]'); x && x.click(); return 1; })()`); await sleep(300);
      }
      rule(!bad.length && (what === "first decision" || buttons > 0), `${w} ${what}: ${seen.join(", ")}${what === "placing blocks" && !buttons ? " — no buttons in any box (instrument)" : ""}${bad.length ? " — " + bad.join("; ") : ""}`);
      t.close();
    }
  }
} finally { br.close(); }
let bad = 0;
for (const x of out) { if (!x.ok) bad++; console.log(`${x.ok ? "✓" : "✗"} ${x.what}`); }
console.log(bad ? `FAIL: ${bad} of ${out.length}` : `PASS: ${out.length} checks`);
process.exit(bad ? 1 : 0);
