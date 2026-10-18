// tools/feeddock74.mjs — on the desk the record stands open on the right from the start (#74). Orchestrator's instrument:
// a peer may run it, does not edit it. Needs Chrome and a running dev server that serves this tree; about two minutes.
//
//   node tools/feeddock74.mjs http://127.0.0.1:8787/president_2000/
//
// Owner, 2026-10-17: 「Desktop 上，紀錄 預設展開在右邊」. Solo games played in node by this tree's rules, put in the page's
// session store and opened (?play, speed fast): the human to act in the action phase (turn 2 or later, the record holding
// at least four lines), and the human having just moved with the rivals to move. On the desk — 1280×800, 1440×900,
// 1100×720 and 1366×657 in Chinese, 1280×800 in English:
//   - without a tap the record (.t-feed) is open (data-open="1") and wholly on screen, to the right of the map (its left
//     edge at or right of the map box's right edge), overlapping neither the top row, the candidates, the headlines, the
//     map nor the lowered hand;
//   - the map is not smaller for it: its width at least 98 % of what it was before #74 at that size (main e47ce84:
//     1280×800 712, 1440×900 872, 1100×720 532, 1366×657 640);
//   - at least three of its lines are wholly in view, and its newest line (the last of .t-feed ol, the record keeps its
//     order) is in view and not covered (the topmost element at its centre is inside the record);
//   - while the rivals move it stays open and its newest line stays in view;
//   - inside it nothing is cut, on every screen measured (to act, a card up, the rivals moving): 「剛剛」 (.fd-now), when
//     drawn, shows whole (its content fits its box), at least two whole lines of the list are in view, and its blocks
//     (the header, 「剛剛」, the list) do not overlap (added after the first delivery, eb9e1ff: at 1366×657 with the
//     rivals moving, 「剛剛」 and the list each showed half a line next to each other, read as one line over another);
//   - with a card tapped up, the card's sheet ([data-sheet]) is wholly on screen, the record (still open) does not
//     overlap it, and every play button in the sheet is free to tap (the raised hand may cover the record's foot);
//   - while it stands open the record button shows no count of new lines (.nb), since they are on screen
//     (orchestrator's ruling, #74: the owner may overrule);
//   - a tap on the record button closes it, and it stays closed while the rivals move; a second tap opens it again;
//     each tap waits until no handoff card ([data-handoff]) is up, at most 8 s (#82: on v0.8 the handoff card left at 3.53 s
//     and redrew the page between the first tap's mousedown and mouseup, so no click). It does not wait for a replay: a tap
//     on the record button during a rival's replay must work (the first delivery of #82 took it as a skip): a row of its
//     own waits for the rivals' first replay ([data-replay]) and taps the button twice during it: closed, then open;
//   - the page does not scroll.
// On the phone (390×664) nothing changes: the record is closed until its button is tapped (tools/gamepage66.mjs measures
// the rest there).
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";

const base = process.argv[2];
if (!base) { console.log("usage: node tools/feeddock74.mjs <base url ending in /president_2000/>"); process.exit(2); }
const S = await import(new URL("../public/solo.js", import.meta.url).href);
const D = await import(new URL("../tests/driver.js", import.meta.url).href);
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KEY = "p2000.solo.session";
const MAPW = { "1280x800": 712, "1440x900": 872, "1100x720": 532, "1366x657": 640 };

function states() {
  let decide = null, rivals = null;
  for (const [seat, seed] of [[0, 7401], [1, 7402], [2, 7403], [0, 7404]]) {
    let s = S.newSolo({ seat, level: 2, seed });
    const R1 = D.rng(seed);
    for (let n = 0; n < 3000 && s.st.phase !== "end" && !(decide && rivals); n++) {
      if (S.botsToMove(s).length) { s = S.stepBot(s); continue; }
      const ch = S.choices(s, "zh-Hant");
      if (!ch.length) break;
      if (!decide && s.st.phase === "action" && !s.st.pending && s.st.turn >= 2 && (s.feed || []).length >= 4 && ch.length > 1) decide = { s: { ...s, cardSeen: s.st.turn }, where: `seat ${seat} seed ${seed} 第 ${s.st.turn} 回合第 ${n} 步` };
      const was = s.st.phase;
      s = S.act(s, ch[Math.floor(R1() * ch.length)].move);
      if (!rivals && was === "action" && s.st.phase === "action" && s.st.turn >= 2 && S.botsToMove(s).length) {
        let x = s, k = 0; while (S.botsToMove(x).length && k < 40) { x = S.stepBot(x); k++; }
        if (k >= 2) rivals = { s: { ...s, cardSeen: s.st.turn }, where: `seat ${seat} seed ${seed} 第 ${s.st.turn} 回合第 ${n} 步（之後對手 ${k} 步）` };
      }
    }
  }
  return { decide, rivals };
}
const ST = states();

async function launch() {
  const root = process.env.TEMP || "/tmp", dir = `${root}/feeddock74_${process.pid}_${Date.now()}`;
  for (const old of readdirSync(root).filter((d) => d.startsWith("feeddock74_"))) { try { if (Date.now() - statSync(`${root}/${old}`).mtimeMs > 600000) rmSync(`${root}/${old}`, { recursive: true, force: true }); } catch { /* in use */ } }
  mkdirSync(dir, { recursive: true });
  const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--remote-debugging-port=0", `--user-data-dir=${dir}`, "about:blank"], { stdio: "ignore" });
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
    const tm = setTimeout(() => { pend.delete(i); rej(new Error(`instrument: CDP ${method} got no reply in 20 s`)); }, 20000);
    pend.set(i, (m) => { clearTimeout(tm); res(m.result || {}); }); ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile });
  const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); return r.result ? r.result.value : undefined; };
  const go = async (u, wait) => { await send("Page.navigate", { url: u }); await sleep(wait); };
  const tapAt = async (x, y) => { for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 }); };
  return { ev, go, tapAt, close: () => { try { ws.close(); } catch { /* closed */ } } };
}
const load = async (t, s, lang) => {
  await t.go(base, 900);
  await t.ev(`(() => { localStorage.setItem("p2000.speed", "fast"); sessionStorage.setItem(${JSON.stringify(KEY)}, ${JSON.stringify(JSON.stringify(s))}); return 1; })()`);
  await t.go(`${base}?play${lang === "en" ? "&lang=en" : ""}`, 2200);
  await t.ev(`(() => { const b = document.querySelector("[data-turncard] button"); if (b) b.click(); return 1; })()`);
  await sleep(300);
};
// the record and what stands around it; a line is "in view" when wholly inside every box that clips it up to the record
const LOOK = `(() => {
  const R = (e) => { const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, r: b.right, b: b.bottom }; };
  const drawn = (e) => !!e && e.getClientRects().length > 0 && e.getBoundingClientRect().width > 0 && getComputedStyle(e).visibility !== "hidden" && Number(getComputedStyle(e).opacity) > 0.05;
  const q = (s) => { const e = document.querySelector(s); return drawn(e) ? R(e) : null; };
  const f = document.querySelector(".t-feed");
  const view = (li) => { let b = R(li); for (let e = li.parentElement; e; e = e.parentElement) { const cs = getComputedStyle(e); if (!/visible/.test(cs.overflowY + cs.overflowX) || e === f) { const c = R(e); if (b.y < c.y - 1 || b.b > c.b + 1 || b.x < c.x - 1 || b.r > c.r + 1) return false; } if (e === f) break; } return b.y >= -1 && b.b <= innerHeight + 1; };
  const lis = f ? [...f.querySelectorAll("ol > li")].filter(drawn) : [];
  const tog = document.querySelector("[data-feed-toggle]"), nb = tog ? tog.querySelector(".nb") : null;
  const hand = document.querySelector(".t-hand");
  return JSON.stringify({ open: f ? f.dataset.open : null, drawn: drawn(f), feed: drawn(f) ? R(f) : null,
    lines: lis.filter(view).length, all: lis.length, newest: lis.length ? view(lis[lis.length - 1]) : false,
    newestText: lis.length ? lis[lis.length - 1].textContent.trim().slice(0, 60) : "",
    fresh: (() => { try { const x = JSON.parse(sessionStorage.getItem(${JSON.stringify(KEY)})); return (x.rec || []).filter((e) => e.seat != null && e.seat !== x.seat).length; } catch { return -1; } })(),
    log: (() => { try { return JSON.parse(sessionStorage.getItem(${JSON.stringify(KEY)})).st.log.length; } catch { return -1; } })(),
    olBox: (() => { const ol = f && f.querySelector("ol"); return ol ? { ch: ol.clientHeight, sh: ol.scrollHeight, st: Math.round(ol.scrollTop) } : null; })(),
    clash: f && drawn(f) ? (() => { const kids = [...f.children].filter(drawn).map((e) => ({ n: (e.getAttribute("class") || e.tagName.toLowerCase()), b: e.getBoundingClientRect() })), out = [];
      for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) { const a = kids[i].b, c = kids[j].b, oy = Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top), ox = Math.min(a.right, c.right) - Math.max(a.left, c.left); if (ox > 1 && oy > 1) out.push(kids[i].n + " and " + kids[j].n + " by " + Math.round(oy) + " px"); }
      return out; })() : [],
    nowCut: (() => { const n = f && f.querySelector(".fd-now"); return !!n && drawn(n) && n.scrollHeight > n.clientHeight + 1; })(),
    newestFree: lis.length ? (() => { const b = lis[lis.length - 1].getBoundingClientRect(), e = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return !!e && e.closest(".t-feed") === f; })() : false,
    playsFree: [...document.querySelectorAll("[data-sheet] button[data-move]")].filter(drawn).map((x) => { const b = x.getBoundingClientRect(), e = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return !!e && !!e.closest("[data-sheet]"); }),
    map: q(".tw-box"), top: q(".t-top"), players: q(".t-players"), track: q(".t-track"), hand: hand && drawn(hand) ? { ...R(hand), up: hand.dataset.hand === "up" } : null,
    sheet: q("[data-sheet]"), tog: drawn(tog) ? R(tog) : null, nb: drawn(nb), sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight, iw: innerWidth, ih: innerHeight });
})()`;
const look = async (t) => JSON.parse(await t.ev(LOOK));
// Wait, at most 8 s, until no handoff card is on the page (its leaving redraws the table).
const quiet = async (t) => { for (let i = 0; i < 80; i++) { if (await t.ev(`!document.querySelector("[data-handoff]")`)) return true; await sleep(100); } return false; };
const meet = (a, b) => !!a && !!b && Math.min(a.r, b.r) - Math.max(a.x, b.x) > 1 && Math.min(a.b, b.b) - Math.max(a.y, b.y) > 1;
const onScreen = (b, m) => !!b && b.x >= -1 && b.y >= -1 && b.r <= m.iw + 1 && b.b <= m.ih + 1;

const out = [];
const rule = (ok, what) => out.push({ ok, what });
if (!ST.decide || !ST.rivals) rule(false, `instrument: states found — decide ${ST.decide ? "yes" : "no"}, rivals ${ST.rivals ? "yes" : "no"}`);
const br = await launch();
try {
  for (const [w, h, lang] of [[1280, 800, "zh"], [1440, 900, "zh"], [1100, 720, "zh"], [1366, 657, "zh"], [1280, 800, "en"]]) {
    if (!ST.decide || !ST.rivals) break;
    const who = `${w}×${h} ${lang}`;
    const clash = []; let looked = 0;
    const blocks = (q, where) => { if (!q.drawn) return; looked++; for (const x of q.clash || []) clash.push(where + ": " + x); if (q.nowCut) clash.push(where + ": 「剛剛」 is cut"); if (q.lines < Math.min(2, q.all)) clash.push(where + ": " + q.lines + " whole lines of the list in view"); };
    let t = await tab(br, w, h, false);
    try {
      // the human to act
      await load(t, ST.decide.s, lang);
      let m = await look(t);
      blocks(m, "to act");
      const open = m.open === "1" && m.drawn && onScreen(m.feed, m);
      rule(open, `${who}: the record stands open on screen without a tap (data-open ${m.open}, ${m.feed ? `${Math.round(m.feed.x)}–${Math.round(m.feed.r)} × ${Math.round(m.feed.y)}–${Math.round(m.feed.b)}` : "not drawn"})`);
      const hits = [["the top row", m.top], ["the candidates", m.players], ["the headlines", m.track], ["the map", m.map], ["the hand", m.hand && !m.hand.up ? m.hand : null]].filter(([, b]) => meet(m.feed, b)).map(([n]) => n);
      rule(open && !!m.map && m.feed.x >= m.map.r - 1 && !hits.length, `${who}: right of the map, over nothing (record from x ${m.feed ? Math.round(m.feed.x) : "-"}, map to ${m.map ? Math.round(m.map.r) : "-"}${hits.length ? "; overlaps " + hits.join(", ") : ""})`);
      const want = MAPW[`${w}x${h}`];
      rule(!!m.map && m.map.w >= 0.98 * want, `${who}: the map not smaller (${m.map ? Math.round(m.map.w) : "-"} wide, before #74 ${want})`);
      rule(open && m.lines >= Math.min(3, m.all) && m.all > 0 && m.newest && m.newestFree, `${who}: three lines or more in view, the newest among them and not covered (${m.lines} of ${m.all} in view, newest ${m.newest ? (m.newestFree ? "in view" : "in view but COVERED") : "NOT in view"})`);
      rule(m.sw <= m.iw + 1 && m.sh <= m.ih + 1, `${who}: the page does not scroll (${m.sw}×${m.sh} in ${m.iw}×${m.ih})`);
      // a card tapped up: its sheet and the record side by side
      const c = JSON.parse(await t.ev(`JSON.stringify((() => { const e = [...document.querySelectorAll(".t-hand .hc[data-sel]")].find((x) => x.getClientRects().length && !x.classList.contains("dis")); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + Math.min(b.height / 2, 24) }; })())`));
      if (c) {
        await t.tapAt(c.x, c.y); await sleep(700);
        const k = await look(t);
        blocks(k, "a card up");
        const free = k.playsFree.filter(Boolean).length;
        rule(!!k.sheet && onScreen(k.sheet, k) && k.open === "1" && k.drawn && !meet(k.sheet, k.feed) && k.playsFree.length > 0 && free === k.playsFree.length, `${who}: with a card up, its sheet on screen, the record open beside it and not over it, the plays free to tap (${k.sheet ? "sheet " + Math.round(k.sheet.y) + "–" + Math.round(k.sheet.b) : "no sheet"}, record ${k.drawn ? Math.round(k.feed.y) + "–" + Math.round(k.feed.b) : "not drawn"}${meet(k.sheet, k.feed) ? ", OVERLAPPING" : ""}, ${free} of ${k.playsFree.length} plays free)`);
      } else rule(false, `${who}: instrument: no playable card to tap`);
    } catch (e) { rule(false, `${who}: broke off: ${e.message}`); } finally { t.close(); }
    t = await tab(br, w, h, false);
    try {
      // the rivals moving: it stays open with the newest in view; closed by a tap, it stays closed
      await load(t, ST.rivals.s, lang);
      const a = await look(t);
      // #82: during a rival's replay, a tap on the record button toggles it (it is not taken as a skip of the replay).
      let rp = false, rpMsg = "no replay came up in 3 s (instrument)";
      for (let i = 0; i < 30 && !rp; i++) { rp = await t.ev(`!!document.querySelector("[data-replay]")`); if (!rp) await sleep(100); }
      if (rp) {
        const r0 = await look(t); let r1 = null, r2 = null;
        if (r0.tog) { await t.tapAt(r0.tog.x + r0.tog.w / 2, r0.tog.y + r0.tog.h / 2); await sleep(250); r1 = await look(t); }
        const still = await t.ev(`!!document.querySelector("[data-replay]")`);
        if (r1 && r1.tog) { await t.tapAt(r1.tog.x + r1.tog.w / 2, r1.tog.y + r1.tog.h / 2); await sleep(250); r2 = await look(t); }
        rp = !!(r0.open === "1" && r1 && r1.open !== "1" && !r1.drawn && r2 && r2.open === "1" && r2.drawn);
        rpMsg = `before ${r0.open === "1" ? "open" : "closed"}; first tap ${r1 ? (r1.open !== "1" && !r1.drawn ? "closed it" : "did nothing") : "no button"}${still ? " (replay still up)" : ""}; second tap ${r2 ? (r2.open === "1" && r2.drawn ? "opened it" : "did nothing") : "no button"}`;
      }
      rule(rp, `${who}: during a rival's replay a tap on the record button closes it and a second opens it (${rpMsg})`);
      await sleep(3500);
      const b = await look(t);
      blocks(a, "rivals to move"); blocks(b, "rivals moved");
      const moved = b.log > a.log, grew = b.newestText !== a.newestText;
      rule(moved && grew && b.open === "1" && b.drawn && b.newest && b.newestFree, `${who}: while the rivals move it stays open, its newest line in view (${moved ? `log ${a.log} → ${b.log}` : "the rivals did not move (instrument)"}, newest line ${grew ? "changed" : "the same as before"}, ${b.newest ? (b.newestFree ? "in view" : "in view but COVERED") : `NOT in view (list ${b.olBox ? `${b.olBox.ch} high of ${b.olBox.sh}, scrolled ${b.olBox.st}` : "-"})`}, data-open ${b.open})`);
      rule(b.fresh > 0 && b.open === "1" && !b.nb, `${who}: while it stands open the button shows no count of new lines (${b.fresh} new lines of the rivals, ${b.nb ? "a count IS drawn" : "no count"})`);
      let closedOk = false, reopened = false, msg = "no record button";
      const b1 = (await quiet(t)) ? await look(t) : b;
      if (b1.tog) {
        await t.tapAt(b1.tog.x + b1.tog.w / 2, b1.tog.y + b1.tog.h / 2); await sleep(300);
        const c1 = await look(t); await sleep(2500); const c2 = await look(t);
        closedOk = !c1.drawn && !c2.drawn;
        const c3 = (await quiet(t)) ? await look(t) : c2;
        if (c3.tog) { await t.tapAt(c3.tog.x + c3.tog.w / 2, c3.tog.y + c3.tog.h / 2); await sleep(400); }
        const d = await look(t);
        reopened = d.open === "1" && d.drawn && onScreen(d.feed, d) && !!d.map && d.feed.x >= d.map.r - 1;
        msg = `after the tap ${c1.drawn ? "still drawn" : "gone"}, 2.5 s later ${c2.drawn ? "drawn again" : "still gone"}; a second tap ${reopened ? "opens it right of the map again" : "does not open it where it was"}`;
      }
      rule(looked > 0 && !clash.length, `${who}: inside the record nothing is cut: 「剛剛」 shows whole, at least two whole lines of the list, the blocks apart (${looked} screens${clash.length ? "; " + clash.slice(0, 2).join(" | ") : ""})`);
      rule(closedOk && reopened, `${who}: the button closes it, it stays closed, a second tap opens it (${msg})`);
    } catch (e) { rule(false, `${who}: broke off: ${e.message}`); } finally { t.close(); }
  }
  // the phone: unchanged
  if (ST.decide) {
    const t = await tab(br, 390, 664, true);
    try { await load(t, ST.decide.s, "zh"); const m = await look(t); rule(!m.drawn, `390×664 zh: on the phone the record is closed until tapped (${m.drawn ? "it is OPEN" : "closed"})`); }
    catch (e) { rule(false, `390×664: broke off: ${e.message}`); } finally { t.close(); }
  }
} finally { br.close(); }
for (const o of out) console.log(`${o.ok ? "✓" : "✗"} ${o.what}`);
const nbad = out.filter((o) => !o.ok).length;
console.log(nbad ? `FAIL: ${nbad} of ${out.length} checks` : `PASS: ${out.length} checks`);
process.exit(nbad ? 1 : 0);
