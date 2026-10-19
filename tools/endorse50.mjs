// tools/endorse50.mjs — who holds each region's endorsement, shown on the map (#50).
// Orchestrator's instrument: a peer may run it, does not edit it. Needs Chrome and a running dev server.
//
//   node tools/endorse50.mjs http://127.0.0.1:8787/president_2000/
//
// Owner, 2026-10-15: 「設計一下 背書，如何在地圖上顯示」; of the three designs, 「背書 B版」 — every county paper of an
// endorsed region carries a small 「背」 stamp in the holder's colour, a key says 「章的顏色 = 該區背書持有者」, and a
// county's popover says who endorses its region and what that gives on election day. Election day (engine,
// finishElection): in every county of the region, half its empty grey (無色) blocks, rounded down, go to the holder.
// Contract (orchestrator, #50):
//   - inside the map's g[data-county="<k>"] of every county whose region has a holder, exactly one
//     [data-endorse-stamp="<seat 0|1|2>"]; none in the other counties. It wraps the whole stamp; its colour (the
//     element's own fill when it is a shape, else its first circle / rect / path's) is the fill of that seat's vote
//     blocks on the map (rect[data-slot="chen|soong|lien"]);
//   - the stamp covers nothing of the county's own (its name, its blocks, a candidate standing on it) nor any other
//     county's paper or candidate, stays inside the map, and is at least 10 px across;
//   - a key [data-endorse-legend] on the map while any region has a holder, none while no region has one;
//   - the popover [data-popover="<k>"] of a county in an endorsed region holds [data-endorse-note] with
//     data-here = what this county gives the holder on election day and data-region = what the whole region gives,
//     its text naming the holder (short name) and the region; a county of a region without a holder has no note;
//   - the county's aria-label says the endorsement too (「背書」 and the holder's short name).
// Measured on a solo game (陳, seed 7) with 北北基 連, 中彰投 宋, 雲嘉南 陳, 宜花東 宋 — the three candidates stand
// in endorsed regions of their own (台北市, 南投縣, 台南縣), so stamps and candidates share corners — at 390 and 1440,
// and in English at 390.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import * as S from "../public/solo.js";
import { COUNTIES, REGIONS, SEATS } from "../public/shared/board.js";

const base = process.argv[2];
if (!base) { console.log("usage: node tools/endorse50.mjs <base url ending in /president_2000/>"); process.exit(2); }
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function launch() {
  const root = process.env.TEMP || "/tmp", dir = `${root}/endorse50_${process.pid}_${Date.now()}`;
  for (const old of readdirSync(root).filter((d) => d.startsWith("endorse50_"))) { try { if (Date.now() - statSync(`${root}/${old}`).mtimeMs > 600000) rmSync(`${root}/${old}`, { recursive: true, force: true }); } catch { /* in use */ } }
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
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    if (m.method === "Page.javascriptDialogOpening") ws.send(JSON.stringify({ id: ++id, method: "Page.handleJavaScriptDialog", params: { accept: false } })); };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id;
    const tm = setTimeout(() => { pend.delete(i); rej(new Error(`instrument: CDP ${method} got no reply in 20 s (${String(params.expression || params.url || "").replace(/\s+/g, " ").slice(0, 90)})`)); }, 20000);
    pend.set(i, (m) => { clearTimeout(tm); res(m.result || {}); }); ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Page.enable"); // #96: the first-time boxes are a modal of the first game, measured by tools/tips96.mjs; off here unless set
  await send("Page.addScriptToEvaluateOnNewDocument", { source: 'try { if (!localStorage.getItem("p2000.tips")) localStorage.setItem("p2000.tips", JSON.stringify({ seen: [], off: true })); } catch (e) { /* no storage */ }' });
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile });
  const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); return r.result ? r.result.value : undefined; };
  const go = async (u, wait = 2200) => { await send("Page.navigate", { url: u }); await sleep(wait); };
  const tapAt = async (x, y) => { for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 }); };
  return { ev, go, tapAt, close: () => { try { ws.close(); } catch { /* closed */ } } };
}

// The game: 陳 at their first decision, the endorsements put in by hand.
const ENDORSE = [2, -1, 1, 0, -1, 1, -1]; // 北北基 連, 桃竹苗 —, 中彰投 宋, 雲嘉南 陳, 高屏 —, 宜花東 宋, 離島 —
const regionOf = (k) => (typeof COUNTIES[k][1] === "number" ? COUNTIES[k][1] : REGIONS.indexOf(COUNTIES[k][1]));
const SHORT = { zh: ["陳", "宋", "連"] };
const session = (endorse) => { const s = S.advance(S.newSolo({ seat: 0, level: 2, seed: 7 })); s.st.endorse = endorse.slice(); return s; };
const load = async (t, s, lang) => {
  await t.go(base, 1200);
  await t.ev(`(()=>{ sessionStorage.setItem("p2000.solo.session", ${JSON.stringify(JSON.stringify(s))}); return 1; })()`);
  await t.go(`${base}?play${lang ? "&lang=" + lang : ""}`, 100);
  for (let i = 0; i < 100; i++) { try { if (await t.ev(`!!document.querySelector("[data-county]")`)) break; } catch { /* navigating */ } await sleep(30); }
  // the turn card (#44) first: tap it away, then wait until it has been gone 0.4 s in a row
  for (let i = 0, clear = 0; i < 160 && clear < 8; i++) {
    let up = true; try { up = await t.ev(`(() => { const c = document.querySelector("[data-turncard]"); if (!c) return false; const r = c.getBoundingClientRect(); return r.width > 0 && Number(getComputedStyle(c).opacity) > 0.05; })()`); } catch { /* navigating */ }
    if (up && i % 20 === 5) await t.ev(`(() => { const c = document.querySelector("[data-turncard]"); c && c.click(); return 1; })()`);
    clear = up ? 0 : clear + 1; await sleep(50);
  }
};
// Everything about the stamps, read in the page.
const READ = `JSON.stringify((() => {
  const box = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
  const hit = (a, b) => Math.min(a.r, b.r) - Math.max(a.l, b.l) > 0.5 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 0.5;
  const colourOf = (e) => { const shape = /^(circle|rect|path|ellipse)$/i.test(e.tagName) ? e : e.querySelector("circle, rect, path, ellipse"); if (!shape) return getComputedStyle(e).backgroundColor; return getComputedStyle(shape).fill; };
  const slotCol = {}; for (const s of ${JSON.stringify(SEATS)}) { const r = document.querySelector('rect[data-slot="' + s + '"]'); slotCol[s] = r ? getComputedStyle(r).fill : null; }
  const svg = document.querySelector("[data-county]") && document.querySelector("[data-county]").ownerSVGElement, map = svg ? box(svg) : null;
  const papers = [...document.querySelectorAll("[data-paper]")].map((p) => ({ k: p.getAttribute("data-paper"), b: box(p) }));
  const pawns = [...document.querySelectorAll("[data-pawn][data-of], img[data-pawn-pic][data-of]")].map((p) => ({ k: p.getAttribute("data-of"), b: box(p) }));
  const out = [];
  for (const g of document.querySelectorAll("g[data-county]")) {
    const k = g.getAttribute("data-county"), st = [...g.querySelectorAll("[data-endorse-stamp]")];
    const rec = { k: +k, aria: g.getAttribute("aria-label") || "", stamps: [] };
    for (const s of st) {
      const b = box(s), mine = [...g.querySelectorAll("text, rect[data-slot], image")].filter((e) => !s.contains(e));
      const covers = [];
      for (const e of mine) if (hit(b, box(e))) covers.push(e.tagName === "text" ? "its name" : e.tagName === "image" ? "a picture" : "a block");
      for (const p of pawns) if (hit(b, p.b)) covers.push(p.k === k ? "the candidate on it" : "a candidate on county " + p.k);
      for (const p of papers) if (p.k !== k && hit(b, p.b)) covers.push("county " + p.k + "'s paper");
      const inside = map && b.l >= map.l - 0.5 && b.t >= map.t - 0.5 && b.r <= map.r + 0.5 && b.b <= map.b + 0.5;
      rec.stamps.push({ seat: s.getAttribute("data-endorse-stamp"), colour: colourOf(s), size: Math.round(Math.min(b.w, b.h) * 10) / 10, covers, inside });
    }
    out.push(rec);
  }
  const lg = document.querySelector("[data-endorse-legend]");
  const lv = lg && (() => { const r = lg.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(lg).visibility !== "hidden"; })();
  return { counties: out, slotCol, legend: lv ? lg.textContent.replace(/\\s+/g, " ").trim() : null };
})())`;

const out = [];
const rule = (ok, what) => out.push({ ok, what });
// The stamps of one screen against ENDORSE: count, seat, colour, size, what they cover, inside the map.
function stamps(m, w, want) {
  const bad = [], seen = { stamps: 0, endorsed: 0 };
  const col = (seat) => m.slotCol[SEATS[seat]];
  for (const c of m.counties) {
    const h = want[regionOf(c.k)], name = COUNTIES[c.k][0];
    if (h >= 0) seen.endorsed++;
    seen.stamps += c.stamps.length;
    if (h < 0 && c.stamps.length) { bad.push(`${name} (no holder) has ${c.stamps.length} stamps`); continue; }
    if (h >= 0 && c.stamps.length !== 1) { bad.push(`${name} has ${c.stamps.length} stamps (1)`); continue; }
    for (const s of c.stamps) {
      if (String(s.seat) !== String(h)) bad.push(`${name}: stamp of seat ${s.seat} (${h})`);
      if (!col(h) || s.colour !== col(h)) bad.push(`${name}: colour ${s.colour} (the blocks: ${col(h)})`);
      if (s.size < 10) bad.push(`${name}: ${s.size} px across (≥ 10)`);
      if (s.covers.length) bad.push(`${name}: covers ${[...new Set(s.covers)].join(", ")}`);
      if (!s.inside) bad.push(`${name}: outside the map`);
    }
  }
  return { bad, seen };
}

const br = await launch();
try {
  const withE = session(ENDORSE), none = session(Array(7).fill(-1));
  const nEndorsed = COUNTIES.filter((_, k) => ENDORSE[regionOf(k)] >= 0).length;
  // 1–2. The stamps at 390 and 1440.
  for (const [w, h, mob] of [[390, 844, true], [1440, 900, false]]) {
    const t = await tab(br, w, h, mob);
    await load(t, withE);
    const m = JSON.parse(await t.ev(READ)), x = stamps(m, w, ENDORSE);
    rule(x.seen.stamps > 0 && !x.bad.length, `${w}: ${x.seen.stamps} stamps on ${x.seen.endorsed} counties of endorsed regions (want ${nEndorsed}), each its holder's colour, ≥ 10 px, covering nothing, inside the map${x.bad.length ? " — " + x.bad.slice(0, 6).join("; ") + (x.bad.length > 6 ? ` (+${x.bad.length - 6})` : "") : ""}`);
    rule(!!m.legend && /背書/.test(m.legend), `${w}: the key ${m.legend ? `「${m.legend.slice(0, 40)}」` : "— none"} (says 背書)`);
    t.close();
  }
  // 3. No holder anywhere: no stamp, no key.
  {
    const t = await tab(br, 390, 844, true);
    await load(t, none);
    const m = JSON.parse(await t.ev(READ)), n = m.counties.reduce((s, c) => s + c.stamps.length, 0);
    rule(m.counties.length > 0 && n === 0 && !m.legend, `390, nobody endorsed: ${n} stamps (0), key ${m.legend ? "shown" : "not shown"} (not shown) on ${m.counties.length} counties`);
    t.close();
  }
  // 4–5. The popover and the aria-label at 390: 台北縣 (北北基, 連) and 桃園縣 (桃竹苗, nobody).
  {
    const t = await tab(br, 390, 844, true);
    await load(t, withE);
    const free = (k) => withE.st.counties[k].blocks.filter((b) => b.o < 0 && b.t === "N").length;
    const tpe = COUNTIES.findIndex((c) => c[0] === "台北縣"), tyn = COUNTIES.findIndex((c) => c[0] === "桃園縣");
    const r = regionOf(tpe), here = Math.floor(free(tpe) / 2), all = COUNTIES.reduce((s, _, k) => s + (regionOf(k) === r ? Math.floor(free(k) / 2) : 0), 0);
    const pop = async (k) => {
      await t.ev(`(() => { const p = document.querySelector('[data-paper="${k}"]'); p && p.scrollIntoView({ block: "center" }); return 1; })()`); await sleep(300);
      const c = JSON.parse(await t.ev(`JSON.stringify((() => { const r = document.querySelector('[data-paper="${k}"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })())`));
      await t.tapAt(c.x, c.y); await sleep(500);
      return JSON.parse(await t.ev(`JSON.stringify((() => { const p = document.querySelector('[data-popover="${k}"]'); if (!p) return { open: false }; const n = p.querySelector("[data-endorse-note]"); return { open: true, note: n ? { here: n.getAttribute("data-here"), region: n.getAttribute("data-region"), text: n.textContent.replace(/\\s+/g, " ").trim() } : null }; })())`));
    };
    const a = await pop(tpe);
    const okA = a.open && a.note && a.note.here === String(here) && a.note.region === String(all) && a.note.text.includes(SHORT.zh[ENDORSE[r]]) && a.note.text.includes(REGIONS[r]);
    rule(okA, `390 popover of 台北縣 (北北基, 連; 無色 empty ${free(tpe)}): ${!a.open ? "did not open" : !a.note ? "no [data-endorse-note]" : `here ${a.note.here} (${here}), region ${a.note.region} (${all}), 「${a.note.text.slice(0, 60)}」 (names 連 and 北北基)`}`);
    await t.ev(`(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); return 1; })()`); await sleep(300);
    const b = await pop(tyn);
    rule(b.open && !b.note, `390 popover of 桃園縣 (桃竹苗, nobody): ${!b.open ? "did not open" : b.note ? `has a note 「${b.note.text.slice(0, 40)}」` : "no endorsement note"}`);
    const m = JSON.parse(await t.ev(READ)), ta = m.counties.find((c) => c.k === tpe), tb = m.counties.find((c) => c.k === tyn);
    rule(!!ta && /背書/.test(ta.aria) && ta.aria.includes("連") && !!tb && !/背書/.test(tb.aria), `390 aria-label: 台北縣 「${ta ? ta.aria : "—"}」 (背書, 連); 桃園縣 「${tb ? tb.aria : "—"}」 (no 背書)`);
    t.close();
  }
  // 6. English at 390: the stamps as in Chinese, and the key in English.
  {
    const t = await tab(br, 390, 844, true);
    await load(t, withE, "en");
    const m = JSON.parse(await t.ev(READ)), x = stamps(m, 390, ENDORSE);
    rule(x.seen.stamps > 0 && !x.bad.length && !!m.legend && /endorse/i.test(m.legend) && !/背書/.test(m.legend), `390 English: ${x.seen.stamps} stamps${x.bad.length ? " — " + x.bad.slice(0, 4).join("; ") : " right"}; the key ${m.legend ? `「${m.legend.slice(0, 50)}」` : "— none"} (in English)`);
    t.close();
  }
} finally { br.close(); }
let bad = 0;
for (const x of out) { if (!x.ok) bad++; console.log(`${x.ok ? "✓" : "✗"} ${x.what}`); }
console.log(bad ? `FAIL: ${bad} of ${out.length}` : `PASS: ${out.length} checks`);
process.exit(bad ? 1 : 0);
