// tools/issuehl65.mjs — the issue track as newspaper headlines (design 乙 「黑底報眉」, #65): the space it takes and its
// look on a phone and a desk. Orchestrator's instrument: a peer may run it, does not edit it. Needs Chrome; no server:
// the table is drawn with this tree's own code (public/solo.js) and styled with this tree's own public/style.css.
//
//   node tools/issuehl65.mjs
//
// Owner, 2026-10-17: 「維持原本的欄位空間」, 「議題頭條 採用 丙的排版，但是設計成報紙的樣式」, then 「乙」 (the canvas
// 「議題頭條」, third row). Contract, two tables of one solo game (the start of turn 4 and forty steps later), Chinese and
// English, at 390×664 (CDP mobile) and 1280×800:
//   - the track takes no more space than it did (measured at 65d3053 with this tool): on the phone at most 370 wide and
//     73 high in Chinese, 90 in English (the English totals line wraps to two lines today); on the desk 618×115;
//   - the three headlines ([data-hl-slot]) sit in one row; the 頭條 is at least 1.2 times as wide as each of the other
//     two, and those two are as wide as each other (±2 px);
//   - each has its flag [data-hl-reward] across its top (the flag's top within 2 px of the card's, 12–20 px high, text at
//     least 9 px); the 頭條's flag has another colour than the other two, and theirs are the same;
//   - the issue's name [data-hl-name] is serif, at least 14 px on the phone and 16 px on the desk; who leads
//     [data-hl-status] is drawn;
//   - the cards are paper with square corners (radius at most 2 px); the 頭條 has a picture with square corners, and on
//     the desk all three do;
//   - nothing is cut: the label, flag, name and status stay inside their card and do not overflow their own box;
//   - the totals line ([data-issue-lead]) is drawn inside the track; the phone page never scrolls sideways.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import * as S from "../public/solo.js";

const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PUBLIC = new URL("../public/", import.meta.url).href;
const TMP = process.env.TEMP || "/tmp";

async function launch() {
  const dir = `${TMP}/issuehl65_${process.pid}_${Date.now()}`;
  for (const old of readdirSync(TMP).filter((d) => d.startsWith("issuehl65_"))) { try { if (Date.now() - statSync(`${TMP}/${old}`).mtimeMs > 600000) rmSync(`${TMP}/${old}`, { recursive: true, force: true }); } catch { /* in use */ } }
  mkdirSync(dir, { recursive: true });
  const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--remote-debugging-port=0", "--allow-file-access-from-files", `--user-data-dir=${dir}`, "about:blank"], { stdio: "ignore" });
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
  await send("Page.navigate", { url }); await sleep(1800);
  const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); return r.result ? r.result.value : undefined; };
  await ev("document.fonts.ready.then(()=>1)");
  return { ev, close: () => { try { ws.close(); } catch { /* closed */ } } };
}
// One solo game (the first move each time): the start of turn 4, and forty steps later.
function tables() {
  let s = S.newSolo({ seat: 0, level: 2, seed: 7101 });
  const out = [];
  for (let n = 0, at = -1; n < 8000 && s.st.phase !== "end" && out.length < 2; n++) {
    const before = s.st.log.length;
    if (S.botsToMove(s).length) s = S.stepBot(s); else { const ch = S.choices(s, "zh-Hant"); if (!ch.length) break; s = S.act(s, ch[0].move); }
    if (at < 0 && s.st.log.slice(before).some((e) => e.t === "turn" && e.turn === 4)) { at = n; out.push({ s, name: "turn 4 start" }); }
    else if (at >= 0 && n === at + 40) out.push({ s, name: "turn 4 + 40 steps" });
  }
  return out;
}

const MEASURE = `(() => {
  const R = (e) => { const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, r: b.right, b: b.bottom }; };
  const drawn = (e) => !!e && e.getClientRects().length > 0 && e.getBoundingClientRect().width > 0 && getComputedStyle(e).visibility !== "hidden";
  const cs = (e) => getComputedStyle(e);
  const chain = (e, top) => { const a = []; for (let x = e; x; x = x.parentElement) { a.push(x); if (x === top) break; } return a; };
  const rad = (e) => Math.max(...["borderTopLeftRadius", "borderTopRightRadius", "borderBottomLeftRadius", "borderBottomRightRadius"].map((k) => parseFloat(cs(e)[k]) || 0));
  const tr = document.querySelector("[data-issues]");
  const cards = [...document.querySelectorAll("[data-hl-slot]")].filter(drawn);
  const part = (c, a) => { const e = c.querySelector("[" + a + "]"); if (!drawn(e)) return null; const r = R(e);
    return { ...r, size: parseFloat(cs(e).fontSize), font: cs(e).fontFamily, bg: cs(e).backgroundColor, over: e.scrollWidth > e.clientWidth + 1 && cs(e).overflow !== "visible", txt: e.textContent.trim().slice(0, 24) }; };
  return JSON.stringify({
    track: tr ? R(tr) : null,
    cards: cards.map((c) => { const img = c.querySelector("img");
      return { slot: c.dataset.hlSlot, ...R(c), rad: rad(c), img: drawn(img) ? { ...R(img), rad: Math.max(...chain(img, c).map(rad)) } : null,
        label: part(c, "data-hl-label"), reward: part(c, "data-hl-reward"), name: part(c, "data-hl-name"), status: part(c, "data-hl-status") }; }),
    lead: (() => { const e = document.querySelector("[data-issue-lead]"); return drawn(e) ? R(e) : null; })(),
    sw: document.documentElement.scrollWidth, iw: innerWidth,
  });
})()`;

const out = [];
const rule = (ok, what) => out.push({ ok, what });
const folder = `${TMP}/issuehl65_pages_${process.pid}`;
mkdirSync(folder, { recursive: true });
const pages = [];
for (const t of tables()) for (const lang of ["zh-Hant", "en"]) {
  const file = `${folder}/${pages.length}.html`;
  writeFileSync(file, `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base href="${PUBLIC}">` +
    `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;700;900&family=Noto+Serif+TC:wght@700;900&display=swap"><link rel="stylesheet" href="style.css"></head>` +
    `<body><main class="wrap game" id="solo"><div id="stage">${S.screen(t.s, lang)}</div></main></body></html>`);
  pages.push({ name: t.name, lang, url: pathToFileURL(file).href });
}
if (pages.length < 4) rule(false, `only ${pages.length / 2} tables reached`);
const br = await launch();
try {
  for (const [dev, w, h, mobile, maxW, maxHs, nameMin] of [["phone", 390, 664, true, 370, { "zh-Hant": 73, en: 90 }, 14], ["desk", 1280, 800, false, 618, { "zh-Hant": 115, en: 115 }, 16]]) {
    for (const p of pages) {
      const t = await tab(br, p.url, w, h, mobile);
      const m = JSON.parse(await t.ev(MEASURE));
      t.close();
      const who = `${dev} ${p.lang} ${p.name}`, maxH = maxHs[p.lang];
      rule(!!m.track && m.track.w <= maxW + 1 && m.track.h <= maxH + 1, `${who}: the track keeps its space (${m.track ? `${Math.round(m.track.w)}×${Math.round(m.track.h)}` : "none"} ≤ ${maxW}×${maxH})`);
      const C = m.cards;
      if (C.length !== 3) { rule(false, `${who}: ${C.length} headlines drawn, not 3`); continue; }
      rule(C.map((c) => c.slot).join() === "1,2,3" && Math.max(...C.map((c) => c.y)) - Math.min(...C.map((c) => c.y)) <= 1, `${who}: three headlines in one row (${C.map((c) => c.slot).join()})`);
      rule(C[0].w >= 1.2 * Math.max(C[1].w, C[2].w) && Math.abs(C[1].w - C[2].w) <= 2, `${who}: the 頭條 wider (${C.map((c) => Math.round(c.w)).join(" / ")})`);
      const fl = C.map((c) => c.reward);
      rule(fl.every((f, i) => f && Math.abs(f.y - C[i].y) <= 2 && f.h >= 12 && f.h <= 20 && f.size >= 9), `${who}: a flag across each top (${fl.map((f, i) => (f ? `top +${Math.round(f.y - C[i].y)} h ${Math.round(f.h)} ${f.size}px` : "none")).join(" / ")})`);
      rule(fl.every(Boolean) && fl[0].bg !== fl[1].bg && fl[1].bg === fl[2].bg, `${who}: the 頭條's flag coloured apart (${fl.map((f) => (f ? f.bg : "-")).join(" / ")})`);
      rule(C.every((c) => c.name && /serif/i.test(c.name.font) && !/^\s*["']?Noto Sans/i.test(c.name.font) && c.name.size >= nameMin), `${who}: issue names serif ≥ ${nameMin}px (${C.map((c) => (c.name ? `${c.name.size}px ${c.name.font.split(",")[0]}` : "none")).join(" / ")})`);
      rule(C.every((c) => c.status), `${who}: who leads drawn on each (${C.map((c) => (c.status ? c.status.txt : "none")).join(" / ")})`);
      rule(C.every((c) => c.rad <= 2), `${who}: square cards (radius ${C.map((c) => c.rad).join("/")})`);
      const pics = dev === "desk" ? C : [C[0]];
      rule(pics.every((c) => c.img && c.img.rad <= 2), `${who}: ${dev === "desk" ? "every headline has" : "the 頭條 has"} a square picture (${C.map((c) => (c.img ? `${Math.round(c.img.w)}×${Math.round(c.img.h)} r${c.img.rad}` : "none")).join(" / ")})`);
      const cut = [];
      for (const c of C) for (const k of ["label", "reward", "name", "status"]) { const e = c[k]; if (e && (e.over || e.r > c.r + 1 || e.b > c.b + 1 || e.x < c.x - 1)) cut.push(`${c.slot}.${k}「${e.txt}」`); }
      rule(!cut.length, `${who}: nothing cut${cut.length ? ` (${cut.join(", ")})` : ""}`);
      rule(!!m.lead && !!m.track && m.lead.b <= m.track.b + 1, `${who}: the totals line inside the track (${m.lead ? Math.round(m.lead.b) : "none"} ≤ ${m.track ? Math.round(m.track.b) : "-"})`);
      if (dev === "phone") rule(m.sw <= m.iw, `${who}: no sideways scroll (${m.sw} ≤ ${m.iw})`);
    }
  }
} finally { br.close(); try { rmSync(folder, { recursive: true, force: true }); } catch { /* in use */ } }
for (const o of out) console.log(`${o.ok ? "✓" : "✗"} ${o.what}`);
const bad = out.filter((o) => !o.ok).length;
console.log(bad ? `FAIL: ${bad} of ${out.length} checks` : `PASS: ${out.length} checks`);
process.exit(bad ? 1 : 0);
