// tools/url105.mjs — a room socket's address carries neither the player's name nor the seat token (#105). Orchestrator's
// instrument: a peer may run it, does not edit it. Needs Chrome and `wrangler dev` of this tree (it opens a room), about a
// minute.
//
//   node tools/url105.mjs http://127.0.0.1:8787/president_2000/
//
// The audit (商業盤點 E, item 5): the name and the token travel in the WebSocket URL (/ws?room=…&name=…&token=…), and the
// Worker's request logs (observability) keep URLs, so names and seat tokens end up in the logs.
// Contract (orchestrator, #105): no room socket the pages open has `name` or `token` in its query, nor the typed name
// anywhere in its URL (raw or encoded); the room code, `create=1` and `lang` may stay. The name and the token go in the
// socket's first message instead (the protocol is the BE's to define, the client follows it). The room works as
// before: the host sits, a second player (another browser) joins under their name and sits, both see each other's name
// on the seats, and a reload sits the host down again in the same seat. A socket that never sends its first message is
// given up within 15 s (the client sees an error or the close, whichever comes first) and gets nothing of the room before
// (ruling on #105 after the BE's notes).
// Measured with two browser profiles (two players); every WebSocket each opens is read off CDP.
// Reports 尚未實作 while the pages put the name or the token in the URL (as on main).
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";

const base = (process.argv[2] || "").replace(/\/?$/, "/");
if (!process.argv[2]) { console.log("usage: node tools/url105.mjs <base url ending in /president_2000/>"); process.exit(2); }
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (k) => { if (process.env.URL105_DEBUG) console.log(`  · ${k}`); };
const NAME_A = "甲方一〇五", NAME_B = "Bee105x";

async function launch(tag) {
  const root = process.env.TEMP || "/tmp", dir = `${root}/url105_${tag}_${process.pid}_${Date.now()}`;
  for (const old of readdirSync(root).filter((d) => d.startsWith("url105_"))) { try { if (Date.now() - statSync(`${root}/${old}`).mtimeMs > 600000) rmSync(`${root}/${old}`, { recursive: true, force: true }); } catch { /* in use */ } }
  mkdirSync(dir, { recursive: true });
  const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--remote-debugging-port=0", `--user-data-dir=${dir}`, "about:blank"], { stdio: "ignore" });
  let port = 0;
  for (let i = 0; i < 100 && !port; i++) { try { port = Number.parseInt(readFileSync(`${dir}/DevToolsActivePort`, "utf8"), 10) || 0; } catch { /* starting */ } if (!port) await sleep(100); }
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break; } catch { /* starting */ } await sleep(200); }
  return { port, close: () => proc.kill() };
}
// A tab whose sockets (their URLs) and the server's hello and room messages are recorded.
async function tab(br) {
  const t = await (await fetch(`http://127.0.0.1:${br.port}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pend = new Map(), log = { urls: [], hellos: [], rooms: [] };
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result || {}); pend.delete(m.id); return; }
    if (m.method === "Network.webSocketCreated") log.urls.push(m.params.url);
    if (m.method === "Network.webSocketFrameReceived") { try { const d = JSON.parse(m.params.response.payloadData); if (d.t === "hello") log.hellos.push(d.seat); if (d.t === "room") log.rooms.push(d.seats.map((s) => s.name)); } catch { /* not ours */ } }
    if (m.method === "Page.javascriptDialogOpening") ws.send(JSON.stringify({ id: ++id, method: "Page.handleJavaScriptDialog", params: { accept: true } }));
  };
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; const tm = setTimeout(() => { pend.delete(i); res({ timeout: true }); }, 20000); pend.set(i, (r) => { clearTimeout(tm); res(r); }); ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Page.enable"); await send("Network.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", { source: 'try { localStorage.setItem("p2000.tips", JSON.stringify({ seen: [], off: true })); localStorage.setItem("p2000.sound", JSON.stringify({ on: false, vol: 0 })); } catch (e) { /* no storage */ }' });
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.timeout) throw new Error(`the tab did not answer: ${expr.slice(0, 60)}`); return r.result ? r.result.value : undefined; };
  const go = async (u, wait = 2500) => { await send("Page.navigate", { url: u }); await sleep(wait); };
  const reload = async (wait = 3000) => { await send("Page.reload", {}); await sleep(wait); };
  return { ev, go, reload, log, close: () => { try { ws.close(); } catch { /* closed */ } } };
}
const submitName = (n) => `(() => { const f = document.querySelector("form.rform"); if (!f) return 0; f.elements.name.value = ${JSON.stringify(n)}; f.requestSubmit(); return 1; })()`;
const clickSit = `(() => { const b = document.querySelector(".btn.sit[data-msg]"); if (!b) return 0; b.click(); return 1; })()`;

const M = {};
const brA = await launch("a"), brB = await launch("b");
try {
  const A = await tab(brA);
  await A.go(`${base}?host`);
  await A.ev(submitName(NAME_A));
  for (let i = 0; i < 40 && !(await A.ev(`!!document.querySelector(".btn.sit[data-msg]")`)); i++) await sleep(250);
  await A.ev(clickSit); await sleep(1200);
  M.code = (await A.ev("new URLSearchParams(location.search).get('room')")) || "";
  M.aSeat = A.log.hellos.filter((s) => s != null).pop();
  step(`room ${M.code}, A seat ${M.aSeat}`);
  const B = await tab(brB);
  await B.go(`${base}?room=${M.code}`);
  await B.ev(submitName(NAME_B)); await sleep(2000);
  await B.ev(clickSit); await sleep(1500);
  M.bSeat = B.log.hellos.filter((s) => s != null).pop();
  M.aSees = (A.log.rooms[A.log.rooms.length - 1] || []).filter(Boolean);
  M.bSees = (B.log.rooms[B.log.rooms.length - 1] || []).filter(Boolean);
  // the reload must open a socket of its own and get a hello of its own (an earlier hello does not count)
  const u0 = A.log.urls.length, h0 = A.log.hellos.length;
  await A.reload(4000);
  M.reloadSockets = A.log.urls.length - u0;
  M.aSeat2 = A.log.hellos.slice(h0).filter((s) => s != null).pop();
  M.urls = [...A.log.urls.map((u) => ["A", u]), ...B.log.urls.map((u) => ["B", u])];
  step(`urls ${JSON.stringify(M.urls)}`);
  A.close(); B.close();
  // a socket that never sends its first message: closed within 15 s, and nothing of the room reaches it before
  // (orchestrator's ruling on #105 after the BE's note: a join that never comes must not hold a socket open for ever)
  M.idle = await new Promise((res) => {
    const wsBase = base.replace(/^http/, "ws") + "ws", t0 = Date.now(), got = [];
    let ws; try { ws = new WebSocket(`${wsBase}?room=${M.code}`, { headers: { "CF-Connecting-IP": "2001:db8:105::1" } }); } catch (e) { res({ err: e.message }); return; }
    // the server gives up on the socket when it says so (an error) or closes it, whichever the client sees first: in
    // wrangler dev a close of a socket that never sent a frame reaches the client about 10 s late (BE on #105)
    let said = null;
    ws.onmessage = (e) => { try { const t = JSON.parse(e.data).t; got.push(t); if (t === "error" && said == null) said = Date.now() - t0; } catch { /* not json */ } };
    const done = (closedAt) => res({ closedAfter: [said, closedAt].filter((x) => x != null).reduce((a, b) => Math.min(a, b), Infinity), said, closedAt, got });
    ws.onclose = () => done(Date.now() - t0);
    setTimeout(() => { try { ws.close(); } catch { /* closed */ } done(null); }, 20000);
  });
  step(`idle ${JSON.stringify(M.idle)}`);
} catch (e) { M.err = e.message; } finally { brA.close(); brB.close(); }

const rows = [];
const row = (name, fn) => { try { const r = fn(); rows.push(r === true ? { name, ok: true } : typeof r === "string" && r.startsWith("TODO:") ? { name, todo: r.slice(5).trim() } : r && r.pass ? { name, ok: true, msg: r.msg } : { name, ok: false, msg: String(r) }); } catch (e) { rows.push({ name, ok: false, msg: `instrument: ${e.message}` }); } };
const okm = (c, msg) => (c ? { pass: true, msg } : msg);
const leaks = (u) => {
  let q = null; try { q = new URL(u).searchParams; } catch { return ["unparsable"]; }
  const out = [];
  if (q.has("name")) out.push("name=");
  if (q.has("token")) out.push("token=");
  for (const n of [NAME_A, NAME_B]) if (u.includes(n) || u.includes(encodeURIComponent(n))) out.push(`「${n}」`);
  return out;
};
row("每一條房間連線的網址都不帶名字與 token（開房、加入、重新整理坐回去，兩個玩家）", () => {
  if (M.err) return `儀器中途停下：${M.err}`;
  const ws = (M.urls || []).filter(([, u]) => /\/ws\?/.test(u));
  if (ws.length < 3) return `只看到 ${ws.length} 條房間連線（instrument）`;
  const bad = ws.map(([who, u]) => [who, u, leaks(u)]).filter(([, , l]) => l.length);
  if (bad.length === ws.length) return `TODO: 每一條都還帶著（例：${bad[0][0]} ${bad[0][1].replace(/^.*\/ws/, "/ws").slice(0, 90)}）`;
  return okm(!bad.length, bad.length ? `${bad.length}/${ws.length} 條還帶著：${bad.map(([w, , l]) => `${w} ${l.join("、")}`).join("；")}` : `${ws.length} 條都沒有（例：${ws[0][1].replace(/^.*\/ws/, "/ws")}）`);
});
row("照樣能玩：房主入座、另一個玩家用名字加入並入座、兩邊的座位上都看得到兩個名字、房主重新整理坐回同一席", () => {
  if (M.err) return `儀器中途停下：${M.err}`;
  const bad = [];
  if (M.aSeat == null) bad.push("房主沒有座位");
  if (M.bSeat == null) bad.push("第二個玩家沒有座位");
  for (const [who, list] of [["房主", M.aSees], ["第二個玩家", M.bSees]]) for (const n of [NAME_A, NAME_B]) if (!list.includes(n)) bad.push(`${who}的座位上沒有「${n}」（${JSON.stringify(list)}）`);
  if (!M.reloadSockets) bad.push("重新整理後沒有開新的連線");
  else if (M.aSeat2 !== M.aSeat) bad.push(`重新整理後新的連線坐 ${M.aSeat2}，原本是 ${M.aSeat}`);
  return okm(!bad.length, bad.join("；") || `房主 ${M.aSeat}、第二個玩家 ${M.bSeat}，兩邊都看得到兩個名字，重新整理後新開 ${M.reloadSockets} 條連線、坐回 ${M.aSeat2}`);
});

row("連上之後一直不送第一則訊息的連線：15 秒內被關掉，在那之前收不到房間的任何東西", () => {
  if (M.err) return `儀器中途停下：${M.err}`;
  const x = M.idle || {};
  if (x.err) return `開不了連線：${x.err}（instrument）`;
  const roomish = (x.got || []).filter((t) => ["hello", "room", "state", "chat"].includes(t));
  if (roomish.includes("hello") && !Number.isFinite(x.closedAfter)) return `TODO: 沒送 join 也拿到 hello、連線一直開著（收到 ${roomish.join("、")}）`;
  const bad = [];
  if (!Number.isFinite(x.closedAfter) || x.closedAfter > 15000) bad.push(`15 秒內伺服器沒有放棄這條連線（${Number.isFinite(x.closedAfter) ? x.closedAfter + " ms" : "20 秒都開著、沒有 error"}）`);
  if (roomish.length) bad.push(`關掉之前收到 ${roomish.join("、")}`);
  return okm(!bad.length, bad.join("；") || `${x.closedAfter} ms 伺服器放棄這條連線（error ${x.said ?? "—"} ms、close ${x.closedAt ?? "—"} ms），之前沒收到房間的東西`);
});

let bad = 0, pend = 0;
for (const r of rows) { if (r.todo) pend++; else if (!r.ok) bad++; console.log(`${r.todo ? "…" : r.ok ? "✓" : "✗"} ${r.name}${r.todo ? " — " + r.todo : r.msg ? " — " + r.msg : ""}`); }
console.log(`${bad ? "FAIL" : pend ? "TODO" : "PASS"}: ${rows.length - bad - pend} pass, ${bad} fail, ${pend} 尚未實作 (room ${M.code})`);
process.exit(bad ? 1 : 0);
