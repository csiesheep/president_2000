// tools/room101.mjs — guessing room codes, opening rooms and flooding a socket are limited per client address (#101).
// Orchestrator's instrument: a peer may run it, does not edit it. Needs `wrangler dev` of this tree (and Chrome for the
// last row), about 2 minutes. Names, chat and the limiter itself are tests/room101.test.js.
//
//   node tools/room101.mjs http://127.0.0.1:8787/president_2000/
//
// The audit (商業盤點 E, multiplayer): no rate limit of any kind; four-letter codes (32 letters: about a million) and a
// `no_room` answer let anyone find the rooms that are open by trying codes one after another.
// Contract (orchestrator, #101). The address is CF-Connecting-IP (set by Cloudflare; `wrangler dev` passes on what the
// client sends, so each scenario here uses its own documentation address, 2001:db8::/32, and never limits 127.0.0.1).
// An IPv6 address counts as its /64 (one home or phone holds a whole /64 and could use a new address for every guess;
// orchestrator's ruling on #101 after the BE's question); an IPv4 address counts as itself:
//   - joins without a valid token: an address that has had 20 joins naming a room that does not exist within 10 minutes
//     is answered { t: "error", code: "rate_limited" } (and the socket closed) on every further join without a valid
//     token, to a room that exists or not, until it has fewer; a refused join counts as a miss (trying on keeps it out);
//   - a join with the token of a seat in that room is never refused (a player behind the same address gets back in);
//   - opening rooms (create=1): 30 within 10 minutes from one address; the 31st is rate_limited;
//   - a socket: at most 30 messages within any 10 s (src/limits.js LIMITS.msg); each one more is answered rate_limited;
//   - the room page, refused when joining: shows T.errors.rate_limited and opens no new socket (40 s).
// #101 landed (46ca7d8): nothing ever rate_limited is a failure now (it reported 尚未實作 before the work was done).
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";

const base = process.argv[2];
if (!base) { console.log("usage: node tools/room101.mjs <base url ending in /president_2000/>"); process.exit(2); }
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (k) => { if (process.env.ROOM101_DEBUG) console.log(`  · ${k}`); };
const wsBase = base.replace(/^http/, "ws").replace(/\/?$/, "/") + "ws";
// every scenario its own /64 (IPv6 is counted per /64, #101 ruling after the BE's question): 2001:db8:<run>:<scenario>::<host>
const run = Date.now().toString(16).slice(-4), addr = (k, host = 1) => `2001:db8:${run}:${k}::${host}`;
const CODE = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const zh = (await import(new URL("../public/i18n/zh-Hant.js", import.meta.url).href)).default;
const LIMIT_TEXT = zh.errors && zh.errors.rate_limited;

// One socket: the messages it got, until it closes or `ms` pass (then it is closed). Since #105 the name and the token
// go in the socket's first message, { t: "join", name, token }, as the pages send them (the query keeps only the room
// code, create=1 and lang); `name` and `token` given in `query` are moved there.
const joinOf = (query) => { const q = new URLSearchParams(query), name = q.get("name"), token = q.get("token"); q.delete("name"); q.delete("token"); return { query: q.toString(), join: { t: "join", name: name || "", token: token || null } }; };
function connect(query0, ip, { ms = 4000, until, send } = {}) {
  const { query, join } = joinOf(query0);
  return new Promise((res) => {
    const got = []; let done = false, ws;
    const end = (why) => { if (done) return; done = true; try { ws.close(); } catch { /* closed */ } res({ got, why }); };
    try { ws = new WebSocket(`${wsBase}?${query}`, { headers: { "CF-Connecting-IP": ip } }); } catch (e) { res({ got, why: `cannot open: ${e.message}` }); return; }
    ws.onmessage = (e) => { let m = null; try { m = JSON.parse(e.data); } catch { return; } got.push(m); if (until && until(m, got)) end("until"); };
    ws.onopen = () => { try { ws.send(JSON.stringify(join)); } catch { /* closed */ } if (send) send(ws); };
    ws.onclose = () => end("closed"); ws.onerror = () => end("error");
    setTimeout(() => end("time"), ms);
  });
}
const errOf = (r) => { const e = r.got.find((m) => m.t === "error"); return e ? e.code : null; };
const helloOf = (r) => r.got.find((m) => m.t === "hello") || null;
const firstAnswer = (m) => m.t === "hello" || m.t === "error";
const newRoom = (ip) => connect(`create=1&name=${encodeURIComponent("甲")}&lang=zh-Hant`, ip, { until: (m) => m.t === "room" || m.t === "error" });
function freeCode(taken) { for (;;) { let c = ""; for (let i = 0; i < 4; i++) c += CODE[Math.floor(Math.random() * CODE.length)]; if (!taken.has(c)) return c; } }

const M = {};
try {
  // a room that exists (opened from an address of its own)
  const host = await newRoom(addr("a0"));
  M.code = (host.got.find((m) => m.t === "room") || {}).code || null;
  step(`room ${M.code}`);
  if (!M.code) throw new Error(`could not open a room to join (${JSON.stringify(host.got).slice(0, 120)})`);
  // 1. guessing from address a1: first a fair join (its token kept), then 20 misses, then a join without a token
  const fair = await connect(`room=${M.code}&name=${encodeURIComponent("乙")}`, addr("a1"), { until: firstAnswer });
  M.token = (helloOf(fair) || {}).token || null;
  // does the server speak #105's join? A server before it answers the join with bad_message (it opened the seat from
  // the URL); then every row here reads 尚未實作 (#105), not a failure of #101
  const sj = await connect(`room=${M.code}&name=probe`, addr("a0", 9), { ms: 1500 });
  M.speaksJoin = !!helloOf(sj) && !sj.got.some((m) => m.t === "error" && m.code === "bad_message");
  const taken = new Set([M.code]); M.misses = [];
  for (let i = 0; i < 20; i++) { const c = freeCode(taken); taken.add(c); M.misses.push(errOf(await connect(`room=${c}&name=x`, addr("a1"), { until: firstAnswer, ms: 3000 })) || "hello?"); }
  const after = await connect(`room=${M.code}&name=x`, addr("a1"), { until: firstAnswer });
  M.after = helloOf(after) ? "hello" : errOf(after) || after.why;
  const miss21 = await connect(`room=${freeCode(taken)}&name=x`, addr("a1"), { until: firstAnswer, ms: 3000 });
  M.miss21 = helloOf(miss21) ? "hello" : errOf(miss21) || miss21.why;
  // 2. the same address with its seat's token
  const back = M.token ? await connect(`room=${M.code}&name=${encodeURIComponent("乙")}&token=${M.token}`, addr("a1"), { until: firstAnswer }) : null;
  M.back = back ? (helloOf(back) ? (helloOf(back).token === M.token ? "same" : "other") : errOf(back) || back.why) : "no token";
  step(`misses ${JSON.stringify(M.misses)} after ${M.after} miss21 ${M.miss21} back ${M.back}`);
  // 3. opening rooms from address a2
  M.creates = [];
  for (let i = 0; i < 31; i++) { const r = await newRoom(addr("a2")); M.creates.push(r.got.some((m) => m.t === "room") ? "room" : errOf(r) || r.why); }
  step(`creates ${M.creates.join(",")}`);
  // 4. one socket, 40 messages the room cannot read, as fast as it goes (address a3)
  M.flood = await new Promise((res) => {
    const codes = []; const ws = new WebSocket(`${wsBase}?create=1`, { headers: { "CF-Connecting-IP": addr("a3") } });
    ws.onmessage = (e) => { let m = null; try { m = JSON.parse(e.data); } catch { return; } if (m.t === "error") codes.push(m.code); };
    // the join is the socket's first message and counts as one of its 30 (#105): 29 of the 40 that follow are read
    ws.onopen = () => { ws.send(JSON.stringify({ t: "join", name: "x", token: null })); setTimeout(() => { for (let i = 0; i < 40; i++) ws.send(JSON.stringify({ t: "nonsense", i })); }, 600); };
    setTimeout(() => { try { ws.close(); } catch { /* closed */ } res(codes); }, 5000);
  });
  step(`flood ${JSON.stringify(M.flood)}`);
  // 4b. IPv6 per /64: 20 misses from one host of a /64, then a join without a token from another host of the same /64, and
  // one from a host of another /64. The two hosts of the same /64 are spelled differently (BE on #101): the first with
  // `::` standing for two groups inside the first four (an empty group read as 0 would still be one short), the second
  // written out in capitals with leading zeros; both are in 2001:db8:0:0::/64. A key that takes the first four groups of
  // the text as it is would not see them as one. (That /64 is the same in every run: a run soon after another finds it
  // still blocked, which this row reads the same way.)
  const host1 = `2001:db8::${run}:0:0:1`, host2 = `2001:0DB8:0000:0000:${run.toUpperCase().padStart(4, "0")}:0000:0000:0002`;
  const taken2 = new Set([M.code]);
  for (let i = 0; i < 20; i++) { const c = freeCode(taken2); taken2.add(c); await connect(`room=${c}&name=x`, host1, { until: firstAnswer, ms: 3000 }); }
  const same = await connect(`room=${M.code}&name=x`, host2, { until: firstAnswer });
  const other = await connect(`room=${M.code}&name=x`, addr("a5", 1), { until: firstAnswer });
  M.v6 = { same: helloOf(same) ? "hello" : errOf(same) || same.why, other: helloOf(other) ? "hello" : errOf(other) || other.why };
  step(`v6 ${JSON.stringify(M.v6)}`);
  // 5. the page, from address a1 (refused): what it shows, and whether it tries again
  M.page = await page(M.code, addr("a1"));
  step(`page ${JSON.stringify(M.page)}`);
} catch (e) { M.err = e.message; }

async function page(code, ip) {
  const root = process.env.TEMP || "/tmp", dir = `${root}/room101_${process.pid}_${Date.now()}`;
  for (const old of readdirSync(root).filter((d) => d.startsWith("room101_"))) { try { if (Date.now() - statSync(`${root}/${old}`).mtimeMs > 600000) rmSync(`${root}/${old}`, { recursive: true, force: true }); } catch { /* in use */ } }
  mkdirSync(dir, { recursive: true });
  const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--remote-debugging-port=0", `--user-data-dir=${dir}`, "about:blank"], { stdio: "ignore" });
  try {
    let port = 0;
    for (let i = 0; i < 100 && !port; i++) { try { port = Number.parseInt(readFileSync(`${dir}/DevToolsActivePort`, "utf8"), 10) || 0; } catch { /* starting */ } if (!port) await sleep(100); }
    for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break; } catch { /* starting */ } await sleep(200); }
    const t = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
    const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
    let id = 0, sockets = 0; const pend = new Map();
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result || {}); pend.delete(m.id); } if (m.method === "Network.webSocketCreated") sockets++; };
    const send = (method, params = {}) => new Promise((res) => { const i = ++id; const tm = setTimeout(() => { pend.delete(i); res({}); }, 20000); pend.set(i, (r) => { clearTimeout(tm); res(r); }); ws.send(JSON.stringify({ id: i, method, params })); });
    await send("Page.enable"); await send("Network.enable");
    await send("Network.setExtraHTTPHeaders", { headers: { "CF-Connecting-IP": ip } });
    await send("Page.addScriptToEvaluateOnNewDocument", { source: 'try { localStorage.setItem("p2000.tips", JSON.stringify({ seen: [], off: true })); sessionStorage.setItem("p2000.room.name", JSON.stringify("丙")); } catch (e) { /* no storage */ }' });
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await send("Page.navigate", { url: `${base}?room=${code}` });
    await sleep(5000);
    const s0 = sockets, text0 = (await send("Runtime.evaluate", { expression: "document.body.innerText", returnByValue: true })).result?.value || "";
    await sleep(40000);
    const text = (await send("Runtime.evaluate", { expression: "document.body.innerText", returnByValue: true })).result?.value || "";
    return { sockets0: s0, more: sockets - s0, shows: !!LIMIT_TEXT && (text0.includes(LIMIT_TEXT) || text.includes(LIMIT_TEXT)), stillShows: !!LIMIT_TEXT && text.includes(LIMIT_TEXT), text: text.replace(/\s+/g, " ").slice(0, 120) };
  } finally { proc.kill(); }
}

const rows = [];
const row = (name, fn) => { try { const r = fn(); rows.push(r === true ? { name, ok: true } : typeof r === "string" && r.startsWith("TODO:") ? { name, todo: r.slice(5).trim() } : r && r.pass ? { name, ok: true, msg: r.msg } : { name, ok: false, msg: String(r) }); } catch (e) { rows.push({ name, ok: false, msg: `instrument: ${e.message}` }); } };
const okm = (c, msg) => (c ? { pass: true, msg } : msg);
const pre = () => (M.err ? `儀器中途停下：${M.err}（instrument；同一個 wrangler 跑過的話，這次用的位址不一樣，不會被上一次擋住）` : M.speaksJoin === false ? "TODO: 伺服器還不懂第一則的 join（#105 之前）：名字與 token 不在網址裡就入不了座" : null);
const any = () => [...(M.misses || []), M.after, M.miss21, ...(M.creates || []), ...(M.flood || [])].includes("rate_limited");
row("猜代碼：同一個位址 20 次加入不存在的房間都回 no_room；之後沒帶 token 加入存在的房間、或再猜一次，都回 rate_limited", () => {
  const p = pre(); if (p) return p;
  if (!any()) return `#101 上線之後是失敗：從來沒有 rate_limited（20 次都是 ${[...new Set(M.misses)].join("/")}，之後加入存在的房間：${M.after}）`;
  const bad = [];
  const early = M.misses.findIndex((x) => x !== "no_room"); if (early >= 0) bad.push(`第 ${early + 1} 次猜就回 ${M.misses[early]}（前 20 次應是 no_room）`);
  if (M.after !== "rate_limited") bad.push(`之後沒帶 token 加入存在的房間：${M.after}（應是 rate_limited：不然有沒有這間房還是看得出來）`);
  if (M.miss21 !== "rate_limited") bad.push(`第 21 次猜：${M.miss21}`);
  return okm(!bad.length, bad.join("；") || `20 次 no_room，之後 ${M.code} 與第 21 次都是 rate_limited`);
});
row("同一個位址被擋的時候，帶著自己座位的 token 回來照常坐回去", () => {
  const p = pre(); if (p) return p;
  if (!M.token) return "第一次公平加入沒有拿到 token（instrument）";
  if (!any()) return "#101 上線之後是失敗：還沒有限制，量不出被擋時回不回得去";
  return okm(M.back === "same", M.back === "same" ? "hello，同一個 token" : `回來時：${M.back}`);
});
row("開房間：同一個位址 10 分鐘內 30 間都開得成，第 31 間回 rate_limited", () => {
  const p = pre(); if (p) return p;
  const ok30 = M.creates.slice(0, 30).filter((x) => x === "room").length, last = M.creates[30];
  if (!any()) return `#101 上線之後是失敗：31 間都開成了（${ok30 + (last === "room" ? 1 : 0)} 間）`;
  return okm(ok30 === 30 && last === "rate_limited", `前 30 間開成 ${ok30} 間，第 31 間：${last}`);
});
row("一條連線 join 之後一口氣送 40 則：join 算第一則，接著 29 則照常處理（bad_message），後 11 則回 rate_limited", () => {
  const p = pre(); if (p) return p;
  const f = M.flood || [], bm = f.filter((c) => c === "bad_message").length, rl = f.filter((c) => c === "rate_limited").length;
  if (!any()) return `#101 上線之後是失敗：40 則都照常處理（bad_message ${bm}）`;
  return okm(bm === 29 && rl === 11, `bad_message ${bm}、rate_limited ${rl}（共收到 ${f.length} 個錯誤）`);
});
row("IPv6 以 /64 為一組：同一個 /64 的一台猜錯 20 次，另一台沒帶 token 加入也被擋；另一個 /64 照常", () => {
  const p = pre(); if (p) return p;
  if (!any()) return "#101 上線之後是失敗：還沒有限制";
  const x = M.v6 || {};
  return okm(x.same === "rate_limited" && x.other === "hello", `同一個 /64 的另一台：${x.same}（應是 rate_limited）；另一個 /64：${x.other}（應是 hello）`);
});
row("房間頁：被擋的位址打開 ?room=<代碼>，畫面寫出 errors.rate_limited，40 秒內不再開新連線", () => {
  const p = pre(); if (p) return p;
  if (!LIMIT_TEXT) return "#101 上線之後是失敗：zh-Hant 的 errors.rate_limited 還沒有";
  const x = M.page; if (!x) return "沒有量到（instrument）";
  if (!any()) return "#101 上線之後是失敗：還沒有限制";
  const bad = [];
  if (!x.shows) bad.push(`畫面沒有寫出「${LIMIT_TEXT}」（寫的是：${x.text}）`);
  if (x.more) bad.push(`之後 40 秒又開了 ${x.more} 條連線`);
  return okm(!bad.length, bad.join("；") || `寫出「${LIMIT_TEXT.slice(0, 30)}」，最初 ${x.sockets0} 條連線，之後 40 秒 0 條`);
});

let bad = 0, pend = 0;
for (const r of rows) { if (r.todo) pend++; else if (!r.ok) bad++; console.log(`${r.todo ? "…" : r.ok ? "✓" : "✗"} ${r.name}${r.todo ? " — " + r.todo : r.msg ? " — " + r.msg : ""}`); }
console.log(`${bad ? "FAIL" : pend ? "TODO" : "PASS"}: ${rows.length - bad - pend} pass, ${bad} fail, ${pend} 尚未實作 (room ${M.code})`);
process.exit(bad ? 1 : 0);
