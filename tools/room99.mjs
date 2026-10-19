// tools/room99.mjs — a room seat survives a second tab and a lost sessionStorage (#99). Orchestrator's instrument: a peer
// may run it, does not edit it. Needs Chrome and `wrangler dev` of this tree (rooms are Durable Objects), about 2 minutes.
//
//   node tools/room99.mjs http://127.0.0.1:8787/president_2000/
//
// The audit (商業盤點 C, rooms): the same player opening the room in a second tab made the two tabs kick each other
// forever (the server closes the old socket with 4000 "replaced"; it reconnected 1–2 s later and kicked the other, every
// ~6 s); with sessionStorage gone (a tab closed, an in-app browser killed) the player could not get the seat back (「這個
// 房間已經開局，你沒有座位」, the computer played it to the end). Contract (orchestrator, #99), one browser profile:
//   - the token is kept in localStorage too: p2000.room.<CODE> = { token, name, at } (at: when it was stored, ms); a
//     page opening ?room=<CODE> with nothing in its sessionStorage sits down again with it when it is less than 24 h
//     old, and shows the join form when it is older; leaving the room (#rleave) removes it;
//   - a socket closed with 4000 ("replaced": the seat was opened in another tab) is not reconnected — not by the backoff,
//     not on waking or going online — and the page shows [data-room-elsewhere] with a [data-room-takeover] button;
//     tapping it takes the seat back here (the other tab then shows [data-room-elsewhere] in turn) and nothing loops.
// The seat a tab holds is read off the server's hello messages (CDP); new sockets are counted per tab.
// Reports 尚未實作 until it is there: the two tab rows until a page shows [data-room-elsewhere], the two storage rows
// until localStorage holds p2000.room.<CODE>.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";

const base = process.argv[2];
if (!base) { console.log("usage: node tools/room99.mjs <base url ending in /president_2000/ (wrangler dev)>"); process.exit(2); }
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch() {
  const root = process.env.TEMP || "/tmp", dir = `${root}/room99_${process.pid}_${Date.now()}`;
  for (const old of readdirSync(root).filter((d) => d.startsWith("room99_"))) { try { if (Date.now() - statSync(`${root}/${old}`).mtimeMs > 600000) rmSync(`${root}/${old}`, { recursive: true, force: true }); } catch { /* in use */ } }
  mkdirSync(dir, { recursive: true });
  const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "--remote-debugging-port=0", `--user-data-dir=${dir}`, "about:blank"], { stdio: "ignore" });
  let port = 0;
  for (let i = 0; i < 100 && !port; i++) { try { port = Number.parseInt(readFileSync(`${dir}/DevToolsActivePort`, "utf8"), 10) || 0; } catch { /* starting */ } if (!port) await sleep(100); }
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break; } catch { /* starting */ } await sleep(200); }
  return { port, close: () => proc.kill() };
}
// A tab in the same profile (one localStorage), with its sockets and the server's hellos recorded.
async function tab(br, url, w = 390, h = 844) {
  const t = await (await fetch(`http://127.0.0.1:${br.port}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pend = new Map(), log = { sockets: 0, hellos: [] };
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
    if (m.method === "Network.webSocketCreated") log.sockets++;
    if (m.method === "Network.webSocketFrameReceived") { try { const d = JSON.parse(m.params.response.payloadData); if (d.t === "hello") log.hellos.push({ seat: d.seat, at: Date.now() }); } catch { /* not ours */ } }
    if (m.method === "Page.javascriptDialogOpening") ws.send(JSON.stringify({ id: ++id, method: "Page.handleJavaScriptDialog", params: { accept: true } }));
  };
  // every call gives up after 20 s (a tab that stopped answering must not hang the run)
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; const tm = setTimeout(() => { pend.delete(i); res({ timeout: true }); }, 20000); pend.set(i, (m) => { clearTimeout(tm); res(m.result || {}); }); try { ws.send(JSON.stringify({ id: i, method, params })); } catch { clearTimeout(tm); res({ closed: true }); } });
  ws.onclose = () => { log.closed = true; };
  await send("Page.enable"); await send("Network.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", { source: 'try { if (!localStorage.getItem("p2000.tips")) localStorage.setItem("p2000.tips", JSON.stringify({ seen: [], off: true })); localStorage.setItem("p2000.sound", JSON.stringify({ on: false, vol: 0 })); } catch (e) { /* no storage */ }' });
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: true });
  const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.timeout || r.closed) throw new Error(`the tab did not answer (${r.timeout ? "20 s" : "closed"}): ${expr.slice(0, 60)}`); return r.result ? r.result.value : undefined; };
  const go = async (u, wait = 2500) => { await send("Page.navigate", { url: u }); await sleep(wait); };
  const tapSel = async (sel) => {
    // the first match that is drawn (a page can carry hidden copies, e.g. the top menu button under a table)
    const c = await ev(`(()=>{ const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.getClientRects().length && x.getBoundingClientRect().width); if (!e) return null; e.scrollIntoView({ block: "center" }); const r = e.getBoundingClientRect(); return r.width ? [r.left + r.width / 2, r.top + r.height / 2] : null; })()`);
    if (!c) return false;
    for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: c[0], y: c[1], button: "left", clickCount: 1 });
    return true;
  };
  if (url) await go(url);
  return { ev, go, tapSel, log, seat: () => (log.hellos.length ? log.hellos[log.hellos.length - 1].seat : null), close: () => { try { ws.close(); } catch { /* closed */ } } };
}
const STATE = `(()=>{ return { table: !!document.querySelector("#rstage [data-phase]"), form: !!document.querySelector("form.rform"), elsewhere: !!document.querySelector("[data-room-elsewhere]"), takeover: !!document.querySelector("[data-room-takeover]"), url: location.search }; })()`;
const waitFor = async (t, pred, ms) => { const t0 = Date.now(); let s; do { s = await t.ev(STATE); if (pred(s)) return { ok: true, s, ms: Date.now() - t0 }; await sleep(200); } while (Date.now() - t0 < ms); return { ok: false, s, ms: Date.now() - t0 }; };

const M = {};
const br = await launch();
const step = (k) => { if (process.env.ROOM99_DEBUG) console.log(`  · ${k}`); };
try {
  // A hosts, sits, starts with bots
  const A = await tab(br, `${base}?host`);
  await A.ev(`(() => { const f = document.querySelector("form.rform"); if (!f) return 0; f.elements.name.value = "甲"; f.requestSubmit(); return 1; })()`);
  for (let i = 0; i < 40 && !(await A.ev(`!!document.querySelector(".btn.sit[data-msg]")`)); i++) await sleep(250);
  await A.ev(`(() => { const b = document.querySelector(".btn.sit[data-msg]"); b && b.click(); return 1; })()`); await sleep(800);
  await A.ev(`(() => { const b = document.querySelector(".big.go[data-msg]"); b && b.click(); return 1; })()`);
  M.aTable = await waitFor(A, (s) => s.table, 15000);
  const code = (await A.ev("new URLSearchParams(location.search).get('room')")) || "";
  M.code = code; M.aSeat = A.seat();
  M.stored = await A.ev(`(()=>{ try { return JSON.parse(localStorage.getItem("p2000.room.${code}")); } catch { return null; } })()`);
  // B: the same room in a second tab (its own empty sessionStorage, the same localStorage)
  const B = await tab(br, `${base}?room=${code}`);
  M.bTable = await waitFor(B, (s) => s.table || s.form, 10000); M.bSeat = B.seat();
  M.aElse = await waitFor(A, (s) => s.elsewhere, 6000);
  step(`A else ${M.aElse.ok}, B ${JSON.stringify(M.bTable.s)}`);
  const aSock0 = A.log.sockets, bSock0 = B.log.sockets;
  await sleep(20000);
  M.aQuiet = { newSockets: A.log.sockets - aSock0, state: await A.ev(STATE) };
  M.bQuiet = { newSockets: B.log.sockets - bSock0, state: await B.ev(STATE) };
  // A wakes (visibility / online): still no socket
  await A.ev(`(() => { window.dispatchEvent(new Event("online")); document.dispatchEvent(new Event("visibilitychange")); return 1; })()`); await sleep(3000);
  M.aWake = A.log.sockets - aSock0;
  // A takes the seat back
  M.tookOver = await A.tapSel("[data-room-takeover]");
  M.aBack = await waitFor(A, (s) => s.table && !s.elsewhere, 6000); M.aSeat2 = A.seat();
  M.bElse = await waitFor(B, (s) => s.elsewhere, 6000);
  const aSock1 = A.log.sockets, bSock1 = B.log.sockets;
  await sleep(12000);
  M.loop = { a: A.log.sockets - aSock1, b: B.log.sockets - bSock1, aState: await A.ev(STATE), bState: await B.ev(STATE) };
  B.close();
  // C: a tab with an expired token, then a fresh one
  const C = await tab(br, null);
  await C.go(`${base}`, 800);
  await C.ev(`(()=>{ const k = "p2000.room.${code}"; const r = JSON.parse(localStorage.getItem(k) || "null"); if (r) { r.at = Date.now() - 25 * 3600 * 1000; localStorage.setItem(k, JSON.stringify(r)); } return !!r; })()`);
  await C.go(`${base}?room=${code}`);
  M.cOld = await waitFor(C, (s) => s.form || s.table, 8000); M.cOldSeat = C.seat();
  await C.ev(`(()=>{ sessionStorage.clear(); const k = "p2000.room.${code}"; const r = JSON.parse(localStorage.getItem(k) || "null"); if (r) { r.at = Date.now(); localStorage.setItem(k, JSON.stringify(r)); } return !!r; })()`);
  await C.go(`${base}?room=${code}`);
  M.cNew = await waitFor(C, (s) => s.table, 10000); M.cNewSeat = C.seat();
  // leaving removes the stored token
  // #rleave sits in the menu (#rmenu), hidden until a menu button opens it: the top one, or the table header's
  await C.tapSel("#rmenub, #rstage [data-menu]"); await sleep(500);
  M.left = await C.tapSel("#rleave"); await sleep(2500);
  M.afterLeave = await A.ev(`localStorage.getItem("p2000.room.${code}")`);
  A.close(); C.close();
} catch (e) { M.err = e.message; } finally { br.close(); }

const rows = [];
const row = (name, fn) => { try { const r = fn(); rows.push(r === true ? { name, ok: true } : typeof r === "string" && r.startsWith("TODO:") ? { name, todo: r.slice(5).trim() } : r && r.pass ? { name, ok: true, msg: r.msg } : { name, ok: false, msg: String(r) }); } catch (e) { rows.push({ name, ok: false, msg: `instrument: ${e.message}` }); } };
const okm = (c, msg) => (c ? { pass: true, msg } : msg);
const pre = M.err ? `儀器中途停下：${M.err}` : !M.aTable || !M.aTable.ok ? `房主的頁面沒有進到牌桌（${JSON.stringify(M.aTable && M.aTable.s)}）（instrument）` : M.aSeat == null ? "沒有讀到房主的座位（hello）（instrument）" : null;
const ready = M.aElse && M.aElse.ok || M.bElse && M.bElse.ok;
const R0 = (name, fn) => row(name, () => pre || (!ready ? "TODO: 被另一個分頁接手的頁面還沒有 [data-room-elsewhere]" : fn()));
row("token 也存在 localStorage：p2000.room.<代碼> = { token, name, at }", () => {
  if (pre) return pre;
  const s = M.stored;
  if (!s) return "TODO: localStorage 裡還沒有 p2000.room.<代碼>";
  return okm(typeof s.token === "string" && s.token && typeof s.name === "string" && Number.isFinite(s.at) && Math.abs(Date.now() - s.at) < 3600 * 1000, `存的是 ${JSON.stringify({ ...s, token: s.token ? "…" : s.token })}`);
});
R0("第二個分頁打開同一房：直接坐回同一席；第一個分頁顯示「在另一個分頁」，20 秒內不重連、喚醒也不重連", () => {
  const bad = [];
  if (!M.bTable.ok || !M.bTable.s.table) bad.push(`第二個分頁不是牌桌（${JSON.stringify(M.bTable.s)}）`);
  if (M.bSeat !== M.aSeat) bad.push(`第二個分頁坐 ${M.bSeat}，原本是 ${M.aSeat}`);
  if (!M.aElse.ok) bad.push("第一個分頁沒有顯示 [data-room-elsewhere]");
  if (M.aQuiet.newSockets) bad.push(`第一個分頁 20 秒內又開了 ${M.aQuiet.newSockets} 條連線`);
  if (!M.aQuiet.state.elsewhere || !M.aQuiet.state.takeover) bad.push("20 秒後第一個分頁沒有「在另一個分頁」與接手的按鈕");
  if (M.aWake) bad.push(`喚醒（online、visibilitychange）之後第一個分頁開了 ${M.aWake} 條連線`);
  if (M.bQuiet.newSockets || M.bQuiet.state.elsewhere) bad.push(`第二個分頁被踢了（新連線 ${M.bQuiet.newSockets}，在另一個分頁 ${M.bQuiet.state.elsewhere}）`);
  return okm(!bad.length, bad.join("；") || `第二個分頁坐 ${M.bSeat}；第一個分頁 ${M.aElse.ms} ms 顯示在另一個分頁，之後 20 秒 0 條新連線`);
});
R0("按「在這裡繼續」：拿回座位，另一個分頁換成「在另一個分頁」，12 秒內不再來回", () => {
  const bad = [];
  if (!M.tookOver) bad.push("沒有 [data-room-takeover] 可以按");
  if (!M.aBack.ok) bad.push(`按了之後第一個分頁沒有回到牌桌（${JSON.stringify(M.aBack.s)}）`);
  if (M.aSeat2 !== M.aSeat) bad.push(`第一個分頁坐 ${M.aSeat2}，原本是 ${M.aSeat}`);
  if (!M.bElse.ok) bad.push("第二個分頁沒有換成 [data-room-elsewhere]");
  if (M.loop.b) bad.push(`第二個分頁 12 秒內又開了 ${M.loop.b} 條連線`);
  if (M.loop.aState.elsewhere) bad.push("第一個分頁又被踢回「在另一個分頁」");
  return okm(!bad.length, bad.join("；") || `第一個分頁 ${M.aBack.ms} ms 回到座位 ${M.aSeat2}，第二個分頁 ${M.bElse.ms} ms 換成在另一個分頁，之後 12 秒不來回`);
});
row("localStorage 的 token 超過 24 小時就不用（加入表單）；24 小時內換一個沒有 sessionStorage 的分頁也坐得回去；離開房間就刪掉", () => {
  if (pre) return pre;
  if (!M.stored) return "TODO: localStorage 裡還沒有 p2000.room.<代碼>";
  const bad = [];
  if (!M.cOld.ok || !M.cOld.s.form || M.cOld.s.table) bad.push(`25 小時前的 token：${JSON.stringify(M.cOld.s)}（應是加入表單）`);
  if (!M.cNew.ok) bad.push(`剛存的 token：沒有回到牌桌（${JSON.stringify(M.cNew.s)}）`);
  else if (M.cNewSeat !== M.aSeat) bad.push(`剛存的 token 坐 ${M.cNewSeat}，原本是 ${M.aSeat}`);
  if (!M.left) bad.push("打開選單後沒有 #rleave 可以按");
  else if (M.afterLeave != null) bad.push(`離開之後 localStorage 還有 ${M.afterLeave.slice(0, 40)}`);
  return okm(!bad.length, bad.join("；") || "過期的不用、新的坐回同一席、離開就刪");
});

let bad = 0, pend = 0;
for (const r of rows) { if (r.todo) pend++; else if (!r.ok) bad++; console.log(`${r.todo ? "…" : r.ok ? "✓" : "✗"} ${r.name}${r.todo ? " — " + r.todo : r.msg ? " — " + r.msg : ""}`); }
console.log(`${bad ? "FAIL" : pend ? "TODO" : "PASS"}: ${rows.length - bad - pend} pass, ${bad} fail, ${pend} 尚未實作 (room ${M.code}, seat ${M.aSeat})`);
process.exit(bad ? 1 : 0);
