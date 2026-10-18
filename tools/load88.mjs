// tools/load88.mjs — the page loads fast on a phone and holds together on iOS 15 (#88). Orchestrator's instrument: a peer may
// run it, does not edit it. About 2 min.
//
//   node tools/load88.mjs <base url, e.g. http://localhost:8814>     (the dev server of this very tree)
//
// Owner, 2026-10-18: 「請打磨此遊戲，直到其具有商業價值」, 「先免費網頁上線」. The orchestrator's #88, from the technical audit of
// the same day (fonts 2.2 MB before the first table, home FCP 2.8 s on a phone, the table broken on iOS 15). Everything runs
// in headless Chrome over CDP, each load on a browser of its own (a new --user-data-dir: a cold cache, no open connection).
// The phone is 390×844, mobile, DPR 3, touch, an Android Chrome user agent; the desk is 1440×900 at DPR 1. The loads of L1,
// L2 and L4 are throttled to Slow 4G (1.6 Mbps down, 750 kbps up, 150 ms RTT) with the CPU 4× slower, three loads each, and
// the median counts. "?play with a game saved" is a solo game at the human's first decision, put in the page's sessionStorage
// (p2000.solo.session) before the load, its turn card not yet seen. "The table drawn" is the first frame (or 16 ms check) in
// which a county of the map (.tw-c) has a box on the screen. Rows (they set the exit code):
//   - L1: the font bytes a load of ?play (a game saved) asks for until the table is drawn: requests sent up to 1 s after it,
//     each counted whole as it came over the wire; woff2 / woff / ttf / otf (or CDP type Font) and the Google Fonts stylesheet.
//     Median ≤ 600 KB;
//   - L2: the home page's FCP ≤ 2.0 s; ?play (a game saved): FCP ≤ 2.0 s and the table drawn ≤ 3.0 s (medians, from the
//     navigation);
//   - L3: index.html as the server sends it has, inside its <head>, an inline <style> that gives html or body a background
//     that is not white (a channel under 240, alpha ≥ 0.5), computed in Chrome from those <style>s alone: an external
//     stylesheet does not count;
//   - L4: from the navigation until the table is drawn, no button of the home page (#play 「單人開打」 / "Play solo",
//     #tutorial, #host, #join, or any link or button with that text) is drawn: checked every 16 ms and at every frame (before
//     the frame's paint); a frame's check always counts (Chrome runs no frame while the page is render-blocked), a 16 ms
//     check from the first paint on (read from the paint timeline). None of the three loads may draw one.
//     ?play (a game saved), and ?room=CODE: a room this instrument opens on the server (seat 0 taken, started at level 1,
//     its token kept in sessionStorage as roompage.js keeps it);
//   - L5: every picture under /president_2000/art/ (each image file in public/art, fetched from the server) answers with a
//     Cache-Control max-age ≥ 86400 (no-store / no-cache count as 0); so does every font this server sends (each font file
//     in public/, and any font the loads got from this origin). With no font of its own the row says so and passes;
//   - L6: the first table (?play, a game saved: seat 0, seed 2024; looked at once it is drawn and 4 s later, so the turn card
//     and the handoff card are in it), not throttled, phone 390 @3x and desk 1440 @1x:
//     every <img> on the screen has a file at most 2.5 × as wide as it is drawn (CSS width × devicePixelRatio). The file's
//     own width, read from the file: a srcset w descriptor does not make it smaller. SVG is left out;
//   - L7: iOS 15, simulated the way the audit's compat.mjs did it: every same-origin stylesheet and inline <style> is re-read
//     as Safari 15.0 (no :has(), no container queries or cq units, no dvh / svh / lvh, no :focus-visible, no @layer) or
//     Safari 15.4 (no container queries or cq units) would read it, and put in place of the original: a rule whose selector
//     it cannot read goes whole, a declaration it cannot read goes, @supports is decided as that Safari would, range media
//     queries and nested rules go. Then on a phone 390×664, the table at 「選牌」 (the human picks a card) and at 「放塊」 (the
//     human places cubes in a campaign): the page does not scroll (scrollHeight ≤ innerHeight + 1); at least one hand card
//     (.t-hand .hc) has its top on the screen; the map frame (.tw-box) starts no higher than the bottom of the rows above it
//     (.t-top, .t-players, .t-track: the headlines), 1 px allowed. The same three in plain Chrome are printed as a control,
//     not counted.
// The iOS rows simulate the parser only: they are not a real iPhone, and no other Safari difference is in them.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as S from "../public/solo.js";
import * as E from "../public/shared/engine.js";
import * as B from "../public/shared/bots.js";

const base = process.argv[2];
if (!base) { console.log("usage: node tools/load88.mjs <base url>"); process.exit(2); }
const URL0 = /\/president_2000\/?$/.test(base) ? base.replace(/\/?$/, "/") : base.replace(/\/+$/, "") + "/president_2000/";
const ORIGIN = new URL(URL0).origin;
const PUBLIC = fileURLToPath(new URL("../public/", import.meta.url));
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- the contract's numbers
const RUNS = 3;
const SLOW4G = { offline: false, latency: 150, downloadThroughput: 1.6e6 / 8, uploadThroughput: 750e3 / 8 };
const CPU = 4;
const PHONE = { w: 390, h: 844, dpr: 3, mobile: true }, DESK = { w: 1440, h: 900, dpr: 1, mobile: false }, SHORT = { w: 390, h: 664, dpr: 3, mobile: true };
const FONT_KB = 600, FONT_GRACE = 1000;
const FCP_HOME = 2000, FCP_TABLE = 2000, TABLE_AT = 3000; // 3.0 s, not 3.5 (orchestrator, #88): at 3.5 main passed 3 of 10 medians; main's fastest load 3,278 ms, the probe without web fonts 2,404–2,722
const MAX_AGE = 86400;
const IMG_X = 2.5;
const KEY = "p2000.solo.session";

const out = [];
const rule = (ok, what) => out.push({ ok, what });
const note = [];
const kb = (b) => Math.round(b / 1024).toLocaleString("en-US");
const ms = (x) => (x == null ? "—" : Math.round(x).toLocaleString("en-US"));
const median = (a) => { const s = a.filter((x) => x != null).sort((x, y) => x - y); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const header = (h, k) => { for (const [n, v] of Object.entries(h || {})) if (n.toLowerCase() === k) return String(v); return ""; };
const maxAge = (cc) => { if (!cc || /no-store|no-cache/i.test(cc)) return 0; const m = /(?:^|[,\s])max-age\s*=\s*"?(\d+)/i.exec(cc); return m ? Number(m[1]) : 0; };
const isFontUrl = (u) => { try { const x = new URL(u); return /\.(woff2?|ttf|otf)$/i.test(x.pathname) || x.host === "fonts.googleapis.com" || x.host === "fonts.gstatic.com"; } catch { return false; } };

// ---- Chrome: one per load, killed at the end; nothing left running if this script dies
const LIVE = new Set();
process.on("exit", () => { for (const p of LIVE) { try { p.kill(); } catch { /* gone */ } } });
let launches = 0;
async function launch() {
  const root = process.env.TEMP || "/tmp", dir = `${root}/load88_${process.pid}_${Date.now()}_${++launches}`;
  for (const old of readdirSync(root).filter((d) => d.startsWith("load88_"))) { try { if (Date.now() - statSync(`${root}/${old}`).mtimeMs > 900000) rmSync(`${root}/${old}`, { recursive: true, force: true }); } catch { /* in use */ } }
  mkdirSync(dir, { recursive: true });
  const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--mute-audio", "--no-first-run", "--no-default-browser-check",
    "--disable-extensions", "--disable-component-update", "--disable-background-networking", "--disable-sync", "--disable-default-apps",
    "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows",
    "--remote-debugging-port=0", `--user-data-dir=${dir}`, "about:blank"], { stdio: "ignore" });
  LIVE.add(proc); proc.on("exit", () => LIVE.delete(proc));
  let port = 0;
  for (let i = 0; i < 150 && !port; i++) { try { port = Number.parseInt(readFileSync(`${dir}/DevToolsActivePort`, "utf8"), 10) || 0; } catch { /* starting */ } if (!port) await sleep(100); }
  let ver = null;
  for (let i = 0; i < 60 && !ver; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) ver = await r.json(); } catch { /* starting */ } if (!ver) await sleep(200); }
  if (!ver) throw new Error("Chrome did not start");
  const ua = ver["User-Agent"].replace("HeadlessChrome", "Chrome"), major = (/Chrome\/(\d+)/.exec(ua) || [0, "155"])[1];
  const close = async () => {
    try { const ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; }); ws.send(JSON.stringify({ id: 1, method: "Browser.close" })); } catch { /* gone */ }
    for (let i = 0; i < 50 && LIVE.has(proc); i++) await sleep(100);
    if (LIVE.has(proc)) { try { proc.kill(); } catch { /* gone */ } await sleep(500); }
    for (let i = 0; i < 6; i++) { try { rmSync(dir, { recursive: true, force: true }); break; } catch { await sleep(400); } }
  };
  return { port, ua, phoneUa: `Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Mobile Safari/537.36`, close };
}
async function tab(br, dev) {
  const t = await (await fetch(`http://127.0.0.1:${br.port}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pend = new Map(), lis = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); if (m.error) p.rej(new Error(`${p.method}: ${m.error.message}`)); else p.res(m.result || {}); return; }
    if (m.method) for (const fn of lis.get(m.method) || []) fn(m.params);
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { method, res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  const on = (m, fn) => { if (!lis.has(m)) lis.set(m, []); lis.get(m).push(fn); };
  const ev = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error("in the page: " + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
    return r.result ? r.result.value : undefined;
  };
  await send("Page.enable"); await send("Network.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: dev.w, height: dev.h, deviceScaleFactor: dev.dpr, mobile: dev.mobile });
  if (dev.mobile) await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await send("Emulation.setUserAgentOverride", { userAgent: dev.mobile ? br.phoneUa : br.ua });
  // A page of this origin to write sessionStorage into: the favicon (its cache is cleared before a timed load).
  const prime = async (store) => {
    let loaded; const p = new Promise((r) => { loaded = r; }); on("Page.loadEventFired", () => loaded());
    await send("Page.navigate", { url: URL0 + "favicon.svg" }); await Promise.race([p, sleep(5000)]);
    for (const [k, v] of Object.entries(store || {})) await ev(`(() => { sessionStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(JSON.stringify(v))}); return 1; })()`);
  };
  const waitTable = async (limit = 20000) => { const end = Date.now() + limit; while (Date.now() < end) { if (await ev(TABLE_NOW).catch(() => false)) return true; await sleep(100); } return false; };
  return { send, on, ev, prime, waitTable, close: async () => { try { await fetch(`http://127.0.0.1:${br.port}/json/close/${t.id}`); } catch { /* closed */ } try { ws.close(); } catch { /* closed */ } } };
}
const TABLE_NOW = `(() => { const c = document.querySelector(".tw-c"); if (!c) return false; const r = c.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth; })()`;

// ---- in the page, from the moment the document exists (L2, L4): the paints, the table, the home page's buttons
function sampler() {
  if (window.top !== window) return;
  const P = (window.__l88 = { tableIn: null, tableAt: null, land: [], frames: [], n: 0 });
  const IDS = ["play", "tutorial", "host", "join"], RX = /單人開打|Play solo/i;
  let dirty = true, byText = [];
  const mo = new MutationObserver(() => { dirty = true; if (P.tableIn == null && document.querySelector(".tw-c")) P.tableIn = performance.now(); });
  mo.observe(document, { childList: true, subtree: true, characterData: true });
  const onScreen = (e) => {
    if (!e || !e.isConnected) return false;
    if (e.checkVisibility && !e.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
  };
  const home = () => {
    if (dirty) { dirty = false; byText = [...document.querySelectorAll("a, button")].filter((e) => RX.test(e.textContent || "")); }
    for (const id of IDS) { const e = document.getElementById(id); if (e && onScreen(e)) return "#" + id; }
    for (const e of byText) if (onScreen(e)) return "「" + (e.textContent || "").trim().slice(0, 10) + "」";
    return null;
  };
  const table = () => { const c = document.querySelector(".tw-c"); return !!c && onScreen(c); };
  let iv = 0;
  const sample = (via) => {
    if (P.tableAt != null) return;
    const t = performance.now(), h = home();
    P.n++;
    if (via === "f") P.frames.push([Math.round(t), h ? 1 : 0]);
    if (h) P.land.push([Math.round(t), via, h]);
    if (table()) { P.tableAt = t; mo.disconnect(); clearInterval(iv); }
  };
  iv = setInterval(() => sample("t"), 16);
  const frame = () => { if (P.tableAt != null) return; sample("f"); requestAnimationFrame(frame); };
  requestAnimationFrame(frame);
}
// The paint entries are read from the timeline: a busy main thread hands them out late (the table's first load is one long
// task), so a reader waits for them rather than taking an observer's word at the moment the table shows.
const PAINTS = `JSON.stringify(Object.fromEntries(performance.getEntriesByType("paint").map((e) => [e.name, e.startTime])))`;
// The home buttons drawn: a frame check always counts (Chrome runs no frame while the page is render-blocked, so every frame
// is painted: the first one is the first paint, which comes out up to half a second later on this CPU), a 16 ms check from
// the first paint on.
function landDrawn(P) {
  const fp = P.fp != null ? P.fp : P.fcp;
  if (fp == null) return { list: P.land, fp }; // no paint known: every check counts
  return { list: P.land.filter(([t, via]) => via === "f" || t >= fp), fp };
}

// ---- games to put in the page (this tree's own engine)
function firstTable(seat, seed) { return S.advance(S.newSolo({ seat, level: 2, seed })); }
function stateAt(kind, seat, seed) {
  let s = firstTable(seat, seed);
  for (let n = 0; n < 400 && s.st.phase !== "end"; n++) {
    if (S.botsToMove(s).length) { s = S.advance(s); continue; }
    const st = s.st, pd = st.pending, legal = E.legalMoves(st, seat);
    const pick = st.phase === "action" && !pd && legal.some((m) => m.type === "play") && legal.length > 1;
    const place = st.phase === "action" && !!pd && pd.stage === "campaign" && legal.filter((m) => m.type === "fill" || m.type === "cross").length >= 2;
    if (kind === "pick" && pick) return s;
    if (kind === "place" && place) return s;
    let m = null;
    if (kind === "place" && pick) {
      for (const c of legal.filter((x) => x.type === "play" && x.mode === "cp" && !x.block)) {
        const t = S.advance(S.act(s, c));
        if (t.st.pending && t.st.pending.stage === "kind" && E.mustAct(t.st).includes(seat)) { m = c; break; }
      }
    } else if (pd && pd.stage === "kind") m = legal.find((x) => x.kind === "campaign") || null;
    if (!m) m = B.advise(E.view(st, seat), legal).move;
    s = S.act(s, m);
  }
  throw new Error(`no ${kind} position for seat ${seat}, seed ${seed}`);
}

// ---- a room on this server (L4): seat 0 taken, started at level 1
async function openRoom() {
  const url = URL0.replace(/^http/, "ws") + "ws?create=1&name=L88&lang=zh-Hant";
  return new Promise((res, rej) => {
    const ws = new WebSocket(url);
    let token = null, code = null, sat = false, started = false;
    const to = setTimeout(() => { try { ws.close(); } catch { /* closed */ } rej(new Error("no started room within 20 s")); }, 20000);
    ws.onerror = () => { clearTimeout(to); rej(new Error("the room WebSocket failed")); };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.t === "error") { clearTimeout(to); try { ws.close(); } catch { /* closed */ } rej(new Error("room error " + m.code)); return; }
      if (m.t === "hello") token = m.token;
      if (m.t === "room" && m.code) code = code || m.code;
      if (m.t === "hello" && m.seat === 0 && !started) { started = true; ws.send(JSON.stringify({ t: "start", level: 1 })); return; }
      if (token && code && !sat) { sat = true; ws.send(JSON.stringify({ t: "sit", seat: 0 })); return; }
      if (m.t === "state" && started) { clearTimeout(to); setTimeout(() => { try { ws.close(); } catch { /* closed */ } res({ code, token }); }, 300); }
    };
  });
}

// ---- one throttled load on a browser of its own (L1, L2, L4)
async function timedLoad(kind, i, room) {
  const br = await launch();
  try {
    const t = await tab(br, PHONE);
    const reqs = new Map();
    t.on("Network.requestWillBeSent", (p) => { if (!reqs.has(p.requestId)) reqs.set(p.requestId, { url: p.request.url, wall: p.wallTime * 1000, t0: p.timestamp, type: p.type }); });
    t.on("Network.responseReceived", (p) => { const r = reqs.get(p.requestId); if (r) { r.type = p.type || r.type; r.cc = header(p.response.headers, "cache-control"); r.status = p.response.status; } });
    t.on("Network.loadingFinished", (p) => { const r = reqs.get(p.requestId); if (r) { r.bytes = p.encodedDataLength; r.t1 = p.timestamp; r.done = true; } });
    t.on("Network.loadingFailed", (p) => { const r = reqs.get(p.requestId); if (r) { r.failed = p.errorText; r.done = true; } });
    const store = kind === "play" ? { [KEY]: firstTable(i % 3, 4242 + i) } : kind === "room" ? { ["p2000.room." + room.code]: { token: room.token, name: "L88" } } : {};
    await t.prime(store);
    await t.send("Network.clearBrowserCache");
    await t.send("Page.addScriptToEvaluateOnNewDocument", { source: `(${sampler})();` });
    await t.send("Network.emulateNetworkConditions", SLOW4G);
    await t.send("Emulation.setCPUThrottlingRate", { rate: CPU });
    reqs.clear();
    const url = kind === "home" ? URL0 : kind === "play" ? URL0 + "?play" : URL0 + "?room=" + room.code;
    await t.send("Page.navigate", { url });
    const GET = `window.__l88 ? JSON.stringify({ ...window.__l88, origin: performance.timeOrigin, paint: ${PAINTS} }) : null`;
    let P = null;
    for (const end = Date.now() + 45000; Date.now() < end;) {
      await sleep(250);
      const s = await t.ev(GET).catch(() => null);
      if (s) { P = JSON.parse(s); P.paint = JSON.parse(P.paint); P.fcp = P.paint["first-contentful-paint"] ?? null; P.fp = P.paint["first-paint"] ?? P.fcp; }
      if (P && P.fcp != null && (kind === "home" || P.tableAt != null)) break;
    }
    if (!P) return { err: "the page never ran the sampler" };
    let fonts = null;
    if (kind === "play" && P.tableAt != null) {
      const cut = P.origin + P.tableAt + FONT_GRACE;
      await sleep(FONT_GRACE + 300);
      const mine = () => [...reqs.values()].filter((r) => r.wall <= cut && (r.type === "Font" || isFontUrl(r.url)));
      for (const end = Date.now() + 90000; Date.now() < end && mine().some((r) => !r.done);) await sleep(250);
      const list = mine();
      fonts = { bytes: list.reduce((a, r) => a + (r.bytes || 0), 0), n: list.length, css: list.filter((r) => /fonts\.googleapis\.com/.test(r.url)).reduce((a, r) => a + (r.bytes || 0), 0), open: list.filter((r) => !r.done).length };
    }
    const own = [...reqs.values()].filter((r) => r.url.startsWith(ORIGIN) && (r.type === "Font" || isFontUrl(r.url))).map((r) => ({ url: r.url, cc: r.cc || "" }));
    // When each stylesheet came in, from the document's request (to tell a slow network from a slow page).
    const doc = [...reqs.values()].find((r) => r.type === "Document");
    const css = doc ? [...reqs.values()].filter((r) => r.type === "Stylesheet" && r.t1).map((r) => `${new URL(r.url).host === new URL(ORIGIN).host ? new URL(r.url).pathname.split("/").pop() : new URL(r.url).host} ${ms((r.t1 - doc.t0) * 1000)}`) : [];
    await t.close();
    return { P, fonts, own, css, land: landDrawn(P) };
  } finally { await br.close(); }
}

// ---- L7: the stylesheet as Safari 15 would read it (runs in the page, with Chrome's CSS.supports for what that Safari has)
function compatCss(src, prof, sup) {
  const css = src.replace(/\/\*[\s\S]*?\*\//g, "");
  const stats = { rules: 0, decls: 0, blocks: 0, nested: 0 };
  const RANGE = /\(\s*[a-z-]+\s*[<>=]|[<>=]=?\s*[a-z-]+\s*\)/i;
  const skipStr = (s, i) => { const q = s[i]; i++; while (i < s.length && s[i] !== q) { if (s[i] === "\\") i++; i++; } return i + 1; };
  function block(s, i0, end) {
    const items = []; let i = i0;
    while (i < end) {
      while (i < end && /\s/.test(s[i])) i++;
      if (i >= end) break;
      let j = i, depth = 0;
      while (j < end) {
        const c = s[j];
        if (c === "\"" || c === "'") { j = skipStr(s, j); continue; }
        if (c === "(") depth++; else if (c === ")") depth--; else if (depth <= 0 && (c === "{" || c === ";")) break;
        j++;
      }
      const pre = s.slice(i, Math.min(j, end)).trim();
      if (j >= end) { if (pre) items.push({ t: "stmt", text: pre }); break; }
      if (s[j] === ";") { if (pre) items.push({ t: "stmt", text: pre + ";" }); i = j + 1; continue; }
      let k = j + 1, d = 1;
      while (k < end && d) { const c = s[k]; if (c === "\"" || c === "'") { k = skipStr(s, k); continue; } if (c === "{") d++; else if (c === "}") d--; k++; }
      if (/^@(media|supports|layer|container|scope|document)\b/i.test(pre)) items.push({ t: "at", head: pre, items: block(s, j + 1, k - 1) });
      else items.push({ t: "rule", sel: pre, body: s.slice(j + 1, k - 1) });
      i = k;
    }
    return items;
  }
  const selBad = (sel) => (prof.noHas && /:has\(/i.test(sel)) || (prof.noFV && /:focus-visible/i.test(sel));
  const declBad = (d) =>
    (prof.noCQ && (/\d(cqw|cqh|cqi|cqb|cqmin|cqmax)\b/i.test(d) || /^\s*container(-type|-name)?\s*:/i.test(d))) ||
    (prof.noDVH && /\d(dvh|svh|lvh|dvw|svw|lvw|dvi|svi|lvi|dvb|svb|lvb|dvmin|dvmax|svmin|svmax|lvmin|lvmax)\b/i.test(d));
  function supOK(cond) {
    const s = cond.trim(); let i = 0;
    const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
    const group = () => { let j = i, d = 0; for (; j < s.length; j++) { if (s[j] === "(") d++; else if (s[j] === ")") { d--; if (!d) break; } } const text = s.slice(i, j + 1); i = j + 1; return text; };
    const leaf = () => {
      ws();
      if (/^not\b/i.test(s.slice(i))) { i += 3; return !leaf(); }
      const fn = /^([a-z-]+)\(/i.exec(s.slice(i));
      if (fn) { const text = group(); const inner = text.slice(fn[1].length + 1, -1); if (/^selector$/i.test(fn[1]) && selBad(inner)) return false; try { return sup(text); } catch { return false; } }
      if (s[i] !== "(") { i = s.length; return false; }
      const inner = group().slice(1, -1).trim();
      if (inner.startsWith("(") || /^not\b/i.test(inner) || /^[a-z-]+\(/i.test(inner)) return supOK(inner);
      if (declBad(inner)) return false;
      try { return sup("(" + inner + ")"); } catch { return false; }
    };
    let v = leaf();
    for (;;) { ws(); const m = /^(and|or)\b/i.exec(s.slice(i)); if (!m) break; i += m[1].length; const w = leaf(); v = m[1].toLowerCase() === "and" ? v && w : v || w; }
    return v;
  }
  function emit(items) {
    let o = "";
    for (const it of items) {
      if (it.t === "stmt") { if (!(prof.noLayer && /^@layer/i.test(it.text))) o += it.text + "\n"; continue; }
      if (it.t === "at") {
        const h = it.head;
        if ((prof.noCQ && /^@container/i.test(h)) || (prof.noLayer && /^@layer/i.test(h)) || (prof.noRange && /^@media/i.test(h) && RANGE.test(h))) { stats.blocks++; continue; }
        if (/^@supports/i.test(h)) { if (supOK(h.replace(/^@supports/i, ""))) o += emit(it.items); else stats.blocks++; continue; }
        o += h + " {\n" + emit(it.items) + "}\n"; continue;
      }
      if (it.sel.startsWith("@")) { o += it.sel + " {" + it.body + "}\n"; continue; }
      if (selBad(it.sel)) { stats.rules++; continue; }
      const keep = [];
      for (const p of block(it.body, 0, it.body.length)) {
        if (p.t !== "stmt") { stats.nested++; continue; }
        const d = p.text.replace(/;\s*$/, "");
        if (declBad(d)) { stats.decls++; continue; }
        keep.push(d);
      }
      o += it.sel + " {" + keep.join(";") + "}\n";
    }
    return o;
  }
  return { css: emit(block(css, 0, css.length)), stats };
}
const PROFILES = {
  "safari15.0": { noCQ: true, noHas: true, noDVH: true, noFV: true, noLayer: true, noRange: true },
  "safari15.4": { noCQ: true, noRange: true },
};
async function injectCompat(prof) {
  const n = { sheets: 0, rules: 0, decls: 0, blocks: 0, nested: 0 };
  const fix = (text) => { const r = window.__l88css(text, prof, (c) => CSS.supports(c)); for (const k of ["rules", "decls", "blocks", "nested"]) n[k] += r.stats[k]; n.sheets++; return r.css; };
  for (const l of [...document.querySelectorAll("link[rel~=stylesheet]")]) {
    if (l.disabled) continue;
    const u = new URL(l.href, location.href);
    if (u.origin !== location.origin) continue;
    const text = await (await fetch(u.href)).text();
    const st = document.createElement("style"); st.dataset.l88 = "1"; if (l.media) st.media = l.media;
    st.textContent = fix(text);
    l.after(st); l.disabled = true;
  }
  for (const s of [...document.querySelectorAll("style:not([data-l88])")]) { s.textContent = fix(s.textContent); s.dataset.l88 = "1"; }
  window.dispatchEvent(new Event("resize"));
  return JSON.stringify(n);
}
function look() {
  scrollTo(0, 0);
  const R = (e) => { const r = e.getBoundingClientRect(); return { t: Math.round(r.top), b: Math.round(r.bottom), l: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) }; };
  const vis = (e) => !!e && e.getClientRects().length > 0 && (!e.checkVisibility || e.checkVisibility({ visibilityProperty: true }));
  const sh = Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0);
  const cards = [...document.querySelectorAll(".t-hand .hc")].filter(vis).map(R);
  const map = document.querySelector(".tw-box");
  const rows = [...document.querySelectorAll(".tbl .t-top, .tbl .t-players, .tbl .t-track")].filter(vis).map((e) => ({ c: [...e.classList].find((c) => c.startsWith("t-")) || e.className, ...R(e) }));
  return JSON.stringify({ sh, ih: innerHeight, cards, map: vis(map) ? R(map) : null, rows });
}

// ---- L6: the pictures on the screen, with the width of their files
async function pictures() {
  const want = [...document.images].filter((i) => i.currentSrc && !/\.svg(\?|#|$)/i.test(i.currentSrc));
  const end = performance.now() + 6000;
  const onScreen = (i) => { if (i.checkVisibility && !i.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false; const r = i.getBoundingClientRect(); return r.width >= 1 && r.height >= 1 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth; };
  while (performance.now() < end && want.some((i) => onScreen(i) && !i.complete)) await new Promise((r) => setTimeout(r, 100));
  const fileW = {}, list = [];
  for (const i of want) {
    if (!onScreen(i) || !i.complete || !i.naturalWidth) continue;
    const src = i.currentSrc;
    if (!(src in fileW)) { const im = new Image(); im.src = src; try { await im.decode(); } catch { /* unreadable */ } fileW[src] = im.naturalWidth || i.naturalWidth; }
    const r = i.getBoundingClientRect(), use = i.closest("[class]");
    list.push({ src: src.replace(/^.*\/president_2000\//, ""), file: fileW[src], w: Math.round(r.width * 10) / 10, dpr: devicePixelRatio, at: use && use !== i ? (use.className.baseVal != null ? use.className.baseVal : use.className).split(" ")[0] : (i.className || "") });
  }
  return JSON.stringify(list);
}

// =================================================================================================== the run
console.log(`load88 against ${URL0}`);

// ---- L3: the inline background in <head>
const html = await (await fetch(URL0)).text();
const head = (/<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(html) || [])[1] || "";
const styleTags = [...head.matchAll(/<style\b[^>]*>[\s\S]*?<\/style>/gi)].map((m) => m[0]);

// ---- L5: the cache headers of every picture under art/ and every font file of this tree
const walk = (dir, rel = "") => readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(`${dir}/${d.name}`, `${rel}${d.name}/`) : [`${rel}${d.name}`]));
const artFiles = walk(PUBLIC + "art").filter((f) => /\.(webp|png|jpe?g|gif|avif|svg)$/i.test(f)).map((f) => URL0 + "art/" + f.split("/").map(encodeURIComponent).join("/"));
const fontFiles = walk(PUBLIC.replace(/[\\/]$/, "")).filter((f) => /\.(woff2?|ttf|otf)$/i.test(f)).map((f) => URL0 + f.split("/").map(encodeURIComponent).join("/"));
async function heads(urls) {
  const res = []; let k = 0;
  await Promise.all(Array.from({ length: 8 }, async () => { while (k < urls.length) { const u = urls[k++]; try { const r = await fetch(u); await r.arrayBuffer(); res.push({ url: u, status: r.status, cc: r.headers.get("cache-control") || "" }); } catch (e) { res.push({ url: u, status: 0, cc: "", err: e.message }); } } }));
  return res;
}
const artHeads = await heads(artFiles), fontHeads = await heads(fontFiles);

// ---- L1, L2, L4: the throttled loads
const runs = { home: [], play: [], room: [] };
for (let i = 0; i < RUNS; i++) { runs.home.push(await timedLoad("home", i)); }
for (let i = 0; i < RUNS; i++) { runs.play.push(await timedLoad("play", i)); }
let room = null, roomErr = null;
try { room = await openRoom(); } catch (e) { roomErr = e.message; }
if (room) for (let i = 0; i < RUNS; i++) { runs.room.push(await timedLoad("room", i, room)); }
for (const [k, list] of Object.entries(runs)) for (const [i, r] of list.entries()) note.push(`  ${k} load ${i + 1}: FCP ${ms(r.P && r.P.fcp)} ms, first paint ${ms(r.P && r.P.fp)} ms, table in the DOM ${ms(r.P && r.P.tableIn)} ms, drawn ${ms(r.P && r.P.tableAt)} ms` + (r.fonts ? `, fonts ${kb(r.fonts.bytes)} KB in ${r.fonts.n} (Google Fonts CSS ${kb(r.fonts.css)} KB${r.fonts.open ? `, ${r.fonts.open} unfinished` : ""})` : "") + (r.land ? `, home drawn in ${r.land.list.length} of ${r.P.n} checks` : "") + (r.css && r.css.length ? `; stylesheets in at ${r.css.join(", ")} ms` : "") + (r.err ? ` (${r.err})` : ""));

// ---- L3 (needs a browser), L6, L7: one browser, not throttled
const l3 = {}, l6 = {}, l7 = {};
{
  const br = await launch();
  try {
    { // L3
      const t = await tab(br, PHONE);
      l3.bg = JSON.parse(await t.ev(`(() => { document.open(); document.write("<!doctype html><html><head>" + ${JSON.stringify(styleTags.join(""))} + "</head><body><p>x</p></body></html>"); document.close(); const c = (e) => getComputedStyle(e).backgroundColor; return JSON.stringify({ html: c(document.documentElement), body: c(document.body) }); })()`));
      await t.close();
    }
    for (const [name, dev] of [["phone 390 @3x", PHONE], ["desk 1440 @1x", DESK]]) { // L6
      const t = await tab(br, dev);
      await t.prime({ [KEY]: firstTable(0, 2024) });
      await t.send("Page.navigate", { url: URL0 + "?play" });
      const drawn = await t.waitTable();
      const seen = new Map();
      if (drawn) for (const wait of [600, 3400]) { await sleep(wait); for (const x of JSON.parse(await t.ev(`(${pictures})()`))) seen.set(`${x.src}@${x.w}`, x); }
      l6[name] = { drawn, list: [...seen.values()] };
      await t.close();
    }
    await (async () => { // L7
      const pos = { pick: stateAt("pick", 1, 64), place: stateAt("place", 0, 31) };
      for (const prof of ["chrome", "safari15.0", "safari15.4"]) for (const [label, s] of Object.entries(pos)) {
        const t = await tab(br, SHORT);
        await t.prime({ [KEY]: { ...s, cardSeen: s.st.turn } });
        await t.send("Page.navigate", { url: URL0 + "?play" });
        const drawn = await t.waitTable();
        await sleep(2500);
        let n = null;
        if (prof !== "chrome") { await t.ev(`(() => { window.__l88css = ${compatCss}; return 1; })()`); n = JSON.parse(await t.ev(`(${injectCompat})(${JSON.stringify(PROFILES[prof])})`)); await sleep(1200); }
        l7[`${prof} ${label}`] = { drawn, n, m: JSON.parse(await t.ev(`(${look})()`)), pos: `turn ${s.st.turn}, ${s.st.pending ? "stage " + s.st.pending.stage : "pick a card"}` };
        await t.close();
      }
    })();
  } finally { await br.close(); }
}

// =================================================================================================== the rows
// L1
{
  const f = runs.play.map((r) => r.fonts).filter(Boolean), med = median(f.map((x) => x.bytes));
  rule(f.length === RUNS && med != null && med <= FONT_KB * 1024, `L1 fonts: ?play (a game saved) asks for ${med == null ? "—" : kb(med)} KB of fonts before the table is drawn (median; ${f.map((x) => `${kb(x.bytes)} KB in ${x.n} files, Google Fonts CSS ${kb(x.css)}`).join(" / ") || "no table"}) ≤ ${FONT_KB} KB`);
}
// L2
{
  const h = median(runs.home.map((r) => r.P && r.P.fcp)), pf = median(runs.play.map((r) => r.P && r.P.fcp)), pt = median(runs.play.map((r) => r.P && r.P.tableAt));
  rule(h != null && h <= FCP_HOME, `L2 the home page's FCP ${ms(h)} ms (median; ${runs.home.map((r) => ms(r.P && r.P.fcp)).join(" / ")}) ≤ ${ms(FCP_HOME)} ms`);
  rule(pf != null && pf <= FCP_TABLE, `L2 ?play (a game saved) FCP ${ms(pf)} ms (median; ${runs.play.map((r) => ms(r.P && r.P.fcp)).join(" / ")}) ≤ ${ms(FCP_TABLE)} ms`);
  rule(pt != null && pt <= TABLE_AT && runs.play.every((r) => r.P && r.P.tableAt != null), `L2 ?play (a game saved) the table drawn at ${ms(pt)} ms (median; ${runs.play.map((r) => ms(r.P && r.P.tableAt)).join(" / ")}) ≤ ${ms(TABLE_AT)} ms`);
}
// L3
{
  const rgba = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c || ""); if (!m) return null; const v = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return { r: v[0], g: v[1], b: v[2], a: v.length > 3 ? v[3] : 1 }; };
  const dark = (c) => { const x = rgba(c); return !!x && x.a >= 0.5 && Math.min(x.r, x.g, x.b) < 240; };
  const ok = styleTags.length > 0 && (dark(l3.bg && l3.bg.html) || dark(l3.bg && l3.bg.body));
  rule(ok, `L3 index.html has in its <head> an inline <style> with a background on html or body that is not white: ${styleTags.length} inline <style> in <head>${styleTags.length ? `; from them alone html ${l3.bg.html}, body ${l3.bg.body}` : ""} (the server's page, ${html.length.toLocaleString("en-US")} characters)`);
}
// L4
for (const [k, name] of [["play", "?play (a game saved)"], ["room", "?room=CODE (a started room, its token saved)"]]) {
  if (k === "room" && !room) { rule(false, `L4 ${name}: could not open a room on this server (${roomErr})`); continue; }
  const list = runs[k], bad = list.filter((r) => !r.land || r.land.list.length || !r.P || r.P.tableAt == null);
  const say = list.map((r) => { if (!r.P || r.P.tableAt == null) return "no table"; const d = r.land.list; return d.length ? `${d[0][2]} drawn ${ms(d[0][0])}–${ms(d[d.length - 1][0])} ms, table ${ms(r.P.tableAt)} ms` : `none drawn in ${r.P.n} checks, table ${ms(r.P.tableAt)} ms`; });
  rule(list.length === RUNS && !bad.length, `L4 ${name}: no home button drawn before the table: ${list.length - bad.length} of ${list.length} loads clean${room && k === "room" ? ` (room ${room.code})` : ""} (${say.join(" / ")})`);
}
// L5
{
  const bad = artHeads.filter((r) => r.status !== 200 || maxAge(r.cc) < MAX_AGE), ccs = [...new Set(artHeads.map((r) => r.cc))];
  rule(artHeads.length > 0 && !bad.length, `L5 the pictures under art/: ${artHeads.length - bad.length} of ${artHeads.length} answer with max-age ≥ ${MAX_AGE} (Cache-Control seen: ${ccs.map((c) => `「${c || "none"}」`).join(", ")}${bad.length ? `; e.g. ${bad[0].url.replace(URL0, "")} ${bad[0].status}` : ""})`);
  const seen = new Map();
  for (const r of fontHeads) seen.set(r.url, { url: r.url, cc: r.cc, status: r.status });
  for (const list of Object.values(runs)) for (const r of list) for (const f of r.own || []) if (!seen.has(f.url)) seen.set(f.url, { url: f.url, cc: f.cc, status: 200 });
  const fonts = [...seen.values()], fbad = fonts.filter((r) => r.status !== 200 || maxAge(r.cc) < MAX_AGE);
  rule(!fbad.length, fonts.length ? `L5 the fonts this server sends: ${fonts.length - fbad.length} of ${fonts.length} answer with max-age ≥ ${MAX_AGE} (Cache-Control seen: ${[...new Set(fonts.map((r) => r.cc))].map((c) => `「${c || "none"}」`).join(", ")})` : "L5 the fonts this server sends: none (no font file in public/, none from this origin in the loads): nothing to cache");
}
// L6
for (const [name, v] of Object.entries(l6)) {
  const rows = v.list.map((x) => ({ ...x, x: x.file / (x.w * x.dpr) })).sort((a, b) => b.x - a.x), over = rows.filter((r) => r.x > IMG_X + 0.005);
  const show = (r) => `${r.src} ${r.file} px for ${r.w}×${r.dpr} (${r.at}) ${r.x.toFixed(1)}×`;
  rule(v.drawn && rows.length > 0 && !over.length, `L6 ${name}: every picture on the first table at most ${IMG_X}× the pixels it is drawn at: ${over.length} of ${rows.length} over${over.length ? ` (${over.slice(0, 6).map(show).join("; ")}${over.length > 6 ? "; …" : ""})` : rows.length ? ` (the largest ${show(rows[0])})` : v.drawn ? " (no picture found)" : " (no table)"}`);
}
// L7
for (const [key, v] of Object.entries(l7)) {
  const m = v.m, ctl = key.startsWith("chrome"), tag = ctl ? `(control, not counted) ${key}` : `L7 ${key}`;
  const say = (ok, what) => (ctl ? note.push(`  ${ok ? "✓" : "✗"} ${tag}: ${what}`) : rule(ok, `${tag}: ${what}`));
  const where = `${v.pos}${v.n ? `; dropped ${v.n.rules} rules, ${v.n.decls} declarations, ${v.n.blocks} blocks from ${v.n.sheets} sheets` : ""}`;
  if (!v.drawn) { say(false, `the table was not drawn (${where})`); continue; }
  say(m.sh <= m.ih + 1, `the page does not scroll: scrollHeight ${m.sh} ≤ ${m.ih} + 1 (${where})`);
  const top = m.cards.filter((c) => c.t >= 0 && c.t < m.ih);
  say(top.length > 0, `at least one hand card's top on the screen: ${top.length} of ${m.cards.length} (tops ${m.cards.map((c) => c.t).join(", ") || "none"}; screen 0–${m.ih})`);
  const above = m.rows.length ? Math.max(...m.rows.map((r) => r.b)) : null, low = m.rows.find((r) => r.b === above);
  say(!!m.map && above != null && m.map.t >= above - 1, `the map frame starts below the rows above it: map top ${m.map ? m.map.t : "none"} (${m.map ? `${m.map.w}×${m.map.h}` : "—"}) ≥ ${above == null ? "no rows" : `${above} (.${low.c} bottom)`}`);
}

console.log("measured (not rows):");
for (const n of note) console.log(n);
let bad = 0;
for (const r of out) { if (!r.ok) bad++; console.log(`${r.ok ? "✓" : "✗"} ${r.what}`); }
console.log(bad ? `FAIL: ${bad} of ${out.length}` : `PASS: ${out.length} checks`);
process.exit(bad ? 1 : 0);
