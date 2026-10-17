// tools/turncard64.mjs — the turn card as a newspaper (design 甲 「選戰日報」, #64): its look and its fit on a phone and
// a desk. Orchestrator's instrument: a peer may run it, does not edit it. Needs Chrome; no server: the cards are drawn
// with this tree's own code (public/solo.js) and styled with this tree's own public/style.css and art.
//
//   node tools/turncard64.mjs
//
// Owner, 2026-10-17: 「甲」 of the three newspaper designs (the canvas 「回合簡報 · 報紙版」). Contract, a solo game's turn
// card at the start of turns 1, 2, 4, 6 and 9, Chinese and English, at 390×664 (an iPhone's Safari with its bars; CDP
// mobile metrics) and 1280×800:
//   - the masthead [data-masthead] is drawn, in a serif face, at least 32 px on the phone and 44 px on the desk, and
//     centred on the card (its middle within 12 px of the card's);
//   - the dateline [data-dateline] sits under a double rule (border-top-style double, on it or on its parent);
//   - the headline's title [data-hl-title] (turns 2 and 4) is serif, at least 26 px on the phone and 34 px on the
//     desk, and the headline's picture is at least 60 % of the card's width on the phone and 45 % on the desk;
//   - the card is a sheet of paper: square corners (border radius at most 2 px);
//   - the nine calendar cells [data-tc-step] are drawn, each at least 20 px wide, and this turn's cell
//     (data-state="now") has another background than the cells still to come;
//   - fit: on the phone turns 1, 2 and 4 need no scrolling (the overlay's scroll height within its height, the card's
//     bottom on screen), in both languages; turns 6 and 9 scroll no more than they did before #64 (overlay scroll height
//     Chinese 786 / 737, English 900 / 845, measured at 65d3053); on the desk the card is 640–720 px wide and needs no
//     scrolling, except the English turn 6 which may reach 830 (as before);
//   - the phone page never scrolls sideways.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import * as S from "../public/solo.js";

const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PUBLIC = new URL("../public/", import.meta.url).href;
const TMP = process.env.TEMP || "/tmp";

// Chrome picks a free port and writes it to DevToolsActivePort in its own profile folder, one per run (as compact29).
async function launch() {
  const dir = `${TMP}/turncard64_${process.pid}_${Date.now()}`;
  for (const old of readdirSync(TMP).filter((d) => d.startsWith("turncard64_"))) { try { if (Date.now() - statSync(`${TMP}/${old}`).mtimeMs > 600000) rmSync(`${TMP}/${old}`, { recursive: true, force: true }); } catch { /* in use */ } }
  mkdirSync(dir, { recursive: true });
  const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--remote-debugging-port=0", "--allow-file-access-from-files", `--user-data-dir=${dir}`, "about:blank"], { stdio: "ignore" });
  let port = 0;
  for (let i = 0; i < 100 && !port; i++) { try { port = Number.parseInt(readFileSync(`${dir}/DevToolsActivePort`, "utf8"), 10) || 0; } catch { /* starting */ } if (!port) await sleep(100); }
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break; } catch { /* starting */ } await sleep(200); }
  return { port, dir, close: () => proc.kill() };
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

// A solo game at the start of the given turn (made with the game's own code; the first move each time).
function atTurn(seed, turn) {
  let s = S.newSolo({ seat: 0, level: 2, seed });
  if (turn === 1) return s;
  for (let n = 0; n < 8000 && s.st.phase !== "end"; n++) {
    const before = s.st.log.length;
    if (S.botsToMove(s).length) s = S.stepBot(s); else { const ch = S.choices(s, "zh-Hant"); if (!ch.length) return null; s = S.act(s, ch[0].move); }
    if (s.st.log.slice(before).some((e) => e.t === "turn" && e.turn === turn)) return s;
  }
  return null;
}

// Everything measured in the page in one go.
const MEASURE = `(() => {
  const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, b: b.bottom }; };
  const drawn = (e) => !!e && e.getClientRects().length > 0 && e.getBoundingClientRect().width > 0 && getComputedStyle(e).visibility !== "hidden";
  const o = document.querySelector("[data-turncard]");
  const card = o && (o.querySelector(".tc-card") || o.firstElementChild);
  const mh = o && o.querySelector("[data-masthead]"), dl = o && o.querySelector("[data-dateline]"), ht = o && o.querySelector("[data-hl-title]");
  const hl = o && o.querySelector("[data-headline]"), img = hl && hl.querySelector("img");
  const cs = (e) => (e ? getComputedStyle(e) : null);
  const steps = o ? [...o.querySelectorAll("[data-tc-step]")] : [];
  const now = steps.find((s) => s.dataset.state === "now"), far = steps.filter((s) => s.dataset.state === "far");
  return JSON.stringify({
    card: r(card), radius: card ? Math.max(...["borderTopLeftRadius", "borderTopRightRadius", "borderBottomLeftRadius", "borderBottomRightRadius"].map((k) => parseFloat(cs(card)[k]) || 0)) : null,
    mh: drawn(mh) ? { ...r(mh), size: parseFloat(cs(mh).fontSize), font: cs(mh).fontFamily } : null,
    dl: dl ? { double: cs(dl).borderTopStyle === "double" || (dl.parentElement && cs(dl.parentElement).borderTopStyle === "double") } : null,
    ht: drawn(ht) ? { size: parseFloat(cs(ht).fontSize), font: cs(ht).fontFamily } : null,
    img: drawn(img) ? r(img) : null,
    steps: steps.map((s) => ({ v: s.dataset.step, w: s.getBoundingClientRect().width, drawn: drawn(s) })),
    nowBg: now ? cs(now).backgroundColor : null, farBg: far.map((s) => cs(s).backgroundColor),
    sh: o ? o.scrollHeight : 0, ch: o ? o.clientHeight : 0, sw: document.documentElement.scrollWidth, iw: innerWidth, ih: innerHeight,
  });
})()`;

const BEFORE = { phone: { "zh-Hant": { 6: 786, 9: 737 }, en: { 6: 900, 9: 845 } } }; // 65d3053, overlay scroll height
const out = [];
const rule = (ok, what) => out.push({ ok, what });
const pages = [];
const folder = `${TMP}/turncard64_pages_${process.pid}`;
mkdirSync(folder, { recursive: true });
for (const turn of [1, 2, 4, 6, 9]) {
  const s = atTurn(7101, turn);
  if (!s) { rule(false, `no game reached turn ${turn}`); continue; }
  for (const lang of ["zh-Hant", "en"]) {
    const html = S.screen(s, lang, { turnCard: true, cardAge: 5000 });
    const file = `${folder}/t${turn}_${lang}.html`;
    writeFileSync(file, `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base href="${PUBLIC}">` +
      `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;700;900&family=Noto+Serif+TC:wght@700;900&display=swap"><link rel="stylesheet" href="style.css"></head>` +
      `<body><main class="wrap game" id="solo"><div id="stage">${html}</div></main></body></html>`);
    pages.push({ turn, lang, url: pathToFileURL(file).href });
  }
}
const br = await launch();
try {
  for (const [dev, w, h, mobile] of [["phone", 390, 664, true], ["desk", 1280, 800, false]]) {
    for (const p of pages) {
      const t = await tab(br, p.url, w, h, mobile);
      const m = JSON.parse(await t.ev(MEASURE));
      t.close();
      const who = `${dev} ${p.lang} turn ${p.turn}`;
      if (!m.card) { rule(false, `${who}: no turn card drawn`); continue; }
      const serif = (f) => /serif/i.test(f || "") && !/^\s*["']?Noto Sans/i.test(f || "");
      const mhMin = dev === "phone" ? 32 : 44, htMin = dev === "phone" ? 26 : 34, imgMin = dev === "phone" ? 0.6 : 0.45;
      rule(!!m.mh && serif(m.mh.font) && m.mh.size >= mhMin && Math.abs(m.mh.x + m.mh.w / 2 - (m.card.x + m.card.w / 2)) <= 12,
        `${who}: masthead drawn, serif, ≥ ${mhMin}px, centred (${m.mh ? `${m.mh.size}px, ${m.mh.font.split(",")[0]}, middle ${Math.round(m.mh.x + m.mh.w / 2 - (m.card.x + m.card.w / 2))}px off` : "not drawn"})`);
      rule(!!m.dl && m.dl.double, `${who}: the dateline under a double rule (${m.dl ? (m.dl.double ? "double" : "no double rule") : "no data-dateline"})`);
      if (p.turn === 2 || p.turn === 4) {
        rule(!!m.ht && serif(m.ht.font) && m.ht.size >= htMin, `${who}: headline title serif, ≥ ${htMin}px (${m.ht ? `${m.ht.size}px, ${m.ht.font.split(",")[0]}` : "not drawn"})`);
        rule(!!m.img && m.img.w >= imgMin * m.card.w, `${who}: headline picture ≥ ${imgMin * 100}% of the card's width (${m.img ? `${Math.round(m.img.w)} of ${Math.round(m.card.w)}` : "not drawn"})`);
      }
      rule(m.radius != null && m.radius <= 2, `${who}: square corners (radius ${m.radius}px)`);
      const stepsOk = m.steps.length === 9 && m.steps.every((s) => s.drawn && s.w >= 20) && m.nowBg && m.farBg.every((b) => b !== m.nowBg);
      rule(stepsOk, `${who}: nine calendar cells ≥ 20px, this turn's cell coloured apart (${m.steps.length} cells, narrowest ${m.steps.length ? Math.round(Math.min(...m.steps.map((s) => s.w))) : "-"}px, now ${m.nowBg})`);
      if (dev === "phone") {
        const cap = BEFORE.phone[p.lang][p.turn];
        if (cap) rule(m.sh <= cap, `${who}: scrolls no more than before #64 (scroll height ${m.sh} ≤ ${cap})`);
        else rule(m.sh <= m.ch + 1 && m.card.b <= m.ih + 1 && m.card.y >= -1, `${who}: no scrolling (scroll height ${m.sh}/${m.ch}, card ${Math.round(m.card.y)}–${Math.round(m.card.b)} of ${m.ih})`);
        rule(m.sw <= m.iw, `${who}: no sideways scroll (${m.sw} ≤ ${m.iw})`);
      } else {
        const cap = p.lang === "en" && p.turn === 6 ? 830 : m.ch;
        rule(m.card.w >= 640 && m.card.w <= 720 && m.sh <= cap + 1, `${who}: card 640–720 wide, scroll height ≤ ${cap} (${Math.round(m.card.w)} wide, scroll height ${m.sh})`);
      }
    }
  }
} finally { br.close(); try { rmSync(folder, { recursive: true, force: true }); } catch { /* in use */ } }
for (const o of out) console.log(`${o.ok ? "✓" : "✗"} ${o.what}`);
const bad = out.filter((o) => !o.ok).length;
console.log(bad ? `FAIL: ${bad} of ${out.length} checks` : `PASS: ${out.length} checks`);
process.exit(bad ? 1 : 0);
