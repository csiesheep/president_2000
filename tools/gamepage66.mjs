// tools/gamepage66.mjs — the game page laid out again (design 甲 「疊層收緊」, #66): the whole map on one screen, the hand
// lowered, the record a button, the rivals' moves on the map. Orchestrator's instrument: a peer may run it, does not
// edit it. Needs Chrome and a running dev server.
//
//   node tools/gamepage66.mjs http://127.0.0.1:8787/president_2000/
//
// Owner, 2026-10-17: 「目標是不 scroll 就能看到完整地圖 … 手牌位置降低一半，點了才升高，並且出現使用，及可以使用的動作 …
// 紀錄變成上方按鈕，可縮放」; of three designs, 「甲」. A solo game at its first human decision after the rivals moved, at
// 390×664 (an iPhone's Safari with its bars, CDP mobile metrics) and 1280×800, Chinese and English:
//   - the page does not scroll (scrollHeight ≤ innerHeight) and the map (.tw-box) is wholly on screen, at least 290×400
//     on the phone and 640 wide on the desk; the phone never scrolls sideways;
//   - nothing of 「剛剛」 (.t-now), the region list (.tw-reg) or the cube legend (.tw-leg) is drawn, and the pick-a-card
//     prompt (p.play) is not on the page;
//   - the top row (.t-top) ends within 50 px of the top and holds the record button [data-feed-toggle]; on the phone the
//     candidates' row (.t-players) and the headlines (.t-track) are each at most 60 px high;
//   - the hand is lowered: .t-hand[data-hand="down"], and of the first hand card (.hc) between 30 % and 60 % is on
//     screen; a tap (a real pointer tap, CDP) on a playable card raises it: .t-hand[data-hand="up"], a [data-sheet]
//     whose .opt[data-move] buttons (at least one) are wholly on screen, the page still not scrolling; its back
//     button ([data-sel=""]) lowers it again; and (#67, owner 2026-10-17 「再點一下同一張牌，會收起來」) a second tap on
//     the same card in the tray lowers it too, as does a tap on the raised card's own face in the sheet (the face
//     carries data-sel="<id>" like the tray card);
//   - a tap on [data-feed-toggle] draws the record (.t-feed[data-open="1"]) on screen with at least one line, still
//     without the page scrolling; a second tap closes it (the record not drawn);
//   - when the rivals placed cubes before this decision, at least one [data-act-chip][data-county] is drawn, its centre
//     inside the map and within 40 px of its county's box, and the county carries data-changed (when they placed none,
//     the row says so and passes);
//   - on the desk the candidates (.t-players) sit left of the map;
//   - the floats over the map — the toast [data-act-toast], the totals [data-issue-lead], the issue chips — cover no
//     county's box while they are visible (added after the first delivery: the toast sat on 台北市 and 金馬, the totals
//     on 屏東).
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";

const base = process.argv[2];
if (!base) { console.log("usage: node tools/gamepage66.mjs <base url ending in /president_2000/>"); process.exit(2); }
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch() {
  const root = process.env.TEMP || "/tmp", dir = `${root}/gamepage66_${process.pid}_${Date.now()}`;
  for (const old of readdirSync(root).filter((d) => d.startsWith("gamepage66_"))) { try { if (Date.now() - statSync(`${root}/${old}`).mtimeMs > 600000) rmSync(`${root}/${old}`, { recursive: true, force: true }); } catch { /* in use */ } }
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
  let id = 0; const pend = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, (m) => res(m.result || {})); ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile });
  const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); return r.result ? r.result.value : undefined; };
  const tapAt = async (x, y) => { for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 }); };
  await send("Page.navigate", { url }); await sleep(2200);
  await ev("document.fonts.ready.then(()=>1)");
  return { ev, tapAt, close: () => { try { ws.close(); } catch { /* closed */ } } };
}
const START = `(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.offsetParent&&/開始選戰|Start/.test(x.textContent)); if(b){b.click();return 1;} return 0;})()`;
const CLOSE = `(()=>{const b=document.querySelector('[data-turncard] button, [data-replay] button'); if(b){b.click();return 1;} return 0;})()`;
// Wait until it is the human's decision (a card to play or a sheet) and no replay is running, up to 20 s.
const MINE = `(()=>!!document.querySelector('.t-hand[data-pick="1"], [data-sheet]') && !document.querySelector('[data-turncard], [data-replay]'))()`;
const MEASURE = (en) => `(() => {
  const r = (e) => { const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, r: b.right, b: b.bottom }; };
  const drawn = (e) => !!e && e.getClientRects().length > 0 && e.getBoundingClientRect().width > 0 && getComputedStyle(e).visibility !== "hidden";
  const q = (s) => document.querySelector(s);
  const map = q(".tw-box"), top = q(".t-top"), tog = q("[data-feed-toggle]"), hand = q(".t-hand"), hc = q(".t-hand .hc");
  const hcr = hc ? r(hc) : null, ih = innerHeight;
  const vis = hcr ? Math.max(0, Math.min(hcr.b, ih) - Math.max(hcr.y, 0)) / hcr.h : null;
  const play = ${en ? "/Play \\d of 4|Tap the card .* in your hand/i" : "/第 \\d \\/ 4 次出牌/"};
  const chips = [...document.querySelectorAll("[data-act-chip][data-county]")].filter(drawn).map((c) => { const b = r(c); const g = q('.tw-c[data-county="' + c.dataset.county + '"]'); const gr = g ? r(g) : null;
    return { county: c.dataset.county, cx: b.x + b.w / 2, cy: b.y + b.h / 2, changed: !!(g && g.hasAttribute("data-changed")), near: !!gr && b.x + b.w / 2 >= gr.x - 40 && b.x + b.w / 2 <= gr.r + 40 && b.y + b.h / 2 >= gr.y - 40 && b.y + b.h / 2 <= gr.b + 40 }; });
  const pick = [...document.querySelectorAll(".hc[data-sel]")].filter((c) => drawn(c) && !c.classList.contains("dis"))[0];
  // The floats over the map (the toast, the totals, the issue chips) must not sit on any county's box.
  const boxes = [...document.querySelectorAll(".tw-c[data-county]")].map((g) => { const p = g.querySelector("[data-paper]") || g; return { k: g.dataset.county, ...r(p) }; });
  const hit = (b) => boxes.filter((x) => b.x < x.r - 1 && b.r > x.x + 1 && b.y < x.b - 1 && b.b > x.y + 1).map((x) => x.k);
  const floats = [["toast", q("[data-act-toast]")], ["totals", q("[data-issue-lead]")], ...[...document.querySelectorAll("[data-act-chip][data-issue]")].map((e, i) => ["issue chip " + i, e])]
    .filter(([, e]) => drawn(e) && Number(getComputedStyle(e).opacity) > 0.05).map(([n, e]) => ({ n, over: hit(r(e)) }));
  return JSON.stringify({
    sh: document.documentElement.scrollHeight, ih, sw: document.documentElement.scrollWidth, iw: innerWidth,
    map: map ? r(map) : null, top: top ? r(top) : null, tog: drawn(tog) ? r(tog) : null,
    players: q(".t-players") ? r(q(".t-players")) : null, track: q(".t-track") ? r(q(".t-track")) : null,
    now: drawn(q(".t-now")), reg: drawn(q(".tw-reg")), leg: drawn(q(".tw-leg")), playText: play.test(document.body.innerText),
    hand: hand ? hand.dataset.hand : null, pickFlag: hand ? hand.dataset.pick : null, hcVis: vis,
    chips, pickCard: pick ? { ...r(pick), id: pick.dataset.sel } : null, floats,
  });
})()`;
const AFTER_TAP = `(() => {
  const r = (e) => { const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, r: b.right, b: b.bottom }; };
  const drawn = (e) => !!e && e.getClientRects().length > 0 && e.getBoundingClientRect().width > 0 && getComputedStyle(e).visibility !== "hidden";
  const sheet = document.querySelector("[data-sheet]"), hand = document.querySelector(".t-hand");
  const opts = sheet ? [...sheet.querySelectorAll(".opt[data-move]")].filter(drawn).map(r) : [];
  const back = sheet ? sheet.querySelector('[data-sel=""]') : null;
  return JSON.stringify({ sheet: drawn(sheet) ? r(sheet) : null, card: sheet ? sheet.dataset.card : null, opts, hand: hand ? hand.dataset.hand : null, sh: document.documentElement.scrollHeight, ih: innerHeight, back: drawn(back) ? r(back) : null });
})()`;
const FEED = `(() => {
  const r = (e) => { const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, r: b.right, b: b.bottom }; };
  const drawn = (e) => !!e && e.getClientRects().length > 0 && e.getBoundingClientRect().width > 0 && getComputedStyle(e).visibility !== "hidden";
  const f = document.querySelector(".t-feed"), tog = document.querySelector("[data-feed-toggle]");
  return JSON.stringify({ open: f ? f.dataset.open : null, drawn: drawn(f), rect: drawn(f) ? r(f) : null, lines: f ? [...f.querySelectorAll("li")].filter(drawn).length : 0, sh: document.documentElement.scrollHeight, ih: innerHeight, tog: drawn(tog) ? r(tog) : null });
})()`;

const out = [];
const rule = (ok, what) => out.push({ ok, what });
const inside = (b, ih) => b.y >= -1 && b.b <= ih + 1;
const br = await launch();
try {
  for (const [dev, w, h, mobile] of [["phone", 390, 664, true], ["desk", 1280, 800, false]]) {
    for (const lang of ["zh", "en"]) {
      const who = `${dev} ${lang}`;
      const t = await tab(br, `${base}?play${lang === "en" ? "&lang=en" : ""}`, w, h, mobile);
      if (!(await t.ev(START))) { rule(false, `${who}: no start button found`); t.close(); continue; }
      await sleep(2500); await t.ev(CLOSE);
      for (let i = 0; i < 40 && !(await t.ev(MINE)); i++) { await sleep(500); await t.ev(CLOSE); }
      await sleep(600);
      const m = JSON.parse(await t.ev(MEASURE(lang === "en")));
      rule(m.sh <= m.ih + 1, `${who}: the page does not scroll (${m.sh} ≤ ${m.ih})`);
      rule(!!m.map && inside(m.map, m.ih) && (dev === "phone" ? m.map.w >= 290 && m.map.h >= 400 : m.map.w >= 640), `${who}: the whole map on screen, ${dev === "phone" ? "≥ 290×400" : "≥ 640 wide"} (${m.map ? `${Math.round(m.map.w)}×${Math.round(m.map.h)} at ${Math.round(m.map.y)}–${Math.round(m.map.b)} of ${m.ih}` : "no map"})`);
      if (dev === "phone") rule(m.sw <= m.iw, `${who}: no sideways scroll (${m.sw} ≤ ${m.iw})`);
      rule(!m.now && !m.reg && !m.leg && !m.playText, `${who}: no 剛剛, region list, cube legend or pick-a-card prompt (剛剛 ${m.now}, list ${m.reg}, legend ${m.leg}, prompt ${m.playText})`);
      rule(!!m.top && m.top.b <= 50 && !!m.tog && m.tog.b <= 56, `${who}: the top row ends by 50 px and holds the record button (top ${m.top ? Math.round(m.top.b) : "-"}, button ${m.tog ? Math.round(m.tog.b) : "not drawn"})`);
      if (dev === "phone") rule(!!m.players && m.players.h <= 60 && !!m.track && m.track.h <= 60, `${who}: candidates and headlines each ≤ 60 px (${m.players ? Math.round(m.players.h) : "-"} / ${m.track ? Math.round(m.track.h) : "-"})`);
      else rule(!!m.players && !!m.map && m.players.r <= m.map.x + 1, `${who}: the candidates left of the map (${m.players ? Math.round(m.players.r) : "-"} ≤ ${m.map ? Math.round(m.map.x) : "-"})`);
      rule(m.hand === "down" && m.hcVis != null && m.hcVis >= 0.3 && m.hcVis <= 0.6, `${who}: the hand lowered, 30–60 % of a card on screen (data-hand ${m.hand}, ${m.hcVis == null ? "no card" : Math.round(m.hcVis * 100) + "%"})`);
      if (m.chips.length) rule(m.chips.every((c) => c.changed && c.near && c.cx >= m.map.x && c.cx <= m.map.r && c.cy >= m.map.y && c.cy <= m.map.b), `${who}: the rivals' chips on the map, each within 40 px of its county, the county marked (${m.chips.map((c) => `${c.county}${c.changed ? "" : " unmarked"}${c.near ? "" : " far"}`).join(", ")})`);
      else rule(true, `${who}: the rivals placed no cube before this decision (chips not sampled)`);
      rule(m.floats.every((f) => !f.over.length), `${who}: the floats over the map (toast, totals, issue chips) cover no county box (${m.floats.length ? m.floats.map((f) => `${f.n}: ${f.over.length ? "over " + f.over.join(",") : "clear"}`).join("; ") : "no floats drawn"})`);
      // tap a playable card
      if (m.pickCard) {
        await t.tapAt(m.pickCard.x + m.pickCard.w / 2, Math.min(m.pickCard.y + 20, m.ih - 4)); await sleep(500);
        const a = JSON.parse(await t.ev(AFTER_TAP));
        rule(a.hand === "up" && !!a.sheet && a.card === m.pickCard.id && a.opts.length > 0 && a.opts.every((o) => inside(o, a.ih)) && a.sh <= a.ih + 1,
          `${who}: a tap raises the hand and shows the card's plays on screen (data-hand ${a.hand}, sheet for ${a.card || "-"}, ${a.opts.length} plays${a.opts.length ? ` at ${Math.round(Math.min(...a.opts.map((o) => o.y)))}–${Math.round(Math.max(...a.opts.map((o) => o.b)))}` : ""}, scroll ${a.sh}/${a.ih})`);
        // #67: the same card tapped again in the tray lowers the hand; so does the raised face in the sheet.
        const SAME = (where) => `(()=>{const e=[...document.querySelectorAll('${where} [data-sel="${m.pickCard.id}"]')].find((x)=>x.getClientRects().length&&x.getBoundingClientRect().width>0); if(!e) return null; const r=e.getBoundingClientRect(); return JSON.stringify({x:r.x,y:r.y,w:r.width,h:r.height});})()`;
        const tray = JSON.parse(await t.ev(SAME(".t-hand")) || "null");
        if (tray) { await t.tapAt(tray.x + tray.w / 2, Math.min(Math.max(tray.y + 20, 0), m.ih - 4)); await sleep(500); }
        const s2 = JSON.parse(await t.ev(AFTER_TAP));
        rule(!!tray && s2.hand === "down" && !s2.sheet, `${who}: a second tap on the same tray card lowers the hand (#67; ${tray ? `data-hand ${s2.hand}, sheet ${s2.sheet ? "still drawn" : "gone"}` : "the card not found in the tray"})`);
        if (s2.hand !== "up") { await t.tapAt(m.pickCard.x + m.pickCard.w / 2, Math.min(m.pickCard.y + 20, m.ih - 4)); await sleep(500); }
        const face = JSON.parse(await t.ev(SAME("[data-sheet]")) || "null");
        if (face) { await t.tapAt(face.x + face.w / 2, Math.min(Math.max(face.y + face.h / 2, 0), m.ih - 4)); await sleep(500); }
        const s3 = JSON.parse(await t.ev(AFTER_TAP));
        rule(!!face && s3.hand === "down" && !s3.sheet, `${who}: a tap on the raised card's face lowers the hand (#67; ${face ? `data-hand ${s3.hand}, sheet ${s3.sheet ? "still drawn" : "gone"}` : "no [data-sel] face in the sheet"})`);
        if (s3.hand !== "up") { await t.tapAt(m.pickCard.x + m.pickCard.w / 2, Math.min(m.pickCard.y + 20, m.ih - 4)); await sleep(500); }
        const b2 = JSON.parse(await t.ev(AFTER_TAP));
        if (b2.back) { await t.tapAt(b2.back.x + b2.back.w / 2, b2.back.y + b2.back.h / 2); await sleep(400); }
        const c = JSON.parse(await t.ev(AFTER_TAP));
        rule(c.hand === "down" && !c.sheet, `${who}: the back button lowers the hand again (data-hand ${c.hand}, sheet ${c.sheet ? "still drawn" : "gone"})`);
      } else rule(true, `${who}: this decision picks no card (a sheet opened first); the tap not sampled here`);
      // the record
      // #74 (owner 2026-10-17 「Desktop 上，紀錄 預設展開在右邊」): on the desk the record may stand open from the start;
      // then the first tap closes it and the second opens it again (tools/feeddock74.mjs measures where it stands).
      const f0 = JSON.parse(await t.ev(FEED)), pre = dev === "desk" && f0.open === "1" && f0.drawn;
      if (m.tog && pre) {
        await t.tapAt(m.tog.x + m.tog.w / 2, m.tog.y + m.tog.h / 2); await sleep(400);
        const g = JSON.parse(await t.ev(FEED));
        rule(g.open === "0" && !g.drawn, `${who}: the record stands open from the start; a tap closes it (data-open ${g.open}, ${g.drawn ? "still drawn" : "gone"})`);
        if (g.tog) { await t.tapAt(g.tog.x + g.tog.w / 2, g.tog.y + g.tog.h / 2); await sleep(400); }
        const f = JSON.parse(await t.ev(FEED));
        rule(f.open === "1" && f.drawn && inside(f.rect, f.ih) && f.lines > 0 && f.sh <= f.ih + 1, `${who}: a second tap opens it on screen again (data-open ${f.open}, ${f.lines} lines, ${f.rect ? `${Math.round(f.rect.y)}–${Math.round(f.rect.b)}` : "not drawn"}, scroll ${f.sh}/${f.ih})`);
      } else if (m.tog) {
        await t.tapAt(m.tog.x + m.tog.w / 2, m.tog.y + m.tog.h / 2); await sleep(400);
        const f = JSON.parse(await t.ev(FEED));
        rule(f.open === "1" && f.drawn && inside(f.rect, f.ih) && f.lines > 0 && f.sh <= f.ih + 1, `${who}: the record opens on screen (data-open ${f.open}, ${f.lines} lines, ${f.rect ? `${Math.round(f.rect.y)}–${Math.round(f.rect.b)}` : "not drawn"}, scroll ${f.sh}/${f.ih})`);
        if (f.tog) { await t.tapAt(f.tog.x + f.tog.w / 2, f.tog.y + f.tog.h / 2); await sleep(400); }
        const g = JSON.parse(await t.ev(FEED));
        rule(g.open === "0" && !g.drawn, `${who}: a second tap closes it (data-open ${g.open}, ${g.drawn ? "still drawn" : "gone"})`);
      }
      t.close();
    }
  }
} finally { br.close(); }
for (const o of out) console.log(`${o.ok ? "✓" : "✗"} ${o.what}`);
const bad = out.filter((o) => !o.ok).length;
console.log(bad ? `FAIL: ${bad} of ${out.length} checks` : `PASS: ${out.length} checks`);
process.exit(bad ? 1 : 0);
