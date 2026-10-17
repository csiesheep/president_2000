// tools/marks72.mjs — every action's result on the map (#72): where the county chips with their marks sit and whether
// their words are cut. Orchestrator's instrument: a peer may run it, does not edit it. Needs Chrome and a running dev
// server that serves this tree; about a minute.
//
//   node tools/marks72.mjs http://127.0.0.1:8787/president_2000/
//
// Owner, 2026-10-17: 「自己和對手，每個動作都要顯示效果，比如 檢定成功或失敗」, then 「動作結果可以」. States from solo
// games played by this tree's own rules in node — the human to decide right after the rivals moved with failed checks
// among their actions, and after a failed check of the human's own — put in the page's session store and opened (?play),
// at 390×664 (CDP mobile) in Chinese and English and at 1280×800 in Chinese:
//   - every county chip ([data-act-chip][data-county]) holds at least one mark ([data-act-mark]), lies inside the map
//     box, and its centre is within 40 px of its county's box;
//   - its words are not cut: the chip's content fits (scrollWidth, scrollHeight within its client size) and it is
//     wholly on screen;
//   - it covers no other county's box (rect[data-paper]) by more than 2 px each way (added after the first delivery,
//     78b54ec: stacked chips hid the boxes below them, 27 times on the phone in Chinese, 42 in English, 23 on the desk,
//     against 0 / 1 / 0 for the single chips before #72);
//   - the marks on screen match the actions: the number of marks in the chips equals the number of the rivals' county
//     actions in the record plus the human's own last move's (counted in node), and the failed ones show 「✗」 in Chinese.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";

const base = process.argv[2];
if (!base) { console.log("usage: node tools/marks72.mjs <base url ending in /president_2000/>"); process.exit(2); }
const S = await import(new URL("../public/solo.js", import.meta.url).href);
const D = await import(new URL("../tests/driver.js", import.meta.url).href);
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KEY = "p2000.solo.session";
const CUBE = new Set(["fill", "cross", "grey", "steal", "remove"]);
const acts = (s) => {
  const r = (s.rec || []).filter((e) => e.seat != null && e.seat !== s.seat && ((CUBE.has(e.k) && e.county != null) || (e.k === "move" && e.to != null)));
  const m = ((s.mine && s.mine.lines) || []).filter((e) => (CUBE.has(e.k) && e.county != null) || (e.k === "move" && e.to != null));
  return { n: r.length + m.length, fails: r.filter((e) => e.k !== "move" && !e.ok).length + m.filter((e) => e.k !== "move" && !e.ok).length, mineFail: m.some((e) => e.k !== "move" && !e.ok) };
};
function states() {
  const out = [];
  for (const [seat, seed] of [[2, 7201], [1, 7202], [0, 7203], [2, 7204], [1, 7205], [0, 7206]]) {
    let s = S.newSolo({ seat, level: 2, seed }); const R1 = D.rng(seed);
    let rivals = 0, mine = 0;
    for (let n = 0; n < 3000 && s.st.phase !== "end" && (rivals < 2 || mine < 1); n++) {
      const bots = S.botsToMove(s).length > 0, ch = S.choices(s, "zh-Hant");
      if (!bots && ch.length && s.st.phase === "action") {
        const a = acts(s);
        if (rivals < 2 && a.fails >= 2 && a.n >= 4) { out.push({ s, a, where: `rivals: seat ${seat} seed ${seed} 第 ${s.st.turn} 回合第 ${n} 步` }); rivals++; }
        else if (mine < 1 && a.mineFail) { out.push({ s, a, where: `mine: seat ${seat} seed ${seed} 第 ${s.st.turn} 回合第 ${n} 步` }); mine++; }
      }
      if (bots) s = S.stepBot(s); else { if (!ch.length) break; s = S.act(s, ch[Math.floor(R1() * ch.length)].move); }
    }
  }
  return out;
}
const ST = states();

async function launch() {
  const root = process.env.TEMP || "/tmp", dir = `${root}/marks72_${process.pid}_${Date.now()}`;
  for (const old of readdirSync(root).filter((d) => d.startsWith("marks72_"))) { try { if (Date.now() - statSync(`${root}/${old}`).mtimeMs > 600000) rmSync(`${root}/${old}`, { recursive: true, force: true }); } catch { /* in use */ } }
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
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; const tm = setTimeout(() => { pend.delete(i); rej(new Error("cdp timeout " + method)); }, 20000); pend.set(i, (m) => { clearTimeout(tm); res(m.result || {}); }); ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile });
  const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); return r.result ? r.result.value : undefined; };
  const go = async (url) => { await send("Page.navigate", { url }); await sleep(1300); await ev("document.fonts.ready.then(()=>1)"); };
  return { ev, go, close: () => { try { ws.close(); } catch { /* closed */ } } };
}
const MEASURE = `(() => {
  const R = (e) => { const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, r: b.right, b: b.bottom }; };
  const drawn = (e) => !!e && e.getClientRects().length > 0 && e.getBoundingClientRect().width > 0 && getComputedStyle(e).visibility !== "hidden";
  const tc = document.querySelector("[data-turncard] button"); if (tc) tc.click();
  const box = document.querySelector(".tw-box"), bb = box ? R(box) : null;
  const chips = [...document.querySelectorAll("[data-act-chip][data-county]")].filter(drawn).map((c) => {
    const r = R(c), g = document.querySelector('.tw-c[data-county="' + c.dataset.county + '"] [data-paper]'), gr = g ? R(g) : null, cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    return { k: c.dataset.county, marks: c.querySelectorAll("[data-act-mark]").length, fails: [...c.querySelectorAll('[data-act-mark][data-ok="0"]')].map((m) => m.textContent.trim()),
      inBox: !!bb && r.x >= bb.x - 1 && r.r <= bb.r + 1 && r.y >= bb.y - 1 && r.b <= bb.b + 1, near: !!gr && cx >= gr.x - 40 && cx <= gr.r + 40 && cy >= gr.y - 40 && cy <= gr.b + 40,
      over: [...document.querySelectorAll("rect[data-paper]")].filter((p) => p.getAttribute("data-paper") !== c.dataset.county).filter((p) => { const b = p.getBoundingClientRect(); return Math.min(r.r, b.right) - Math.max(r.x, b.left) > 2 && Math.min(r.b, b.bottom) - Math.max(r.y, b.top) > 2; }).map((p) => p.getAttribute("data-paper")),
      cut: c.scrollWidth > c.clientWidth + 1 || c.scrollHeight > c.clientHeight + 1, onScreen: r.x >= 0 && r.y >= 0 && r.r <= innerWidth && r.b <= innerHeight };
  });
  return JSON.stringify({ chips, turncard: !!document.querySelector("[data-turncard]") });
})()`;

const out = [];
const rule = (ok, what) => out.push({ ok, what });
if (!ST.some((x) => x.where.startsWith("mine")) || ST.filter((x) => x.where.startsWith("rivals")).length < 2) rule(false, `states met: ${ST.map((x) => x.where.split(":")[0]).join(", ")} (needs rivals and mine)`);
const br = await launch();
try {
  for (const [dev, w, h, mobile, lang] of [["phone", 390, 664, true, "zh"], ["phone", 390, 664, true, "en"], ["desk", 1280, 800, false, "zh"]]) {
    const who = `${dev} ${lang}`, bad = { empty: [], where: [], cut: [], count: [], words: [], cover: [] };
    let chipsN = 0;
    const t = await tab(br, w, h, mobile);
    try {
      await t.go(base); await t.ev(`localStorage.setItem("p2000.speed", "step"); 1`);
      for (const x of ST) {
        await t.ev(`sessionStorage.setItem(${JSON.stringify(KEY)}, ${JSON.stringify(JSON.stringify(x.s))}); 1`);
        await t.go(`${base}?play${lang === "en" ? "&lang=en" : ""}`);
        let m = JSON.parse(await t.ev(MEASURE));
        for (let i = 0; i < 6 && m.turncard; i++) { await sleep(300); m = JSON.parse(await t.ev(MEASURE)); }
        await sleep(200); m = JSON.parse(await t.ev(MEASURE));
        for (const c of m.chips) {
          chipsN++;
          if (!c.marks) bad.empty.push(`${x.where}: county ${c.k}`);
          if (!c.inBox || !c.near) bad.where.push(`${x.where}: county ${c.k}${c.inBox ? "" : " outside the map"}${c.near ? "" : " far from its box"}`);
          if (c.over.length) bad.cover.push(`${x.where}: county ${c.k}'s chip over ${c.over.join(",")}`);
          if (c.cut || !c.onScreen) bad.cut.push(`${x.where}: county ${c.k}${c.cut ? " words cut" : ""}${c.onScreen ? "" : " off screen"}`);
          if (lang === "zh" && c.fails.some((f) => f !== "✗")) bad.words.push(`${x.where}: county ${c.k} 「${c.fails.join("")}」`);
        }
        const total = m.chips.reduce((a, c) => a + c.marks, 0);
        if (total !== x.a.n) bad.count.push(`${x.where}: ${total} marks on screen, ${x.a.n} actions`);
      }
    } catch (e) { rule(false, `${who}: broke off: ${e.message}`); }
    finally { t.close(); }
    rule(chipsN > 0 && !bad.empty.length && !bad.count.length, `${who}: a mark per action (${chipsN} chips${bad.count.length || bad.empty.length ? "; " + [...bad.count, ...bad.empty.map((s) => "empty chip " + s)].slice(0, 3).join(" | ") : ", the counts match the record"})`);
    rule(chipsN > 0 && !bad.where.length, `${who}: every chip inside the map and within 40 px of its county (${bad.where.length ? bad.where.slice(0, 3).join(" | ") : "all"})`);
    rule(chipsN > 0 && !bad.cover.length, `${who}: no chip covers another county's box (${bad.cover.length ? bad.cover.length + " chips; " + bad.cover.slice(0, 3).join(" | ") : "none"})`);
    rule(chipsN > 0 && !bad.cut.length, `${who}: no chip's words cut, all on screen (${bad.cut.length ? bad.cut.slice(0, 3).join(" | ") : "all"})`);
    if (lang === "zh") rule(chipsN > 0 && !bad.words.length, `${who}: a failed check reads 「✗」 (${bad.words.length ? bad.words.slice(0, 3).join(" | ") : "all"})`);
  }
} finally { br.close(); }
for (const o of out) console.log(`${o.ok ? "✓" : "✗"} ${o.what}`);
const bad = out.filter((o) => !o.ok).length;
console.log(bad ? `FAIL: ${bad} of ${out.length} checks` : `PASS: ${out.length} checks`);
process.exit(bad ? 1 : 0);
