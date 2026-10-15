// tools/imgchurn.mjs — do pictures get torn down and rebuilt when nothing about them changed? (#28)
// Orchestrator's instrument: a peer may run it, does not edit it. Needs Chrome and a running dev server.
//
//   node tools/imgchurn.mjs http://127.0.0.1:8787/president_2000/
//
// It drives headless Chrome over the DevTools protocol (Node's own WebSocket, no packages) and counts,
// with a MutationObserver, the NEW <img> elements (ones never on the page before) created in windows
// where no picture changes; moving an existing <img> back into place does not count:
//   A. the tutorial's first two "next" presses (1440 wide and 390 wide);
//   B. the rivals' turn after the tutorial's "end the action" (1440 wide);
//   C. the rivals' moves at the start of a normal solo game (1440 wide).
// Pass: no <img> rebuilt in any window (owner, 2026-10-15: "玩 tutorial 時，圖片會一直閃動").
// It also prints how many times the table was swapped as a whole, for the record.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";

const base = process.argv[2];
if (!base) { console.log("usage: node tools/imgchurn.mjs <base url ending in /president_2000/>"); process.exit(2); }
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch(port) {
  const dir = `${process.env.TEMP || "/tmp"}/imgchurn${port}`;
  mkdirSync(dir, { recursive: true });
  const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, "about:blank"], { stdio: "ignore" });
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
  await send("Page.navigate", { url }); await sleep(2200);
  await ev("document.fonts.ready.then(()=>1)");
  return { ev, close: () => { try { ws.close(); } catch { /* closed */ } } };
}

// Every <img> on the page when the window opens is remembered; an <img> element that shows up later and
// was never seen is a new element - the picture was rebuilt. Putting an existing element back (moving it)
// is not counted: it keeps its decoded picture and does not blink.
const WATCH = `(()=>{
  window.__churn = { newImg: 0, newSrc: [], tableSwaps: 0 };
  window.__churnSeen = new WeakSet(document.querySelectorAll("img"));
  if (window.__churnMO) window.__churnMO.disconnect();
  const look = (n) => { if (n.nodeType !== 1) return; const list = n.tagName === "IMG" ? [n] : [...(n.querySelectorAll ? n.querySelectorAll("img") : [])];
    for (const im of list) if (!__churnSeen.has(im)) { __churnSeen.add(im); __churn.newImg++; if (__churn.newSrc.length < 5) __churn.newSrc.push((im.getAttribute("src") || "").split("/").slice(-2).join("/")); } };
  window.__churnMO = new MutationObserver((list) => { for (const m of list) for (const n of m.addedNodes) {
    look(n); if (n.nodeType === 1 && n.querySelector && n.querySelector("[data-county]")) __churn.tableSwaps++; } });
  window.__churnMO.observe(document.body, { childList: true, subtree: true });
  return 1;
})()`;
const READ = "JSON.stringify(window.__churn)";
const BOX = `((document.querySelector('[data-tutorial]')||{}).dataset||{}).tutorial||null`;
const NEXT = `(()=>{const b=document.querySelector('[data-tutorial]'); const nb=b&&[...b.querySelectorAll('button')].find(x=>/下一步|Next/.test(x.textContent)); if(nb){nb.click();return 'next';} const f=document.querySelector('[data-tut-focus]'); if(f){f.dispatchEvent(new MouseEvent('click',{bubbles:true}));return 'focus';} return 'none';})()`;
const ONLY = `(()=>{const ok=[...document.querySelectorAll('[data-move]')].filter(x=>!x.disabled&&x.offsetParent); if(ok.length===1){ok[0].click();return 1;} return ok.length;})()`;

const results = [];
const br = await launch(9480);
try {
  for (const [w, h, mob] of [[1440, 900, false], [390, 844, true]]) {
    const t = await tab(br, `${base}?tutorial`, w, h, mob);
    await t.ev(WATCH);
    for (let i = 0; i < 2; i++) { await t.ev(NEXT); await sleep(1400); }
    results.push({ window: `A tutorial next x2 (${w})`, expect: "map", step: await t.ev(BOX), ...JSON.parse(await t.ev(READ)) });
    if (w === 1440) {
      for (let n = 0; n < 16; n++) {
        const id = await t.ev(BOX);
        if (id === "endAction" || !id) break;
        await t.ev(NEXT); await sleep(900);
        if ((await t.ev(BOX)) === id) { await t.ev(ONLY); await sleep(900); }
      }
      await t.ev(WATCH);
      await t.ev(`(()=>{const f=document.querySelector('[data-tut-focus]'); f&&f.click(); return 1;})()`);
      for (let i = 0; i < 40; i++) { await sleep(500); if ((await t.ev(BOX)) === "opponents") break; }
      results.push({ window: "B tutorial rivals' turn (1440)", expect: "opponents", step: await t.ev(BOX), ...JSON.parse(await t.ev(READ)) });
    }
    t.close();
  }
  const p = await tab(br, `${base}?play`, 1440, 900, false);
  await p.ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.offsetParent&&/開始選戰|Start/.test(x.textContent)); b&&b.click(); return 1;})()`);
  await sleep(300);
  await p.ev(WATCH);
  await sleep(8000);
  results.push({ window: "C solo start, rivals moving (1440)", ...JSON.parse(await p.ev(READ)) });
  p.close();
} finally { br.close(); }

// A window counts only if something on the page changed in it (the step moved on, or the table was
// redrawn); a window where nothing happened proves nothing and is reported, not passed.
let bad = 0, measured = 0;
for (const r of results) {
  const happened = r.tableSwaps > 0 || r.newImg > 0 || /tutorial/.test(r.window);
  if (!happened) { console.log(`… ${r.window}: nothing was redrawn in this window, nothing measured`); continue; }
  measured++;
  if (r.expect && r.step !== r.expect) { bad++; console.log(`✗ ${r.window}: the walk stopped at ${r.step}, not ${r.expect} (instrument did not reach the window)`); continue; }
  const ok = r.newImg === 0;
  if (!ok) bad++;
  console.log(`${ok ? "✓" : "✗"} ${r.window}${r.step ? " → " + r.step : ""}: new <img> elements ${r.newImg}${r.newImg ? " (e.g. " + r.newSrc.join(", ") + ")" : ""}, table swapped ${r.tableSwaps} times`);
}
if (!measured) { console.log("FAIL: no window measured anything"); process.exit(1); }
console.log(bad ? `FAIL: ${bad} of ${measured} windows rebuild pictures that did not change` : `PASS: ${measured} windows, no picture rebuilt`);
process.exit(bad ? 1 : 0);
