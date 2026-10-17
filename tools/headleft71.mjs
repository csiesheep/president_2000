// tools/headleft71.mjs — on the desk the headlines sit in the left column, under the candidates (#71). Orchestrator's
// instrument: a peer may run it, does not edit it. Needs Chrome and a running dev server that serves this tree; about a
// minute.
//
//   node tools/headleft71.mjs http://127.0.0.1:8787/president_2000/
//
// Owner, 2026-10-17: 「桌機版，把頭條移到左邊，候選人下方」. Tables of solo games played by this tree's own rules in node
// (the start of turn 4, a campaign with its bar, election day), put in the page's session store and opened (?play), at
// 1280×800 and 1440×900, Chinese and English:
//   - the three headlines ([data-hl-slot] 1, 2, 3) sit in the candidates' column (.t-players): each within its left and
//     right edges (±2 px), the first below the candidates, the three one under the other in that order;
//   - each headline is wholly on screen and free: the element at its centre is inside it (the hand tray, the bar, the
//     floats leave it alone); its flag, name and who-leads line are not cut (no hidden overflow);
//   - the map (.tw-box) is right of the headlines, at least 640 wide, and its top no more than 16 px below the
//     candidates' top (the middle column is the map's alone; it is not left hanging lower);
//   - the page does not scroll.
// The phone is not to change: tools/issuehl65.mjs and tools/gamepage66.mjs keep measuring it.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";

const base = process.argv[2];
if (!base) { console.log("usage: node tools/headleft71.mjs <base url ending in /president_2000/>"); process.exit(2); }
const S = await import(new URL("../public/solo.js", import.meta.url).href);
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KEY = "p2000.solo.session";

// One solo game, the first move each time: the start of turn 4, the first campaign bar after it, election day.
function tables() {
  let s = S.newSolo({ seat: 0, level: 2, seed: 7101 });
  const out = {};
  for (let n = 0; n < 9000 && s.st.phase !== "end" && Object.keys(out).length < 3; n++) {
    const bots = S.botsToMove(s).length > 0, ch = bots ? [] : S.choices(s, "zh-Hant");
    if (!bots && ch.length) {
      if (!out.turn4 && s.st.turn === 4 && s.st.phase === "action" && !s.st.pending) out.turn4 = s;
      else if (out.turn4 && !out.bar && s.st.pending && s.st.pending.stage === "campaign" && ch.some((c) => typeof c.move.county === "number")) out.bar = s;
      else if (!out.election && s.st.phase === "election" && ch.some((c) => c.move.card)) out.election = s;
    }
    if (bots) s = S.stepBot(s); else { if (!ch.length) break; const pick = ch.find((c) => c.move.type === "play" && c.move.mode === "cp") || ch.find((c) => c.move.type === "action" && c.move.kind === "campaign") || ch[0]; s = S.act(s, pick.move); }
  }
  return Object.entries(out);
}
const TABLES = tables();

async function launch() {
  const root = process.env.TEMP || "/tmp", dir = `${root}/headleft71_${process.pid}_${Date.now()}`;
  for (const old of readdirSync(root).filter((d) => d.startsWith("headleft71_"))) { try { if (Date.now() - statSync(`${root}/${old}`).mtimeMs > 600000) rmSync(`${root}/${old}`, { recursive: true, force: true }); } catch { /* in use */ } }
  mkdirSync(dir, { recursive: true });
  const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--remote-debugging-port=0", `--user-data-dir=${dir}`, "about:blank"], { stdio: "ignore" });
  let port = 0;
  for (let i = 0; i < 100 && !port; i++) { try { port = Number.parseInt(readFileSync(`${dir}/DevToolsActivePort`, "utf8"), 10) || 0; } catch { /* starting */ } if (!port) await sleep(100); }
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break; } catch { /* starting */ } await sleep(200); }
  return { port, close: () => proc.kill() };
}
async function tab(br, w, h) {
  const t = await (await fetch(`http://127.0.0.1:${br.port}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pend = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; const tm = setTimeout(() => { pend.delete(i); rej(new Error("cdp timeout " + method)); }, 20000); pend.set(i, (m) => { clearTimeout(tm); res(m.result || {}); }); ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); return r.result ? r.result.value : undefined; };
  const go = async (url) => { await send("Page.navigate", { url }); await sleep(1300); await ev("document.fonts.ready.then(()=>1)"); };
  return { ev, go, close: () => { try { ws.close(); } catch { /* closed */ } } };
}
const MEASURE = `(() => {
  const R = (e) => { const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, r: b.right, b: b.bottom }; };
  const drawn = (e) => !!e && e.getClientRects().length > 0 && e.getBoundingClientRect().width > 0 && getComputedStyle(e).visibility !== "hidden";
  const q = (s) => document.querySelector(s);
  const tc = q("[data-turncard] button"); if (tc) tc.click();
  const pl = q(".t-players"), map = q(".tw-box");
  const slots = [...document.querySelectorAll("[data-hl-slot]")].filter(drawn).map((c) => {
    const b = R(c), e = document.elementFromPoint(b.x + b.w / 2, b.y + b.h / 2);
    const cut = ["data-hl-reward", "data-hl-name", "data-hl-status"].map((a) => c.querySelector("[" + a + "]")).filter(drawn).filter((x) => x.scrollWidth > x.clientWidth + 1 && getComputedStyle(x).overflow !== "visible").map((x) => x.textContent.trim().slice(0, 16));
    return { slot: c.dataset.hlSlot, ...b, free: !!e && c.contains(e), under: e && !c.contains(e) ? (e.closest(".t-hand") ? "the hand" : e.closest("[data-sheet]") ? "the bar" : (e.className && e.className.baseVal != null ? e.className.baseVal : e.className) || e.tagName) : "", cut };
  });
  return JSON.stringify({ players: drawn(pl) ? R(pl) : null, map: drawn(map) ? R(map) : null, slots, sh: document.documentElement.scrollHeight, ih: innerHeight, turncard: !!q("[data-turncard]") });
})()`;

const out = [];
const rule = (ok, what) => out.push({ ok, what });
if (TABLES.length < 3) rule(false, `only ${TABLES.length} of 3 tables reached (${TABLES.map(([n]) => n).join(", ")})`);
const br = await launch();
try {
  for (const [w, h] of [[1280, 800], [1440, 900]]) for (const lang of ["zh", "en"]) {
    const t = await tab(br, w, h);
    try {
      await t.go(base); await t.ev(`localStorage.setItem("p2000.speed", "fast"); 1`);
      for (const [name, s] of TABLES) {
        const who = `${w}×${h} ${lang} ${name}`;
        await t.ev(`sessionStorage.setItem(${JSON.stringify(KEY)}, ${JSON.stringify(JSON.stringify(s))}); 1`);
        await t.go(`${base}?play${lang === "en" ? "&lang=en" : ""}`);
        let m = JSON.parse(await t.ev(MEASURE));
        for (let i = 0; i < 8 && m.turncard; i++) { await sleep(300); m = JSON.parse(await t.ev(MEASURE)); }
        await sleep(300); m = JSON.parse(await t.ev(MEASURE));
        const P = m.players, C = m.slots;
        if (!P || C.length !== 3) { rule(false, `${who}: ${P ? "" : "no candidates; "}${C.length} headlines drawn`); continue; }
        const inCol = C.every((c) => c.x >= P.x - 2 && c.r <= P.r + 2), below = C[0].y >= P.b - 1, stacked = C[0].b <= C[1].y + 1 && C[1].b <= C[2].y + 1 && C.map((c) => c.slot).join() === "1,2,3";
        rule(inCol && below && stacked, `${who}: the headlines in the candidates' column, under them, one under the other (${C.map((c) => `${c.slot}: x ${Math.round(c.x)}–${Math.round(c.r)} y ${Math.round(c.y)}–${Math.round(c.b)}`).join("; ")}; candidates x ${Math.round(P.x)}–${Math.round(P.r)} end at ${Math.round(P.b)})`);
        rule(C.every((c) => c.b <= m.ih && c.free), `${who}: each headline on screen and free (${C.map((c) => `${c.slot}${c.b > m.ih ? " below the screen" : c.free ? "" : " under " + c.under}`).join(", ")})`);
        rule(C.every((c) => !c.cut.length), `${who}: nothing cut in the headlines (${C.filter((c) => c.cut.length).map((c) => `${c.slot}: ${c.cut.join("/")}`).join("; ") || "clear"})`);
        rule(!!m.map && m.map.x >= Math.max(...C.map((c) => c.r)) - 1 && m.map.w >= 640 && m.map.y <= P.y + 16, `${who}: the map right of the headlines, ≥ 640 wide, its top within 16 px of the candidates' top (${m.map ? `x ${Math.round(m.map.x)}, ${Math.round(m.map.w)} wide, top ${Math.round(m.map.y)} vs ${Math.round(P.y)}` : "no map"})`);
        rule(m.sh <= m.ih + 1, `${who}: the page does not scroll (${m.sh} ≤ ${m.ih})`);
      }
    } catch (e) { rule(false, `${w}×${h} ${lang}: broke off: ${e.message}`); }
    finally { t.close(); }
  }
} finally { br.close(); }
for (const o of out) console.log(`${o.ok ? "✓" : "✗"} ${o.what}`);
const bad = out.filter((o) => !o.ok).length;
console.log(bad ? `FAIL: ${bad} of ${out.length} checks` : `PASS: ${out.length} checks`);
process.exit(bad ? 1 : 0);
