// tools/compact29.mjs — is the top of the table short, and do the new pieces fit, in a real browser? (#29)
// Orchestrator's instrument: a peer may run it, does not edit it. Needs Chrome and a running dev server.
//
//   node tools/compact29.mjs http://127.0.0.1:8787/president_2000/
//
// Owner, 2026-10-15: "精簡一下上方的空間；候選人跟議題的圖片放大，可以當成其按鈕的靠左背景圖片；
// 地圖上，讓各個顏色方塊一樣大". It starts a solo game (and the tutorial), lets the rivals move, and measures:
//   phone 390×844, zh and en
//     - the first candidate panel ([data-seat] in the table) starts within 60 px of the top, and the
//       "just now" panel ([data-now]) within 220 px (today: 121 and about 330);
//     - the three candidate panels sit in one row, each at most 64 px high, with an <img> on the left
//       (its left edge at the panel's, at least 35% of its width, at least 90% of its height);
//     - the three issue slots ([data-issue]) sit in one row, each at most 56 px high, the picture round;
//     - the advisor switch ([data-advisor]) and a menu button ([data-menu], aria-expanded) are on screen
//       in that top band; quitting (#quit) and the language link (#glang) are hidden until the menu
//       opens, then on screen and on top where they are drawn; Escape closes the menu;
//     - on the map a candidate's cube is at least 6 px and all cubes one size (±1.5); each candidate's
//       picture ([data-pawn] image) at least 20 px wide, and a tap on it reaches its county (#31);
//     - nothing in a candidate panel sticks out of it, and the page does not scroll sideways;
//   desk 1440×900, zh
//     - the candidate panels start within 80 px of the top (today 131), the candidate pictures on the map
//       are at least 20 px, quitting and the language link can be reached (on screen, or one menu away);
//   the tutorial at 390: its box ([data-tutorial]) is on screen and inside the width.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";

const base = process.argv[2];
if (!base) { console.log("usage: node tools/compact29.mjs <base url ending in /president_2000/>"); process.exit(2); }
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch(port) {
  const dir = `${process.env.TEMP || "/tmp"}/compact29_${port}`;
  mkdirSync(dir, { recursive: true });
  const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, "about:blank"], { stdio: "ignore" });
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
  const key = async (k, code) => { await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: 27 }); await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: 27 }); };
  await send("Page.navigate", { url }); await sleep(2200);
  await ev("document.fonts.ready.then(()=>1)");
  return { ev, key, close: () => { try { ws.close(); } catch { /* closed */ } } };
}
const START = `(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.offsetParent&&/開始選戰|Start/.test(x.textContent)); if(b){b.click();return 1;} return 0;})()`;

// Everything measured in the page in one go; returns plain numbers and short notes.
const MEASURE = `(()=>{
  const R = (e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top + scrollY, w: r.width, h: r.height, r: r.right, b: r.bottom + scrollY }; };
  // Seen = drawn: a box with size, not hidden or transparent. Not the hidden attribute: CSS can show an element
  // that still carries it (checker, #29), and an element under a display:none parent has no box anyway.
  const vis = (e) => { if (!e) return false; const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return e.getClientRects().length > 0 && r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0; };
  const onTop = (e) => { if (!vis(e)) return false; const r = e.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!t && (t === e || e.contains(t)); };
  const tbl = document.querySelector(".tbl") || document;
  const seats = [...tbl.querySelectorAll("[data-seat]")].filter(vis);
  const panels = seats.map((p) => { const im = p.querySelector("img"); const pr = R(p); const ir = im && vis(im) ? R(im) : null;
    let stick = null;
    for (const el of p.querySelectorAll("*")) { if (!vis(el) || !el.childNodes.length || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue; const r = R(el); if (r.r > pr.r + 1 || r.x < pr.x - 1 || r.b > pr.b + 1) { stick = el.textContent.trim().slice(0, 20); break; } }
    return { seat: p.dataset.seat, ...pr, img: ir, stick }; });
  const issues = [...tbl.querySelectorAll("[data-issue]")].filter(vis).map((s) => { const im = s.querySelector("img"); let round = false;
    for (let e = im; e && e !== s.parentElement; e = e.parentElement) { const cs = getComputedStyle(e), rr = e.getBoundingClientRect(); const rad = parseFloat(cs.borderTopLeftRadius) || 0; if (cs.borderTopLeftRadius.endsWith("%") ? parseFloat(cs.borderTopLeftRadius) >= 50 : rad >= Math.min(rr.width, rr.height) / 2 - 1) { round = rr.width > 0 && Math.abs(rr.width - rr.height) <= 2; if (round) break; } }
    return { ...R(s), round }; });
  const now = document.querySelector("[data-now]");
  const cubes = [...document.querySelectorAll(".tw [data-slot]")].filter((e) => ["chen", "soong", "lien"].includes(e.dataset.slot)).map((e) => e.getBoundingClientRect().width);
  const picEls = [...document.querySelectorAll(".tw-box [data-pawn-pic], .tw [data-pawn] image")];
  const pics = picEls.map((e) => e.getBoundingClientRect().width);
  // A tap on a candidate's picture lands on its county (the picture must not swallow it, #31): the element at the
  // picture's centre belongs to the data-county of the county the candidate stands in.
  const taps = picEls.map((e) => { e.scrollIntoView({ block: "center" }); const r = e.getBoundingClientRect(), t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const want = e.getAttribute("data-of") || (e.closest("[data-pawn]") || {}).getAttribute?.("data-of"), c = t && t.closest && t.closest("[data-county]");
    return { ok: !!c && c.getAttribute("data-county") === want, hit: t ? (t.getAttribute("data-pawn-pic") ? "the picture" : t.localName) : "nothing" }; });
  scrollTo(0, 0);
  const adv = document.querySelector("[data-advisor]"), menu = document.querySelector("[data-menu]");
  return JSON.stringify({ panels, issues, now: now && vis(now) ? R(now).y : null, cubes: cubes.length ? [Math.min(...cubes), Math.max(...cubes)] : null, pics,
    taps, adv: adv && vis(adv) ? R(adv) : null, menu: menu && vis(menu) ? { ...R(menu), exp: menu.getAttribute("aria-expanded") } : null,
    quitVis: vis(document.getElementById("quit")), langVis: vis(document.getElementById("glang")), quitTop: onTop(document.getElementById("quit")), langTop: onTop(document.getElementById("glang")),
    sw: document.documentElement.scrollWidth, iw: innerWidth });
})()`;

const out = [];
const rule = (ok, what) => out.push({ ok, what });
const br = await launch(9490);
try {
  for (const lang of ["zh", "en"]) {
    const t = await tab(br, `${base}?play${lang === "en" ? "&lang=en" : ""}`, 390, 844, true);
    if (!(await t.ev(START))) rule(false, `phone ${lang}: no start button found`);
    await sleep(8000);
    const m = JSON.parse(await t.ev(MEASURE));
    const P = m.panels, I = m.issues, tag = `phone ${lang}`;
    if (P.length !== 3) rule(false, `${tag}: ${P.length} candidate panels on screen, not 3`);
    else {
      const top = Math.min(...P.map((p) => p.y));
      rule(top <= 60, `${tag}: first candidate panel starts at ${Math.round(top)} px (≤ 60)`);
      rule(Math.max(...P.map((p) => p.y)) - top <= 1, `${tag}: candidate panels in one row (tops ${P.map((p) => Math.round(p.y)).join(", ")})`);
      rule(P.every((p) => p.h <= 64), `${tag}: candidate panels ${P.map((p) => Math.round(p.h)).join("/")} px high (≤ 64)`);
      rule(P.every((p) => p.img && Math.abs(p.img.x - p.x) <= 2 && p.img.w >= 0.35 * p.w && p.img.h >= 0.9 * p.h), `${tag}: picture on the left of each panel (${P.map((p) => (p.img ? `${Math.round(p.img.x - p.x)}/${Math.round((100 * p.img.w) / p.w)}%w/${Math.round((100 * p.img.h) / p.h)}%h` : "none")).join(", ")})`);
      rule(P.every((p) => !p.stick), `${tag}: nothing sticks out of a candidate panel${P.some((p) => p.stick) ? " (「" + P.find((p) => p.stick).stick + "」)" : ""}`);
    }
    rule(m.now != null && m.now <= 220, `${tag}: "just now" starts at ${m.now == null ? "—" : Math.round(m.now)} px (≤ 220)`);
    if (I.length !== 3) rule(false, `${tag}: ${I.length} issue slots on screen, not 3`);
    else {
      rule(Math.max(...I.map((s) => s.y)) - Math.min(...I.map((s) => s.y)) <= 1 && I.every((s) => s.h <= 56), `${tag}: issue slots in one row, ${I.map((s) => Math.round(s.h)).join("/")} px high (≤ 56)`);
      rule(I.every((s) => s.round), `${tag}: issue pictures round (${I.map((s) => s.round).join(", ")})`);
    }
    rule(!!m.adv && m.adv.b <= 64, `${tag}: advisor switch on screen in the top band (${m.adv ? "bottom " + Math.round(m.adv.b) : "missing"})`);
    rule(!!m.menu && m.menu.b <= 64 && m.menu.exp === "false", `${tag}: menu button in the top band, closed (${m.menu ? "bottom " + Math.round(m.menu.b) + ", aria-expanded=" + m.menu.exp : "missing"})`);
    rule(!m.quitVis && !m.langVis, `${tag}: quit and language hidden before the menu opens (quit ${m.quitVis}, lang ${m.langVis})`);
    if (m.menu) {
      await t.ev(`document.querySelector("[data-menu]").click()`); await sleep(400);
      const o = JSON.parse(await t.ev(MEASURE));
      rule(o.menu && o.menu.exp === "true" && o.quitTop && o.langTop, `${tag}: menu open → quit and language on screen and on top (expanded ${o.menu && o.menu.exp}, quit ${o.quitTop}, lang ${o.langTop})`);
      await t.key("Escape", "Escape"); await sleep(300);
      const c = JSON.parse(await t.ev(MEASURE));
      rule(c.menu && c.menu.exp === "false" && !c.quitVis, `${tag}: Escape closes the menu (expanded ${c.menu && c.menu.exp}, quit visible ${c.quitVis})`);
    }
    rule(!!m.cubes && m.cubes[0] >= 6 && m.cubes[1] - m.cubes[0] <= 1.5, `${tag}: map cubes ${m.cubes ? m.cubes.map((n) => n.toFixed(1)).join("…") : "none"} px (≥ 6, one size)`);
    rule(m.pics.length === 3 && m.pics.every((w) => w >= 20), `${tag}: candidate pictures on the map ${m.pics.map((w) => w.toFixed(1)).join("/") || "none"} px (3, ≥ 20)`);
    rule(m.taps.length === 3 && m.taps.every((x) => x.ok), `${tag}: a tap on a candidate's picture reaches its county (${m.taps.map((x) => (x.ok ? "✓" : "hits " + x.hit)).join(", ") || "none"})`);
    rule(m.sw <= m.iw, `${tag}: no sideways scroll (${m.sw} ≤ ${m.iw})`);
    t.close();
  }
  {
    const t = await tab(br, `${base}?play`, 1440, 900, false);
    await t.ev(START); await sleep(8000);
    const m = JSON.parse(await t.ev(MEASURE));
    const top = m.panels.length ? Math.min(...m.panels.map((p) => p.y)) : null;
    rule(top != null && top <= 80, `desk: candidate panels start at ${top == null ? "—" : Math.round(top)} px (≤ 80)`);
    rule(m.pics.length === 3 && m.pics.every((w) => w >= 20), `desk: candidate pictures on the map ${m.pics.map((w) => w.toFixed(1)).join("/") || "none"} px (3, ≥ 20)`);
    rule(m.taps.length === 3 && m.taps.every((x) => x.ok), `desk: a tap on a candidate's picture reaches its county (${m.taps.map((x) => (x.ok ? "✓" : "hits " + x.hit)).join(", ") || "none"})`);
    let reach = m.quitTop && m.langTop;
    if (!reach && m.menu) { await t.ev(`document.querySelector("[data-menu]").click()`); await sleep(400); const o = JSON.parse(await t.ev(MEASURE)); reach = o.quitTop && o.langTop; }
    rule(!!reach, `desk: quit and language reachable (on screen, or one menu away)`);
    rule(m.sw <= m.iw, `desk: no sideways scroll (${m.sw} ≤ ${m.iw})`);
    t.close();
  }
  {
    const t = await tab(br, `${base}?tutorial`, 390, 844, true);
    await sleep(600);
    const b = JSON.parse(await t.ev(`(()=>{const e=document.querySelector("[data-tutorial]"); if(!e) return "null"; const r=e.getBoundingClientRect(); return JSON.stringify({x:r.left,r:r.right,w:r.width,h:r.height,iw:innerWidth});})()`));
    rule(!!b && b.w > 0 && b.x >= 0 && b.r <= b.iw + 1, `tutorial 390: box on screen and inside the width (${b ? Math.round(b.x) + "…" + Math.round(b.r) + " of " + b.iw : "missing"})`);
    t.close();
  }
} finally { br.close(); }

let bad = 0;
for (const r of out) { if (!r.ok) bad++; console.log(`${r.ok ? "✓" : "✗"} ${r.what}`); }
console.log(bad ? `FAIL: ${bad} of ${out.length}` : `PASS: ${out.length} checks`);
process.exit(bad ? 1 : 0);
