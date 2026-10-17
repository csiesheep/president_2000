// tools/panel61.mjs — the phone candidate panels show the luck (#61). Orchestrator's file: a peer may run it, and does not
// edit it.
//
//   node tools/panel61.mjs <base url ending in /president_2000/>
//
// Owner, 2026-10-16: 「設計一下，手機也要顯示運氣」, then 「候選人 名字改到左邊 / 右邊：票數，動能，運氣」 and, of three designs
// (the canvas 「手機候選人板的運氣」, second row), 「乙」 with 「名字部分的深色漸層，也向右漸淡」. Contract, a new solo game at
// 390×844 (CDP device metrics, mobile), Chinese and English, the first screen where the human acts:
//   - three candidate panels ([data-seat]) in one row, each at most 64 px high (as #29);
//   - the name sits at the left, at the panel's foot: its box starts in the left 35 % of the panel and ends within 14 px
//     of the panel's bottom; it is not cut (its box inside the panel, no overflow);
//   - on the right, without a tap, top to bottom: the votes (「N0萬票」 / "N.NM votes"), the momentum (「動能」 /
//     "Momentum") and the luck (「運氣 N%」 / "Luck N%"), each drawn, each starting in the right 60 % of the panel, in
//     that order from top to bottom, inside the panel;
//   - the page does not scroll sideways.
// The desk layout is left as it is (tools/compact29.mjs keeps measuring it).
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";

const base = process.argv[2];
if (!base) { console.log("usage: node tools/panel61.mjs <base url ending in /president_2000/>"); process.exit(2); }
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Chrome picks a free port and writes it to DevToolsActivePort in its own profile folder, one per run (as compact29).
async function launch() {
  const root = process.env.TEMP || "/tmp", dir = `${root}/panel61_${process.pid}_${Date.now()}`;
  for (const old of readdirSync(root).filter((d) => d.startsWith("panel61_"))) { try { if (Date.now() - statSync(`${root}/${old}`).mtimeMs > 600000) rmSync(`${root}/${old}`, { recursive: true, force: true }); } catch { /* in use */ } }
  mkdirSync(dir, { recursive: true });
  const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "--remote-debugging-port=0", `--user-data-dir=${dir}`, "about:blank"], { stdio: "ignore" });
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
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile });
  const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); return r.result ? r.result.value : undefined; };
  await send("Page.navigate", { url }); await sleep(2200);
  await ev("document.fonts.ready.then(()=>1)");
  return { ev, close: () => { try { ws.close(); } catch { /* closed */ } } };
}
const START = `(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.offsetParent&&/開始選戰|Start/.test(x.textContent)); if(b){b.click();return 1;} return 0;})()`;
// Close a turn card or a replay if one is up.
const CLOSE = `(()=>{const b=document.querySelector('[data-turncard] button, [data-replay] button'); if(b){b.click();return 1;} return 0;})()`;

// Everything measured in the page in one go. NAMES / VOTES / MOM / LUCK are per language.
const MEASURE = (lang) => `(() => {
  const NAMES = ${JSON.stringify(lang === "en" ? ["Chen", "Soong", "Lien"] : ["陳水扁", "宋楚瑜", "連戰"])};
  const VOTES = ${lang === "en" ? "/^\\s*\\d+(\\.\\d)?\\s*M\\s*votes?\\s*$/i" : "/^\\s*\\d+\\s*0\\s*萬票\\s*$/"};
  const MOM = ${lang === "en" ? "/^\\s*Momentum/i" : "/^\\s*動能/"};
  const LUCK = ${lang === "en" ? "/^\\s*Luck\\s*\\d+\\s*%\\s*$/i" : "/^\\s*運氣\\s*\\d+\\s*%\\s*$/"};
  const drawn = (e) => { if (!e) return false; const r = e.getBoundingClientRect(), s = getComputedStyle(e); return e.getClientRects().length > 0 && r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0; };
  const R = (e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) }; };
  // The smallest drawn element inside p whose whole text matches rx.
  const smallest = (p, rx) => { let best = null; for (const e of p.querySelectorAll("*")) { if (!drawn(e) || !rx.test(e.textContent)) continue; if (!best || best.contains(e)) best = e; } return best; };
  const panels = [...document.querySelectorAll(".pl-card[data-seat]")].filter((e) => drawn(e));
  const seen = new Set(), out = [];
  for (const p of panels) {
    const seat = Number(p.dataset.seat); if (seen.has(seat)) continue; seen.add(seat);
    const P = R(p), name = smallest(p, new RegExp(NAMES[seat])), votes = smallest(p, VOTES), mom = smallest(p, MOM), luck = smallest(p, LUCK);
    const cut = (e) => !!e && (e.scrollWidth > e.clientWidth + 1 || R(e).r > P.r + 1 || R(e).x < P.x - 1);
    out.push({ seat, P, name: name && { ...R(name), t: name.textContent.trim(), cut: cut(name) }, votes: votes && R(votes), mom: mom && R(mom),
      luck: luck && { ...R(luck), t: luck.textContent.trim() } });
  }
  return JSON.stringify({ panels: out, sw: document.documentElement.scrollWidth, iw: innerWidth });
})()`;

const out = [];
const rule = (ok, what) => out.push({ ok, what });
const br = await launch();
try {
  for (const lang of ["zh", "en"]) {
    const t = await tab(br, `${base}?play${lang === "en" ? "&lang=en" : ""}`, 390, 844, true);
    if (!(await t.ev(START))) { rule(false, `${lang}: no start button found`); t.close(); continue; }
    await sleep(8000); await t.ev(CLOSE); await sleep(900);
    const m = JSON.parse(await t.ev(MEASURE(lang)));
    const ps = m.panels;
    rule(ps.length === 3 && ps.every((p) => p.P.h <= 64), `${lang}: three candidate panels, each ≤ 64 px high (${ps.map((p) => p.P.h).join("/")})`);
    for (const p of ps) {
      const who = `${lang} seat ${p.seat}`, w = p.P.w;
      const n = p.name;
      rule(!!n && n.x < p.P.x + 0.35 * w && n.b >= p.P.b - 14 && !n.cut, `${who}: the name at the left foot, not cut (${n ? `「${n.t}」 x ${n.x - p.P.x}/${w}, bottom ${p.P.b - n.b} px above the panel's, ${n.cut ? "CUT" : "whole"}` : "not found"})`);
      const parts = [["votes", p.votes], ["momentum", p.mom], ["luck", p.luck]];
      const missing = parts.filter(([, r]) => !r).map(([k]) => k);
      const right = parts.every(([, r]) => r && r.x >= p.P.x + 0.4 * w && r.r <= p.P.r + 1 && r.b <= p.P.b + 1);
      const order = !missing.length && p.votes.y < p.mom.y && p.mom.y < p.luck.y;
      rule(!missing.length && right && order, `${who}: on the right, top to bottom, votes · momentum · luck, without a tap (${missing.length ? `missing ${missing.join(", ")}` : `tops ${p.votes.y - p.P.y}/${p.mom.y - p.P.y}/${p.luck.y - p.P.y}, lefts ${p.votes.x - p.P.x}/${p.mom.x - p.P.x}/${p.luck.x - p.P.x} of ${w}; 「${p.luck.t}」`})`);
    }
    rule(m.sw <= m.iw, `${lang}: no sideways scroll (${m.sw} ≤ ${m.iw})`);
    t.close();
  }
} finally { br.close(); }
for (const o of out) console.log(`${o.ok ? "✓" : "✗"} ${o.what}`);
const bad = out.filter((o) => !o.ok).length;
console.log(bad ? `FAIL: ${bad} of ${out.length} checks` : `PASS: ${out.length} checks`);
process.exit(bad ? 1 : 0);
