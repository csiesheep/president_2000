// tools/stub51.mjs — the card's stub: its issue and where it canvasses on election day, apart from the event (#51).
// Orchestrator's instrument: a peer may run it, does not edit it. Needs Chrome and a running dev server.
//
//   node tools/stub51.mjs http://127.0.0.1:8787/president_2000/
//
// Owner, 2026-10-15: 「開單在牌上加說明： 投票日催票 某縣市」「重新設計一下牌票讓其與事件內容好分辦一些」; on the designs
// (canvas 「卡牌三案」), 「以第一版為主，把議題也計設到下方」, then 「乙」 with 「像是催票的簡單的線條的報紙圖案」, and
// 「好，就用乙」. Version 乙: the bottom of the card is a light paper stub, below a perforation, in two rows — the issue
// (a line-drawn newspaper icon and the issue's name, 「無議題」 on a local card) and 「投票日催票」 (a line-drawn ballot box
// and the county); the issue pill is gone from the picture's top-right corner; the rest cubes are small squares.
// Contract (orchestrator, #51), on every event or local card face: the rules page's card list (rules#allcards: each event
// card carries data-face="<card id>", each local face — one per county and deck — data-local="<county>"), the hand cards
// in a solo game at 390 and 1440 ([data-sel] / [data-pick] with data-camp) and the big face a tapped hand card opens
// ([data-face]):
//   - one [data-stub] inside the card, as wide as the card and touching its bottom (±1.5 px), its background light
//     (relative luminance ≥ 0.6) and not the card's colour;
//   - in it [data-stub-issue]: an <svg> and the issue's name (兩岸 / 清廉 / 經濟民生, 無議題 when the card has none); and
//     [data-stub-county]: an <svg>, 「投票日催票」 and the county's name. In English: Latin text, no Chinese;
//   - the issue's name appears nowhere else on the card (the old pill is gone);
//   - the event text ends above the stub and is not cut (its box and its scroll height fit); no text in the stub is cut.
//     A hand card is a preview (the big face shows it all): there the name and the text may be shortened as they were
//     before the stub (3 lines, an ellipsis), but must still end above it (orchestrator's ruling on FE's question, #51);
//   - [data-rest="<n>"] in the stub with n = the card's rest cubes (CP 2 → 2, 3 → 1, 4 → 0); none, or "0", when 0 (not
//     read on a rules-page local face, which stands for cards of 2 and 3 CP). Since #60 (v0.7): no rest cubes anywhere.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { EVENTS, localCards } from "../public/shared/cards.js";

const base = process.argv[2];
if (!base) { console.log("usage: node tools/stub51.mjs <base url ending in /president_2000/>"); process.exit(2); }
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function launch() {
  const root = process.env.TEMP || "/tmp", dir = `${root}/stub51_${process.pid}_${Date.now()}`;
  for (const old of readdirSync(root).filter((d) => d.startsWith("stub51_"))) { try { if (Date.now() - statSync(`${root}/${old}`).mtimeMs > 600000) rmSync(`${root}/${old}`, { recursive: true, force: true }); } catch { /* in use */ } }
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
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    if (m.method === "Page.javascriptDialogOpening") ws.send(JSON.stringify({ id: ++id, method: "Page.handleJavaScriptDialog", params: { accept: false } })); };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id;
    const tm = setTimeout(() => { pend.delete(i); rej(new Error(`instrument: CDP ${method} got no reply in 20 s (${url})`)); }, 20000);
    pend.set(i, (m) => { clearTimeout(tm); res(m.result || {}); }); ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile });
  const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); return r.result ? r.result.value : undefined; };
  await send("Page.navigate", { url }); await sleep(2200);
  await ev("document.fonts.ready.then(()=>1)");
  return { ev, close: () => { try { ws.close(); } catch { /* closed */ } } };
}

// What each card should say, from the card tables (the issue's Chinese names copied from the rulebook, §十四).
const ISSUE_ZH = { cross: "兩岸", clean: "清廉", econ: "經濟民生" };
// Rest cubes: CP 2 → 2, 3 → 1, 4 → 0 until rulebook v0.6. Since #60 new games and the rules page are v0.7, which has
// none: every stub this tool opens must show no rest cubes (no [data-rest], or "0").
const REST = { 2: 0, 3: 0, 4: 0 };
const CARDS = Object.fromEntries([...EVENTS, ...localCards()].map((c) => [c.id, c]));
const WANT = Object.fromEntries(Object.values(CARDS).map((c) => [c.id, { issue: c.icon ? ISSUE_ZH[c.icon] : "無議題", county: c.county, rest: REST[c.cp] ?? 0 }]));
const wantOf = (key) => (key.startsWith("local:") ? { issue: "無議題", county: key.slice(6), rest: null } : WANT[key]);

// One card measured in the page (fan rotation and transitions off). Returns what it read.
const READ = `window.__stub = (el) => {
  const tf = el.style.transform, tr = el.style.transition, p = el.parentElement, ptf = p && p.style.transform;
  el.style.transition = "none"; el.style.transform = "none"; if (p) p.style.transform = "none"; void el.offsetWidth;
  const box = (e) => e.getBoundingClientRect();
  const rgb = (s) => (s.match(/[\\d.]+/g) || []).slice(0, 3).map(Number);
  const lum = (c) => { const v = c.map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
  const text = (e) => (e ? e.textContent.replace(/\\s+/g, " ").trim() : "");
  const own = (e) => [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").replace(/\\s+/g, " ").trim();
  const cut = (e) => e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1;
  const out = { stubs: el.querySelectorAll("[data-stub]").length, bad: [] };
  const cr = box(el), st = el.querySelector("[data-stub]");
  if (st) {
    const sr = box(st), sb = rgb(getComputedStyle(st).backgroundColor), cb = rgb(getComputedStyle(el).backgroundColor);
    out.edge = [sr.left - cr.left, cr.right - sr.right, cr.bottom - sr.bottom].map((n) => Math.round(n * 10) / 10);
    out.lum = Math.round(lum(sb) * 100) / 100; out.sameColour = sb.join() === cb.join();
    const iss = st.querySelector("[data-stub-issue]"), cty = st.querySelector("[data-stub-county]");
    out.issue = iss ? { svg: !!iss.querySelector("svg"), text: text(iss) } : null;
    out.county = cty ? { svg: !!cty.querySelector("svg"), text: text(cty) } : null;
    const rest = st.querySelector("[data-rest]"); out.rest = rest ? rest.getAttribute("data-rest") : null;
    for (const n of st.querySelectorAll("*")) { if (!own(n)) continue; const r = box(n);
      if (cut(n) && getComputedStyle(n).overflow !== "visible") out.bad.push("「" + own(n).slice(0, 8) + "」 is cut in the stub");
      if (r.left < sr.left - 1 || r.right > sr.right + 1 || r.top < sr.top - 1 || r.bottom > sr.bottom + 1) out.bad.push("「" + own(n).slice(0, 8) + "」 sticks out of the stub"); }
    out.outside = [...el.querySelectorAll("*")].filter((n) => !st.contains(n) && own(n)).map(own);
    out.stubTop = sr.top - cr.top;
  }
  out.texts = [...el.querySelectorAll("*")].filter((n) => !(st && st.contains(n)) && own(n)).map((n) => { const r = box(n); let clipped = cut(n) && getComputedStyle(n).overflow !== "visible";
    return { t: own(n), bottom: r.bottom - cr.top, clipped }; });
  el.style.transform = tf; el.style.transition = tr; if (p) p.style.transform = ptf || "";
  return out;
}; 1`;

// Judge one card against its table entry. en: the English page (Latin text, no Chinese).
function judge(id, m, en, preview = false) {
  const w = wantOf(id), bad = [...(m.bad || [])];
  if (!w) return [`${id}: not in the card tables`];
  if (m.stubs !== 1) return [`${id}: ${m.stubs} [data-stub] (1)`];
  if (m.edge.some((n) => Math.abs(n) > 1.5)) bad.push(`stub off the card's sides / bottom by ${m.edge.join("/")} px`);
  if (m.lum < 0.6 || m.sameColour) bad.push(`stub background luminance ${m.lum}${m.sameColour ? ", the card's own colour" : ""} (light, ≥ 0.6)`);
  if (!m.issue) bad.push("no [data-stub-issue]");
  else {
    if (!m.issue.svg) bad.push("no icon in the issue row");
    if (en ? !/[A-Za-z]/.test(m.issue.text) || /[\u4e00-\u9fff]/.test(m.issue.text) : !m.issue.text.includes(w.issue)) bad.push(`issue row 「${m.issue.text}」 (${en ? "English" : w.issue})`);
  }
  if (!m.county) bad.push("no [data-stub-county]");
  else {
    if (!m.county.svg) bad.push("no icon in the canvass row");
    if (en ? !/[A-Za-z]/.test(m.county.text) || /[\u4e00-\u9fff]/.test(m.county.text) : !(m.county.text.includes("投票日催票") && m.county.text.includes(w.county))) bad.push(`canvass row 「${m.county.text}」 (${en ? "English" : "投票日催票 " + w.county})`);
  }
  const rest = m.rest == null ? 0 : Number(m.rest);
  if (w.rest !== null && rest !== w.rest) bad.push(`data-rest ${m.rest} (${w.rest})`);
  if (m.issue && !en && m.outside.some((t) => t === w.issue)) bad.push(`the issue 「${w.issue}」 is also outside the stub (the old pill?)`);
  for (const t of m.texts) { if (t.clipped && !preview) bad.push(`「${t.t.slice(0, 10)}」 is cut`); if (t.bottom > m.stubTop + 1) bad.push(`「${t.t.slice(0, 10)}」 runs into the stub (${Math.round(t.bottom - m.stubTop)} px)`); }
  return bad.length ? [`${id}: ${bad.join("; ")}`] : [];
}

const out = [];
const rule = (ok, what) => out.push({ ok, what });
const br = await launch();
try {
  // 1–2. The rules page's card list, Chinese and English.
  for (const [lang, url] of [["zh", `${base}rules#allcards`], ["en", `${base}rules?lang=en#allcards`]]) {
    const t = await tab(br, url, 1280, 900, false);
    await t.ev(READ);
    const got = JSON.parse(await t.ev(`JSON.stringify([...document.querySelectorAll("#allcards [data-face], #allcards [data-local]")].map((el) => ({ id: el.hasAttribute("data-face") ? el.getAttribute("data-face") : "local:" + el.getAttribute("data-local"), m: __stub(el) })))`));
    const all = Number(await t.ev(`document.querySelectorAll("#allcards [data-camp]").length`));
    const bad = got.flatMap((c) => judge(c.id, c.m, lang === "en"));
    const ev = got.filter((c) => !c.id.startsWith("local:")).length, lo = got.length - ev;
    rule(ev >= 70 && lo >= 20 && got.length === all && !bad.length, `rules page (${lang}): ${ev} event cards with data-face (≥ 70) and ${lo} local faces with data-local (≥ 20), of ${all} cards on the list, each with its stub — issue, 投票日催票 and county, rest cubes, nothing cut${bad.length ? ` — ${bad.length} wrong: ${bad.slice(0, 3).join(" | ")}` : ""}`);
    t.close();
  }
  // 3–4. The hand in a solo game at 390 and 1440.
  for (const [w, h, mob] of [[390, 844, true], [1440, 900, false]]) {
    const t = await tab(br, `${base}?play`, w, h, mob);
    await t.ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.offsetParent&&/開始選戰|Start/.test(x.textContent)); b&&b.click(); return 1;})()`);
    await sleep(8000);
    await t.ev(READ);
    const got = JSON.parse(await t.ev(`JSON.stringify([...document.querySelectorAll(".tbl [data-sel][data-camp], .tbl [data-pick][data-camp]")].map((el) => ({ id: el.getAttribute("data-sel") || el.getAttribute("data-pick"), m: __stub(el) })))`));
    const bad = got.flatMap((c) => judge(c.id, c.m, false, true));
    rule(got.length >= 4 && !bad.length, `${w} hand: ${got.length} cards (≥ 4), each with its stub${bad.length ? ` — ${bad.slice(0, 3).join(" | ")}` : ""}`);
    // the big face of the first hand card, opened by tapping it
    const opened = await t.ev(`(()=>{ const c = document.querySelector(".tbl [data-sel][data-camp]"); if (!c) return null; c.click(); return c.getAttribute("data-sel"); })()`);
    await sleep(600);
    const face = JSON.parse(await t.ev(`JSON.stringify((() => { const f = document.querySelector("[data-face][data-camp]"); return f ? { id: f.getAttribute("data-face"), m: __stub(f) } : null; })())`));
    const fb = face ? judge(face.id, face.m, false) : [];
    rule(!!face && face.id === opened && !fb.length, `${w} big face of ${opened}: ${!face ? "did not open" : fb.length ? fb.join(" | ") : "its stub right"}`);
    t.close();
  }
} finally { br.close(); }
let bad = 0;
for (const x of out) { if (!x.ok) bad++; console.log(`${x.ok ? "✓" : "✗"} ${x.what}`); }
console.log(bad ? `FAIL: ${bad} of ${out.length}` : `PASS: ${out.length} checks`);
process.exit(bad ? 1 : 0);
