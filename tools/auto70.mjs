// tools/auto70.mjs — a decision with one option only is made by itself (#70): the page makes it without a tap, says so,
// and undo after it does not loop. Orchestrator's instrument: a peer may run it, does not edit it. Needs Chrome and a
// running dev server that serves this tree; about 2 minutes.
//
//   node tools/auto70.mjs http://127.0.0.1:8787/president_2000/
//
// Owner, 2026-10-17, on the canvas 「UX 巡檢 · 建議修改」 (row 6): 「Go」. States are taken from solo games played by this
// tree's own rules in node (seeded, at random) and put in the page's session store, then opened (?play) on a 390×664
// phone (CDP mobile metrics) in Chinese, opponents on 「快」:
//   - one state of each kind met where the human has exactly one option and no rival is to move (keeping the only card,
//     ending an action with nothing left, a local card's one placement, the debate's last card, election day's last
//     card, an event's one placement …): within 2.5 s, without a tap, the page has made it — the state on screen is no
//     longer that one (the session store holds another state) — and a note [data-auto-note] is on screen whose words
//     hold 「只有一個選項，自動做了」; the note's words are not cut (no hidden overflow or line clamp with more words than
//     room), and neither it nor any note stacked with it (.t-notes) covers a county's box — the rule #66 set for the
//     floats over the map (added after the first delivery, cb9330b: on the phone the note stacked over 「你的上一步」 and
//     covered 台東 in 8 of 12 states, its words cut to 「屏東縣 · 填 1 塊 ⋯」);
//   - chains met where the human made a move, the only option followed, and then the human has a choice again (the
//     session put in the store is the one right after the human's move, its undo history holding the state before it):
//     the page makes the only option by itself; then a tap on undo ([data-undo]) brings back the state before the
//     human's move — the store holds it, it has more than one option — and no new [data-auto-note] appears within 2 s
//     (undo goes back past the step made by itself; it does not loop).
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";

const base = process.argv[2];
if (!base) { console.log("usage: node tools/auto70.mjs <base url ending in /president_2000/>"); process.exit(2); }
const S = await import(new URL("../public/solo.js", import.meta.url).href);
const D = await import(new URL("../tests/driver.js", import.meta.url).href);
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KEY = "p2000.solo.session", W = 390, H = 664;

// ---- the states, from this tree's rules
function states() {
  const singles = new Map(), chains = [];
  for (let i = 0; i < 8; i++) {
    const seat = i % 3, seed = 7001 + i;
    let s = S.newSolo({ seat, level: 2, seed });
    const R1 = D.rng(seed);
    for (let n = 0; n < 4000 && s.st.phase !== "end"; n++) {
      const bots = S.botsToMove(s).length > 0, ch = S.choices(s, "zh-Hant");
      const where = `seat ${seat} seed ${seed} 第 ${s.st.turn} 回合第 ${n} 步`;
      if (!bots && ch.length === 1) {
        const kind = `${s.st.phase}/${s.st.pending ? s.st.pending.stage : "-"}/${ch[0].move.type}`;
        if (!singles.has(kind)) singles.set(kind, { s, where, label: ch[0].label });
      }
      if (!bots && ch.length > 1 && chains.length < 4) {
        for (const c of ch) {
          const s2 = S.act(s, c.move);
          if (S.botsToMove(s2).length || s2.st.rng !== s.st.rng) continue;
          const c2 = S.choices(s2, "zh-Hant");
          if (c2.length !== 1) continue;
          const s3 = S.act(s2, c2[0].move);
          if (s3.st.rng !== s2.st.rng || S.botsToMove(s3).length || S.choices(s3, "zh-Hant").length < 2) continue;
          chains.push({ s1: s, s2, where: `${where}: 「${c.label}」→「${c2[0].label}」` });
          break;
        }
      }
      if (bots && (!ch.length || R1() < 0.5)) s = S.stepBot(s);
      else { if (!ch.length) break; s = S.act(s, ch[Math.floor(R1() * ch.length)].move); }
    }
  }
  return { singles: [...singles.entries()].slice(0, 10), chains };
}
const ST = states();

async function launch() {
  const root = process.env.TEMP || "/tmp", dir = `${root}/auto70_${process.pid}_${Date.now()}`;
  for (const old of readdirSync(root).filter((d) => d.startsWith("auto70_"))) { try { if (Date.now() - statSync(`${root}/${old}`).mtimeMs > 600000) rmSync(`${root}/${old}`, { recursive: true, force: true }); } catch { /* in use */ } }
  mkdirSync(dir, { recursive: true });
  const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--remote-debugging-port=0", `--user-data-dir=${dir}`, "about:blank"], { stdio: "ignore" });
  let port = 0;
  for (let i = 0; i < 100 && !port; i++) { try { port = Number.parseInt(readFileSync(`${dir}/DevToolsActivePort`, "utf8"), 10) || 0; } catch { /* starting */ } if (!port) await sleep(100); }
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break; } catch { /* starting */ } await sleep(200); }
  return { port, close: () => proc.kill() };
}
async function tab(br) {
  const t = await (await fetch(`http://127.0.0.1:${br.port}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pend = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } else if (m.method === "Page.javascriptDialogOpening") send("Page.handleJavaScriptDialog", { accept: false }); };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; const tm = setTimeout(() => { pend.delete(i); rej(new Error("cdp timeout " + method)); }, 20000); pend.set(i, (m) => { clearTimeout(tm); res(m.result || {}); }); ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: true });
  const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); return r.result ? r.result.value : undefined; };
  const tapAt = async (x, y) => { for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 }); };
  const go = async (url) => { await send("Page.navigate", { url }); await sleep(900); };
  return { ev, tapAt, go, close: () => { try { ws.close(); } catch { /* closed */ } } };
}
// what the page holds and shows: the stored state's fingerprint, the notes, the undo button
const LOOK = `(() => {
  const vis = (e) => !!e && e.getClientRects().length > 0 && e.getBoundingClientRect().width > 0 && getComputedStyle(e).visibility !== "hidden";
  let st = null; try { st = JSON.parse(sessionStorage.getItem(${JSON.stringify(KEY)})); } catch { /* none */ }
  const tc = document.querySelector("[data-turncard] button"); if (tc) tc.click();
  const u = document.querySelector("button[data-undo]:not([disabled])"), b = vis(u) ? u.getBoundingClientRect() : null;
  return JSON.stringify({ log: st && st.st ? st.st.log.length + ":" + JSON.stringify(st.st.pending || null).length + ":" + st.st.phase + ":" + st.st.turn : null,
    notes: [...document.querySelectorAll("[data-auto-note]")].filter(vis).map((e) => e.textContent.replace(/\\s+/g, " ").trim()),
    cut: [...document.querySelectorAll("[data-auto-note], [data-auto-note] *")].filter(vis).filter((e) => { const cs = getComputedStyle(e), clamp = cs.webkitLineClamp && cs.webkitLineClamp !== "none"; return (clamp || /hidden|clip/.test(cs.overflowY)) && e.scrollHeight > e.clientHeight + 1; }).length,
    over: (() => { const R = (e) => { const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, r: b.right, b: b.bottom }; }; const notes = [...document.querySelectorAll(".t-notes > *, [data-auto-note]")].filter(vis).map(R);
      return [...document.querySelectorAll(".tw-c[data-county]")].map((g) => ({ k: g.dataset.county, ...R(g.querySelector("[data-paper]") || g) })).filter((c) => notes.some((n) => n.x < c.r - 1 && n.r > c.x + 1 && n.y < c.b - 1 && n.b > c.y + 1)).map((c) => c.k); })(),
    undo: b ? { x: b.left + b.width / 2, y: b.top + b.height / 2 } : null });
})()`;
const fp = (s) => `${s.st.log.length}:${JSON.stringify(s.st.pending || null).length}:${s.st.phase}:${s.st.turn}`;

const out = [];
const rule = (ok, what) => out.push({ ok, what });
const res = { made: [], stuck: [], noNote: [], undoOk: 0, undoBad: [], covers: [], cutNotes: [] };
const br = await launch();
try {
  const t = await tab(br);
  try {
    await t.go(base); await t.ev(`localStorage.setItem("p2000.speed", "fast"); 1`);
    const open = async (s) => { await t.ev(`sessionStorage.setItem(${JSON.stringify(KEY)}, ${JSON.stringify(JSON.stringify(s))}); 1`); await t.go(`${base}?play`); };
    for (const [kind, x] of ST.singles) {
      await open(x.s);
      const was = fp(x.s);
      let m = null, moved = false;
      for (let i = 0; i < 10; i++) { await sleep(250); m = JSON.parse(await t.ev(LOOK)); if (m.log && m.log !== was) { moved = true; break; } }
      if (!moved) { res.stuck.push(`${kind} (「${x.label}」)`); continue; }
      await sleep(150); m = JSON.parse(await t.ev(LOOK));
      if (!m.notes.some((n) => n.includes("只有一個選項，自動做了"))) res.noNote.push(`${kind}: ${m.notes.length ? "「" + m.notes[0].slice(0, 30) + "」" : "no note"}`);
      else { res.made.push(kind); if (m.over.length) res.covers.push(`${kind}: over ${m.over.join(",")}`); if (m.cut) res.cutNotes.push(kind); }
    }
    for (const c of ST.chains) {
      await open(c.s2);
      const was = fp(c.s2);
      let m = null;
      for (let i = 0; i < 10; i++) { await sleep(250); m = JSON.parse(await t.ev(LOOK)); if (m.log && m.log !== was) break; }
      if (!m || m.log === was) { res.undoBad.push(`${c.where}: the only option was not made by itself`); continue; }
      await sleep(300); m = JSON.parse(await t.ev(LOOK));
      if (!m.undo) { res.undoBad.push(`${c.where}: no undo button after it`); continue; }
      // a real tap when the button is free; under the bar or the tray (tools/labels69.mjs measures that) it is clicked in the page
      if (await t.ev(`(()=>{const e=document.elementFromPoint(${m.undo.x},${m.undo.y}); return !!e && !!e.closest("button[data-undo]");})()`)) await t.tapAt(m.undo.x, m.undo.y);
      else await t.ev(`(()=>{const u=document.querySelector("button[data-undo]:not([disabled])"); if(u) u.click(); return 1;})()`);
      let loop = false, back = false;
      for (let i = 0; i < 8; i++) { await sleep(250); const k = JSON.parse(await t.ev(LOOK)); if (k.notes.length) loop = true; if (k.log === fp(c.s1)) back = true; }
      if (loop || !back) res.undoBad.push(`${c.where}: ${loop ? "a note came back right after undo (it made the only option again)" : "undo did not bring back the state before the human's move"}`);
      else res.undoOk++;
    }
  } catch (e) { rule(false, `broke off: ${e.message}`); }
  finally { t.close(); }
} finally { br.close(); }
rule(ST.singles.length >= 4, `kinds of single-option states met: ${ST.singles.length} (${ST.singles.map(([k]) => k).join(", ")}; needs ≥ 4)`);
rule(!res.stuck.length && res.made.length + res.noNote.length === ST.singles.length, `the page makes the only option within 2.5 s without a tap (${ST.singles.length - res.stuck.length} of ${ST.singles.length}${res.stuck.length ? "; still waiting: " + res.stuck.slice(0, 4).join(" | ") : ""})`);
rule(res.made.length > 0 && !res.covers.length && !res.cutNotes.length, `the note and the notes stacked with it cover no county box, and its words are not cut (${res.made.length} notes${res.covers.length ? "; " + res.covers.slice(0, 4).join(" | ") : ""}${res.cutNotes.length ? "; words cut: " + res.cutNotes.slice(0, 4).join(", ") : ""})`);
rule(!res.noNote.length && res.made.length > 0, `each one leaves a note 「只有一個選項，自動做了 …」 (${res.made.length} with it${res.noNote.length ? "; without: " + res.noNote.slice(0, 3).join(" | ") : ""})`);
rule(ST.chains.length > 0 && !res.undoBad.length, `undo right after an option made by itself goes back to before the human's move, no loop (${res.undoOk} of ${ST.chains.length}${res.undoBad.length ? "; " + res.undoBad.slice(0, 3).join(" | ") : ""})`);
for (const o of out) console.log(`${o.ok ? "✓" : "✗"} ${o.what}`);
const bad = out.filter((o) => !o.ok).length;
console.log(bad ? `FAIL: ${bad} of ${out.length} checks` : `PASS: ${out.length} checks`);
process.exit(bad ? 1 : 0);
