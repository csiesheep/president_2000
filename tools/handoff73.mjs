// tools/handoff73.mjs — whose turn it is, in the page (#73): the handoff card each time the turn passes, and the lit
// board. Orchestrator's instrument: a peer may run it, does not edit it. Needs Chrome and a running dev server that
// serves this tree; about three minutes.
//
//   node tools/handoff73.mjs http://127.0.0.1:8787/president_2000/
//
// Owner, 2026-10-17: 「遊戲中，請明確顯示輪到哪一個候選人，或是輪到每個候選人時，有一個pop out panel」, then of the
// canvas's three: 「輪到誰 用 甲加乙」 (甲: the board of whoever is to act lit with 「陳 行動中」 / 「輪到你」, the other two
// faded; 乙: each time the turn passes, a card over the map for about a second, a tap puts it away).
// "Whose turn" is the one seat the game waits for (E.mustAct with exactly one seat), as in tests/turn73.test.js.
// Solo games played in node by this tree's rules — the human having just moved in the action phase (turn 2 or later),
// the rivals to move before the human's next decision — put in the page's session store and opened (?play, speed
// fast), at 390×664 (CDP mobile) in Chinese and English and at 1280×800 in Chinese:
//   - each time the turn passes to another seat (and when the page opens on a rival's turn), the card
//     [data-handoff="<key>"] for that seat is on screen before that seat's next step; for the human it says 「輪到你」,
//     for a rival 「輪到 <full name>」;
//   - while it shows the rivals do not move; it stays at least 0.5 s and goes by itself within 3 s;
//   - it is wholly on screen, its centre over the map (.tw-box), its words not cut;
//   - it is never on screen together with the turn card ([data-turncard]) or a rival's replayed move ([data-replay]);
//   - a tap on it closes it within 0.4 s (the point tapped is the card, not what lies under it) and is not a skip: the
//     rivals still take their steps one by one (as many as node counts);
//   - whenever one seat is to act (and no turn card, replayed move or handoff card is up), that seat's board alone
//     carries data-turn, its tag [data-turn-tag] is on screen (in Chinese 「輪到你」 / 「<short> 行動中」), its card
//     (.pl-card) is not faded (opacity ≥ 0.95) and the other two boards' cards are (opacity ≤ 0.7);
//   - the tutorial never shows the card.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";

const base = process.argv[2];
if (!base) { console.log("usage: node tools/handoff73.mjs <base url ending in /president_2000/>"); process.exit(2); }
const S = await import(new URL("../public/solo.js", import.meta.url).href);
const E = await import(new URL("../public/shared/engine.js", import.meta.url).href);
const D = await import(new URL("../tests/driver.js", import.meta.url).href);
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KEY = "p2000.solo.session";
const KEYS = ["chen", "soong", "lien"], SHORT = ["陳", "宋", "連"], FULL = ["陳水扁", "宋楚瑜", "連戰"];
const single = (st) => { if (!st || st.phase === "end") return null; const m = E.mustAct(st); return m.length === 1 ? m[0] : null; };

// bot steps from s until the human decides, and whether they stay in the action phase
function botRun(s) {
  let n = 0;
  let incs = 0;
  while (S.botsToMove(s).length && n < 60) { const was = s.st.log.length; s = S.stepBot(s); n++; if (s.st.log.length > was) incs++; }
  return { n, incs, log: s.st.log.length, ends: s.st.phase === "action" && single(s.st) === s.seat };
}
function states() {
  const mid = [];
  let start = null;
  for (const [seat, seed] of [[0, 7311], [1, 7312], [2, 7313], [0, 7314], [1, 7315], [2, 7316]]) {
    let s = S.newSolo({ seat, level: 2, seed });
    const R1 = D.rng(seed);
    let found = false;
    for (let n = 0; n < 3000 && s.st.phase !== "end" && !(found && start); n++) {
      const before = s.st.log.length;
      if (S.botsToMove(s).length) {
        s = S.stepBot(s);
        if (!start && s.st.log.slice(before).some((e) => e.t === "turn" && e.turn === 2) && S.botsToMove(s).length) start = { s, where: `turn 2 start: seat ${seat} seed ${seed}` };
        continue;
      }
      const ch = S.choices(s, "zh-Hant");
      if (!ch.length) break;
      const was = s.st.phase;
      s = S.act(s, ch[Math.floor(R1() * ch.length)].move);
      if (!start && s.st.log.slice(before).some((e) => e.t === "turn" && e.turn === 2) && S.botsToMove(s).length) start = { s, where: `turn 2 start: seat ${seat} seed ${seed}` };
      if (!found && was === "action" && s.st.phase === "action" && s.st.turn >= 2 && S.botsToMove(s).length && single(s.st) != null && single(s.st) !== seat) {
        const r = botRun(s);
        if (r.n >= 2 && r.ends) { mid.push({ s: { ...s, cardSeen: s.st.turn }, n: r.n, incs: r.incs, log: r.log, where: `seat ${seat} seed ${seed} 第 ${s.st.turn} 回合第 ${n} 步` }); found = true; }
      }
    }
  }
  // a turn's start with the rivals to move first, as tools/turncard44.mjs finds one
  for (let seed = 4601; seed <= 4660 && !start; seed++) {
    let s = S.newSolo({ seat: 0, level: 2, seed });
    for (let n = 0; n < 3000 && s.st.phase !== "end"; n++) {
      const before = s.st.log.length;
      if (S.botsToMove(s).length) s = S.stepBot(s); else { const ch = S.choices(s, "zh-Hant"); if (!ch.length) break; s = S.act(s, ch[0].move); }
      if (s.st.log.slice(before).some((e) => e.t === "turn" && e.turn === 2)) { if (S.botsToMove(s).length) start = { s, where: `turn 2 start: seat 0 seed ${seed}` }; break; }
    }
  }
  return { mid, start };
}
const ST = states();

async function launch() {
  const root = process.env.TEMP || "/tmp", dir = `${root}/handoff73_${process.pid}_${Date.now()}`;
  for (const old of readdirSync(root).filter((d) => d.startsWith("handoff73_"))) { try { if (Date.now() - statSync(`${root}/${old}`).mtimeMs > 600000) rmSync(`${root}/${old}`, { recursive: true, force: true }); } catch { /* in use */ } }
  mkdirSync(dir, { recursive: true });
  const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "--remote-debugging-port=0", `--user-data-dir=${dir}`, "about:blank"], { stdio: "ignore" });
  let port = 0;
  for (let i = 0; i < 100 && !port; i++) { try { port = Number.parseInt(readFileSync(`${dir}/DevToolsActivePort`, "utf8"), 10) || 0; } catch { /* starting */ } if (!port) await sleep(100); }
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break; } catch { /* starting */ } await sleep(200); }
  return { port, close: () => proc.kill() };
}
// Every 50 ms: the saved session's turn seat (with this tree's engine, loaded in the page), the handoff card, the turn
// card, a replayed move, and the three boards.
const SPY = `(() => {
  const BASE = ${JSON.stringify(base)};
  window.__h = { saves: [], polls: [] };
  let E = null; import(BASE + "shared/engine.js").then((m) => { E = m; });
  let last = null;
  const vis = (el) => { if (!el) return null; const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && Number(s.opacity) > 0.05 ? r : null; };
  const eff = (el) => { let o = 1; for (let e = el; e && e.nodeType === 1; e = e.parentElement) o *= Number(getComputedStyle(e).opacity); return o; };
  setInterval(() => {
    const t = performance.now();
    let v = null; try { v = sessionStorage.getItem(${JSON.stringify(KEY)}); } catch { /* storage */ }
    if (E && v && v !== last) { last = v; try { const s = JSON.parse(v), st = s.st; let a = null, n = 0;
      if (st && st.phase !== "end") { const m = E.mustAct(st); n = m.length; a = m.length === 1 ? m[0] : null; }
      window.__h.saves.push({ t, log: st ? st.log.length : -1, a, n, me: s.seat, tut: !!s.tut }); } catch { /* not json */ } }
    const hc = document.querySelector("[data-handoff]"), hr = vis(hc);
    const tc = !!vis(document.querySelector("[data-turncard]")), rp = [...document.querySelectorAll("[data-replay]")].some((e) => !!vis(e));
    const box = document.querySelector(".tw-box"), bb = box ? box.getBoundingClientRect() : null;
    let hand = null;
    if (hr) { const cx = hr.left + hr.width / 2, cy = hr.top + hr.height / 2;
      hand = { k: hc.getAttribute("data-handoff"), txt: hc.textContent.replace(/\\s+/g, " ").trim().slice(0, 80), cx, cy,
        on: hr.left >= -1 && hr.top >= -1 && hr.right <= innerWidth + 1 && hr.bottom <= innerHeight + 1,
        overMap: !!bb && cx >= bb.left && cx <= bb.right && cy >= bb.top && cy <= bb.bottom,
        cut: hc.scrollHeight > hc.clientHeight + 1 || hc.scrollWidth > hc.clientWidth + 1 }; }
    const boards = [...document.querySelectorAll("article.pl")].map((b) => { const c = b.querySelector(".pl-card"), tag = b.querySelector("[data-turn-tag]"), tr = vis(tag);
      return { seat: Number((b.className.match(/\\bs(\\d)\\b/) || [])[1]), turn: b.hasAttribute("data-turn"), op: c ? Math.round(eff(c) * 100) / 100 : 1,
        tag: tr ? { on: tr.left >= 0 && tr.top >= 0 && tr.right <= innerWidth && tr.bottom <= innerHeight, txt: tag.textContent.trim() } : null }; });
    window.__h.polls.push({ t, hand, tc, rp, boards });
  }, 50);
})();`;
async function tab(br, w, h, mobile) {
  const t = await (await fetch(`http://127.0.0.1:${br.port}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pend = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    if (m.method === "Page.javascriptDialogOpening") ws.send(JSON.stringify({ id: ++id, method: "Page.handleJavaScriptDialog", params: { accept: false } })); };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id;
    const tm = setTimeout(() => { pend.delete(i); rej(new Error(`instrument: CDP ${method} got no reply in 20 s`)); }, 20000);
    pend.set(i, (m) => { clearTimeout(tm); res(m.result || {}); }); ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: SPY });
  const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); return r.result ? r.result.value : undefined; };
  const go = async (u, wait) => { await send("Page.navigate", { url: u }); await sleep(wait); };
  const tapAt = async (x, y) => { for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 }); };
  return { ev, go, tapAt, close: () => { try { ws.close(); } catch { /* closed */ } } };
}
const load = async (t, s, lang) => {
  await t.go(base, 1000);
  await t.ev(`(() => { localStorage.setItem("p2000.speed", "fast"); sessionStorage.setItem(${JSON.stringify(KEY)}, ${JSON.stringify(JSON.stringify(s))}); return 1; })()`);
  await t.go(`${base}?play${lang === "en" ? "&lang=en" : ""}`, 300);
};
const read = async (t) => JSON.parse(await t.ev(`JSON.stringify(window.__h || { saves: [], polls: [] })`));
// waits until the human's card has shown and gone (or `cap` ms)
async function playOut(t, me, cap) {
  const t0 = Date.now();
  while (Date.now() - t0 < cap) {
    await sleep(500);
    const done = await t.ev(`(() => { const p = (window.__h || { polls: [] }).polls; const i = p.findIndex((x) => x.hand && x.hand.k === ${JSON.stringify(KEYS[me])});
      return i >= 0 && p.slice(i).some((x) => !x.hand) && performance.now() - p[p.length - 1].t < 200; })()`);
    if (done) { await sleep(400); return true; }
  }
  return false;
}
// the seat to act at a time (the last save at or before it)
const seatAt = (saves, t) => { let a; for (const s of saves) if (s.t <= t) a = s; return a; };
function intervals(polls) {
  const out = []; let cur = null;
  for (const p of polls) {
    if (p.hand && (!cur || cur.k !== p.hand.k)) { if (cur) { cur.off = p.t; out.push(cur); } cur = { k: p.hand.k, on: p.t, txt: p.hand.txt }; }
    else if (!p.hand && cur) { cur.off = p.t; out.push(cur); cur = null; }
  }
  if (cur) { cur.off = null; out.push(cur); }
  return out;
}

const out = [];
const rule = (ok, what) => out.push({ ok, what });
if (ST.mid.length < 2 || !ST.start) rule(false, `instrument: states found — ${ST.mid.length} after the human's move, ${ST.start ? 1 : 0} at a turn's start`);
const br = await launch();
try {
  for (const [dev, w, h, mobile, lang] of [["phone", 390, 664, true, "zh"], ["phone", 390, 664, true, "en"], ["desk", 1280, 800, false, "zh"]]) {
    const who = `${dev} ${lang}`, bad = { miss: [], wait: [], stay: [], place: [], words: [], together: [], lit: [] };
    let events = 0, cards = 0, litN = 0;
    const judge = (m, x, opening) => {
      const me = x.s.seat, saves = m.saves, polls = m.polls, iv = intervals(polls);
      if (!saves.length) { bad.miss.push(`${x.where}: the page never saved a session`); return; }
      // the turn passing
      let prev = opening;
      for (let i = 0; i < saves.length; i++) {
        const sv = saves[i];
        if (sv.a == null || sv.a === prev) continue;
        prev = sv.a; events++;
        const next = saves.find((q) => q.t > sv.t && q.log > sv.log), until = next ? next.t : Infinity;
        if (!polls.some((p) => p.hand && p.hand.k === KEYS[sv.a] && p.t >= sv.t - 60 && p.t < until)) bad.miss.push(`${x.where}: the turn passed to ${KEYS[sv.a]} (${Math.round(sv.t)} ms) and no card for ${KEYS[sv.a]} before ${next ? "their step" : "the end"}`);
      }
      for (const c of iv) {
        cards++;
        const steps = saves.filter((q, i) => i > 0 && q.log > saves[i - 1].log && q.t > c.on + 60 && (c.off == null || q.t < c.off));
        if (steps.length) bad.wait.push(`${x.where}: ${steps.length} step(s) while the card for ${c.k} showed`);
        const end = c.off == null ? polls[polls.length - 1].t : c.off, stay = Math.round(end - c.on);
        // a card still up when the observation ends is judged only if it has already outstayed 3 s (after #73's third
        // delivery: the human's last card of a run was counted as "still up" and the FE cut the hold to fit the window)
        if ((c.off != null && stay < 500) || stay > 3000) bad.stay.push(`${x.where}: the card for ${c.k} ${c.off == null ? "still up after" : "stayed"} ${stay} ms`);
        const sv = seatAt(saves, c.on);
        if (!sv || sv.a == null || KEYS[sv.a] !== c.k) bad.words.push(`${x.where}: a card for ${c.k} while ${sv && sv.a != null ? KEYS[sv.a] : "no one seat"} is to act`);
        else if (lang === "zh") { const want = sv.a === me ? "輪到你" : `輪到 ${FULL[sv.a]}`; if (!c.txt.includes(want)) bad.words.push(`${x.where}: the card says 「${c.txt.slice(0, 40)}」, not 「${want}」`); }
      }
      for (const p of polls) {
        if (p.hand && (!p.hand.on || !p.hand.overMap || p.hand.cut)) { bad.place.push(`${x.where}: the card for ${p.hand.k}${p.hand.on ? "" : " off screen"}${p.hand.overMap ? "" : " not over the map"}${p.hand.cut ? " words cut" : ""}`); break; }
      }
      for (const p of polls) if (p.hand && (p.tc || p.rp)) { bad.together.push(`${x.where}: the card for ${p.hand.k} on screen with ${p.tc ? "the turn card" : "a replayed move"}`); break; }
      // the lit board, when the screen is settled
      for (const p of polls) {
        const sv = seatAt(saves, p.t);
        if (!sv || p.t - sv.t < 250 || p.hand || p.tc || p.rp || p.boards.length !== 3) continue;
        const on = p.boards.filter((b) => b.turn).map((b) => b.seat);
        let why = "";
        if (sv.a == null) { if (on.length) why = `no one seat to act, boards [${on.map((q) => KEYS[q])}] lit`; else if (p.boards.some((b) => b.op < 0.95)) why = `no one seat to act, a board faded (${p.boards.map((b) => b.op).join("/")})`; }
        else {
          const lit = p.boards.find((b) => b.seat === sv.a), rest = p.boards.filter((b) => b.seat !== sv.a);
          if (on.length !== 1 || on[0] !== sv.a) why = `${KEYS[sv.a]} to act, boards [${on.map((q) => KEYS[q])}] carry data-turn`;
          else if (!lit.tag || !lit.tag.on) why = `${KEYS[sv.a]}'s tag ${lit.tag ? "off screen" : "not drawn"}`;
          else if (lang === "zh" && lit.tag.txt !== (sv.a === me ? "輪到你" : `${SHORT[sv.a]} 行動中`)) why = `${KEYS[sv.a]}'s tag reads 「${lit.tag.txt}」`;
          else if (lit.op < 0.95 || rest.some((b) => b.op > 0.7)) why = `opacity ${KEYS[sv.a]} ${lit.op}, the others ${rest.map((b) => b.op).join("/")} (lit ≥ 0.95, others ≤ 0.7)`;
        }
        litN++;
        if (why) { bad.lit.push(`${x.where}: ${why}`); break; }
      }
    };
    // the turn passing, one game after the other
    for (const x of ST.mid) {
      const t = await tab(br, w, h, mobile);
      try { await load(t, x.s, lang); const ok = await playOut(t, x.s.seat, 30000); const m = await read(t); if (!ok) bad.miss.push(`${x.where}: the human's card did not show and go within 30 s`); judge(m, x, x.s.seat); }
      catch (e) { bad.miss.push(`${x.where}: broke off: ${e.message}`); } finally { t.close(); }
    }
    // a turn's start: the turn card first, then the cards
    if (ST.start) {
      const x = ST.start, t = await tab(br, w, h, mobile);
      try { await load(t, x.s, lang); await sleep(9000); const m = await read(t); if (!m.polls.some((p) => p.tc)) bad.together.push(`${x.where}: the turn card never showed (the instrument's state is wrong)`); judge(m, x, null); }
      catch (e) { bad.miss.push(`${x.where}: broke off: ${e.message}`); } finally { t.close(); }
    }
    rule(events > 0 && cards > 0 && !bad.miss.length, `${who}: a card each time the turn passes, before that seat moves (${events} times, ${cards} cards${bad.miss.length ? "; " + bad.miss.slice(0, 2).join(" | ") : ""})`);
    rule(cards > 0 && !bad.wait.length, `${who}: the rivals wait while it shows (${bad.wait.length ? bad.wait.slice(0, 2).join(" | ") : "no step under a card"})`);
    rule(cards > 0 && !bad.stay.length, `${who}: it stays 0.5–3 s and goes by itself (${bad.stay.length ? bad.stay.slice(0, 2).join(" | ") : "all"})`);
    rule(cards > 0 && !bad.place.length, `${who}: on screen, over the map, words not cut (${bad.place.length ? bad.place[0] : "all"})`);
    rule(cards > 0 && !bad.words.length, `${who}: the card names whoever is to act${lang === "zh" ? " (輪到你 / 輪到 全名)" : ""} (${bad.words.length ? bad.words.slice(0, 2).join(" | ") : "all"})`);
    rule(cards > 0 && !bad.together.length, `${who}: never together with the turn card or a replayed move (${bad.together.length ? bad.together[0] : "never"})`);
    rule(litN > 0 && !bad.lit.length, `${who}: the board of whoever is to act lit with its tag, the other two faded (${litN} settled screens${bad.lit.length ? "; " + bad.lit[0] : ""})`);
    // a tap closes it, and is not a skip
    {
      const x = ST.mid[0], t = await tab(br, w, h, mobile);
      let msg = "", okTap = false;
      try {
        await load(t, x.s, lang);
        let c = null;
        for (let i = 0; i < 80 && !c; i++) { await sleep(100); c = JSON.parse(await t.ev(`JSON.stringify((() => { const e = document.querySelector("[data-handoff]"); if (!e) return null; const r = e.getBoundingClientRect(); if (!r.width) return null;
          const cx = r.left + r.width / 2, cy = r.top + r.height / 2, hit = document.elementFromPoint(cx, cy); return { cx, cy, own: !!hit && !!hit.closest("[data-handoff]"), k: e.getAttribute("data-handoff") }; })())`)); }
        if (!c) msg = "no card showed to tap";
        else {
          const tapT = await t.ev("performance.now()");
          await t.tapAt(c.cx, c.cy);
          await playOut(t, x.s.seat, 30000);
          const m = await read(t);
          const gone = m.polls.find((p) => p.t > tapT && !(p.hand && p.hand.k === c.k));
          const close = gone ? Math.round(gone.t - tapT) : null;
          const steps = m.saves.filter((q, i) => i > 0 && q.log > m.saves[i - 1].log).length;
          const last = m.saves.length ? m.saves[m.saves.length - 1].log : -1;
          okTap = c.own && close != null && close <= 400 && last === x.log && steps >= Math.min(2, x.incs);
          msg = `the point tapped is ${c.own ? "the card" : "NOT the card"}; it went ${close == null ? "— never" : close + " ms"} after the tap; then the rivals moved in ${steps} steps to the record node reaches (${last} vs ${x.log} entries; node: ${x.incs} steps that add to the record)`;
        }
      } catch (e) { msg = `broke off: ${e.message}`; } finally { t.close(); }
      rule(okTap, `${who}: a tap closes the card and is not a skip (${msg})`);
    }
  }
  // the tutorial never shows it
  {
    const t = await tab(br, 390, 664, true);
    let shown = null;
    try {
      await t.go(`${base}?tutorial`, 2500);
      for (let i = 0; i < 6; i++) { await t.ev(`(() => { const b = document.querySelector("[data-tutorial]"); const nb = b && [...b.querySelectorAll("button")].find((x) => /下一步|Next/.test(x.textContent)); nb && nb.click(); return 1; })()`); await sleep(900); }
      const m = await read(t);
      shown = m.polls.some((p) => p.hand) ? "a card SHOWED" : m.saves.some((s) => s.tut) ? "no card" : "the tutorial never started (instrument)";
    } catch (e) { shown = `broke off: ${e.message}`; } finally { t.close(); }
    rule(shown === "no card", `phone zh tutorial: ${shown}`);
  }
} finally { br.close(); }
for (const o of out) console.log(`${o.ok ? "✓" : "✗"} ${o.what}`);
const nbad = out.filter((o) => !o.ok).length;
console.log(nbad ? `FAIL: ${nbad} of ${out.length} checks` : `PASS: ${out.length} checks`);
process.exit(nbad ? 1 : 0);
