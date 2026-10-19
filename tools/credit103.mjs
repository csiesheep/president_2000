// tools/credit103.mjs — the credit, with the AI art disclosed, and the privacy link, on every page (#103). Orchestrator's
// instrument: a peer may run it, does not edit it. Needs Chrome and `wrangler dev` of this tree (it opens a room), about
// a minute.
//
//   node tools/credit103.mjs http://127.0.0.1:8787/president_2000/
//
// The audit (商業盤點 E, items 1, 6 and 8): the art was generated with Qwen-Image (Qwen Research License: non-commercial
// use only) while the credit says 「自創名稱與美術」 / "its own name and art" and the README "All art and prose are our
// own"; the solo table, the tutorial, the room and the end page carry no credit; the rules page's credit appears only
// once its script has run; no page links the privacy policy (https://csiesheep.com/privacy-policy/).
// Contract (orchestrator, #103):
//   - the credit says the art was generated with AI and names Qwen-Image and its non-commercial license: in Chinese
//     with 「AI」, 「Qwen」 and 「非商業」, in English with "AI", "Qwen" and "non-commercial"; 「自創名稱與美術」 and "its own
//     name and art" are gone;
//   - it is on screen on the home page and the rules page and the end page (both languages), and in the menu of the
//     solo table, the tutorial and the room once the menu is opened (both languages for the solo table); each place
//     also shows a link to https://csiesheep.com/privacy-policy/;
//   - the rules page's HTML, as served (no script run), already carries the Chinese credit;
//   - README.md no longer says "All art and prose are our own" and says the art was made with Qwen-Image under a
//     non-commercial license ("Qwen", "non-commercial").
// Reports 尚未實作 while no page names Qwen.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import * as S from "../public/solo.js";
import * as D from "../tests/driver.js";

const base = (process.argv[2] || "").replace(/\/?$/, "/");
if (!process.argv[2]) { console.log("usage: node tools/credit103.mjs <base url ending in /president_2000/>"); process.exit(2); }
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PRIVACY = "https://csiesheep.com/privacy-policy/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (k) => { if (process.env.CREDIT103_DEBUG) console.log(`  · ${k}`); };

async function launch() {
  const root = process.env.TEMP || "/tmp", dir = `${root}/credit103_${process.pid}_${Date.now()}`;
  for (const old of readdirSync(root).filter((d) => d.startsWith("credit103_"))) { try { if (Date.now() - statSync(`${root}/${old}`).mtimeMs > 600000) rmSync(`${root}/${old}`, { recursive: true, force: true }); } catch { /* in use */ } }
  mkdirSync(dir, { recursive: true });
  const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--remote-debugging-port=0", `--user-data-dir=${dir}`, "about:blank"], { stdio: "ignore" });
  let port = 0;
  for (let i = 0; i < 100 && !port; i++) { try { port = Number.parseInt(readFileSync(`${dir}/DevToolsActivePort`, "utf8"), 10) || 0; } catch { /* starting */ } if (!port) await sleep(100); }
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break; } catch { /* starting */ } await sleep(200); }
  return { port, close: () => proc.kill() };
}
async function tab(br, w = 390, h = 844) {
  const t = await (await fetch(`http://127.0.0.1:${br.port}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pend = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result || {}); pend.delete(m.id); } if (m.method === "Page.javascriptDialogOpening") ws.send(JSON.stringify({ id: ++id, method: "Page.handleJavaScriptDialog", params: { accept: true } })); };
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; const tm = setTimeout(() => { pend.delete(i); res({ timeout: true }); }, 20000); pend.set(i, (r) => { clearTimeout(tm); res(r); }); ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Page.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", { source: 'try { localStorage.setItem("p2000.tips", JSON.stringify({ seen: [], off: true })); localStorage.setItem("p2000.sound", JSON.stringify({ on: false, vol: 0 })); } catch (e) { /* no storage */ }' });
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: w < 768 });
  const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.timeout) throw new Error(`the tab did not answer: ${expr.slice(0, 60)}`); return r.result ? r.result.value : undefined; };
  const go = async (u, wait = 2500) => { await send("Page.navigate", { url: u }); await sleep(wait); };
  return { ev, go, close: () => { try { ws.close(); } catch { /* closed */ } } };
}
// What is on screen: the visible text (elements with a box, not hidden; innerText, so a hidden child's words do not count
// for its visible parent), and the visible links' hrefs.
const SEEN = `JSON.stringify((() => {
  const vis = (e) => { for (let x = e; x && x !== document.documentElement; x = x.parentElement) { const s = getComputedStyle(x); if (x.hidden || s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) return false; } const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const texts = [...document.querySelectorAll("p, span, small, div, li, footer, a, em")].filter((e) => e.children.length < 6 && vis(e)).map((e) => e.innerText.replace(/\\s+/g, " ").trim()).filter(Boolean);
  const links = [...document.querySelectorAll("a[href]")].filter(vis).map((a) => a.href);
  return { text: texts.join(" | "), all: document.body.innerText.replace(/\\s+/g, " "), links };
})())`;
const OPEN_MENU = `(() => { const b = [...document.querySelectorAll("[data-menu], [data-menu-top]")].find((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }); if (!b) return false; b.click(); return true; })()`;
function ended() {
  for (let seed = 1; seed < 200; seed++) {
    let s = S.advance(S.newSolo({ seat: 0, level: 0, seed })); const R = D.rng(seed * 13 + 7);
    for (let n = 0; n < 900 && s.st.phase !== "end"; n++) { const ch = S.choices(s, "zh-Hant"); if (!ch.length) { s = S.advance(s); continue; } s = S.advance(S.act(s, ch[Math.floor(R() * ch.length)].move)); }
    if (s.st.phase === "end") return { ...s, advisor: false };
  }
  return null;
}

const M = { places: {} };
const br = await launch();
try {
  const README = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  M.readme = { old: README.includes("All art and prose are our own"), qwen: README.includes("Qwen"), nc: /non-commercial/i.test(README) };
  M.rulesStatic = (await (await fetch(base + "rules")).text());
  const t = await tab(br);
  const look = async (key, url, { menu = false, wait = 2500, before } = {}) => {
    if (before) await before(); else await t.go(url, wait);
    if (menu) { M.places[key + ":menu"] = await t.ev(OPEN_MENU); await sleep(500); }
    M.places[key] = JSON.parse(await t.ev(SEEN)); step(`${key}: ${M.places[key].text.slice(0, 80)}`);
  };
  await look("home zh", base);
  await look("home en", base + "?lang=en");
  await look("rules zh", base + "rules");
  await look("rules en", base + "rules?lang=en");
  await look("solo zh", base + "?play", { menu: true, wait: 3500 });
  await look("solo en", base + "?play&lang=en", { menu: true, wait: 3500 });
  await look("tutorial", base + "?tutorial", { menu: true, wait: 3500 });
  const end = ended(); M.ended = !!end;
  if (end) {
    for (const [k, q] of [["end zh", ""], ["end en", "&lang=en"]]) await look(k, null, { before: async () => { await t.go(base, 1200); await t.ev(`(()=>{ sessionStorage.setItem("p2000.solo.session", ${JSON.stringify(JSON.stringify(end))}); return 1; })()`); await t.go(base + "?play" + q, 5000); } });
  }
  await look("room", null, { menu: true, before: async () => {
    await t.go(base + "?host", 2500);
    await t.ev(`(() => { const f = document.querySelector("form.rform"); if (!f) return 0; f.elements.name.value = "甲"; f.requestSubmit(); return 1; })()`); await sleep(2500);
  } });
  t.close();
} catch (e) { M.err = e.message; } finally { br.close(); }

const rows = [];
const row = (name, fn) => { try { const r = fn(); rows.push(r === true ? { name, ok: true } : typeof r === "string" && r.startsWith("TODO:") ? { name, todo: r.slice(5).trim() } : r && r.pass ? { name, ok: true, msg: r.msg } : { name, ok: false, msg: String(r) }); } catch (e) { rows.push({ name, ok: false, msg: `instrument: ${e.message}` }); } };
const okm = (c, msg) => (c ? { pass: true, msg } : msg);
const anyQwen = () => Object.values(M.places).some((p) => p && p.all && p.all.includes("Qwen"));
const disclosed = (text, en) => (en ? /\bAI\b/.test(text) && text.includes("Qwen") && /non-commercial/i.test(text) : text.includes("AI") && text.includes("Qwen") && text.includes("非商業"));
const PLACES = [["home zh", false], ["home en", true], ["rules zh", false], ["rules en", true], ["end zh", false], ["end en", true], ["solo zh", false], ["solo en", true], ["tutorial", false], ["room", false]];
row("credit 寫出美術是 AI（Qwen-Image，非商業授權）產生的，而且就在畫面上：首頁、規則、結局頁（中英），單人、教學、房間打開選單之後", () => {
  if (M.err) return `儀器中途停下：${M.err}`;
  if (!anyQwen()) return "TODO: 沒有一頁提到 Qwen";
  if (!M.ended) return "找不到打完的一局（instrument）";
  const bad = [];
  for (const [k, en] of PLACES) { const p = M.places[k]; if (!p) { bad.push(`${k} 沒量到`); continue; } if (M.places[k + ":menu"] === false) bad.push(`${k} 找不到選單按鈕`); if (!disclosed(p.text, en)) bad.push(`${k} 畫面上沒有`); }
  return okm(!bad.length, bad.join("；") || `${PLACES.length} 處都在畫面上`);
});
row("同樣這些地方都有一個看得到的隱私權政策連結（https://csiesheep.com/privacy-policy/）", () => {
  if (M.err) return `儀器中途停下：${M.err}`;
  if (!anyQwen() && Object.values(M.places).every((p) => !p || !p.links || !p.links.includes(PRIVACY))) return "TODO: 沒有一頁連到隱私權政策";
  const miss = PLACES.filter(([k]) => !(M.places[k] && M.places[k].links.includes(PRIVACY))).map(([k]) => k);
  return okm(!miss.length, miss.length ? `沒有連結：${miss.join("、")}` : `${PLACES.length} 處都有`);
});
row("舊的說法拿掉了：「自創名稱與美術」、\"its own name and art\" 不在任何一頁", () => {
  if (M.err) return `儀器中途停下：${M.err}`;
  const old = Object.entries(M.places).filter(([, p]) => p && p.all && (p.all.includes("自創名稱與美術") || p.all.includes("its own name and art"))).map(([k]) => k);
  if (!anyQwen()) return `TODO: 還是舊的說法（${old.join("、")}）`;
  return okm(!old.length, old.length ? `還在：${old.join("、")}` : "都拿掉了");
});
row("規則頁送出來的 HTML（沒跑 script）就有中文的 credit 與揭露", () => {
  if (M.err) return `儀器中途停下：${M.err}`;
  const body = (M.rulesStatic.match(/<body[\s\S]*<\/body>/i) || [""])[0].replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, " ");
  if (!anyQwen()) return "TODO: 還沒有揭露";
  return okm(disclosed(body, false), disclosed(body, false) ? "有" : "rules 的 HTML 裡沒有（要等 script 才出現）");
});
row("README：拿掉 \"All art and prose are our own\"，寫出美術是 Qwen-Image、non-commercial", () => {
  if (M.err) return `儀器中途停下：${M.err}`;
  const x = M.readme;
  if (x.old && !x.qwen) return "TODO: README 還是 \"All art and prose are our own\"";
  const bad = [x.old && "還在說 All art and prose are our own", !x.qwen && "沒有 Qwen", !x.nc && "沒有 non-commercial"].filter(Boolean);
  return okm(!bad.length, bad.join("；") || "改好了");
});

let bad = 0, pend = 0;
for (const r of rows) { if (r.todo) pend++; else if (!r.ok) bad++; console.log(`${r.todo ? "…" : r.ok ? "✓" : "✗"} ${r.name}${r.todo ? " — " + r.todo : r.msg ? " — " + r.msg : ""}`); }
console.log(`${bad ? "FAIL" : pend ? "TODO" : "PASS"}: ${rows.length - bad - pend} pass, ${bad} fail, ${pend} 尚未實作`);
process.exit(bad ? 1 : 0);
