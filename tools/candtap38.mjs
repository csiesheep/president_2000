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
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import * as S from "../public/solo.js";

const base = process.argv[2];
if (!base) { console.log("usage: node tools/candtap38.mjs <base url ending in /president_2000/>"); process.exit(2); }
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function launch(port) {
  const dir = `${process.env.TEMP || "/tmp"}/candtap38_${port}`;
  mkdirSync(dir, { recursive: true });
  const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, "about:blank"], { stdio: "ignore" });
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
  await send("Page.enable");
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
  const yes = btn(${JSON.stringify(YES)}), cand = document.querySelector(".tbl [data-cand]"), face = [...document.querySelectorAll("[data-face]")].find(shown);
  return { question: [...document.querySelectorAll("p, div, span")].some((e) => shown(e) && e.childElementCount === 0 && e.textContent.trim() === ${JSON.stringify(Q)}),
    yes: !!yes, yesMove: yes ? yes.getAttribute("data-move") : null, no: !!btn(${JSON.stringify(NO)}),
    face: face ? face.getAttribute("data-face") : null,
    cand: cand ? { usable: cand.hasAttribute("data-move") && !cand.disabled, used: cand.hasAttribute("data-used") } : null };
})())`;
const look = async (t) => JSON.parse(await t.ev(LOOK));
const tapCard = (t) => t.ev(`(() => { const c = [...document.querySelectorAll(".tbl [data-sel]")].find((x) => !x.disabled); if (!c) return null; c.click(); return c.getAttribute("data-sel"); })()`);
const tapCand = (t) => t.ev(`(() => { const c = document.querySelector(".tbl [data-cand]"); if (!c) return false; c.click(); return true; })()`);
const tapYes = (t) => t.ev(`(() => { const b = [...document.querySelectorAll("button")].find((x) => x.getClientRects().length && x.textContent.trim() === ${JSON.stringify(YES)}); if (!b) return false; b.click(); return true; })()`);
const say = (o) => JSON.stringify(o);

const out = [];
const rule = (ok, what) => out.push({ ok, what });

// The two ways of tapping, on a table where the candidate card can be used now. open() puts the page there.
async function flows(where, open) {
  // A: a card, then the candidate card, then 確定使用.
  let t = await open();
  let m = await look(t);
  if (!m.cand || !m.cand.usable) { rule(false, `${where}: instrument — the candidate card is not usable at the start (${say(m.cand)})`); t.close(); return; }
  const id = await tapCard(t); await sleep(500);
  const m1 = await look(t);
  if (!id || m1.face !== id) { rule(false, `${where}: instrument — tapping a hand card did not open it (tapped ${id}, face ${m1.face})`); t.close(); return; }
  await tapCand(t); await sleep(500);
  const m2 = await look(t);
  rule(m2.question && m2.yes && m2.no, `${where}: tap ${id}, then the candidate card → the question with ${YES} / ${NO} (question ${m2.question}, ${YES} ${m2.yes}, ${NO} ${m2.no}, face still open ${m2.face})`);
  if (m2.yes) { await tapYes(t); await sleep(where.includes("room") ? 2500 : 800); }
  const m3 = await look(t);
  rule(!!m3.cand && m3.cand.used && !m3.question, `${where}: … then ${YES} → the candidate card is used (${m2.yes ? say(m3.cand) : "no " + YES + " button to tap"})`);
  t.close();
  // B: the candidate card, then a card: the card wins, the question goes.
  t = await open();
  await tapCand(t); await sleep(500);
  const n1 = await look(t);
  if (!n1.question) { rule(false, `${where}: instrument — tapping the candidate card alone did not ask (${say(n1)})`); t.close(); return; }
  const id2 = await tapCard(t); await sleep(500);
  const n2 = await look(t);
  rule(!!id2 && n2.face === id2 && !n2.question, `${where}: tap the candidate card, then ${id2} → its face, the question gone (face ${n2.face}, question ${n2.question})`);
  // … and closing that face (← 收起) does not bring the old question back (FE, #38: a face drawn over a question
  // still standing underneath passes the line above).
  const closed = await t.ev(`(() => { const b = document.querySelector(".sheet [data-sel='']"); if (!b) return false; b.click(); return true; })()`); await sleep(500);
  const n3 = await look(t);
  rule(closed && !n3.face && !n3.question, `${where}: … then ← 收起 → no face and no question left over (${closed ? `face ${n3.face}, question ${n3.question}` : "no ← 收起 button on the face"})`);
  t.close();
}

const br = await launch(9497);
try {
  // Solo: 宋 at the first decision of a fixed game (the candidate card can be used, five cards in hand).
  const s = S.advance(S.newSolo({ seat: 1, level: 2, seed: 3701 }));
  for (const [w, h, mob] of [[390, 844, true], [1440, 900, false]]) {
    await flows(`${w} solo`, async () => {
      const t = await tab(br, base, w, h, mob);
      await t.ev(`(()=>{ sessionStorage.setItem("p2000.solo.session", ${JSON.stringify(JSON.stringify(s))}); return 1; })()`);
      await t.go(`${base}?play`); await sleep(600);
      return t;
    });
  }
  // A room: host it, sit, start with bots, wait until the candidate card can be used.
  await flows("390 room", async () => {
    const t = await tab(br, `${base}?host`, 390, 844, true);
    await t.ev(`(() => { const f = document.querySelector("form.rform"); f.elements.name.value = "測試"; f.requestSubmit(); return 1; })()`);
    for (let i = 0; i < 40 && !(await t.ev(`!!document.querySelector(".btn.sit[data-msg]")`)); i++) await sleep(250);
    await t.ev(`(() => { const b = document.querySelector(".btn.sit[data-msg]"); b && b.click(); return 1; })()`); await sleep(800);
    await t.ev(`(() => { const b = document.querySelector(".big.go[data-msg]"); b && b.click(); return 1; })()`);
    // With the initiative the room first asks for an order: take position 1, then wait for the play decision.
    for (let i = 0; i < 120 && !(await t.ev(`!!document.querySelector(".tbl [data-cand][data-move]")`)); i++) {
      await t.ev(`(() => { const b = [...document.querySelectorAll("[data-move]")].find((x) => { try { return JSON.parse(x.getAttribute("data-move")).type === "order"; } catch { return false; } }); b && b.click(); return 1; })()`);
      await sleep(250);
    }
    return t;
  });
} finally { br.close(); }
let bad = 0;
for (const x of out) { if (!x.ok) bad++; console.log(`${x.ok ? "✓" : "✗"} ${x.what}`); }
console.log(bad ? `FAIL: ${bad} of ${out.length}` : `PASS: ${out.length} checks`);
process.exit(bad ? 1 : 0);
