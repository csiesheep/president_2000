// tools/count93.mjs — election night as a TV special (#93): when a solo game ends, the count is shown county by county
// on a Taiwan map, as 選戰新聞台's 開票特別報導, before the end page. Orchestrator's instrument: a peer may run it, does
// not edit it. Needs Chrome and a running dev server of this tree (about 3 minutes).
//
//   node tools/count93.mjs http://127.0.0.1:8787/president_2000/
//
// Owner, 2026-10-18: 「開票頁，重新設計，像新聞聯播，image generation 用 qwen 2.1 image」, 「各縣市開票 用台灣地圖」;
// to the design canvas (③a 開場, ③b 逐縣開出, ③c 快訊, ③d 桌機): 「可以 開工」. Contract (orchestrator, #93), what the
// page shows and the hooks this file reads:
//   - The count night starts when a game ends on the page (the last move made there, the human's or a rival's); a game
//     that is already over when the page opens shows the end page, as before, with a [data-count-replay] button that
//     plays the count night again from its start.
//   - [data-count] is its root while it shows; its value is the stage: "open" → "tally" → "win".
//   - open: the channel (zh 「選戰新聞台」) and 開票; the three candidates at 0; 棄保 and 背書 as they happened
//     ([data-count-settle="strategic"], [data-count-settle="endorse"]: for each seat that gained, its short name and the
//     number of blocks); [data-count-start] starts the count, and it starts by itself within 5 s.
//   - tally: the 24 counties are opened one at a time in the board's order (台北市 first, 金馬 last), about 0.6 s
//     each at the default speed (all 24 in 8–25 s). [data-count-now][data-k] is the county just opened: its name, its
//     leader's name when it has one, and 「反超」 (en "overtak…") exactly when the running leader changes there.
//     [data-count-votes="chen|soong|lien"][data-n]: the running totals in blocks, shown in 萬 (en: millions, one
//     decimal). [data-count-done][data-n]: how many are open, of 24. [data-cmap]: the map, 24 [data-cmap-k="<index>"]
//     cells, data-lead "" (not open yet), "0" "1" "2" (that seat has the most blocks there alone) or "-1" (a tie, or
//     nobody); the county just opened carries data-now; a seat's counties share its colour, the three colours differ,
//     and an unopened county or a tie has none of them. [data-count-skip] goes to the result within 1 s;
//     [data-count-speed][data-speed] changes the speed (the fastest at most 0.6 × the default's time per county).
//   - win: [data-count-winner="<seat key>"] with the winner's name; the winner's end picture (art/end/<seat>.webp);
//     the final totals; [data-count-led="<seat key>"][data-n] the counties each one leads; the whole map open;
//     [data-count-next] goes on to the end page within 2 s.
//   - In English no Chinese character is shown. Every picture in it loads; the anchor desk (art/news/studio.webp,
//     #91) is on screen while counting.
//   - Layout while counting: phone 390×844 (zh and en) and 360×740: no sideways scroll; the county just opened, the
//     three totals, how many are open, the map, skip and speed are on screen and not covered; the line about the
//     county just opened is not cut; the map at least 230×330 (360×740: 200×285). Desk 1280×800: no scroll at all,
//     the same on screen, the map at least 260×370, the anchor desk at least 700×390. ("No scroll" is the count night
//     itself: its root inside the screen and nothing in it to scroll; a page behind an overlay may be long.) A picture
//     that never loads is broken; one caught while loading is not.
// Every row reports 尚未實作 until [data-count] appears after a game ends on the page.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import * as S from "../public/solo.js";
import * as D from "../tests/driver.js";
import { COUNTIES, SEATS } from "../public/shared/board.js";
import { bind } from "../public/table.js";

const base = process.argv[2];
if (!base) { console.log("usage: node tools/count93.mjs <base url ending in /president_2000/>"); process.exit(2); }
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const X = { zh: bind("zh-Hant"), en: bind("en") };
const CJK = /[\u3400-\u9fff\uf900-\ufaff]/;

// ------------------------------------------------------------------ the game: from this tree's own code
const lead = (a) => { const m = Math.max(...a); return m > 0 && a.filter((x) => x === m).length === 1 ? a.indexOf(m) : -1; };
function facts(st) {
  const blocks = st.counties.map((c) => [0, 1, 2].map((p) => c.blocks.filter((b) => b.o === p).length));
  const leads = blocks.map(lead), run = [];
  let acc = [0, 0, 0];
  for (const b of blocks) { acc = acc.map((v, p) => v + b[p]); run.push(acc.slice()); }
  const runLead = run.map(lead), overtakes = [];
  for (let k = 1; k < run.length; k++) if (runLead[k - 1] >= 0 && runLead[k] >= 0 && runLead[k] !== runLead[k - 1]) overtakes.push(k);
  const gain = (t, f) => [0, 1, 2].map((p) => st.log.filter((e) => e.t === t).reduce((s, e) => s + e[f].filter((m) => m.seat === p).reduce((x, m) => x + m.n, 0), 0));
  return { blocks, leads, run, overtakes, strategic: gain("strategic", "moved"), endorse: gain("endorse", "given"), votes: st.result.votes, winner: st.result.winner, led: st.result.leads };
}
// The first seed from P2000_SEED (default 1) where the human (陳, level 2) makes a last move with rivals still to move after
// it (the page then plays them and the game ends there), the running leader changes at least once after the first
// county, and 棄保 or 背書 gave someone blocks.
function prepared() {
  const from = Number(process.env.P2000_SEED || 1) >>> 0;
  for (let seed = from; seed < from + 300; seed++) {
    let s = S.advance(S.newSolo({ seat: 0, level: 2, seed })), pre = null;
    const R = D.rng(seed);
    for (let n = 0; n < 900 && s.st.phase !== "end"; n++) {
      const ch = S.choices(s, "zh-Hant");
      if (!ch.length) break;
      const s1 = S.act(s, ch[Math.floor(R() * ch.length)].move), s2 = S.advance(s1);
      if (s2.st.phase === "end" && S.botsToMove(s1).length) pre = s1;
      s = s2;
    }
    if (!pre || s.st.phase !== "end") continue;
    const f = facts(s.st);
    if (!f.overtakes.length || ![...f.strategic, ...f.endorse].some(Boolean)) continue;
    return { seed, pre, end: s, f };
  }
  throw new Error("300 seeds and no game to use (instrument)");
}

// ------------------------------------------------------------------ the browser
async function launch() {
  const root = process.env.TEMP || "/tmp", dir = `${root}/count93_${process.pid}_${Date.now()}`;
  for (const old of readdirSync(root).filter((d) => d.startsWith("count93_"))) { try { if (Date.now() - statSync(`${root}/${old}`).mtimeMs > 600000) rmSync(`${root}/${old}`, { recursive: true, force: true }); } catch { /* in use */ } }
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
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile });
  const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); return r.result ? r.result.value : undefined; };
  const go = async (url, wait = 1500) => { await send("Page.navigate", { url }); await sleep(wait); await ev("document.fonts.ready.then(()=>1)"); };
  const tapAt = async (x, y) => { for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 }); };
  // a real tap at the middle of the first element that matches (false: none on screen)
  const tap = async (sel) => {
    const c = await ev(`(()=>{ const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return r.width ? [r.left + r.width / 2, r.top + r.height / 2] : null; })()`);
    if (!c) return false;
    await tapAt(c[0], c[1]); return true;
  };
  return { ev, go, tap, close: () => { try { ws.close(); } catch { /* closed */ } } };
}
const SNAP = `(()=>{
  const root = document.querySelector("[data-count]");
  if (!root) return { stage: null, t: performance.now(), end: !!document.querySelector("[data-end-hero]"), replay: !!document.querySelector("[data-count-replay]") };
  const q = (s) => root.querySelector(s), attr = (s, a) => { const e = q(s); return e ? e.getAttribute(a) : null; };
  const num = (e) => (e && e.hasAttribute("data-n") ? Number(e.getAttribute("data-n")) : null);
  const txt = (e) => (e ? e.textContent.replace(/\\s+/g, " ").trim() : "");
  const keys = ["chen", "soong", "lien"];
  const now = q("[data-count-now]");
  const colour = (e) => { const s = getComputedStyle(e); return e instanceof SVGElement ? s.fill : s.backgroundColor; };
  return {
    stage: root.getAttribute("data-count"), t: performance.now(),
    done: num(q("[data-count-done]")), doneText: txt(q("[data-count-done]")),
    votes: keys.map((k) => { const e = root.querySelector('[data-count-votes="' + k + '"]'); return e ? { n: num(e), text: txt(e) } : null; }),
    nowK: now && now.hasAttribute("data-k") ? Number(now.getAttribute("data-k")) : null, nowText: txt(now),
    cells: [...root.querySelectorAll("[data-cmap-k]")].map((e) => ({ k: Number(e.getAttribute("data-cmap-k")), lead: e.getAttribute("data-lead"), now: e.hasAttribute("data-now"), colour: colour(e) })),
    settle: ["strategic", "endorse"].map((k) => { const e = root.querySelector('[data-count-settle="' + k + '"]'); return e ? txt(e) : null; }),
    start: !!q("[data-count-start]"), skip: !!q("[data-count-skip]"), speed: attr("[data-count-speed]", "data-speed"), next: !!q("[data-count-next]"),
    winner: attr("[data-count-winner]", "data-count-winner"), winnerText: txt(q("[data-count-winner]")),
    led: keys.map((k) => num(root.querySelector('[data-count-led="' + k + '"]'))),
    text: root.innerText || "",
    imgs: [...root.querySelectorAll("img")].map((i) => ({ src: i.getAttribute("src") || "", ok: i.complete && i.naturalWidth > 0 })),
  };
})()`;
const LAYOUT = `(()=>{
  const root = document.querySelector("[data-count]"); if (!root) return null;
  const vw = innerWidth, vh = innerHeight;
  const rect = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), r: Math.round(r.right), b: Math.round(r.bottom) }; };
  const inside = (r) => !!r && r.w > 0 && r.h > 0 && r.x >= -0.5 && r.y >= -0.5 && r.r <= vw + 0.5 && r.b <= vh + 0.5;
  const hit = (e) => { if (!e) return false; const r = e.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!t && (t === e || e.contains(t) || t.contains(e)); };
  const cut = (e) => { if (!e) return null; for (const x of [e, ...e.querySelectorAll("*")]) { const s = getComputedStyle(x); if (s.overflowX !== "visible" && x.scrollWidth > x.clientWidth + 1) return "「" + (x.textContent || "").trim().slice(0, 20) + "」被切掉（" + x.scrollWidth + " > " + x.clientWidth + "）"; } const g = document.createRange(); g.selectNodeContents(e); const rr = g.getBoundingClientRect(); if (rr.width && (rr.left < -0.5 || rr.right > vw + 0.5)) return "字跑出畫面（" + Math.round(rr.left) + "–" + Math.round(rr.right) + "）"; return null; };
  const sel = { now: "[data-count-now]", done: "[data-count-done]", map: "[data-cmap]", skip: "[data-count-skip]", speed: "[data-count-speed]", chen: '[data-count-votes="chen"]', soong: '[data-count-votes="soong"]', lien: '[data-count-votes="lien"]' };
  const out = {};
  for (const [k, s] of Object.entries(sel)) { const e = root.querySelector(s), r = rect(e); out[k] = { r, inside: inside(r), hit: hit(e) }; }
  out.nowCut = cut(root.querySelector("[data-count-now]"));
  const studio = [...root.querySelectorAll("img")].find((i) => /art\\/news\\/studio/.test(i.getAttribute("src") || ""));
  out.studio = { r: rect(studio), inside: inside(rect(studio)) };
  const se = document.scrollingElement;
  out.page = { vw, vh, sw: se.scrollWidth, sh: se.scrollHeight };
  const rr = rect(root);
  out.root = { r: rr, inside: inside(rr), over: root.scrollHeight > root.clientHeight + 1 ? root.scrollHeight + " > " + root.clientHeight : null };
  return out;
})()`;

// One pass: open the page on the prepared game, let the rivals finish it, follow the count night.
//   cfg: { name, w, h, mobile, lang, tapStart, skipAt, speedAt, layoutAt, next }
async function pass(br, G, cfg) {
  const t = await tab(br, cfg.w, cfg.h, cfg.mobile);
  const out = { cfg, snaps: [], layout: null, todo: null, err: null };
  try {
    await t.go(base, 800);
    await t.ev(`(()=>{ localStorage.clear(); localStorage.setItem("p2000.speed", "fast"); localStorage.setItem("p2000.sound", JSON.stringify({ on: false, vol: 0 })); sessionStorage.setItem("p2000.solo.session", ${JSON.stringify(JSON.stringify(G.pre))}); return 1; })()`);
    await t.go(`${base}?play${cfg.lang === "en" ? "&lang=en" : ""}`, 1000);
    if (!(await t.ev("!!document.querySelector('#stage')"))) { out.err = `${base}?play 沒有載入遊戲頁（沒有 #stage）`; return out; }
    // The rivals finish the game by themselves (speed "fast"; nothing is tapped: a tap on the map would open a county
    // and hold them). Up to 120 s for the game to end, then up to 20 s for the count night to show.
    const PHASE = `(()=>{ try { return JSON.parse(sessionStorage.getItem("p2000.solo.session")).st.phase; } catch { return null; } })()`;
    const t0 = Date.now(); let s = null, phase = null, endAt = null, n = 0;
    while (Date.now() - t0 < 120000) {
      s = await t.ev(SNAP);
      if (s && s.stage) break;
      if (n++ % 10 === 0) { phase = await t.ev(PHASE); if (phase === "end" && endAt == null) endAt = Date.now(); }
      if (endAt != null && Date.now() - endAt > 20000) break;
      await sleep(100);
    }
    out.waitS = ((endAt || Date.now()) - t0) / 1000;
    phase = await t.ev(PHASE);
    if (!s || !s.stage) { if (phase === "end") out.todo = "局在頁面上下完了（phase end），之後 20 秒沒有出現 [data-count]"; else out.err = `局在 120 秒內沒有在頁面上下完（phase ${phase}）`; return out; }
    out.pageVotes = await t.ev(`(()=>{ try { return JSON.parse(sessionStorage.getItem("p2000.solo.session")).st.result.votes; } catch { return null; } })()`);
    out.snaps.push(s);
    // open → tally: by itself, or tapped
    if (cfg.tapStart) {
      for (let i = 0; i < 20 && s.stage === "open" && !s.start; i++) { await sleep(50); s = await t.ev(SNAP); out.snaps.push(s); }
      out.startTapped = await t.tap("[data-count-start]"); out.tapT = await t.ev("performance.now()");
    }
    const seen = new Set();
    const tL = Date.now();
    while (Date.now() - tL < 70000) {
      s = await t.ev(SNAP); if (!s) break;
      out.snaps.push(s);
      if (!s.stage || s.stage === "win") break;
      if (s.stage === "tally" && s.done != null && !seen.has(s.done)) {
        seen.add(s.done);
        // at the first county seen at or after the one asked for (a county the page skipped must not skip the step)
        if (cfg.layoutAt != null && s.done >= cfg.layoutAt && !out.layout) out.layout = await t.ev(LAYOUT);
        if (cfg.speedAt != null && s.done >= cfg.speedAt && out.speedTapped === undefined) { out.speedBefore = s.speed; out.speedTapped = await t.tap("[data-count-speed]"); out.speedT = await t.ev("performance.now()"); out.speedAfter = (await t.ev(SNAP)).speed; }
        if (cfg.skipAt != null && s.done >= cfg.skipAt && out.skipTapped === undefined) { out.skipTapped = await t.tap("[data-count-skip]"); out.skipT = await t.ev("performance.now()"); }
      }
      await sleep(70);
    }
    if (s && s.stage === "win") {
      await sleep(600); s = await t.ev(SNAP); out.snaps.push(s); out.win = s;
      out.winLayout = await t.ev(`(()=>{ const e = document.querySelector("[data-count-next]"); if (!e) return null; const r = e.getBoundingClientRect(); const c = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { inside: r.width > 0 && r.top >= 0 && r.bottom <= innerHeight + 0.5 && r.left >= 0 && r.right <= innerWidth + 0.5, hit: !!c && (c === e || e.contains(c)) }; })()`);
      if (cfg.next) {
        out.nextTapped = await t.tap("[data-count-next]");
        const tn = Date.now(); let a = null;
        while (Date.now() - tn < 4000) { a = await t.ev(SNAP); if (a && !a.stage && a.end) break; await sleep(100); }
        out.after = a; out.afterMs = Date.now() - tn;
      }
    }
  } catch (e) { out.err = e.message; } finally { t.close(); }
  return out;
}
// A game already over when the page opens: the end page, and its replay button.
async function reload(br, G) {
  const t = await tab(br, 390, 844, true), out = {};
  try {
    await t.go(base, 800);
    await t.ev(`(()=>{ localStorage.clear(); localStorage.setItem("p2000.sound", JSON.stringify({ on: false, vol: 0 })); sessionStorage.setItem("p2000.solo.session", ${JSON.stringify(JSON.stringify(G.end))}); return 1; })()`);
    await t.go(`${base}?play`, 3000);
    out.first = await t.ev(SNAP);
    out.replayTapped = await t.tap("[data-count-replay]");
    const t0 = Date.now(); let s = null;
    while (Date.now() - t0 < 2500) { s = await t.ev(SNAP); if (s && s.stage) break; await sleep(100); }
    out.after = s; out.ms = Date.now() - t0;
  } catch (e) { out.err = e.message; } finally { t.close(); }
  return out;
}

// ------------------------------------------------------------------ rows
const rows = [];
const row = (name, fn) => { try { const r = fn(); rows.push(r === true ? { name, ok: true } : typeof r === "string" && r.startsWith("TODO:") ? { name, todo: r.slice(5).trim() } : r && r.pass ? { name, ok: true, msg: r.msg } : { name, ok: false, msg: String(r) }); } catch (e) { rows.push({ name, ok: false, msg: `instrument: ${e.message}` }); } };
const okm = (c, msg) => (c ? { pass: true, msg } : msg);

const G = prepared();
const F = G.f, W = G.end.st.result.winner;
console.log(`seed ${G.seed}: ${SEATS[W]} wins ${F.votes.join("/")}, counties led ${F.led.join("/")}, 反超 at ${F.overtakes.map((k) => COUNTIES[k][0]).join("、")}, 棄保 ${F.strategic.join("/")}, 背書 ${F.endorse.join("/")}, ties at ${F.leads.map((l, k) => (l < 0 ? COUNTIES[k][0] : null)).filter(Boolean).join("、") || "none"}`);
const br = await launch();
const P = {};
try {
  P.A = await pass(br, G, { name: "手機 390×844 中文", w: 390, h: 844, mobile: true, lang: "zh", tapStart: false, layoutAt: 12, next: true });
  P.B = await pass(br, G, { name: "手機 390×844 英文", w: 390, h: 844, mobile: true, lang: "en", tapStart: true, layoutAt: 2, skipAt: 3, next: true });
  P.C = await pass(br, G, { name: "桌機 1280×800 中文", w: 1280, h: 800, mobile: false, lang: "zh", tapStart: true, layoutAt: 12, speedAt: 6, next: true });
  P.D = await pass(br, G, { name: "手機 360×740 中文", w: 360, h: 740, mobile: true, lang: "zh", tapStart: true, layoutAt: 4, skipAt: 5, next: false });
  P.E = await reload(br, G);
} finally { br.close(); }

for (const k of ["A", "B", "C", "D"]) console.log(`  ${P[k].cfg.name}: the rivals finished the game on the page in ${P[k].waitS == null ? "?" : P[k].waitS.toFixed(1)} s`);
const todo = Object.values(P).find((p) => p && p.todo);
const errs = ["A", "B", "C", "D"].filter((k) => P[k].err).map((k) => `${P[k].cfg.name}：${P[k].err}`);
const R0 = (name, fn) => row(name, () => (errs.length ? errs.join("；") : todo ? `TODO: ${todo.todo}` : fn()));
const tally = (p) => p.snaps.filter((s) => s && s.stage === "tally");
const firstOf = (p) => { const m = new Map(); for (const s of tally(p)) if (s.done != null && !m.has(s.done)) m.set(s.done, s); return m; };
const xOf = (p) => (p.cfg.lang === "en" ? X.en : X.zh);
const shown = (n, lang) => (lang === "en" ? (n / 10).toFixed(1) : String(n * 10));

R0("頁面下完的那一局就是 node 算的這一局（同一個存檔、同樣的電腦）", () => {
  const bad = ["A", "B", "C", "D"].filter((k) => JSON.stringify(P[k].pageVotes) !== JSON.stringify(F.votes)).map((k) => `${P[k].cfg.name} ${JSON.stringify(P[k].pageVotes)}`);
  return okm(!bad.length, bad.length ? `頁面的結果跟 node 不一樣：${bad.join("；")}（node ${F.votes.join("/")}）` : `四次都是 ${F.votes.join("/")}`);
});
R0("開場：第一個畫面是 open，三家都是 0，寫出頻道與開票（中文「選戰新聞台」）", () => {
  const bad = [];
  for (const k of ["A", "B", "C", "D"]) {
    const s = P[k].snaps[0], x = xOf(P[k]);
    if (s.stage !== "open") { bad.push(`${P[k].cfg.name}：第一個畫面是 ${s.stage}`); continue; }
    if (s.votes.some((v) => !v || v.n !== 0)) bad.push(`${P[k].cfg.name}：開場的票數 ${JSON.stringify(s.votes.map((v) => v && v.n))}`);
    if (x.lang !== "en" && !(s.text.includes("選戰新聞台") && s.text.includes("開票"))) bad.push(`${P[k].cfg.name}：沒有「選戰新聞台」或「開票」`);
    if (x.lang === "en" && !s.text.trim()) bad.push(`${P[k].cfg.name}：開場沒有字`);
  }
  return okm(!bad.length, bad.join("；") || "四次都從開場開始，三家 0");
});
R0("棄保與背書：開出第一個縣市之前寫出每家拿到幾塊", () => {
  const bad = [];
  for (const k of ["A", "B", "C", "D"]) {
    const p = P[k], x = xOf(p), pre = p.snaps.filter((s) => s && (s.stage === "open" || (s.stage === "tally" && !s.done)));
    for (const [i, kind, gain] of [[0, "strategic", F.strategic], [1, "endorse", F.endorse]]) {
      const txt = pre.map((s) => s.settle[i]).find((t) => t != null);
      if (txt == null) { bad.push(`${p.cfg.name}：開出縣市之前沒有 [data-count-settle="${kind}"]`); continue; }
      for (let q = 0; q < 3; q++) if (gain[q] && !(txt.includes(x.short(q)) && txt.includes(String(gain[q])))) bad.push(`${p.cfg.name} ${kind}：「${txt.slice(0, 60)}」沒有寫 ${x.short(q)} ${gain[q]}`);
    }
  }
  return okm(!bad.length, bad.slice(0, 4).join("；") || `棄保 ${F.strategic.join("/")}、背書 ${F.endorse.join("/")} 都寫了`);
});
R0("不點也會開始：開場出現後 5 秒內自己開始開票（手機中文）", () => {
  const sn = P.A.snaps, o = sn.find((s) => s.stage === "open"), t1 = sn.find((s) => s.stage === "tally");
  if (!o || !t1) return `開場 ${!!o}、開票 ${!!t1}`;
  const ms = t1.t - o.t;
  return okm(ms <= 5500, `開場 ${(ms / 1000).toFixed(1)} 秒後開始`);
});
R0("點「開始開票」1 秒內開始", () => {
  const bad = [];
  for (const k of ["B", "C", "D"]) {
    const p = P[k];
    if (!p.startTapped) { bad.push(`${p.cfg.name}：畫面上沒有 [data-count-start]`); continue; }
    const t1 = p.snaps.find((s) => s.stage === "tally" && s.t >= p.tapT);
    if (!t1 || t1.t - p.tapT > 1000) bad.push(`${p.cfg.name}：點了之後 ${t1 ? ((t1.t - p.tapT) / 1000).toFixed(1) + " 秒" : "沒有"}才開始`);
  }
  return okm(!bad.length, bad.join("；") || "三次都在 1 秒內");
});
R0("逐縣開出：照棋盤的順序一次一個（台北市先、金馬最後），每一個都看得到", () => {
  const m = firstOf(P.A), bad = [];
  for (let n = 1; n <= 24; n++) { const s = m.get(n); if (!s) { bad.push(`沒看到第 ${n} 個`); continue; } if (s.nowK !== n - 1) bad.push(`第 ${n} 個開的是 ${s.nowK == null ? "（沒有 data-k）" : COUNTIES[s.nowK] ? COUNTIES[s.nowK][0] : s.nowK}，應是 ${COUNTIES[n - 1][0]}`); }
  const extra = [...m.keys()].filter((n) => n < 1 || n > 24);
  if (extra.length) bad.push(`開出數 ${extra.join("、")}`);
  return okm(!bad.length, bad.slice(0, 5).join("；") || "24 個依序開出");
});
R0("累計票數：每開一個縣市，三家的數字就是已開縣市的方塊加總，畫面上寫萬（英文 M、一位小數）", () => {
  const bad = []; let n0 = 0;
  for (const k of ["A", "C"]) {
    const p = P[k], lang = p.cfg.lang;
    for (const [n, s] of firstOf(p)) {
      if (n < 1 || n > 24) continue;
      n0++;
      const want = F.run[n - 1];
      for (let q = 0; q < 3; q++) {
        const v = s.votes[q];
        if (!v || v.n !== want[q]) { bad.push(`${p.cfg.name} 第 ${n} 個：${SEATS[q]} ${v ? v.n : "沒有"}，應是 ${want[q]}`); break; }
        if (!v.text.includes(shown(want[q], lang))) { bad.push(`${p.cfg.name} 第 ${n} 個：${SEATS[q]}「${v.text}」沒有寫 ${shown(want[q], lang)}`); break; }
      }
      if (s.done !== n || !s.doneText.includes(String(n)) || !s.doneText.includes("24")) bad.push(`${p.cfg.name}：開出數「${s.doneText}」`);
    }
  }
  if (!n0) return "沒有看到任何開票中的畫面";
  return okm(!bad.length, bad.slice(0, 4).join("；") || `${n0} 個畫面的數字都對`);
});
R0("地圖：24 格；已開的照領先者（平手 -1）、沒開的空著；剛開的那一格有 data-now；一家一色、三色不同，沒開與平手不是三色之一", () => {
  const bad = [], col = new Map(); let n0 = 0;
  for (const [n, s] of firstOf(P.A)) {
    if (n < 1 || n > 24) continue; n0++;
    const ks = s.cells.map((c) => c.k).sort((a, b) => a - b);
    if (ks.length !== 24 || ks.some((k, i) => k !== i)) { bad.push(`第 ${n} 個：地圖的格子是 ${JSON.stringify(ks)}`); break; }
    for (const c of s.cells) {
      const want = c.k < n ? String(F.leads[c.k]) : "";
      if (c.lead !== want) { bad.push(`第 ${n} 個：${COUNTIES[c.k][0]} data-lead=${JSON.stringify(c.lead)}，應是 ${JSON.stringify(want)}`); break; }
      if (c.now !== (c.k === n - 1)) { bad.push(`第 ${n} 個：${COUNTIES[c.k][0]} 的 data-now 是 ${c.now}`); break; }
      const key = c.lead === "" ? "u" : c.lead;
      if (!col.has(key)) col.set(key, new Set());
      col.get(key).add(c.colour);
    }
  }
  if (!n0) return "沒有看到任何開票中的畫面";
  for (const [k, s] of col) if (k !== "u" && k !== "-1" && s.size !== 1) bad.push(`${SEATS[k]} 的縣市有 ${s.size} 種顏色：${[...s].join("、")}`);
  const seatCol = ["0", "1", "2"].filter((k) => col.has(k)).map((k) => [...col.get(k)][0]);
  if (new Set(seatCol).size !== seatCol.length) bad.push(`三家的顏色有重複：${seatCol.join("、")}`);
  for (const k of ["u", "-1"]) if (col.has(k)) for (const c of col.get(k)) if (seatCol.includes(c)) bad.push(`${k === "u" ? "沒開的" : "平手的"}縣市用了某一家的顏色 ${c}`);
  return okm(!bad.length, bad.slice(0, 4).join("；") || `${n0} 個畫面的地圖都對（顏色：${seatCol.join("、")}${col.has("-1") ? "；有平手的縣市" : "；這一局沒有平手的縣市"}）`);
});
R0("剛開出的那一行：寫縣市名、它的領先者，在跑票領先換人的那一個縣市寫「反超」（英文 overtak），其他縣市不寫", () => {
  const bad = []; let n0 = 0, ov = 0;
  for (const k of ["A", "C"]) {
    const p = P[k], x = xOf(p), re = p.cfg.lang === "en" ? /overtak/i : /反超/;
    for (const [n, s] of firstOf(p)) {
      if (n < 1 || n > 24) continue; n0++;
      const c = n - 1, t = s.nowText, l = F.leads[c];
      if (!t.includes(x.county(c))) bad.push(`${p.cfg.name}「${t}」沒有 ${x.county(c)}`);
      if (l >= 0 && !(t.includes(x.short(l)) || t.includes(x.full(l)))) bad.push(`${p.cfg.name}「${t}」沒有領先者 ${x.full(l)}`);
      const want = F.overtakes.includes(c);
      if (want) ov++;
      if (re.test(t) !== want) bad.push(`${p.cfg.name}「${t}」${want ? "應寫" : "不該寫"}反超`);
    }
  }
  if (!n0) return "沒有看到任何開票中的畫面";
  if (!ov) return "看到的縣市裡沒有一個是反超的，分不出對錯";
  return okm(!bad.length, bad.slice(0, 4).join("；") || `${n0} 行都對（反超 ${ov} 次）`);
});
R0("速度：預設 24 縣 8–25 秒；換到更快之後每縣的時間 ≤ 換之前的 0.6 倍", () => {
  const m = firstOf(P.A), a = m.get(1), z = m.get(24);
  if (!a || !z) return "沒有看到第 1 或第 24 個";
  const total = (z.t - a.t) / 1000;
  if (!(total >= 8 && total <= 25)) return `預設速度 24 縣用了 ${total.toFixed(1)} 秒`;
  const c = P.C; if (!c.speedTapped) return "桌機的畫面上沒有 [data-count-speed]";
  if (c.speedAfter === c.speedBefore) return `點了速度，data-speed 還是 ${c.speedBefore}`;
  const mc = firstOf(c), ts = [...mc.entries()].filter(([n]) => n >= 1 && n <= 24).sort((x, y) => x[0] - y[0]);
  const gaps = (arr) => arr.slice(1).map((v, i) => v[1].t - arr[i][1].t);
  const before = gaps(ts.filter(([, s]) => s.t <= c.speedT)), after = gaps(ts.filter(([, s]) => s.t > c.speedT + 300));
  if (before.length < 3 || after.length < 3) return `換速前後的間隔不夠多（${before.length} / ${after.length}）`;
  const mean = (g) => g.reduce((x, y) => x + y, 0) / g.length, rb = mean(before), ra = mean(after);
  return okm(ra <= 0.6 * rb, `預設 24 縣 ${total.toFixed(1)} 秒；桌機 ${c.speedBefore} 每縣 ${(rb / 1000).toFixed(2)} 秒 → ${c.speedAfter} ${(ra / 1000).toFixed(2)} 秒`);
});
R0("跳到結果：1 秒內到快訊，數字是最後的結果", () => {
  const bad = [];
  for (const k of ["B", "D"]) {
    const p = P[k];
    if (!p.skipTapped) { bad.push(`${p.cfg.name}：畫面上沒有 [data-count-skip]`); continue; }
    const w = p.snaps.find((s) => s.stage === "win" && s.t >= p.skipT);
    if (!w || w.t - p.skipT > 1000) { bad.push(`${p.cfg.name}：點了 ${w ? ((w.t - p.skipT) / 1000).toFixed(1) + " 秒後" : "之後沒有"}才到快訊`); continue; }
    if (JSON.stringify(w.votes.map((v) => v && v.n)) !== JSON.stringify(F.votes)) bad.push(`${p.cfg.name}：快訊的票數 ${JSON.stringify(w.votes.map((v) => v && v.n))}`);
  }
  return okm(!bad.length, bad.join("；") || "兩次都在 1 秒內到快訊");
});
R0("快訊：勝者、他的結局圖、最後票數、各家領先的縣市數、整張地圖都開了、「看選後分析」在畫面上", () => {
  const bad = [];
  for (const k of ["A", "B", "C"]) {
    const p = P[k], s = p.win, x = xOf(p);
    if (!s) { bad.push(`${p.cfg.name}：沒有到快訊`); continue; }
    if (s.winner !== SEATS[W] || !s.winnerText.includes(x.full(W))) bad.push(`${p.cfg.name}：勝者 ${s.winner}「${s.winnerText}」`);
    if (!s.imgs.some((i) => i.src.includes(`art/end/${SEATS[W]}.webp`) && i.ok)) bad.push(`${p.cfg.name}：沒有載入 art/end/${SEATS[W]}.webp`);
    if (JSON.stringify(s.votes.map((v) => v && v.n)) !== JSON.stringify(F.votes)) bad.push(`${p.cfg.name}：票數 ${JSON.stringify(s.votes.map((v) => v && v.n))}`);
    if (JSON.stringify(s.led) !== JSON.stringify(F.led)) bad.push(`${p.cfg.name}：領先縣市 ${JSON.stringify(s.led)}，應是 ${JSON.stringify(F.led)}`);
    const wrong = s.cells.filter((c) => c.lead !== String(F.leads[c.k]));
    if (s.cells.length !== 24 || wrong.length) bad.push(`${p.cfg.name}：地圖 ${s.cells.length} 格，${wrong.length} 格不對`);
    if (!p.winLayout || !p.winLayout.inside || !p.winLayout.hit) bad.push(`${p.cfg.name}：「看選後分析」${p.winLayout ? "不在畫面上或被蓋住" : "沒有"}`);
  }
  return okm(!bad.length, bad.slice(0, 4).join("；") || `三次都是 ${X.zh.full(W)}，${F.votes.join("/")}，縣市 ${F.led.join("/")}`);
});
R0("看選後分析：2 秒內到結局頁，開票夜收起來", () => {
  const bad = [];
  for (const k of ["A", "B", "C"]) {
    const p = P[k];
    if (!p.nextTapped) { bad.push(`${p.cfg.name}：沒有點到 [data-count-next]`); continue; }
    if (!p.after || p.after.stage || !p.after.end || p.afterMs > 2000) bad.push(`${p.cfg.name}：${p.after && p.after.stage ? "開票夜還在" : "沒有結局頁"}（${p.afterMs} ms）`);
  }
  return okm(!bad.length, bad.join("；") || "三次都到結局頁");
});
R0("英文：開場、開票、快訊都沒有中文字", () => {
  const p = P.B, bad = [];
  for (const s of p.snaps.filter((x) => x && x.stage)) { const m = s.text.match(CJK); if (m) { bad.push(`${s.stage}：「${s.text.slice(Math.max(0, s.text.indexOf(m[0]) - 10), s.text.indexOf(m[0]) + 10).replace(/\s+/g, " ")}」`); if (bad.length > 2) break; } }
  const n = p.snaps.filter((x) => x && x.stage).length;
  if (!n) return "沒有英文的畫面";
  return okm(!bad.length, bad.join("；") || `${n} 個英文畫面沒有中文字`);
});
R0("圖：開票夜裡的圖都載入了，開票時有主播台（art/news/studio.webp）", () => {
  const bad = [];
  for (const k of ["A", "C"]) {
    const p = P[k], all = p.snaps.filter((s) => s && s.stage).flatMap((s) => s.imgs.map((i) => ({ ...i, stage: s.stage })));
    const broken = [...new Set(all.map((i) => i.src))].filter((src) => !all.some((i) => i.src === src && i.ok));
    if (broken.length) bad.push(`${p.cfg.name}：沒有載入 ${broken.join("、")}`);
    const t = tally(p).filter((s) => s.done >= 2);
    if (!t.length || !t.every((s) => s.imgs.some((i) => i.src.includes("art/news/studio"))) || !t.some((s) => s.imgs.some((i) => i.src.includes("art/news/studio") && i.ok))) bad.push(`${p.cfg.name}：開票時沒有主播台`);
  }
  return okm(!bad.length, bad.join("；") || "都載入了");
});
const layoutRow = (p, minMap, desk) => {
  const L = p.layout; if (!L) return `${p.cfg.name}：沒有量到版面（第 ${p.cfg.layoutAt} 個縣市開出時）`;
  const bad = [];
  if (L.page.sw > L.page.vw + 1) bad.push(`可以左右捲（${L.page.sw} > ${L.page.vw}）`);
  if (desk && (!L.root.inside || L.root.over)) bad.push(`開票夜一個畫面裝不下（${L.root.over ? `裡面要捲 ${L.root.over}` : `外框 ${JSON.stringify(L.root.r)}`}）`);
  for (const k of ["now", "done", "map", "skip", "speed", "chen", "soong", "lien"]) { const e = L[k]; if (!e.r) bad.push(`沒有 ${k}`); else if (!e.inside) bad.push(`${k} 不在畫面裡（${JSON.stringify(e.r)}）`); else if (!e.hit) bad.push(`${k} 被蓋住`); }
  if (L.nowCut) bad.push(`剛開出的那一行：${L.nowCut}`);
  if (L.map.r && (L.map.r.w < minMap[0] || L.map.r.h < minMap[1])) bad.push(`地圖 ${L.map.r.w}×${L.map.r.h}，小於 ${minMap.join("×")}`);
  if (desk && (!L.studio.r || L.studio.r.w < 700 || L.studio.r.h < 390 || !L.studio.inside)) bad.push(`主播台 ${L.studio.r ? `${L.studio.r.w}×${L.studio.r.h}` : "沒有"}`);
  return bad.length ? `${p.cfg.name}：${bad.join("；")}` : null;
};
R0("版面・手機：390×844 中英、360×740，不左右捲；剛開的一行、三家、開出數、地圖、跳過、速度都在畫面上沒被蓋；那一行沒被切；地圖夠大", () => {
  const bad = [layoutRow(P.A, [230, 330]), layoutRow(P.B, [230, 330]), layoutRow(P.D, [200, 285])].filter(Boolean);
  return okm(!bad.length, bad.join("；") || ["A", "B", "D"].map((k) => `${P[k].cfg.name} 地圖 ${P[k].layout.map.r.w}×${P[k].layout.map.r.h}`).join("、"));
});
R0("版面・桌機 1280×800：開票夜一個畫面裝得下；同樣都在畫面上；地圖 ≥ 260×370；主播台 ≥ 700×390", () => {
  const b = layoutRow(P.C, [260, 370], true);
  return okm(!b, b || `地圖 ${P.C.layout.map.r.w}×${P.C.layout.map.r.h}、主播台 ${P.C.layout.studio.r.w}×${P.C.layout.studio.r.h}`);
});
row("打開時已經結束的局：直接是結局頁，有「重看開票」，點了從開場重播", () => {
  const e = P.E;
  if (e.err) return e.err;
  if (todo) return `TODO: ${todo.todo}`;
  if (!e.first) return "量不到畫面";
  if (e.first.stage) return `打開就是開票夜（${e.first.stage}），應直接是結局頁`;
  if (!e.first.end) return "沒有結局頁";
  if (!e.first.replay || !e.replayTapped) return "結局頁沒有 [data-count-replay]";
  return okm(e.after && e.after.stage === "open" && e.ms <= 1500, e.after && e.after.stage ? `點了之後 ${e.ms} ms 到 ${e.after.stage}` : `點了之後 ${e.ms} ms 沒有開票夜`);
});

let bad = 0, pend = 0;
for (const r of rows) { if (r.todo) pend++; else if (!r.ok) bad++; console.log(`${r.todo ? "…" : r.ok ? "✓" : "✗"} ${r.name}${r.todo ? " — " + r.todo : r.msg ? " — " + r.msg : ""}`); }
console.log(`${bad ? "FAIL" : pend ? "TODO" : "PASS"}: ${rows.length - bad - pend} pass, ${bad} fail, ${pend} 尚未實作 (seed ${G.seed})`);
process.exit(bad ? 1 : 0);
