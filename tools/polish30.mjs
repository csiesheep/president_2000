// tools/polish30.mjs — can every decision button be pressed, and does the top fit on a small phone? (#30)
// Orchestrator's instrument: a peer may run it, does not edit it. Needs Chrome and a running dev server.
//
//   node tools/polish30.mjs http://127.0.0.1:8787/president_2000/
//
// It builds, with the game's own code, a solo game (陳, level 2) stopped at a tall decision — an opponent
// played your card for CP and you may trigger it (the card is drawn in the decision) — puts it in the page's
// saved session and opens ?play, then measures:
//   desk 1440×900, zh and en: without scrolling, every button of the decision (#act button) is on screen
//     and on top at its centre (today the fanned hand covers "Don't trigger");
//   laptop 1280×800 and phone 390×844, zh and en: every decision button, scrolled to the middle of the
//     screen, is on top at its centre;
//   small phone 360×740, zh and en, a fresh solo game after the rivals moved: the first candidate panel starts
//     within 60 px of the top (the top row does not wrap), the pieces of the top row (back, the turn text,
//     the advisor switch, the menu button) do not overlap and stay inside the width, no text sticks out of a
//     candidate panel or an issue slot, and the page does not scroll sideways.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import * as S from "../public/solo.js";
import * as D from "../tests/driver.js";
import { EVENTS } from "../public/shared/cards.js";

const base = process.argv[2];
if (!base) { console.log("usage: node tools/polish30.mjs <base url ending in /president_2000/>"); process.exit(2); }
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KEY = "p2000.solo.session";

// A solo game stopped at a tall decision about the human's own card that a rival played for CP. Before v0.8 that was
// the question whether to trigger it; since v0.8 (#82, no question: it always happens) it is the event's own choice the
// human makes (where to place), with #92's note above it saying who played it.
const OWNER = Object.fromEntries(EVENTS.map((e) => [e.id, e.owner]));
function tallMine(st) {
  const log = st.log, ti = log.map((e) => e.t).lastIndexOf("trigger"), tr = log[ti], fx = st.pending && st.pending.fx;
  if (!tr || tr.seat !== 0 || OWNER[tr.card] !== "chen" || !fx || fx.card !== tr.card || log.slice(ti + 1).some((e) => e.t === "play")) return false;
  const pl = [...log.slice(0, ti)].reverse().find((e) => e.t === "play");
  return !!pl && pl.seat !== 0 && pl.card === tr.card;
}
function triggerSession() {
  for (let seed = 1; seed < 400; seed++) {
    let s = S.advance(S.newSolo({ seat: 0, level: 2, seed }));
    const R = D.rng(seed);
    for (let n = 0; n < 300 && s.st.phase !== "end"; n++) {
      const ch = S.choices(s, "zh-Hant");
      if (!ch.length) break;
      if (ch.some((c) => c.move && c.move.type === "trigger") || (ch.length > 1 && tallMine(s.st))) return { s, seed, n };
      s = S.advance(S.act(s, ch[Math.floor(R() * ch.length)].move));
    }
  }
  return null;
}

// Chrome picks a free port (--remote-debugging-port=0) and writes it to DevToolsActivePort in its own profile
// folder, one per run: fixed ports and folders collided when several agents ran tools at once (#43's checker).
// Folders this tool left more than 10 minutes ago are removed first.
async function launch() {
  const root = process.env.TEMP || "/tmp", dir = `${root}/polish30_${process.pid}_${Date.now()}`;
  for (const old of readdirSync(root).filter((d) => d.startsWith("polish30_"))) { try { if (Date.now() - statSync(`${root}/${old}`).mtimeMs > 600000) rmSync(`${root}/${old}`, { recursive: true, force: true }); } catch { /* in use */ } }
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
  await send("Page.enable"); // #96: the first-time boxes are a modal of the first game, measured by tools/tips96.mjs; off here unless set
  await send("Page.addScriptToEvaluateOnNewDocument", { source: 'try { if (!localStorage.getItem("p2000.tips")) localStorage.setItem("p2000.tips", JSON.stringify({ seen: [], off: true })); } catch (e) { /* no storage */ }' });
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile });
  const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); return r.result ? r.result.value : undefined; };
  const go = async (url, wait = 2200) => { await send("Page.navigate", { url }); await sleep(wait); await ev("document.fonts.ready.then(()=>1)"); };
  return { ev, go, close: () => { try { ws.close(); } catch { /* closed */ } } };
}

const BUTTONS = (scroll) => `(async()=>{
  const vis = (e) => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return e.getClientRects().length > 0 && r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  // The decision's buttons: in #act, or (since #66, design 甲) in the sheet [data-sheet] wherever the table puts it.
  const bs = [...document.querySelectorAll("#act button, [data-sheet] button")].filter((b, i, a) => a.indexOf(b) === i && vis(b) && !b.disabled);
  const out = [];
  for (const b of bs) {
    if (${scroll}) { b.scrollIntoView({ block: "center" }); await new Promise((r) => setTimeout(r, 120)); }
    const r = b.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    const inView = x >= 0 && y >= 0 && x <= innerWidth && y <= innerHeight;
    const t = inView ? document.elementFromPoint(x, y) : null;
    const top = !!t && (t === b || b.contains(t));
    out.push({ text: b.textContent.trim().replace(/\\s+/g, " ").slice(0, 24), inView, top, by: top || !t ? "" : (t.className && t.className.baseVal === undefined ? String(t.className) : t.tagName).slice(0, 30) });
  }
  return JSON.stringify(out);
})()`;
const SMALL = `(()=>{
  const vis = (e) => { if (!e) return false; const r = e.getBoundingClientRect(), s = getComputedStyle(e); return e.getClientRects().length > 0 && r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  const R = (e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top + scrollY, r: r.right, b: r.bottom + scrollY, w: r.width, h: r.height }; };
  const tbl = document.querySelector(".tbl") || document;
  const panels = [...tbl.querySelectorAll("[data-seat]")].filter(vis);
  const top = document.querySelector(".t-top");
  const parts = top ? [...top.children].filter(vis).map((e) => ({ n: (e.className || e.tagName).toString().slice(0, 16), ...R(e) })) : [];
  const stick = (box) => { const br = R(box); for (const el of box.querySelectorAll("*")) { if (!vis(el) || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue; const r = R(el); if (r.r > br.r + 1 || r.x < br.x - 1 || r.b > br.b + 1 || r.y < br.y - 1) return el.textContent.trim().slice(0, 20); } return null; };
  return JSON.stringify({ first: panels.length ? Math.min(...panels.map((p) => R(p).y)) : null, n: panels.length, parts,
    stickP: panels.map(stick).filter(Boolean), stickI: [...tbl.querySelectorAll("[data-issue]")].filter(vis).map(stick).filter(Boolean),
    sw: document.documentElement.scrollWidth, iw: innerWidth });
})()`;

const out = [];
const rule = (ok, what) => out.push({ ok, what });
const trig = triggerSession();
if (!trig) { console.log("FAIL: no solo game reached a decision about your card a rival played (instrument)"); process.exit(1); }
const br = await launch();
try {
  for (const [w, h, mob, scroll] of [[1440, 900, false, false], [1280, 800, false, true], [390, 844, true, true]]) {
    for (const lang of ["zh", "en"]) {
      const t = await tab(br, w, h, mob);
      await t.go(base, 800);
      await t.ev(`(()=>{ sessionStorage.setItem(${JSON.stringify(KEY)}, ${JSON.stringify(JSON.stringify(trig.s))}); return 1; })()`);
      await t.go(`${base}?play${lang === "en" ? "&lang=en" : ""}`);
      const bs = JSON.parse(await t.ev(BUTTONS(scroll)));
      const tag = `${w}×${h} ${lang}${scroll ? " (scrolled to each)" : " (no scrolling)"}`;
      if (!bs.length) rule(false, `${tag}: no decision buttons found (instrument: seed ${trig.seed})`);
      else rule(bs.every((b) => b.inView && b.top), `${tag}: decision buttons on top — ${bs.map((b) => `「${b.text}」${b.top ? "✓" : b.inView ? "covered by " + b.by : "off screen"}`).join("、")}`);
      t.close();
    }
  }
  for (const lang of ["zh", "en"]) {
    const t = await tab(br, 360, 740, true);
    await t.go(base, 600);
    await t.ev(`(()=>{ sessionStorage.removeItem(${JSON.stringify(KEY)}); return 1; })()`);
    await t.go(`${base}?play${lang === "en" ? "&lang=en" : ""}`);
    await t.ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.offsetParent&&/開始選戰|Start/.test(x.textContent)); b&&b.click(); return 1;})()`);
    await sleep(8000);
    const m = JSON.parse(await t.ev(SMALL)), tag = `360×740 ${lang}`;
    rule(m.n === 3 && m.first != null && m.first <= 60, `${tag}: first candidate panel starts at ${m.first == null ? "—" : Math.round(m.first)} px (≤ 60, the top row does not wrap)`);
    const P = m.parts; let clash = null;
    for (let a = 0; a < P.length && !clash; a++) for (let b = a + 1; b < P.length; b++) if (Math.min(P[a].r, P[b].r) - Math.max(P[a].x, P[b].x) > 0.5 && Math.min(P[a].b, P[b].b) - Math.max(P[a].y, P[b].y) > 0.5) { clash = `${P[a].n} / ${P[b].n}`; break; }
    rule(P.length >= 3 && !clash && P.every((p) => p.x >= -0.5 && p.r <= m.iw + 0.5), `${tag}: top row pieces apart and inside the width (${P.length} pieces${clash ? ", overlap " + clash : ""}${P.some((p) => p.r > m.iw + 0.5) ? ", one past the right edge" : ""})`);
    rule(!m.stickP.length && !m.stickI.length, `${tag}: nothing sticks out of a candidate panel or an issue slot${m.stickP.concat(m.stickI).length ? " (「" + m.stickP.concat(m.stickI)[0] + "」)" : ""}`);
    rule(m.sw <= m.iw, `${tag}: no sideways scroll (${m.sw} ≤ ${m.iw})`);
    t.close();
  }
} finally { br.close(); }

console.log(`(your card played by a rival: seed ${trig.seed}, after ${trig.n} human decisions)`);
let bad = 0;
for (const r of out) { if (!r.ok) bad++; console.log(`${r.ok ? "✓" : "✗"} ${r.what}`); }
console.log(bad ? `FAIL: ${bad} of ${out.length}` : `PASS: ${out.length} checks`);
process.exit(bad ? 1 : 0);
