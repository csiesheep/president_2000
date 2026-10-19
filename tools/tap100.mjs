// tools/tap100.mjs — a quick tap on a decision is not swallowed as the second tap of a double tap (#100). Orchestrator's
// instrument: a peer may run it, does not edit it. Needs Chrome and `wrangler dev` of this tree (it opens a room), about
// 3 minutes. That an opened hand card does not hide the decision is tests/sheet100.test.js (every such screen, as HTML);
// here one of them on the page: at "the kind of action" a hand card really tapped open, every decision button that could
// be tapped before can still be tapped (on top somewhere inside it).
//
//   node tools/tap100.mjs http://127.0.0.1:8787/president_2000/
//
// The audit (商業盤點 C, item 7): in a room a player tapped a hand card while the rivals' moves were still being replayed
// and tapped 「出牌」 right after; the second tap fell within 450 ms of the first, replay.js's bindTaps took it for the
// second tap of a double tap (skip the rest), stopped it, and the move was never sent — nothing happened on the screen and
// the 60 s clock played for the player. Seen once in a 9-round game; it follows from the code.
// Contract (orchestrator, #100, refining the ruling on #47): two taps make a double tap only when the second lands near
// the first (within 40 px, as a double tap does) and within 450 ms. A quick tap farther away is a tap of its own: on a
// decision ([data-move]) it makes that move. #47's side is kept and still measured by tools/replay47.mjs: two quick taps
// on the shown card (the same spot) never reach what is under it.
// Measured at 390×844, rivals' speed slow: the replay is up, it is the human's card play, a hand card is tapped where it
// shows, then its play button about 220 ms later (≤ 440 ms, read off the page's own click times); the move is made (solo: the
// card leaves the hand in the saved game) or sent (room: a "move" with that card on the socket).
// Reports 尚未實作 while the move is swallowed (as on main).
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import * as S from "../public/solo.js";

const base = process.argv[2];
if (!base) { console.log("usage: node tools/tap100.mjs <base url ending in /president_2000/>"); process.exit(2); }
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (k) => { if (process.env.TAP100_DEBUG) console.log(`  · ${k}`); };

async function launch() {
  const root = process.env.TEMP || "/tmp", dir = `${root}/tap100_${process.pid}_${Date.now()}`;
  for (const old of readdirSync(root).filter((d) => d.startsWith("tap100_"))) { try { if (Date.now() - statSync(`${root}/${old}`).mtimeMs > 600000) rmSync(`${root}/${old}`, { recursive: true, force: true }); } catch { /* in use */ } }
  mkdirSync(dir, { recursive: true });
  const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "--remote-debugging-port=0", `--user-data-dir=${dir}`, "about:blank"], { stdio: "ignore" });
  let port = 0;
  for (let i = 0; i < 100 && !port; i++) { try { port = Number.parseInt(readFileSync(`${dir}/DevToolsActivePort`, "utf8"), 10) || 0; } catch { /* starting */ } if (!port) await sleep(100); }
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break; } catch { /* starting */ } await sleep(200); }
  return { port, close: () => proc.kill() };
}
// The page's own click times (window capture: before any handler) and the moves a room page sends.
const SPY = `(() => {
  window.__clicks = []; window.__sent = [];
  // on the way down (window capture, before any handler) where it landed; on the way up whether the page's handlers had it
  addEventListener("click", (e) => { const b = e.target && e.target.closest ? e.target.closest("button, a, [data-county], [data-replay], [data-handoff]") : null;
    window.__clicks.push({ e, t: performance.now(), x: e.clientX, y: e.clientY, on: b ? (b.getAttribute("data-move") ? "data-move" : b.getAttribute("data-sel") ? "data-sel" : b.hasAttribute("data-replay") ? "replay" : b.hasAttribute("data-handoff") ? "handoff" : b.tagName) : String(e.target && e.target.tagName), up: false }); }, true);
  addEventListener("click", (e) => { const c = window.__clicks.find((x) => x.e === e); if (c) c.up = true; });
  const WS = window.WebSocket; if (WS) { const send = WS.prototype.send; WS.prototype.send = function (d) { try { const m = JSON.parse(d); if (m && m.t === "move") window.__sent.push({ t: performance.now(), move: m.move }); } catch { /* not json */ } return send.call(this, d); }; }
})();`;
async function tab(br, w = 390, h = 844) {
  const t = await (await fetch(`http://127.0.0.1:${br.port}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pend = new Map(), log = { state: null };
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
    if (m.method === "Network.webSocketFrameReceived") { try { const d = JSON.parse(m.params.response.payloadData); if (d.t === "state") log.state = { legal: d.legal || [], seat: d.seat, at: Date.now() }; } catch { /* not ours */ } }
    if (m.method === "Page.javascriptDialogOpening") ws.send(JSON.stringify({ id: ++id, method: "Page.handleJavaScriptDialog", params: { accept: true } }));
  };
  // every call gives up after 20 s (a tab that stopped answering must not hang the run)
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; const tm = setTimeout(() => { pend.delete(i); res({ timeout: true }); }, 20000); pend.set(i, (m) => { clearTimeout(tm); res(m.result || {}); }); try { ws.send(JSON.stringify({ id: i, method, params })); } catch { clearTimeout(tm); res({ closed: true }); } });
  await send("Page.enable"); await send("Network.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", { source: 'try { if (!localStorage.getItem("p2000.tips")) localStorage.setItem("p2000.tips", JSON.stringify({ seen: [], off: true })); localStorage.setItem("p2000.sound", JSON.stringify({ on: false, vol: 0 })); localStorage.setItem("p2000.speed", JSON.stringify("slow")); } catch (e) { /* no storage */ }' });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: SPY });
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: w < 768 });
  const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.timeout || r.closed) throw new Error(`the tab did not answer (${r.timeout ? "20 s" : "closed"}): ${expr.slice(0, 60)}`); return r.result ? r.result.value : undefined; };
  const go = async (u, wait = 2500) => { await send("Page.navigate", { url: u }); await sleep(wait); };
  const tapAt = async (x, y) => { for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 }); };
  return { ev, go, tapAt, log, close: () => { try { ws.close(); } catch { /* closed */ } } };
}

// A room hosted, the host sat down, started with the computer in the other seats.
async function hostRoom(br) {
  const t = await tab(br);
  await t.go(`${base}?host`);
  await t.ev(`(() => { const f = document.querySelector("form.rform"); if (!f) return 0; f.elements.name.value = "甲"; f.requestSubmit(); return 1; })()`);
  for (let i = 0; i < 40 && !(await t.ev(`!!document.querySelector(".btn.sit[data-msg]")`)); i++) await sleep(250);
  await t.ev(`(() => { const b = document.querySelector(".btn.sit[data-msg]"); b && b.click(); return 1; })()`); await sleep(800);
  await t.ev(`(() => { const b = document.querySelector(".big.go[data-msg]"); b && b.click(); return 1; })()`);
  return t;
}
// In the page: a spot of the element where the element itself is on top (null when it is covered or off screen).
const HIT = `const hit = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); if (!r.width || !r.height) return null;
  for (const fy of [0.5, 0.3, 0.15, 0.7, 0.85]) for (const fx of [0.5, 0.3, 0.7]) { const x = Math.round(r.left + r.width * fx), y = Math.round(r.top + r.height * fy);
    if (x < 1 || y < 1 || x > innerWidth - 2 || y > innerHeight - 2) continue; const u = document.elementFromPoint(x, y); if (u && (u === e || e.contains(u))) return [x, y]; }
  return null; };`;
const CARD_UP = `[...document.querySelectorAll("[data-replay]")].some((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && Number(getComputedStyle(e).opacity) > 0.05; })`;
// a card fully shown (not flying in or fading out): the replay is surely still going on
const CARD_FULL = `[...document.querySelectorAll("[data-replay]")].some((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && Number(getComputedStyle(e).opacity) > 0.9; })`;
const handAt = (card) => `(() => { ${HIT} return hit([...document.querySelectorAll('[data-sel="${card}"]')].find((e) => e.getClientRects().length) || null); })()`;
const playAt = (card) => `(() => { ${HIT} for (const b of document.querySelectorAll("[data-move]")) { let m = null; try { m = JSON.parse(b.getAttribute("data-move")); } catch { continue; }
  if (!m || m.card !== ${JSON.stringify(card)} || b.disabled || b.hasAttribute("data-confirm")) continue; const p = hit(b); if (p) return { p, move: m }; } return null; })()`;
// Tap the hand card, then its play button as soon as it shows (within 400 ms of the first tap, by the page's clock).
async function cardThenPlay(t, card) {
  // the first tap must be a first tap: no other click in the 600 ms before it (the instrument's own setup clicks count)
  const since = await t.ev(`window.__clicks.length ? performance.now() - window.__clicks[window.__clicks.length - 1].t : 1e9`);
  if (since < 600) await sleep(600 - since);
  const p1 = await t.ev(handAt(card)); if (!p1) return { err: `「${card}」在手牌裡沒有露出來可以點的地方` };
  const up1 = await t.ev(CARD_FULL), t0 = Date.now();
  await t.tapAt(p1[0], p1[1]);
  let b = null;
  while (!b && Date.now() - t0 < 330) { b = await t.ev(playAt(card)); if (!b) await sleep(15); }
  if (!b) return { err: `點了「${card}」之後 330 ms 內沒有它的出牌按鈕`, up1 };
  // a person's second tap: about a quarter of a second after the first (still well inside the 450 ms), where the button
  // is then (the page may have redrawn it)
  while (Date.now() - t0 < 220) await sleep(5);
  b = (await t.ev(playAt(card))) || b;
  await t.tapAt(b.p[0], b.p[1]);
  await sleep(50);
  const k = JSON.parse(await t.ev(`JSON.stringify(window.__clicks.slice(-2).map((c) => ({ t: c.t, on: c.on, up: c.up })))`));
  const gap = k.length === 2 ? Math.round(k[1].t - k[0].t) : null, far = Math.round(Math.hypot(b.p[0] - p1[0], b.p[1] - p1[1]));
  if (k.length === 2 && !k[0].up) return { err: `第一下（點「${card}」）自己就被攔下了，量不到`, up1 };
  return { up1, gap, far, move: b.move, taps: k.map((c) => `${c.on}${c.up ? "" : "（被攔下）"}`).join(" → ") };
}

const M = {};
// The solo game: the human (陳) makes a move that hands over to the rivals, the rivals' last step shows a card (so the
// replay is still up when the human's turn comes), and then the human has a card to play (not the candidate).
function findGame() {
  for (const seed of [7, 11, 21, 33, 45, 57, 69, 81, 93, 105, 117, 129]) {
    let s = S.advance(S.newSolo({ seat: 0, level: 2, seed }));
    for (let n = 0; n < 120 && s.st.phase !== "end"; n++) {
      const ch = S.choices(s, "zh-Hant"); if (!ch.length) break;
      for (const c of ch) {
        const q = S.act(s, c.move); if (!S.botsToMove(q).length) continue;
        let x = q, k = 0, lastAdd = [];
        while (S.botsToMove(x).length && k < 40) { const L0 = x.st.log.length; x = S.stepBot(x); lastAdd = x.st.log.slice(L0); k++; }
        if (x.st.phase === "end" || !lastAdd.some((e) => (e.t === "play" && e.card) || e.t === "trigger")) continue;
        const play = S.choices(x, "zh-Hant").find((d) => d.move.card && d.move.card !== "candidate" && d.move.type !== "candidate");
        if (play) return { seed, queued: q, after: x, card: play.move.card };
      }
      s = S.advance(S.act(s, ch[0].move));
    }
  }
  return null;
}
// The human at "the kind of action" (no card played in this step, two or more choices) with cards in hand, nothing pending.
function findAction() {
  for (const seed of [3, 5, 9, 13]) {
    let s = S.advance(S.newSolo({ seat: 0, level: 1, seed }));
    for (let n = 0; n < 60 && s.st.phase !== "end"; n++) {
      const ch = S.choices(s, "zh-Hant"); if (!ch.length) break;
      if (!S.botsToMove(s).length && s.st.phase === "action" && ch.length > 1 && ch[0].move.type === "action" && !ch.some((c) => c.move.card) && s.st.hands[0].length >= 2) return { seed, s, card: s.st.hands[0][1] };
      s = S.advance(S.act(s, ch[0].move));
    }
  }
  return null;
}
const LOG = `(() => { try { return JSON.parse(sessionStorage.getItem("p2000.solo.session")).st.log.length; } catch { return -1; } })()`;
// A spot on the shown card (on top there) with a decision button of the table under it.
const UNDER = `JSON.stringify((() => { const c = [...document.querySelectorAll("[data-replay]")].find((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && Number(getComputedStyle(e).opacity) > 0.9; }); if (!c) return null;
  const r = c.getBoundingClientRect();
  for (let fy = 0.1; fy <= 0.9; fy += 0.05) for (let fx = 0.1; fx <= 0.9; fx += 0.05) {
    const x = Math.round(r.left + r.width * fx), y = Math.round(r.top + r.height * fy); if (x < 1 || y < 1 || x > innerWidth - 2 || y > innerHeight - 2) continue;
    const els = document.elementsFromPoint(x, y); if (!els.length || !(els[0] === c || c.contains(els[0]))) continue;
    const b = els.map((e) => e.closest && e.closest("#stage [data-move], #rstage [data-move]")).find(Boolean); if (b && !b.disabled) return { x, y, move: b.getAttribute("data-move") };
  }
  return null; })())`;
// The decision's buttons that can be tapped (on top somewhere inside), by their move.
const MOVES_AT = `JSON.stringify((() => { ${HIT} return [...document.querySelectorAll("[data-move]")].filter((b) => !b.disabled && hit(b)).map((b) => b.getAttribute("data-move")); })())`;
const OVERLAY = `[...document.querySelectorAll("[data-turncard], [data-handoff], [data-tip]")].some((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && Number(getComputedStyle(e).opacity) > 0.05; })`;

const br = await launch();
try {
  // 0. solo, a hand card opened at "the kind of action": the decision's buttons are still there to tap
  const a = findAction(); M.action = a ? `種子 ${a.seed}，牌 ${a.card}` : null;
  if (a) {
    const t = await tab(br);
    await t.go(base, 1200);
    await t.ev(`(()=>{ sessionStorage.setItem("p2000.solo.session", ${JSON.stringify(JSON.stringify(a.s))}); return 1; })()`);
    await t.go(`${base}?play`, 300);
    for (let i = 0, clear = 0; i < 200 && clear < 8; i++) { let up = true; try { up = (await t.ev(OVERLAY)) || !(await t.ev(`!!document.querySelector("[data-move]")`)); } catch { /* navigating */ } clear = up ? 0 : clear + 1; await sleep(50); }
    const before = JSON.parse(await t.ev(MOVES_AT)), p = await t.ev(handAt(a.card));
    if (p) { await t.tapAt(p[0], p[1]); await sleep(500); }
    const opened = await t.ev(`!!document.querySelector('[data-sheet][data-card="${a.card}"]')`), after = JSON.parse(await t.ev(MOVES_AT));
    M.sheet = { before, after, tapped: !!p, opened };
    t.close();
  }
  // 1. solo
  const g = findGame(); M.game = g ? `種子 ${g.seed}，牌 ${g.card}` : null;
  if (g) {
    const t = await tab(br);
    await t.go(base, 1200);
    await t.ev(`(()=>{ sessionStorage.setItem("p2000.solo.session", ${JSON.stringify(JSON.stringify(g.queued))}); return 1; })()`);
    await t.go(`${base}?play`, 300);
    let ready = null; const t0 = Date.now();
    while (!ready && Date.now() - t0 < 90000) {
      let s = null; try { s = JSON.parse(await t.ev(`JSON.stringify({ n: ${LOG}, up: ${CARD_FULL} })`)); } catch { /* navigating */ }
      if (s && s.n >= g.after.st.log.length && s.up && (await t.ev(handAt(g.card)))) ready = s; else await sleep(25);
    }
    step(`solo ready ${JSON.stringify(ready)} after ${Date.now() - t0} ms`);
    if (!ready) M.solo = { err: "對手的重播一直沒有跟「輪到你出牌」同時在畫面上（instrument）" };
    else {
      const r = await cardThenPlay(t, g.card);
      await sleep(1500);
      const after = JSON.parse(await t.ev(`JSON.stringify((() => { try { const s = JSON.parse(sessionStorage.getItem("p2000.solo.session")); return { hand: s.st.hands[0], n: s.st.log.length }; } catch { return null; } })())`));
      M.solo = { ...r, played: !!after && !after.hand.includes(g.card), logGrew: after ? after.n - g.after.st.log.length : null, upAfter: await t.ev(CARD_UP) };
    }
    t.close();
  }
  // 2. a room: host, sit, start with the computer in the other seats
  {
    const t = await hostRoom(br);
    const t0 = Date.now(); let tries = 0, setup = 0;
    while (!M.room && Date.now() - t0 < 240000) {
      const st = t.log.state, plays = st ? st.legal.filter((m) => m.card && m.card !== "candidate" && m.type !== "candidate") : [];
      const up = await t.ev(CARD_FULL);
      if (plays.length && up) {
        let card = null; for (const m of plays) if (await t.ev(handAt(m.card))) { card = m.card; break; }
        if (card) {
          tries++;
          const n0 = (await t.ev("window.__sent.length")) || 0, r = await cardThenPlay(t, card);
          await sleep(1500);
          const sent = JSON.parse(await t.ev(`JSON.stringify(window.__sent.slice(${n0}))`));
          step(`room try ${tries}: ${JSON.stringify(r)} sent ${JSON.stringify(sent)}`);
          if (!r.err) { M.room = { ...r, card, sent: sent.filter((x) => x.move && x.move.card === card).length, other: sent.length }; break; }
          if (tries >= 4) { M.room = r; break; }
          await sleep(700); await t.ev(`(() => { const e = document.querySelector('[data-sel="${card}"]'); e && e.click(); return 1; })()`);
          continue;
        }
      }
      if (st && st.legal.length && !up && Date.now() - st.at > 1200) {
        // not the moment yet: make the first move shown and hand over to the computer (a plain click, no replay up)
        const did = await t.ev(`(() => { const b = [...document.querySelectorAll("#rstage [data-move]")].find((e) => e.getClientRects().length && !e.disabled && !e.hasAttribute("data-confirm")); if (b) { b.click(); return 1; } const h = [...document.querySelectorAll("#rstage [data-sel]")].find((e) => e.getClientRects().length); if (h) { h.click(); return 2; } return 0; })()`);
        if (did) { setup++; t.log.state = { ...st, at: Date.now() }; }
      }
      await sleep(60);
    }
    step(`room after ${Date.now() - t0} ms, ${setup} setup moves`);
    if (!M.room) M.room = { err: "房間裡對手的重播一直沒有跟「輪到你出牌」同時在畫面上（instrument）" };
    t.close();
  }
  // 3. #47's side, in a room of its own (a whole game to look in): at the human's card play with the replay up, a hand card
  // opened (its play buttons come up in the panel); a spot on the shown card with one of them under it is tapped twice,
  // quickly. The second tap lands on the button once the card has gone from that spot (it waits for that, at most 380 ms).
  // The moment comes by chance (2 of 5 runs found none in 180 s, FE on #100): up to three rooms, 150 s each.
  for (let roomNo = 1; roomNo <= 3 && !(M.under && M.under.onTop); roomNo++) {
    const t = await hostRoom(br);
    let opened = null; const t2 = Date.now();
    while (!(M.under && M.under.onTop) && Date.now() - t2 < 150000) {
      const st = t.log.state, plays = st ? st.legal.filter((m) => m.card && m.card !== "candidate" && m.type !== "candidate") : [];
      const up = await t.ev(CARD_FULL);
      if (plays.length && up) {
        const o = JSON.parse(await t.ev(UNDER));
        if (o) {
          const n0 = await t.ev("window.__sent.length");
          await t.tapAt(o.x, o.y); const t1 = Date.now();
          let onTop = false;
          while (Date.now() - t1 < 380) { onTop = await t.ev(`(() => { const e = document.elementFromPoint(${o.x}, ${o.y}); return !!(e && e.closest && e.closest("[data-move]") && !e.closest("[data-replay]")); })()`); if (onTop) break; await sleep(10); }
          await t.tapAt(o.x, o.y);
          await sleep(1500);
          const k = JSON.parse(await t.ev(`JSON.stringify(window.__clicks.slice(-2).map((c) => ({ t: c.t, on: c.on, up: c.up })))`));
          const sent = JSON.parse(await t.ev(`JSON.stringify(window.__sent.slice(${n0}))`));
          M.under = { onTop, at: `房間 390 寬，牌底下是 ${o.move.slice(0, 50)}`, gap: k.length === 2 ? Math.round(k[1].t - k[0].t) : null, taps: k.map((x) => `${x.on}${x.up ? "" : "（被攔下）"}`).join(" → "), made: sent.length };
          step(`under: ${JSON.stringify(M.under)}`);
          opened = null; continue;
        }
        if (!opened) {
          opened = await t.ev(`(() => { const ids = ${JSON.stringify(plays.map((m) => m.card))}; const h = [...document.querySelectorAll("#rstage [data-sel]")].find((e) => e.getClientRects().length && ids.includes(e.getAttribute("data-sel"))); if (h) { h.click(); return h.getAttribute("data-sel"); } return null; })()`);
          await sleep(500); continue;
        }
      }
      if (st && st.legal.length && !up && Date.now() - st.at > 1200) {
        const did = await t.ev(`(() => { const b = [...document.querySelectorAll("#rstage [data-move]")].find((e) => e.getClientRects().length && !e.disabled && !e.hasAttribute("data-confirm")); if (b) { b.click(); return 1; } const h = [...document.querySelectorAll("#rstage [data-sel]")].find((e) => e.getClientRects().length); if (h) { h.click(); return 2; } return 0; })()`);
        if (did) { t.log.state = { ...st, at: Date.now() }; opened = null; }
      }
      await sleep(60);
    }
    step(`under search, room ${roomNo}: ${Date.now() - t2} ms`);
    t.close();
  }
} catch (e) { M.err = e.message; } finally { br.close(); }

const rows = [];
const row = (name, fn) => { try { const r = fn(); rows.push(r === true ? { name, ok: true } : typeof r === "string" && r.startsWith("TODO:") ? { name, todo: r.slice(5).trim() } : r && r.pass ? { name, ok: true, msg: r.msg } : { name, ok: false, msg: String(r) }); } catch (e) { rows.push({ name, ok: false, msg: `instrument: ${e.message}` }); } };
const okm = (c, msg) => (c ? { pass: true, msg } : msg);
const judge = (x, made, what) => {
  if (M.err) return `儀器中途停下：${M.err}`;
  if (!x) return "沒有量到（instrument）";
  if (x.err) return `${x.err}（instrument）`;
  if (!x.up1) return "點手牌的時候重播已經不在了，量不到（instrument）";
  if (x.gap == null || x.gap > 440) return `兩下隔了 ${x.gap} ms，不在 450 ms 內，量不到（instrument）`;
  const how = `兩下隔 ${x.gap} ms、相距 ${x.far} px，${x.taps}`;
  if (!made) return `TODO: 出牌被當成連點的第二下吃掉了（${how}；${what}）`;
  return okm(true, `${how}；${what}`);
};
row("單人「選行動」那一步：真的點開一張手牌之後，原本按得到的每一顆決定按鈕都還按得到", () => {
  if (M.err) return `儀器中途停下：${M.err}`;
  if (!M.action || !M.sheet) return "找不到這樣的一局（instrument）";
  const x = M.sheet;
  if (!x.before.length) return `打開牌之前就沒有按得到的決定按鈕（${M.action}）（instrument）`;
  if (!x.tapped || !x.opened) return `「${M.action}」${x.tapped ? "點了但沒有打開" : "在手牌裡沒有露出來可以點的地方"}（instrument）`;
  const lost = x.before.filter((m) => !x.after.includes(m));
  if (lost.length === x.before.length) return `TODO: 打開的牌蓋住了決定（${M.action}：${x.before.length} 顆都按不到）`;
  return okm(!lost.length, lost.length ? `${M.action}：打開後 ${lost.length} / ${x.before.length} 顆按不到（${lost.slice(0, 3).join("、")}）` : `${M.action}：${x.before.length} 顆都還按得到`);
});
row("#47 照舊：在放大的牌上快點兩下（同一點），第二下落在牌底下的決定按鈕上，也不會做那一步", () => {
  if (M.err) return `儀器中途停下：${M.err}`;
  const x = M.under;
  if (!x) return "三間房間裡都找不到放大的牌壓在決定按鈕上的時候（instrument）";
  if (!x.onTop) return `${x.at}：第一下之後 380 ms 內那一點還是牌（下一張接上來了），量不到（instrument）`;
  if (x.gap == null || x.gap > 440) return `兩下隔了 ${x.gap} ms，量不到（instrument）`;
  return okm(!x.made, `${x.at}；兩下隔 ${x.gap} ms，${x.taps}；${x.made ? `做了 ${x.made} 步` : "沒有做任何一步"}`);
});
row("單人：對手的牌還在重播，點一張手牌、400 ms 內點它的出牌按鈕：牌打出去了", () => {
  if (!M.game) return "找不到這樣的一局（instrument）";
  const x = M.solo; return judge(x, x && x.played, x && !x.err ? `${M.game}；${x.played ? `牌離開手牌，紀錄多 ${x.logGrew} 筆` : "牌還在手上"}` : "");
});
row("房間：同上，那一步送給伺服器", () => {
  const x = M.room; return judge(x, x && x.sent >= 1, x && !x.err ? `「${x.card}」${x.sent ? `送出 ${x.sent} 次` : "沒有送出"}${x.other > x.sent ? `，另送了 ${x.other - x.sent} 個別的` : ""}` : "");
});
row("房間：那一步只送一次", () => {
  const x = M.room; if (!x || x.err || !x.sent) return "TODO: 還沒有送出";
  return okm(x.sent === 1 && x.other === 1, `送了 ${x.other} 個 move，其中 ${x.sent} 個是這張牌`);
});

let bad = 0, pend = 0;
for (const r of rows) { if (r.todo) pend++; else if (!r.ok) bad++; console.log(`${r.todo ? "…" : r.ok ? "✓" : "✗"} ${r.name}${r.todo ? " — " + r.todo : r.msg ? " — " + r.msg : ""}`); }
console.log(`${bad ? "FAIL" : pend ? "TODO" : "PASS"}: ${rows.length - bad - pend} pass, ${bad} fail, ${pend} 尚未實作`);
process.exit(bad ? 1 : 0);
