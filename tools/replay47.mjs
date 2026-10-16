// tools/replay47.mjs — the rivals' moves replayed: their cards shown big, a stamp for each check (#47, P1 ②).
// Orchestrator's instrument: a peer may run it, does not edit it. Needs Chrome and a running LOCAL dev server
// (it opens a room).
//
//   node tools/replay47.mjs http://127.0.0.1:8787/president_2000/
//
// Owner, 2026-10-15, approving the P1 designs (sticky 「重播的規格」). Contract:
//   - each card a rival plays or triggers (the log's "play" with a card, "trigger"; the candidate card too) is shown big
//     over the table as [data-replay="<card id>"] ("candidate" for a candidate card), one after another in log order;
//   - each support check in their moves stamps a [data-stamp="hit|miss"] (as the log's "check" says), as many as there
//     were checks;
//   - how long a card stays (from showing to gone): normal 700–2000 ms, fast ≤ 450 ms, slow ≥ 1100 ms (#42's speeds);
//     step by step: it stays until [data-botnext] is tapped;
//   - one tap anywhere on the table: that step jumps to its result (the card gone within 250 ms) and the next card is
//     still shown; two quick taps: the rest of the rivals' turn is skipped (no more cards, all steps done at once);
//   - in a room the same: the rivals' cards are shown and the "play" sound is asked for (#42's p2000:sound).
//   - a tap the replay uses is the replay's alone (orchestrator's ruling on #47, after the room screenshot showed the big
//     card over the decision panel): a tap on the shown card, and the second of two quick taps (≤ 400 ms apart) even if
//     the card has gone by then, never reaches what is under it on the page (the click does not bubble up to the window
//     from a button, link or county of #stage / #rstage) and sends no move. A decision seen outside the card can still
//     be pressed as before.
// Measured in a solo game (陳) where the human's move (a 跨營填 with a check) hands over to the rivals, who trigger
// one card, play another and make a check, at 390 and 1440 wide; speeds, taps and the room at 390; taps on the card at
// 1440 (over the map) and in the room (over the decision panel).
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import * as S from "../public/solo.js";

const base = process.argv[2];
if (!base) { console.log("usage: node tools/replay47.mjs <base url ending in /president_2000/>"); process.exit(2); }
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Chrome picks a free port and writes it to DevToolsActivePort in its own folder (see dbc2a88); no background throttling.
async function launch() {
  const root = process.env.TEMP || "/tmp", dir = `${root}/replay47_${process.pid}_${Date.now()}`;
  for (const old of readdirSync(root).filter((d) => d.startsWith("replay47_"))) { try { if (Date.now() - statSync(`${root}/${old}`).mtimeMs > 600000) rmSync(`${root}/${old}`, { recursive: true, force: true }); } catch { /* in use */ } }
  mkdirSync(dir, { recursive: true });
  const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "--remote-debugging-port=0", `--user-data-dir=${dir}`, "about:blank"], { stdio: "ignore" });
  let port = 0;
  for (let i = 0; i < 100 && !port; i++) { try { port = Number.parseInt(readFileSync(`${dir}/DevToolsActivePort`, "utf8"), 10) || 0; } catch { /* starting */ } if (!port) await sleep(100); }
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break; } catch { /* starting */ } await sleep(200); }
  return { port, close: () => proc.kill() };
}
// Records every showing of a replayed card (id, on, off), every stamp (once per element), sound requests and saves.
const SPY = `(() => {
  window.__rep = []; window.__stamps = []; window.__sounds = []; window.__saves = [];
  addEventListener("p2000:sound", (e) => window.__sounds.push({ name: e.detail && e.detail.name, t: performance.now() }));
  // clicks that bubbled up to the window (so the page's own handlers had them), and the moves sent to a room. Where the
  // click landed is read on the way down (the window's capture phase, before any handler): a handler may redraw the
  // table, and by the bubble phase the button it hit is no longer in #stage.
  window.__clicks = []; window.__sent = []; let down = null;
  addEventListener("click", (e) => { const x = e.target, b = x && x.closest ? x.closest("button, a, [data-county]") : null;
    down = { e, act: !!(b && b.closest("#stage, #rstage")), what: b ? (b.getAttribute("data-move") || b.getAttribute("data-msg") || b.getAttribute("aria-label") || b.getAttribute("data-county") || b.textContent || "").trim().slice(0, 60) : "" }; }, true);
  addEventListener("click", (e) => { if (down && down.e === e) window.__clicks.push({ t: performance.now(), act: down.act, what: down.what }); down = null; });
  const WS = window.WebSocket; if (WS) { const send = WS.prototype.send; WS.prototype.send = function (d) { try { const m = JSON.parse(d); if (m && m.t === "move") window.__sent.push({ t: performance.now(), move: m.move }); } catch { /* not json */ } return send.call(this, d); }; }
  const seen = new WeakSet(); let cur = null, last = null;
  const vis = (el) => { if (!el) return false; const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && Number(s.opacity) > 0.05; };
  setInterval(() => {
    const el = [...document.querySelectorAll("[data-replay]")].find(vis), id = el ? el.getAttribute("data-replay") : null, now = performance.now();
    if (cur && (!el || cur.el !== el || cur.id !== id)) { cur.off = now; cur = null; }
    if (el && !cur) { cur = { id, on: now, off: null, el }; window.__rep.push(cur); }
    for (const s of document.querySelectorAll("[data-stamp]")) if (!seen.has(s) && vis(s)) { seen.add(s); window.__stamps.push({ type: s.getAttribute("data-stamp"), t: now }); }
    try { const v = sessionStorage.getItem("p2000.solo.session"); if (v !== last) { if (last !== null) window.__saves.push(now); last = v; } } catch { /* storage */ }
  }, 20);
})();`;
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
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: SPY });
  const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); return r.result ? r.result.value : undefined; };
  const go = async (u, wait = 2200) => { await send("Page.navigate", { url: u }); await sleep(wait); };
  const tapAt = async (x, y) => { for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 }); };
  return { ev, go, tapAt, close: () => { try { ws.close(); } catch { /* closed */ } } };
}

// The game: the human (陳) at a decision whose visible move hands over to the rivals, who then trigger or play ≥ 2
// cards and make ≥ 1 check. queued = right after that move.
const esc = (j) => j.replace(/"/g, "&quot;");
function findGame() {
  for (const seed of [7, 11, 21, 33, 45, 57, 69, 81]) {
    let s = S.advance(S.newSolo({ seat: 0, level: 2, seed }));
    for (let n = 0; n < 80; n++) {
      const ch = S.choices(s, "zh-Hant"); if (!ch.length) break;
      const html = S.screen(s, "zh-Hant");
      for (const c of ch) {
        if (!html.includes('data-move="' + esc(JSON.stringify(c.move)) + '"')) continue;
        const q = S.act(s, c.move); let x = q, k = 0; const L0 = q.st.log.length;
        while (S.botsToMove(x).length && k < 40) { x = S.stepBot(x); k++; }
        const L = x.st.log.slice(L0), cards = L.filter((e) => (e.t === "play" && e.card) || e.t === "trigger");
        if (cards.length >= 2 && L.some((e) => e.t === "check")) return { queued: q, after: x, label: c.label };
      }
      s = S.advance(S.act(s, ch[0].move));
    }
  }
  return null;
}
const game = findGame();
const want = game ? game.after.st.log.slice(game.queued.st.log.length) : [];
const WANT_IDS = want.filter((e) => (e.t === "play" && e.card) || e.t === "trigger").map((e) => (e.card === "candidate" ? "candidate" : e.card));
const WANT_HIT = want.filter((e) => e.t === "check" && e.ok).length, WANT_MISS = want.filter((e) => e.t === "check" && !e.ok).length;

const out = [];
const rule = (ok, what) => out.push({ ok, what });
const load = async (t, s, speed = "normal") => {
  await t.go(base, 1200);
  await t.ev(`(()=>{ localStorage.setItem("p2000.speed", ${JSON.stringify(speed)}); sessionStorage.setItem("p2000.solo.session", ${JSON.stringify(JSON.stringify(s))}); return 1; })()`);
  await t.go(`${base}?play`, 100);
  for (let i = 0; i < 100; i++) { try { if (await t.ev(`!!document.querySelector("[data-county]")`)) break; } catch { /* navigating */ } await sleep(30); }
  // a turn card (#44) shows on a saved game whose turn was not seen yet; wait until it has gone before tapping
  // (it may be drawn a moment after the map: count it gone only after 0.4 s in a row without it)
  for (let i = 0, clear = 0; i < 160 && clear < 8; i++) { let up = true; try { up = await t.ev(`(() => { const c = document.querySelector("[data-turncard]"); if (!c) return false; const r = c.getBoundingClientRect(); return r.width > 0 && Number(getComputedStyle(c).opacity) > 0.05; })()`); } catch { /* navigating */ } clear = up ? 0 : clear + 1; await sleep(50); }
};
const read = async (t) => JSON.parse(await t.ev(`JSON.stringify({ now: performance.now(), rep: (window.__rep || []).map((r) => ({ id: r.id, on: r.on, off: r.off })), stamps: window.__stamps || [], sounds: window.__sounds || [], saves: window.__saves || [] })`));
const dur = (r, now) => Math.round((r.off == null ? now : r.off) - r.on);
// A spot on the table that is no button: the centre of the 剛剛 (just now) block's heading.
const SPOT = `JSON.stringify((() => { const el = [...document.querySelectorAll("#stage *")].find((e) => e.children.length === 0 && /^(剛剛|Just now)$/.test(e.textContent.trim()) && e.getClientRects().length);
  const r = el ? el.getBoundingClientRect() : document.querySelector("[data-county]").closest("section, div").getBoundingClientRect(); return { x: r.left + Math.min(r.width / 2, 40), y: r.top + r.height / 2 }; })())`;
// A spot on the shown card with a button, link or county of the page right under it (null when nothing is under it).
const OVER = `JSON.stringify((() => { const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && Number(getComputedStyle(e).opacity) > 0.05; };
  const c = [...document.querySelectorAll("[data-replay]")].find(vis); if (!c) return { card: false };
  const r = c.getBoundingClientRect();
  for (let fy = 0.12; fy <= 0.9; fy += 0.06) for (let fx = 0.12; fx <= 0.9; fx += 0.06) {
    const x = Math.round(r.left + r.width * fx), y = Math.round(r.top + r.height * fy); if (x < 1 || y < 1 || x > innerWidth - 2 || y > innerHeight - 2) continue;
    const u = document.elementsFromPoint(x, y).find((e) => e.closest("#stage, #rstage")), b = u && u.closest("button, a, [data-county]");
    if (b) return { card: true, x, y, under: (b.getAttribute("data-move") || b.getAttribute("data-msg") || b.getAttribute("data-county") || b.textContent || "").trim().slice(0, 60) };
  }
  return { card: true, under: null }; })())`;
const CARD_UP = `[...document.querySelectorAll("[data-replay]")].some((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && Number(getComputedStyle(e).opacity) > 0.05; })`;
// Tap the card where something of the page is under it; when twice, tap again as soon as the card has gone (or 330 ms
// after the first tap, whichever is first). Returns what the page got: clicks that reached a button / link / county of
// the table, and moves sent.
const ALIGN = `(() => { const c = [...document.querySelectorAll("[data-replay]")].find((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && Number(getComputedStyle(e).opacity) > 0.05; }); if (!c) return 0;
  const r = c.getBoundingClientRect(), b = [...document.querySelectorAll("#stage button[data-move], #rstage button[data-move], #rstage button[data-msg]")].find((e) => e.getClientRects().length && !e.disabled); if (!b) return 0;
  const q = b.getBoundingClientRect(); window.scrollBy(0, q.top + q.height / 2 - (r.top + r.height * 0.4)); return 1; })()`;
// The shown card's box, to wait until it has stopped flying in (a spot read mid-flight is off the card by the tap).
const RECT = `JSON.stringify((() => { const c = [...document.querySelectorAll("[data-replay]")].find((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && Number(getComputedStyle(e).opacity) > 0.05; }); if (!c) return null; const r = c.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map((x) => Math.round(x)); })())`;
async function tapCard(t, twice) {
  let o = { card: false }, seen = false;
  for (let i = 0; i < 80; i++) {
    const r1 = await t.ev(RECT); await sleep(80); const r2 = await t.ev(RECT);
    if (r2 !== "null") seen = true;
    if (r1 !== "null" && r1 === r2) {
      o = JSON.parse(await t.ev(OVER)); if (o.under) break;
      if (o.card) { await t.ev(ALIGN); await sleep(120); o = JSON.parse(await t.ev(OVER)); if (o.under) break; }
    }
    await sleep(20);
  }
  if (!o.under) return { o: { ...o, card: seen } };
  const t0 = (await read(t)).now;
  await t.tapAt(o.x, o.y);
  let gap = null;
  if (twice) {
    for (let i = 0; i < 40; i++) { const now = (await read(t)).now; if (!(await t.ev(CARD_UP)) || now - t0 >= 330) break; await sleep(15); }
    gap = Math.round((await read(t)).now - t0); await t.tapAt(o.x, o.y);
  }
  await sleep(900);
  const k = JSON.parse(await t.ev(`JSON.stringify({ clicks: (window.__clicks || []).filter((c) => c.t >= ${t0} && c.act), sent: (window.__sent || []).filter((s) => s.t >= ${t0}) })`));
  const m = await read(t), first = m.rep.find((r) => r.on <= t0 && (r.off == null || r.off >= t0));
  return { o, gap, k, gone: first && first.off != null ? Math.round(first.off - t0) : null };
}
const tapText = (x) => x.o.under == null ? `${x.o.card ? "a card was shown, but no button, link or county of the table was under it (even scrolled)" : "no card was shown"} — nothing to test (instrument)`
  : `tapped the card over 「${x.o.under}」${x.gap != null ? `, again ${x.gap} ms later` : ""}: ${x.k.clicks.length} clicks reached the table${x.k.clicks.length ? ` (${x.k.clicks.map((c) => "「" + c.what + "」").join(", ")})` : ""}, ${x.k.sent.length} moves sent (0 / 0)`;

const br = await launch();
try {
  if (!game) rule(false, "instrument: no saved game where the rivals play ≥ 2 cards and make a check");
  // 1–2. Normal speed at 390 and 1440: every card in log order, each shown 700–2000 ms; the stamps match the checks.
  for (const [w, h, mob] of [[390, 844, true], [1440, 900, false]]) {
    if (!game) break;
    const t = await tab(br, w, h, mob);
    await load(t, game.queued);
    await sleep(Math.max(9000, WANT_IDS.length * 2500));
    const m = await read(t), ids = m.rep.map((r) => r.id), ds = m.rep.map((r) => dur(r, m.now));
    rule(ids.join(",") === WANT_IDS.join(",") && ds.every((d) => d >= 700 && d <= 2000), `${w} normal: cards shown ${ids.join(",") || "none"} (log: ${WANT_IDS.join(",")}), each ${ds.join("/") || "—"} ms (700–2000)`);
    const hit = m.stamps.filter((s) => s.type === "hit").length, miss = m.stamps.filter((s) => s.type === "miss").length;
    rule(hit === WANT_HIT && miss === WANT_MISS, `${w} normal: stamps ${hit} hit / ${miss} miss (log: ${WANT_HIT} / ${WANT_MISS})`);
    t.close();
  }
  if (game) {
    // 3–4. Fast and slow.
    for (const [sp, okd, txt] of [["fast", (d) => d <= 450, "≤ 450"], ["slow", (d) => d >= 1100, "≥ 1100"]]) {
      const t = await tab(br, 390, 844, true);
      await load(t, game.queued, sp);
      await sleep(sp === "slow" ? Math.max(12000, WANT_IDS.length * 3500) : 6000);
      const m = await read(t), ids = m.rep.map((r) => r.id), ds = m.rep.map((r) => dur(r, m.now));
      rule(ids.join(",") === WANT_IDS.join(",") && ds.every(okd), `390 ${sp}: cards ${ids.join(",") || "none"}, each ${ds.join("/") || "—"} ms (${txt})`);
      t.close();
    }
    // 5. Step by step: the first card stays until 下一步, then the next one comes.
    {
      const t = await tab(br, 390, 844, true);
      await load(t, game.queued, "step");
      for (let i = 0; i < 40; i++) { const n = (await read(t)).rep.length; if (n) break; const nb = await t.ev(`!!document.querySelector("[data-botnext]")`); if (nb) await t.ev(`document.querySelector("[data-botnext]").getClientRects().length && document.querySelector("[data-botnext]").click(), 1`); await sleep(300); }
      await sleep(2500);
      let m = await read(t);
      const firstStays = m.rep.length >= 1 && m.rep[0].off == null;
      for (let i = 0; i < 20 && (await read(t)).rep.length < 2; i++) { await t.ev(`(() => { const b = document.querySelector("[data-botnext]"); b && b.click(); return 1; })()`); await sleep(400); }
      m = await read(t);
      rule(firstStays && m.rep.length >= 2, `390 step by step: the first card ${firstStays ? "stays 2.5 s untill 下一步" : "did NOT stay"}; after 下一步 ${m.rep.length} cards shown`);
      t.close();
    }
    // 6. One tap: that card goes at once, the next card is still shown.
    {
      const t = await tab(br, 390, 844, true);
      await load(t, game.queued);
      for (let i = 0; i < 100 && !(await read(t)).rep.length; i++) await sleep(50);
      await sleep(200);
      const spot = JSON.parse(await t.ev(SPOT)); await t.tapAt(spot.x, spot.y);
      const tapped = (await read(t)).now;
      await sleep(Math.max(6000, WANT_IDS.length * 2500));
      const m = await read(t), first = m.rep[0], later = m.rep.slice(1);
      const gone = first && first.off != null ? Math.round(first.off - tapped) : null;
      rule(!!first && gone !== null && gone <= 250 && later.length >= 1 && later.every((r) => dur(r, m.now) >= 500), `390 one tap: the shown card went ${gone === null ? "— (never)" : gone + " ms after the tap"} (≤ 250); afterwards ${later.length} more cards shown (${later.map((r) => dur(r, m.now)).join("/")} ms, each ≥ 500)`);
      t.close();
    }
    // 7. Two quick taps: the rest of the rivals' turn is skipped.
    {
      const t = await tab(br, 390, 844, true);
      await load(t, game.queued);
      for (let i = 0; i < 100 && !(await read(t)).rep.length; i++) await sleep(50);
      await sleep(200);
      const shownBefore = (await read(t)).rep.length; // only counts when a card was up to tap on
      const spot = JSON.parse(await t.ev(SPOT)); await t.tapAt(spot.x, spot.y); await sleep(150); await t.tapAt(spot.x, spot.y);
      const tapped = (await read(t)).now;
      await sleep(3000);
      const m = await read(t), after = m.rep.filter((r) => r.on > tapped + 300);
      const left = JSON.parse(await t.ev(`JSON.stringify((() => { const s = JSON.parse(sessionStorage.getItem("p2000.solo.session") || "null"); return s ? s.st.log.length : null; })())`));
      rule(shownBefore >= 1 && after.length === 0 && left === game.after.st.log.length, `390 two taps: ${shownBefore ? "tapped while a card was up" : "no card was up to tap on"}; ${after.length} cards shown afterwards (0); the game's log reached ${left} of ${game.after.st.log.length} entries`);
      t.close();
    }
    // 8. Two quick taps on the shown card at 1440 (it lies over the map): neither reaches a county or button under it.
    {
      const t = await tab(br, 1440, 900, false);
      await load(t, game.queued);
      const x = await tapCard(t, true);
      rule(x.o.under != null && x.k.clicks.length === 0 && x.k.sent.length === 0, `1440 taps on the card: ${tapText(x)}`);
      t.close();
    }
  }
  // A room with bots at 390, the human last in order so the bots act first; returns once a rival card is shown.
  // (Who acts first is the server's draw: when the human is first, no rival card comes; then another room, up to 4.)
  const openRoom = async (t) => {
    for (let k = 0; k < 4; k++) { if (await openRoom1(t)) return true; }
    return false;
  };
  const openRoom1 = async (t) => {
    await t.go(`${base}?host`, 1500);
    await t.ev(`(() => { const f = document.querySelector("form.rform"); if (!f) return 0; f.elements.name.value = "測試"; f.requestSubmit(); return 1; })()`);
    for (let i = 0; i < 40 && !(await t.ev(`!!document.querySelector(".btn.sit[data-msg]")`)); i++) await sleep(250);
    await t.ev(`(() => { const b = document.querySelector(".btn.sit[data-msg]"); b && b.click(); return 1; })()`); await sleep(800);
    await t.ev(`(() => { const b = document.querySelector(".big.go[data-msg]"); b && b.click(); return 1; })()`);
    // with the initiative, take the last position so the bots act first; then wait for their cards
    for (let i = 0; i < 60; i++) {
      await t.ev(`(() => { const bs = [...document.querySelectorAll("[data-move]")].filter((x) => { try { return JSON.parse(x.getAttribute("data-move")).type === "order"; } catch { return false; } }); const b = bs[bs.length - 1]; b && b.click(); return 1; })()`);
      if ((await read(t)).rep.length) return true;
      await sleep(250);
    }
    return false;
  };
  // 9. A room: the rivals' cards are replayed and the play sound is asked for.
  {
    const t = await tab(br, 390, 844, true);
    await openRoom(t);
    await sleep(3000);
    const m = await read(t);
    rule(m.rep.length >= 1 && m.sounds.some((s) => s.name === "play"), `390 room: ${m.rep.length} rival cards shown (${m.rep.map((r) => r.id).join(",") || "none"}), play sounds ${m.sounds.filter((s) => s.name === "play").length}`);
    t.close();
  }
  // 10. A room: two quick taps on the shown card, over the decision panel: neither reaches the panel, no move is sent.
  {
    const t = await tab(br, 390, 844, true);
    await openRoom(t);
    const x = await tapCard(t, true);
    rule(x.o.under != null && x.k.clicks.length === 0 && x.k.sent.length === 0, `390 room, taps on the card: ${tapText(x)}`);
    t.close();
  }
} finally { br.close(); }
let bad = 0;
for (const x of out) { if (!x.ok) bad++; console.log(`${x.ok ? "✓" : "✗"} ${x.what}`); }
console.log(bad ? `FAIL: ${bad} of ${out.length}` : `PASS: ${out.length} checks`);
process.exit(bad ? 1 : 0);
