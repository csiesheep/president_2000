// tools/labels69.mjs — what #69 changes that only a browser shows: the endorsement key with the totals covers no county,
// the candidate's strip closes when the player taps elsewhere, the undo button is free to tap. Orchestrator's instrument:
// a peer may run it, does not edit it. Needs Chrome and a running dev server that serves this tree; about 2 minutes.
//
//   node tools/labels69.mjs http://127.0.0.1:8787/president_2000/
//
// Owner, 2026-10-17, on the audit (「候選人板點開的那條……會一直蓋住議題頭條，要再點一次才收」, 「背書圖例蓋住台北市」) and the
// canvas 「UX 巡檢 · 建議修改」 (rows 3 and 8): 「Go」. States from solo games played by this tree's own rules in node, put in
// the page's session store and opened (?play), at 390×664 (CDP mobile) in Chinese and English and at 1280×800 in Chinese:
//   - with a region's endorsement held: the key [data-endorse-legend] is drawn once, and neither it nor the totals it sits
//     in ([data-issue-lead]) covers any county's box;
//   - on the phone: a real tap on a candidate's board (.pl-tap) opens its strip (.pl.open); a real tap on the map's sea (a
//     point of the map box where no county, chip, float or button is) closes it again;
//   - right after a move of the human's own that drew nothing, with the human still to decide (a bar, a card's plays, the
//     kind of action …): the undo button ([data-undo], enabled) is drawn and the element at its centre is that button —
//     no bar, tray or float over it. (Found by tools/auto70.mjs's first run: on the phone the campaign bar and the
//     raised tray covered it.)
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";

const base = process.argv[2];
if (!base) { console.log("usage: node tools/labels69.mjs <base url ending in /president_2000/>"); process.exit(2); }
const S = await import(new URL("../public/solo.js", import.meta.url).href);
const D = await import(new URL("../tests/driver.js", import.meta.url).href);
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KEY = "p2000.solo.session";

function states() {
  const endorse = [], undo = new Map();
  for (let i = 0; i < 6; i++) {
    const seat = i % 3, seed = 6901 + i;
    let s = S.newSolo({ seat, level: 2, seed });
    const R1 = D.rng(seed);
    for (let n = 0; n < 4000 && s.st.phase !== "end"; n++) {
      const bots = S.botsToMove(s).length > 0, ch = S.choices(s, "zh-Hant");
      const where = `seat ${seat} seed ${seed} 第 ${s.st.turn} 回合第 ${n} 步`;
      if (!bots && ch.length > 1 && s.st.endorse.some((h) => h >= 0) && endorse.length < 4 && !endorse.some((e) => e.seed === seed)) endorse.push({ s, seed, where });
      if (!bots && ch.length > 1 && S.canUndo(s) && !s.drew) {
        const kind = s.st.pending ? s.st.pending.stage : s.st.phase;
        if (!undo.has(kind)) undo.set(kind, { s, where: `${kind}: ${where}` });
      }
      if (bots && (!ch.length || R1() < 0.5)) s = S.stepBot(s);
      else { if (!ch.length) break; s = S.act(s, ch[Math.floor(R1() * ch.length)].move); }
    }
  }
  return { endorse, undo: [...undo.values()] };
}
const ST = states();

async function launch() {
  const root = process.env.TEMP || "/tmp", dir = `${root}/labels69_${process.pid}_${Date.now()}`;
  for (const old of readdirSync(root).filter((d) => d.startsWith("labels69_"))) { try { if (Date.now() - statSync(`${root}/${old}`).mtimeMs > 600000) rmSync(`${root}/${old}`, { recursive: true, force: true }); } catch { /* in use */ } }
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
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } else if (m.method === "Page.javascriptDialogOpening") send("Page.handleJavaScriptDialog", { accept: false }); };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; const tm = setTimeout(() => { pend.delete(i); rej(new Error("cdp timeout " + method)); }, 20000); pend.set(i, (m) => { clearTimeout(tm); res(m.result || {}); }); ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Page.enable"); // #96: the first-time boxes are a modal of the first game, measured by tools/tips96.mjs; off here unless set
  await send("Page.addScriptToEvaluateOnNewDocument", { source: 'try { if (!localStorage.getItem("p2000.tips")) localStorage.setItem("p2000.tips", JSON.stringify({ seen: [], off: true })); } catch (e) { /* no storage */ }' });
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile });
  const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); return r.result ? r.result.value : undefined; };
  const tapAt = async (x, y) => { for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 }); };
  const go = async (url) => { await send("Page.navigate", { url }); await sleep(1200); await ev("document.fonts.ready.then(()=>1)"); };
  return { ev, tapAt, go, close: () => { try { ws.close(); } catch { /* closed */ } } };
}
const LOOK = `(() => {
  const R = (e) => { const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, r: b.right, b: b.bottom }; };
  const drawn = (e) => !!e && e.getClientRects().length > 0 && e.getBoundingClientRect().width > 0 && getComputedStyle(e).visibility !== "hidden" && Number(getComputedStyle(e).opacity) > 0.05;
  const tc = document.querySelector("[data-turncard] button"); if (tc) tc.click();
  const boxes = [...document.querySelectorAll(".tw-c[data-county]")].map((g) => { const p = g.querySelector("[data-paper]") || g; return { k: g.dataset.county, ...R(p) }; });
  const hit = (b) => boxes.filter((x) => b.x < x.r - 1 && b.r > x.x + 1 && b.y < x.b - 1 && b.b > x.y + 1).map((x) => x.k);
  const keys = [...document.querySelectorAll("[data-endorse-legend]")].filter(drawn);
  const lead = document.querySelector("[data-issue-lead]");
  const u = [...document.querySelectorAll("button[data-undo]")].find((e) => drawn(e) && !e.disabled);
  let undo = null;
  if (u) { const b = R(u), e = document.elementFromPoint(b.x + b.w / 2, b.y + b.h / 2); undo = { free: !!e && u.contains(e), under: e && !u.contains(e) ? (e.closest("[data-sheet]") ? "the bar" : e.closest(".t-hand") ? "the hand" : (e.className && e.className.baseVal != null ? e.className.baseVal : e.className) || e.tagName) : "" }; }
  // a point of the map box with nothing on it: the sea
  let sea = null; const box = document.querySelector(".tw-box");
  if (box) { const b = R(box); for (let gy = 0.08; gy < 0.95 && !sea; gy += 0.06) for (let gx = 0.05; gx < 0.96 && !sea; gx += 0.05) { const x = b.x + b.w * gx, y = b.y + b.h * gy; const e = document.elementFromPoint(x, y); if (e && box.contains(e) && !e.closest(".tw-c, button, a, [data-popover], [data-act-chip], .t-notes, [data-issue-lead], .t-undo, [data-endorse-legend]")) sea = { x, y }; } }
  const tap = document.querySelector(".pl-tap"), tb = drawn(tap) ? R(tap) : null;
  return JSON.stringify({ keys: keys.length, over: [...keys, ...(drawn(lead) ? [lead] : [])].map((e) => hit(R(e))).flat(), undo, sea, tap: tb ? { x: tb.x + tb.w / 2, y: tb.y + tb.h / 2 } : null, open: !!document.querySelector(".pl.open") });
})()`;

const out = [];
const rule = (ok, what) => out.push({ ok, what });
const br = await launch();
try {
  for (const [dev, w, h, mobile, lang] of [["phone", 390, 664, true, "zh"], ["phone", 390, 664, true, "en"], ["desk", 1280, 800, false, "zh"]]) {
    const who = `${dev} ${lang}`, res = { keyBad: [], keyOk: 0, strip: [], stripOk: 0, undoBad: [], undoOk: 0 };
    const t = await tab(br, w, h, mobile);
    try {
      await t.go(base); await t.ev(`localStorage.setItem("p2000.speed", "fast"); 1`);
      const open = async (s) => { await t.ev(`sessionStorage.setItem(${JSON.stringify(KEY)}, ${JSON.stringify(JSON.stringify(s))}); 1`); await t.go(`${base}?play${lang === "en" ? "&lang=en" : ""}`); await sleep(300); return JSON.parse(await t.ev(LOOK)); };
      for (const x of ST.endorse) {
        const m = await open(x.s);
        if (m.keys !== 1 || m.over.length) res.keyBad.push(`${x.where}: ${m.keys} keys${m.over.length ? ", over " + [...new Set(m.over)].join(",") : ""}`); else res.keyOk++;
        if (dev === "phone" && m.tap && m.sea && res.stripOk + res.strip.length < 3) {
          await t.tapAt(m.tap.x, m.tap.y); await sleep(350);
          const a = JSON.parse(await t.ev(LOOK));
          if (!a.open) { res.strip.push(`${x.where}: a tap on the board did not open its strip`); continue; }
          await t.tapAt(m.sea.x, m.sea.y); await sleep(350);
          const b = JSON.parse(await t.ev(LOOK));
          if (b.open) res.strip.push(`${x.where}: the strip still open after a tap on the map's sea at ${Math.round(m.sea.x)},${Math.round(m.sea.y)}`); else res.stripOk++;
        }
      }
      for (const x of ST.undo) {
        const m = await open(x.s);
        if (!m.undo) res.undoBad.push(`${x.where}: no undo button`);
        else if (!m.undo.free) res.undoBad.push(`${x.where}: under ${m.undo.under}`);
        else res.undoOk++;
      }
    } catch (e) { rule(false, `${who}: broke off: ${e.message}`); }
    finally { t.close(); }
    rule(ST.endorse.length > 0 && !res.keyBad.length, `${who}: the endorsement key drawn once, it and the totals over no county (${res.keyOk} of ${ST.endorse.length}${res.keyBad.length ? "; " + res.keyBad.slice(0, 3).join(" | ") : ""})`);
    if (dev === "phone") rule(res.stripOk > 0 && !res.strip.length, `${who}: a candidate's strip closes on a tap elsewhere (${res.stripOk} ok${res.strip.length ? "; " + res.strip.slice(0, 2).join(" | ") : ""})`);
    rule(ST.undo.length > 0 && !res.undoBad.length, `${who}: the undo button is free to tap (${res.undoOk} of ${ST.undo.length}${res.undoBad.length ? "; " + res.undoBad.slice(0, 3).join(" | ") : ""})`);
  }
} finally { br.close(); }
for (const o of out) console.log(`${o.ok ? "✓" : "✗"} ${o.what}`);
const bad = out.filter((o) => !o.ok).length;
console.log(bad ? `FAIL: ${bad} of ${out.length} checks` : `PASS: ${out.length} checks`);
process.exit(bad ? 1 : 0);
