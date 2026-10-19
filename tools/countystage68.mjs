// tools/countystage68.mjs — the county stages after the UX audit (#68): the lit counties can be tapped, the bar's words
// are not cut, a county chip opens its box. Orchestrator's instrument: a peer may run it, does not edit it. Needs Chrome
// and a running dev server that serves this tree; about 3 minutes.
//
//   node tools/countystage68.mjs http://127.0.0.1:8787/president_2000/
//
// Owner, 2026-10-17, on the canvas 「UX 巡檢 · 建議修改」 (rows 1 and 4): 「Go」. County stages are taken from solo games
// played by this tree's own rules in node (seeded, at random) — the first placements of a campaign, a campaign after a
// cube, a local card, an event's effect, the policy forum's award and election day's canvassing, three of each where met —
// and each is put in the page's session store and opened (?play), at 390×664 (an iPhone's Safari with its bars, mobile
// metrics) in Chinese and English and at 1280×800 in Chinese. On each:
//   - every lit county (.tw-c[data-can]) has the centre of its box on screen and nothing over it: the element at that
//     point is inside that county (the bar, the hand, the floats must leave it free);
//   - nothing in the bar is cut: no element with words of its own whose overflow is hidden or line-clamped has more
//     words than room (scrollHeight / scrollWidth over its client size), and the bar itself does not scroll;
//   - the end of the action, when it is offered, is not the bar's biggest button: its area is at most 1.5 × the biggest
//     county chip's;
//   - a real tap (CDP) on a county chip opens that county's box ([data-popover="k"]) with its first option on screen;
//   - the page does not scroll.
// Every kind of stage has to be met at least once on each device.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";

const base = process.argv[2];
if (!base) { console.log("usage: node tools/countystage68.mjs <base url ending in /president_2000/>"); process.exit(2); }
const S = await import(new URL("../public/solo.js", import.meta.url).href);
const D = await import(new URL("../tests/driver.js", import.meta.url).href);
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KEY = "p2000.solo.session";

// ---- the stages, from this tree's rules
const isPlace = (c) => typeof c.move.county === "number";
function stages() {
  const kinds = { first: [], later: [], local: [], effect: [], award: [], election: [] };
  for (const [seat, seed] of [[0, 6801], [1, 6802], [2, 6803], [0, 6804], [1, 6805], [2, 6806]]) {
    let s = S.newSolo({ seat, level: 2, seed });
    const R1 = D.rng(seed);
    for (let n = 0; n < 4000 && s.st.phase !== "end"; n++) {
      const bots = S.botsToMove(s).length > 0, ch = S.choices(s, "zh-Hant");
      if (!bots && ch.some(isPlace)) {
        const v = s.st, pd = v.pending;
        const kind = v.phase === "election" ? "election" : v.phase === "debate" ? "award" : pd && pd.stage === "local" ? "local" : pd && pd.stage === "effect" ? "effect" : pd && pd.stage === "campaign" ? (ch.some((c) => c.move.type === "move") ? "first" : "later") : null;
        if (kind && kinds[kind].length < 3 && !kinds[kind].some((x) => x.seed === seed)) kinds[kind].push({ s, seed, where: `${kind}: seat ${seat} seed ${seed} 第 ${v.turn} 回合第 ${n} 步` });
      }
      if (bots && (!ch.length || R1() < 0.5)) s = S.stepBot(s);
      else { if (!ch.length) break; s = S.act(s, ch[Math.floor(R1() * ch.length)].move); }
    }
  }
  return kinds;
}
const KINDS = stages();

async function launch() {
  const root = process.env.TEMP || "/tmp", dir = `${root}/countystage68_${process.pid}_${Date.now()}`;
  for (const old of readdirSync(root).filter((d) => d.startsWith("countystage68_"))) { try { if (Date.now() - statSync(`${root}/${old}`).mtimeMs > 600000) rmSync(`${root}/${old}`, { recursive: true, force: true }); } catch { /* in use */ } }
  mkdirSync(dir, { recursive: true });
  const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "--remote-debugging-port=0", `--user-data-dir=${dir}`, "about:blank"], { stdio: "ignore" });
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

// The county stage measured (see the header).
const STAGE = `(() => {
  const r = (e) => { const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, r: b.right, b: b.bottom }; };
  const drawn = (e) => !!e && e.getClientRects().length > 0 && e.getBoundingClientRect().width > 0 && getComputedStyle(e).visibility !== "hidden";
  const sheet = document.querySelector("[data-sheet]");
  const covered = [];
  const lit = [...document.querySelectorAll(".tw-c[data-can]")];
  for (const g of lit) {
    const p = g.querySelector("[data-paper]") || g, b = r(p), cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) { covered.push(g.dataset.county + " off screen"); continue; }
    const e = document.elementFromPoint(cx, cy);
    if (!e || !e.closest('.tw-c[data-county="' + g.dataset.county + '"]')) covered.push(g.dataset.county + " under " + (e ? (e.closest("[data-sheet]") ? "the bar" : e.closest(".t-hand") ? "the hand" : (e.className && e.className.baseVal != null ? e.className.baseVal : e.className) || e.tagName) : "nothing"));
  }
  const cut = [];
  if (sheet) {
    for (const e of sheet.querySelectorAll("*")) {
      if (!drawn(e)) continue;
      const own = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!own) continue;
      const cs = getComputedStyle(e), clamp = cs.webkitLineClamp && cs.webkitLineClamp !== "none";
      const hid = (v) => /hidden|clip/.test(v);
      if ((clamp || hid(cs.overflowY)) && e.scrollHeight > e.clientHeight + 1) cut.push("「" + e.textContent.trim().slice(0, 24) + "」 " + e.scrollHeight + ">" + e.clientHeight);
      else if (hid(cs.overflowX) && e.scrollWidth > e.clientWidth + 1) cut.push("「" + e.textContent.trim().slice(0, 24) + "」 wide " + e.scrollWidth + ">" + e.clientWidth);
    }
  }
  const chips = sheet ? [...sheet.querySelectorAll("[data-open-county]")].filter(drawn).map((e) => ({ ...r(e), k: e.dataset.openCounty })) : [];
  const ends = sheet ? [...sheet.querySelectorAll(".opt[data-move]")].filter(drawn).filter((e) => { try { return ["done", "pass"].includes(JSON.parse(e.dataset.move).type); } catch { return false; } }).map(r) : [];
  return JSON.stringify({ sheet: !!sheet, turncard: !!document.querySelector("[data-turncard]"), lit: lit.length, covered, cut, scrolls: sheet ? sheet.scrollHeight > sheet.clientHeight + 1 : false, chips, ends,
    sh: document.documentElement.scrollHeight, ih: innerHeight, text: sheet ? sheet.innerText.replace(/\\s+/g, " ").slice(0, 80) : "" });
})()`;
const POP = `(() => { const p = document.querySelector("[data-popover]"); if (!p) return JSON.stringify({ k: null }); const o = [...p.querySelectorAll(".opt[data-move]")].find((e) => e.getClientRects().length); const b = o ? o.getBoundingClientRect() : null; return JSON.stringify({ k: p.dataset.popover, first: b ? { y: b.top, b: b.bottom, x: b.left, r: b.right } : null }); })()`;

const out = [];
const rule = (ok, what) => out.push({ ok, what });
const br = await launch();
try {
  for (const [dev, w, h, mobile, lang] of [["phone", 390, 664, true, "zh"], ["phone", 390, 664, true, "en"], ["desk", 1280, 800, false, "zh"]]) {
    const who = `${dev} ${lang}`;
    const st = { met: {}, covered: [], cut: [], scrolls: [], bigEnd: [], chipTap: [], chipOk: 0, scroll: [], none: [] };
    const t = await tab(br, w, h, mobile);
    try {
      await t.go(base); await t.ev(`localStorage.setItem("p2000.speed", "fast"); 1`);
      for (const [kind, list] of Object.entries(KINDS)) for (const x of list) {
        await t.ev(`sessionStorage.setItem(${JSON.stringify(KEY)}, ${JSON.stringify(JSON.stringify(x.s))}); 1`);
        await t.go(`${base}?play${lang === "en" ? "&lang=en" : ""}`);
        let m = null;
        for (let i = 0; i < 16; i++) {
          m = JSON.parse(await t.ev(STAGE));
          if (m.turncard) { await t.tapAt(w / 2, h / 2); await sleep(300); continue; }
          if (m.chips.length) break;
          await sleep(250);
        }
        if (!m || !m.chips.length) { st.none.push(`${x.where}${m && m.sheet ? `: the bar has no county chip (${m.text.slice(0, 40)})` : ": no bar"}`); continue; }
        st.met[kind] = (st.met[kind] || 0) + 1;
        if (m.covered.length) st.covered.push(`${x.where}: ${m.covered.join(", ")}`);
        if (m.cut.length) st.cut.push(`${x.where}: ${m.cut.join("; ")}`);
        if (m.scrolls) st.scrolls.push(`${x.where}: ${m.text.slice(0, 40)}`);
        if (m.sh > m.ih + 1) st.scroll.push(`${x.where}: ${m.sh}/${m.ih}`);
        const big = Math.max(...m.chips.map((c) => c.w * c.h));
        for (const e of m.ends) if (e.w * e.h > 1.5 * big) st.bigEnd.push(`${x.where}: ${Math.round(e.w)}×${Math.round(e.h)} vs a chip of ${Math.round(big)} px²`);
        const c = m.chips.find((q) => q.x >= 0 && q.r <= w && q.y >= 0 && q.b <= h) || m.chips[0];
        await t.tapAt(Math.min(Math.max(c.x + c.w / 2, 1), w - 1), Math.min(Math.max(c.y + c.h / 2, 1), h - 2)); await sleep(450);
        const p = JSON.parse(await t.ev(POP));
        if (p.k === c.k && p.first && p.first.y >= 0 && p.first.b <= h && p.first.x >= 0 && p.first.r <= w) st.chipOk++;
        else st.chipTap.push(`${x.where}: chip ${c.k} → box ${p.k ?? "none"}${p.first ? ` (first option at ${Math.round(p.first.y)}–${Math.round(p.first.b)})` : ", no option"}`);
      }
    } catch (e) { rule(false, `${who}: broke off: ${e.message}`); }
    finally { t.close(); }
    const met = Object.keys(KINDS).map((k) => `${k} ${st.met[k] || 0}`).join(", "), n = Object.values(st.met).reduce((a, b) => a + b, 0);
    rule(Object.keys(KINDS).every((k) => st.met[k] > 0) && !st.none.length, `${who}: every kind of county stage opened with its chips (${met}${st.none.length ? "; " + st.none.slice(0, 2).join(" | ") : ""})`);
    rule(n > 0 && !st.covered.length, `${who}: every lit county's box is on screen and free to tap (${st.covered.length ? st.covered.slice(0, 3).join(" | ") : `${n} stages clear`})`);
    rule(n > 0 && !st.cut.length && !st.scrolls.length, `${who}: nothing in the bar is cut and the bar does not scroll (${st.cut.length || st.scrolls.length ? [...st.cut.slice(0, 3), ...st.scrolls.slice(0, 2).map((s) => "scrolls: " + s)].join(" | ") : `${n} stages clear`})`);
    rule(n > 0 && !st.bigEnd.length, `${who}: the end of the action is no bigger than 1.5 × a county chip (${st.bigEnd.length ? st.bigEnd.slice(0, 2).join(" | ") : "all small"})`);
    rule(n > 0 && !st.chipTap.length, `${who}: a tap on a county chip opens that county's box with its first option on screen (${st.chipOk} ok${st.chipTap.length ? "; " + st.chipTap.slice(0, 2).join(" | ") : ""})`);
    rule(n > 0 && !st.scroll.length, `${who}: the page does not scroll at a county stage (${st.scroll.length ? st.scroll.slice(0, 2).join(" | ") : "never"})`);
  }
} finally { br.close(); }
for (const o of out) console.log(`${o.ok ? "✓" : "✗"} ${o.what}`);
const bad = out.filter((o) => !o.ok).length;
console.log(bad ? `FAIL: ${bad} of ${out.length} checks` : `PASS: ${out.length} checks`);
process.exit(bad ? 1 : 0);
