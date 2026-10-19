// tools/candtap38.mjs — after tapping a card, does tapping the candidate card still work? (#38)
// Orchestrator's instrument: a peer may run it, does not edit it. Needs Chrome and a running dev server (a local one:
// it opens a room).
//
//   node tools/candtap38.mjs http://127.0.0.1:8787/president_2000/
//
// Owner, 2026-10-15: 「遊戲中，點了其他牌後，再點候選人牌，不能用」. Tapping a hand card opens it (the page remembers it
// as selected); tapping the candidate card then asked its question underneath, but the selected card's face kept the
// panel, so nothing seemed to happen. Here, in a solo game (390 and 1440 wide) and in a room with bots (390):
//   - tap a hand card, then the candidate card: the question 「候選人牌整局只能用一次。現在就用嗎？」 shows with its
//     確定使用 / 先不要 buttons; tap 確定使用 and the candidate card is used ([data-cand][data-used]);
//   - tap the candidate card, then a hand card: that card's face ([data-face]) shows and the question is gone (changing
//     your mind still works), and closing that face (← 收起) leaves neither the face nor the old question.
//
// Two rounds (2026-10-18, after #87 made 新手 the default level of the solo setup and of the room's host), every row
// prefixed with its own: (a) 總幹事 (level 2), (b) 新手 (level 0).
//   - Solo: a fixed game built here in node and put in the page's sessionStorage, 宋 at its first decision: seed
//     P2000_SEED_A (default 3701) at level 2, P2000_SEED_B (default 3701) at level 0. Node checks first that this
//     decision offers the candidate card (a seed whose first decision is a sheet does not, and a row says so).
//   - Room: the host picks the round's level in the lobby (the go button must carry it). The room's seed cannot be
//     fixed from here: the room (src/room.js) draws it with crypto.getRandomValues on the server. So the table is
//     waited for instead: until the candidate card can be used, the steps before the play decision are taken for you
//     (the order, a trigger's pass, and since v0.8's 「a rival's CP play always triggers」 the effect of your own card a
//     bot played: its first option, a placement's in the county box its chip opens), each only after it has stood 1.2 s
//     (a decision with one option the page sends itself, #70). Up to 60 s a room, up to 3 rooms; flow B checks the card
//     can be used before it taps it too. Before this the loop took only the order or a pass and gave up after 30 s, and
//     flow B tapped without checking: the checker's 「not usable at the start」 and 「tapping the candidate card alone did
//     not ask」 were rooms that opened on such an effect (5 rooms in 10 at level 0 on 2026-10-18: 災區情誼, 勤政愛民 and
//     省府舊部 played by a bot for CP, 宋 to place their cubes).
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import * as S from "../public/solo.js";
import * as E from "../public/shared/engine.js";

const base = process.argv[2];
if (!base) { console.log("usage: node tools/candtap38.mjs <base url ending in /president_2000/>"); process.exit(2); }
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Chrome picks a free port (--remote-debugging-port=0) and writes it to DevToolsActivePort in its own profile
// folder, one per run: fixed ports and folders collided when several agents ran tools at once (#43's checker).
// Folders this tool left more than 10 minutes ago are removed first.
async function launch() {
  const root = process.env.TEMP || "/tmp", dir = `${root}/candtap38_${process.pid}_${Date.now()}`;
  for (const old of readdirSync(root).filter((d) => d.startsWith("candtap38_"))) { try { if (Date.now() - statSync(`${root}/${old}`).mtimeMs > 600000) rmSync(`${root}/${old}`, { recursive: true, force: true }); } catch { /* in use */ } }
  mkdirSync(dir, { recursive: true });
  const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "--remote-debugging-port=0", `--user-data-dir=${dir}`, "about:blank"], { stdio: "ignore" });
  let port = 0;
  for (let i = 0; i < 100 && !port; i++) { try { port = Number.parseInt(readFileSync(`${dir}/DevToolsActivePort`, "utf8"), 10) || 0; } catch { /* starting */ } if (!port) await sleep(100); }
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break; } catch { /* starting */ } await sleep(200); }
  return { port, close: () => proc.kill() };
}
async function tab(br, url, w, h, mobile) {
  const t = await (await fetch(`http://127.0.0.1:${br.port}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pend = new Map(), dialogs = [];
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    if (m.method === "Page.javascriptDialogOpening") { dialogs.push(`${m.params.type}: ${m.params.message}`); ws.send(JSON.stringify({ id: ++id, method: "Page.handleJavaScriptDialog", params: { accept: false } })); } };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id;
    const tm = setTimeout(() => { pend.delete(i); rej(new Error(`instrument: CDP ${method} got no reply in 20 s (${String(params.expression || params.url || "").replace(/\s+/g, " ").slice(0, 90)}; dialogs: ${dialogs.join(" | ") || "none"})`)); }, 20000);
    pend.set(i, (m) => { clearTimeout(tm); res(m.result || {}); }); ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Page.enable"); // #96: the first-time boxes are a modal of the first game, measured by tools/tips96.mjs; off here unless set
  await send("Page.addScriptToEvaluateOnNewDocument", { source: 'try { if (!localStorage.getItem("p2000.tips")) localStorage.setItem("p2000.tips", JSON.stringify({ seen: [], off: true })); } catch (e) { /* no storage */ }' });
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile });
  const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); return r.result ? r.result.value : undefined; };
  const go = async (u) => { await send("Page.navigate", { url: u }); await sleep(2200); await ev("document.fonts.ready.then(()=>1)"); };
  await go(url);
  return { ev, go, close: () => { try { ws.close(); } catch { /* closed */ } } };
}

const Q = "候選人牌整局只能用一次。現在就用嗎？", YES = "確定使用", NO = "先不要";
// What the table shows now: the question, its buttons, the opened face, the candidate card.
const LOOK = `JSON.stringify((() => {
  const shown = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
  const btn = (label) => [...document.querySelectorAll("button")].find((b) => shown(b) && b.textContent.trim() === label);
  const yes = btn(${JSON.stringify(YES)}), cand = document.querySelector(".tbl [data-cand]"), face = [...document.querySelectorAll("[data-face]")].find((f) => shown(f) && !f.closest("[data-replay]"));
  return { question: [...document.querySelectorAll("p, div, span")].some((e) => shown(e) && e.childElementCount === 0 && e.textContent.trim() === ${JSON.stringify(Q)}),
    yes: !!yes, yesMove: yes ? yes.getAttribute("data-move") : null, no: !!btn(${JSON.stringify(NO)}),
    face: face ? face.getAttribute("data-face") : null,
    cand: cand ? { usable: cand.hasAttribute("data-move") && !cand.disabled, used: cand.hasAttribute("data-used") } : null };
})())`;
const look = async (t) => JSON.parse(await t.ev(LOOK));
// A rival's card replayed big (#47) or the turn card (#44) lies over the table and takes a tap: wait until neither is up
// (0.4 s in a row), so a tap lands on the table (FE on #53: one red in three was a replay face read as the hand's, or a
// tap the turn card swallowed).
const CLEAR = `(() => { const up = (el) => el.getClientRects().length > 0 && Number(getComputedStyle(el).opacity) > 0.05; return ![...document.querySelectorAll("[data-replay], [data-turncard]")].some(up); })()`;
async function settle(t) { for (let i = 0, clear = 0; i < 300 && clear < 8; i++) { clear = (await t.ev(CLEAR)) ? clear + 1 : 0; await sleep(50); } }
const tapCard = async (t) => { await settle(t); return t.ev(`(() => { const c = [...document.querySelectorAll(".tbl [data-sel]")].find((x) => !x.disabled); if (!c) return null; c.click(); return c.getAttribute("data-sel"); })()`); };
const tapCand = async (t) => { await settle(t); return t.ev(`(() => { const c = document.querySelector(".tbl [data-cand]"); if (!c) return false; c.click(); return true; })()`); };
const tapYes = async (t) => { await settle(t); return t.ev(`(() => { const b = [...document.querySelectorAll("button")].find((x) => x.getClientRects().length && x.textContent.trim() === ${JSON.stringify(YES)}); if (!b) return false; b.click(); return true; })()`); };
const say = (o) => JSON.stringify(o);

const out = [];
const rule = (ok, what) => out.push({ ok, what });

// The two ways of tapping, on a table where the candidate card can be used now. open() puts the page there.
async function flows(where, open) {
  // A: a card, then the candidate card, then 確定使用.
  let t = await open();
  if (t.failed) { rule(false, `${where}: instrument — the table never got to a decision where the candidate card can be used (${t.failed})`); return; }
  const note = t.note ? `; ${t.note}` : "";
  let m = await look(t);
  if (!m.cand || !m.cand.usable) { rule(false, `${where}: instrument — the candidate card is not usable at the start (${say(m.cand)})`); t.close(); return; }
  const id = await tapCard(t); await sleep(500);
  const m1 = await look(t);
  if (!id || m1.face !== id) { rule(false, `${where}: instrument — tapping a hand card did not open it (tapped ${id}, face ${m1.face})`); t.close(); return; }
  await tapCand(t); await sleep(500);
  const m2 = await look(t);
  rule(m2.question && m2.yes && m2.no, `${where}: tap ${id}, then the candidate card → the question with ${YES} / ${NO} (question ${m2.question}, ${YES} ${m2.yes}, ${NO} ${m2.no}, face still open ${m2.face}${note})`);
  if (m2.yes) { await tapYes(t); await sleep(where.includes("room") ? 2500 : 800); }
  const m3 = await look(t);
  rule(!!m3.cand && m3.cand.used && !m3.question, `${where}: … then ${YES} → the candidate card is used (${m2.yes ? say(m3.cand) : "no " + YES + " button to tap"})`);
  t.close();
  // B: the candidate card, then a card: the card wins, the question goes.
  t = await open();
  if (t.failed) { rule(false, `${where}: instrument — (B) the table never got to a decision where the candidate card can be used (${t.failed})`); return; }
  const note2 = t.note ? `; ${t.note}` : "";
  const n0 = await look(t);
  if (!n0.cand || !n0.cand.usable) { rule(false, `${where}: instrument — (B) the candidate card is not usable at the start (${say(n0.cand)})`); t.close(); return; }
  await tapCand(t); await sleep(500);
  const n1 = await look(t);
  if (!n1.question) { rule(false, `${where}: instrument — tapping the candidate card alone did not ask (${say(n1)})`); t.close(); return; }
  const id2 = await tapCard(t); await sleep(500);
  const n2 = await look(t);
  rule(!!id2 && n2.face === id2 && !n2.question, `${where}: tap the candidate card, then ${id2} → its face, the question gone (face ${n2.face}, question ${n2.question}${note2})`);
  // … and closing that face (← 收起) does not bring the old question back (FE, #38: a face drawn over a question
  // still standing underneath passes the line above).
  await settle(t);
  const closed = await t.ev(`(() => { const b = document.querySelector(".sheet [data-sel='']"); if (!b) return false; b.click(); return true; })()`); await sleep(500); await settle(t);
  const n3 = await look(t);
  rule(closed && !n3.face && !n3.question, `${where}: … then ← 收起 → no face and no question left over (${closed ? `face ${n3.face}, question ${n3.question}` : "no ← 收起 button on the face"})`);
  t.close();
}

// The rounds (see the head of this file).
const ROUNDS = [
  { tag: "a 總幹事", level: 2, seed: Number(process.env.P2000_SEED_A || 3701) >>> 0 },
  { tag: "b 新手", level: 0, seed: Number(process.env.P2000_SEED_B || 3701) >>> 0 },
];
// The room, until the candidate card can be used: "ready" (twice in a row), "busy" (a replay, the turn card or the handoff
// card is up), or the decision in front of you that is not the play decision — its options' signature and the first one,
// which NEXT_GO takes once the same signature has stood 1.2 s. A placement's options are in the county's box: the bar's
// county chip ([data-open-county]) opens it first.
const NEXT = `(() => {
  const up = (el) => el.getClientRects().length > 0 && Number(getComputedStyle(el).opacity) > 0.05;
  if ([...document.querySelectorAll("[data-replay], [data-turncard], [data-handoff]")].some(up)) return JSON.stringify({ k: "busy" });
  const cand = document.querySelector(".tbl [data-cand][data-move]");
  if (cand && !cand.disabled) return JSON.stringify({ k: "ready" });
  const ms = [...document.querySelectorAll(".tbl [data-move]")].filter((x) => !x.disabled && x.getClientRects().length).map((x) => { try { return JSON.parse(x.getAttribute("data-move")); } catch { return null; } })
    .filter((m) => m && m.type !== "play" && m.type !== "candidate");
  if (ms.length) {
    const pick = ms.find((m) => m.type === "order") || ms.find((m) => m.type === "pass") || ms[0];
    return JSON.stringify({ k: "decide", sig: ms.map((m) => JSON.stringify(m)).sort().join("|"), pick: JSON.stringify(pick), type: pick.type });
  }
  const chips = [...document.querySelectorAll(".tbl [data-open-county]")].filter((x) => x.getClientRects().length).map((x) => x.getAttribute("data-open-county"));
  if (chips.length) return JSON.stringify({ k: "decide", sig: "open " + chips.join(","), open: chips[0], type: "the box of county " + chips[0] });
  return JSON.stringify({ k: "waiting", phase: (document.querySelector(".tbl") || {}).dataset?.phase || null });
})()`;
const NEXT_GO = (n) => n.open != null
  ? `(() => { const b = document.querySelector(".tbl [data-open-county='${n.open}']"); if (!b) return false; b.click(); return true; })()`
  : `(() => { const b = [...document.querySelectorAll(".tbl [data-move]")].find((x) => !x.disabled && x.getClientRects().length && JSON.stringify(JSON.parse(x.getAttribute("data-move"))) === ${JSON.stringify(n.pick)}); if (!b) return false; b.click(); return true; })()`;
const ROOM_WAIT = 60000, ROOM_TRIES = 3;

const br = await launch();
try {
  for (const rd of ROUNDS) {
    const R0 = `[${rd.tag} seed ${rd.seed}]`;
    // Solo: 宋 at the first decision of a fixed game (the candidate card can be used; at 3701, five cards in hand).
    const s = S.advance(S.newSolo({ seat: 1, level: rd.level, seed: rd.seed }));
    if (!E.legalMoves(s.st, 1).some((m) => m.type === "candidate")) rule(false, `${R0} solo: instrument — seed ${rd.seed} at level ${rd.level} does not open on a decision that offers the candidate card (${[...new Set(E.legalMoves(s.st, 1).map((m) => m.type))].join(", ")})`);
    else for (const [w, h, mob] of [[390, 844, true], [1440, 900, false]]) {
      await flows(`${R0} ${w} solo`, async () => {
        const t = await tab(br, base, w, h, mob);
        await t.ev(`(()=>{ sessionStorage.setItem("p2000.solo.session", ${JSON.stringify(JSON.stringify(s))}); return 1; })()`);
        await t.go(`${base}?play`); await sleep(600);
        return t;
      });
    }
    // A room: host it, sit, pick the round's level, start with bots, wait until the candidate card can be used.
    await flows(`[${rd.tag}, the room's seed is the server's] 390 room`, async () => {
      let notes = [];
      for (let k = 1; k <= ROOM_TRIES; k++) {
        const t = await tab(br, `${base}?host`, 390, 844, true);
        await t.ev(`(() => { const f = document.querySelector("form.rform"); f.elements.name.value = "測試"; f.requestSubmit(); return 1; })()`);
        for (let i = 0; i < 40 && !(await t.ev(`!!document.querySelector(".btn.sit[data-msg]")`)); i++) await sleep(250);
        await t.ev(`(() => { const b = document.querySelector(".btn.sit[data-msg]"); b && b.click(); return 1; })()`); await sleep(800);
        for (let i = 0; i < 20 && !(await t.ev(`!!document.querySelector("[data-level='${rd.level}']")`)); i++) await sleep(250);
        await t.ev(`(() => { const b = document.querySelector("[data-level='${rd.level}']"); b && b.click(); return 1; })()`); await sleep(300);
        const go = await t.ev(`(() => { const b = document.querySelector(".big.go[data-msg]"); if (!b) return null; const m = b.getAttribute("data-msg"); b.click(); return m; })()`);
        let lv = null; try { lv = JSON.parse(go).level; } catch { /* no button */ }
        if (lv !== rd.level) { notes.push(`room ${k}: the go button carries level ${lv} (${go}), not ${rd.level}`); t.close(); continue; }
        const t0 = Date.now(); let ready = 0, seen = null, since = 0, last = null; const took = [];
        while (Date.now() - t0 < ROOM_WAIT && ready < 2) {
          const n = JSON.parse(await t.ev(NEXT)); last = n;
          ready = n.k === "ready" ? ready + 1 : 0;
          if (n.k === "decide") {
            if (n.sig !== seen) { seen = n.sig; since = Date.now(); }
            else if (Date.now() - since >= 1200 && (await t.ev(NEXT_GO(n)))) { took.push(n.type); seen = null; }
          } else seen = null;
          await sleep(300);
        }
        if (ready >= 2) { if (took.length) notes.push(`room ${k}: took ${took.join(", ")} for you first`); t.note = notes.join("; "); return t; }
        notes.push(`room ${k}: the candidate card not usable after ${Math.round((Date.now() - t0) / 1000)} s (last ${JSON.stringify(last)}; took ${took.join(", ") || "nothing"})`);
        t.close();
      }
      return { failed: notes.join("; ") };
    });
  }
} finally { br.close(); }
let bad = 0;
for (const x of out) { if (!x.ok) bad++; console.log(`${x.ok ? "✓" : "✗"} ${x.what}`); }
console.log(bad ? `FAIL: ${bad} of ${out.length}` : `PASS: ${out.length} checks`);
process.exit(bad ? 1 : 0);
