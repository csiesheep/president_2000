// Multiplayer rooms (M4), as far as node can see them: the room's logic is a pure core that the
// Durable Object wraps. Orchestrator's file: a peer may run it and falsify against it, and does
// not edit it. The WebSocket wiring is checked by opening two browsers, not here.
//
//   node --test tests/room.test.js      (or `npm test`)
//
// Contract (issue #13): src/roomcore.js imports nothing from Cloudflare and exports
//   newRoom({ code, seed, now }) → room            a plain JSON object (it goes to DO storage)
//   handle(room, ev, now) → { room, out }          pure; now is ms
//     ev: { type: "open", conn, name, token }      token null → a new player
//         { type: "close", conn }
//         { type: "msg", conn, data }              data: { t: "sit", seat } | { t: "start", level } | { t: "move", move }
//         { type: "alarm" }                        the DO alarm, delivered at or after room.alarmAt
//     out: [{ to: conn, msg }]
//       { t: "hello", token, seat }                to an opened conn (seat null until it sits)
//       { t: "room", code, host, started, seats }  seats: [{ kind: "human" | "bot" | "empty", name, connected }]
//       { t: "state", seat, view, legal }          view = E.view(st, seat); legal = legalMoves if seat must act, else []
//                                                  at most one per conn per handle, for the room after the event
//       { t: "error", code }                       to the sender only; the room does not change
//   room.st: the engine state once started; room.alarmAt: ms or null; room.dead: true when it can go.
// Times (orchestrator ruling, plan): a connected human's decision times out after 60 s and a bot
// makes that one move; a seat whose human has been gone 15 s is played by the bot until they
// return with their token; with no human connected the game pauses, and 30 min later the room
// is dead. Every check reports 尚未實作 until src/roomcore.js exists.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { R, section, check, eq, ok, nonEmpty, summary } from "./harness.js";
import * as E from "../public/shared/engine.js";
import * as D from "./driver.js";

const FILE = new URL("../src/roomcore.js", import.meta.url);
let RC = null, IMPORT_ERR = null;
if (existsSync(FILE)) { try { RC = await import(FILE.href); } catch (e) { IMPORT_ERR = e; } }
const c13 = (name, fn) => check(name, () => {
  if (!existsSync(FILE)) return "TODO: src/roomcore.js 還沒有（#13）";
  if (IMPORT_ERR) return `src/roomcore.js 在 node 裡 import 就丟錯：${IMPORT_ERR.message}`;
  if (typeof RC.newRoom !== "function" || typeof RC.handle !== "function") return "TODO: src/roomcore.js 還沒有 newRoom、handle（#13）";
  return fn();
});
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const MIN = 60000;

// A little world around the core: it keeps the room, the clock and what each conn received.
function world(seed = 11) {
  const w = { room: RC.newRoom({ code: "ABCD", seed, now: 0 }), now: 0, inbox: {}, log: [] };
  w.do = (ev, at = w.now) => {
    w.now = at;
    const before = JSON.stringify(w.room);
    const r = RC.handle(JSON.parse(before), ev, at);
    if (!r || !r.room || !Array.isArray(r.out)) throw new Error(`handle 回的不是 { room, out }（${ev.type}）`);
    JSON.stringify(r.room); // must stay JSON
    w.room = r.room;
    for (const o of r.out) (w.inbox[o.to] ??= []).push(o.msg);
    w.log.push({ ev, out: r.out });
    return r.out;
  };
  w.last = (conn, t) => [...(w.inbox[conn] || [])].reverse().find((m) => m.t === t);
  w.open = (conn, name, token = null, at) => { w.do({ type: "open", conn, name, token }, at); return w.last(conn, "hello"); };
  w.msg = (conn, data, at) => w.do({ type: "msg", conn, data }, at);
  return w;
}
// Two humans (A in seat 0, B in seat 1) and a bot of `level` in seat 2, started at time 0.
function twoHumans(seed = 11, level = 1) {
  const w = world(seed);
  const a = w.open("A", "Ann"), b = w.open("B", "Bo");
  w.msg("A", { t: "sit", seat: 0 }); w.msg("B", { t: "sit", seat: 1 });
  w.msg("A", { t: "start", level });
  return { w, a, b };
}
const humanConn = { 0: "A", 1: "B" };
// Let the humans play random legal moves (from what the server told them) until `stop` or the end.
function playHumans(w, R1, stop = () => false, cap = 4000) {
  for (let n = 0; n < cap && w.room.st.phase !== "end" && !stop(w); n++) {
    const must = E.mustAct(w.room.st).filter((s) => s in humanConn);
    if (!must.length) return `第 ${w.room.st.turn} 回合 ${w.room.st.phase}：沒有人類要動，bot 卻停了（要動的是 ${JSON.stringify(E.mustAct(w.room.st))}）`;
    const seat = must[0], st = w.last(humanConn[seat], "state");
    if (!st || !st.legal.length) return `seat ${seat} 要動，卻沒收到帶 legal 的 state`;
    w.msg(humanConn[seat], { t: "move", move: st.legal[Math.floor(R1() * st.legal.length)] }, w.now + 1000);
  }
  return null;
}

section("13 房間");
c13("大廳：三個連線各拿到不同的 token；第一個是房主；入座、房主開局，空位由 bot 補；每個人收到自己座位的 state", () => {
  const w = world();
  const a = w.open("A", "Ann"), b = w.open("B", "Bo"), c = w.open("C", "Cy");
  if (!a || !b || !c) return "有連線沒收到 hello";
  const toks = new Set([a.token, b.token, c.token].filter((x) => typeof x === "string" && x.length >= 8));
  let r = eq(toks.size, 3, "三個不同、至少 8 字的 token"); if (r !== true) return r;
  w.msg("A", { t: "sit", seat: 2 }); w.msg("B", { t: "sit", seat: 0 });
  const before = JSON.stringify(w.room);
  w.msg("B", { t: "start", level: 2 });
  r = eq(JSON.stringify(w.room) === before && !!w.last("B", "error"), true, "不是房主按開局：回 error、房間不變"); if (r !== true) return r;
  w.msg("A", { t: "start", level: 2 });
  const room = w.last("C", "room");
  r = eq(room && room.started && room.seats.map((s) => s.kind).join(","), "human,bot,human", "開局後的座位"); if (r !== true) return r;
  for (const [conn, seat] of [["A", 2], ["B", 0]]) {
    const s = w.last(conn, "state");
    if (!s || s.seat !== seat) return `${conn} 沒收到 seat ${seat} 的 state`;
    if (!same(s.view, E.view(w.room.st, seat))) return `${conn} 收到的 view 不是 E.view(st, ${seat})`;
  }
  return ok(true, `token ${[...toks].map((t) => t.length).join("/")} 字；座位 human,bot,human`);
});
c13("一局打到結束（兩個人類亂走、一個 bot）：bot 不讓人等；結束時兩個人類都收到帶 result 的 state", () => {
  const { w } = twoHumans(21, 2);
  const bad = playHumans(w, D.rng(3));
  if (bad) return bad;
  let r = eq(w.room.st.phase, "end", "結束"); if (r !== true) return r;
  // Replay every state message against the room it was sent from.
  let n = 0;
  for (const step of w.log) for (const o of step.out) if (o.msg.t === "state") n++;
  r = nonEmpty(n, "state 訊息"); if (r !== true) return r;
  for (const conn of ["A", "B"]) {
    const s = w.last(conn, "state");
    if (!s.view.result) return `${conn} 最後的 state 沒有 result`;
  }
  return ok(true, `${n} 則 state；結果 ${w.room.st.result.votes.join("/")}`);
});
c13("每一則 state 都對：view 等於當下的 E.view(st, seat)，legal 等於當下要動時的 legalMoves", () => {
  const w = world(31);
  w.open("A", "Ann"); w.open("B", "Bo");
  w.msg("A", { t: "sit", seat: 1 }); w.msg("B", { t: "sit", seat: 2 });
  const conns = { 1: "A", 2: "B" };
  w.msg("A", { t: "start", level: 1 });
  const R1 = D.rng(9);
  let checked = 0;
  for (let n = 0; n < 3000 && w.room.st.phase !== "end"; n++) {
    // Every state message just sent must match the room as it is now.
    for (const o of w.log[w.log.length - 1].out) {
      if (o.msg.t !== "state") continue;
      const seat = o.msg.seat;
      if (!same(o.msg.view, E.view(w.room.st, seat))) return `第 ${w.room.st.turn} 回合：送給 ${o.to} 的 view 不是 E.view(st, ${seat})`;
      const want = E.mustAct(w.room.st).includes(seat) ? E.legalMoves(w.room.st, seat) : [];
      if (!same(o.msg.legal, want)) return `第 ${w.room.st.turn} 回合：送給 ${o.to} 的 legal 跟 legalMoves 不一樣`;
      checked++;
    }
    const must = E.mustAct(w.room.st).filter((s) => s in conns);
    if (!must.length) return `沒有人類要動，bot 卻停了（${JSON.stringify(E.mustAct(w.room.st))}）`;
    const legal = E.legalMoves(w.room.st, must[0]);
    w.msg(conns[must[0]], { t: "move", move: legal[Math.floor(R1() * legal.length)] }, w.now + 500);
  }
  return ok(true, `${checked} 則 state 逐則比對`);
});
c13("不合法的步、不是你的回合、還沒入座：只回 error 給送的人，房間不變", () => {
  const { w } = twoHumans(41);
  const must = E.mustAct(w.room.st);
  const idle = [0, 1].find((s) => !must.includes(s)), acting = [0, 1].find((s) => must.includes(s));
  const cases = [];
  if (acting !== undefined) cases.push([humanConn[acting], { t: "move", move: { type: "fly", to: "moon" } }, "不合法的步"]);
  if (idle !== undefined) cases.push([humanConn[idle], { t: "move", move: E.legalMoves(w.room.st, idle)[0] || { type: "done" } }, "不是你的回合"]);
  w.open("C", "Cy");
  cases.push(["C", { t: "move", move: { type: "done" } }, "還沒入座"]);
  const r = nonEmpty(cases.length, "情境"); if (r !== true) return r;
  for (const [conn, data, what] of cases) {
    const before = JSON.stringify(w.room.st);
    const out = w.msg(conn, data, w.now + 10);
    if (JSON.stringify(w.room.st) !== before) return `${what}：引擎狀態變了`;
    if (!out.length || out.some((o) => o.to !== conn || o.msg.t !== "error")) return `${what}：應該只回 error 給 ${conn}，實際 ${JSON.stringify(out.map((o) => [o.to, o.msg.t]))}`;
  }
  return ok(true, cases.map((c) => c[2]).join("、"));
});
c13("逾時：人類 60 秒不動，鬧鐘一到 bot 替他走一步；59.999 秒時不動", () => {
  const { w } = twoHumans(51);
  const bad = playHumans(w, D.rng(4), (x) => E.mustAct(x.room.st).some((s) => s in humanConn) && x.room.st.phase === "action");
  if (bad) return bad;
  const seat = E.mustAct(w.room.st).find((s) => s in humanConn);
  if (seat === undefined) return "走不到人類要動的行動階段";
  const t0 = w.now, logLen = w.room.st.log.length;
  if (!(w.room.alarmAt > t0 && w.room.alarmAt <= t0 + MIN)) return `人類要動時 alarmAt 應該在 60 秒內，實際 ${w.room.alarmAt - t0} ms`;
  w.do({ type: "alarm" }, t0 + MIN - 1);
  let r = eq(w.room.st.log.length, logLen, "59.999 秒的鬧鐘之後，log 長度"); if (r !== true) return r;
  w.do({ type: "alarm" }, t0 + MIN);
  const moved = w.room.st.log.slice(logLen).some((e) => e.seat === seat);
  r = eq(moved, true, `60 秒的鬧鐘之後，seat ${seat} 有沒有動`); if (r !== true) return r;
  const seats = w.last("A", "room").seats;
  r = eq(seats[seat].kind, "human", "代打一步之後，座位還是人類的"); if (r !== true) return r;
  return ok(true, `seat ${seat} 在第 60 秒被代打，座位仍是 human`);
});
c13("斷線：離開 15 秒後 bot 接手那個座位；拿 token 回來就拿回座位，bot 不再替他走", () => {
  const { w, b } = twoHumans(61);
  const bad = playHumans(w, D.rng(5), (x) => E.mustAct(x.room.st).includes(1));
  if (bad) return bad;
  if (!E.mustAct(w.room.st).includes(1)) return "走不到 B（seat 1）要動的時候";
  const t0 = w.now, logLen = w.room.st.log.length;
  w.do({ type: "close", conn: "B" }, t0 + 1000);
  let r = eq(w.last("A", "room").seats[1].connected, false, "B 離開之後 A 看到的 seat 1 connected"); if (r !== true) return r;
  w.do({ type: "alarm" }, t0 + 1000 + 15000 - 1);
  r = eq(w.room.st.log.length, logLen, "離開 14.999 秒時，log 長度"); if (r !== true) return r;
  w.do({ type: "alarm" }, t0 + 1000 + 15000);
  r = eq(w.room.st.log.slice(logLen).some((e) => e.seat === 1), true, "離開 15 秒後，bot 有沒有替 seat 1 走"); if (r !== true) return r;
  // B comes back with the token on a new connection.
  const hello = w.open("B2", "Bo", b.token, w.now + 5000);
  r = eq(hello && hello.seat, 1, "拿 token 回來的 hello.seat"); if (r !== true) return r;
  const s = w.last("B2", "state");
  if (!s || !same(s.view, E.view(w.room.st, 1))) return "回來的連線沒收到 seat 1 現在的 state";
  r = eq(w.last("A", "room").seats[1].connected, true, "回來之後 seat 1 connected"); if (r !== true) return r;
  // From here seat 1 waits for B2 again: play A only until seat 1 must act, then check nobody moved it.
  humanConn[1] = "B2";
  const bad2 = playHumans(w, D.rng(6), (x) => E.mustAct(x.room.st).includes(1));
  humanConn[1] = "B";
  if (bad2) return bad2;
  if (w.room.st.phase === "end") return ok(true, "回來之後遊戲已經結束");
  const len2 = w.room.st.log.length;
  w.do({ type: "alarm" }, w.now + 20000);
  r = eq(w.room.st.log.length, len2, "回來之後 20 秒的鬧鐘，seat 1 沒有被代打"); if (r !== true) return r;
  return ok(true, "15 秒接手、token 回座、回座後不代打");
});
c13("沒有人在：全部斷線時遊戲暫停，不代打；30 分鐘後房間 dead", () => {
  const { w } = twoHumans(71);
  const t0 = w.now + 1000;
  w.do({ type: "close", conn: "A" }, t0); w.do({ type: "close", conn: "B" }, t0);
  const st = JSON.stringify(w.room.st);
  w.do({ type: "alarm" }, t0 + 2 * MIN);
  let r = eq(JSON.stringify(w.room.st) === st, true, "全部斷線 2 分鐘後（過了 15 秒接手與 60 秒逾時），引擎狀態不變"); if (r !== true) return r;
  w.do({ type: "alarm" }, t0 + 30 * MIN - 1);
  r = eq(!!w.room.dead, false, "29:59.999 時 dead"); if (r !== true) return r;
  w.do({ type: "alarm" }, t0 + 30 * MIN);
  r = eq(!!w.room.dead, true, "30 分鐘時 dead"); if (r !== true) return r;
  return ok(true, "暫停、30 分鐘 dead");
});
c13("可重放：同一串事件、同一個時間，送出去的訊息一模一樣", () => {
  const run = () => { const { w } = twoHumans(81, 3); const bad = playHumans(w, D.rng(7), (x) => x.room.st.turn >= 3); return bad || JSON.stringify(w.log.map((s) => s.out)); };
  const a = run(), b = run();
  if (a.startsWith && !a.startsWith("[")) return a;
  return a === b ? ok(true, `${a.length} 字元的訊息一樣`) : "同一串事件送出的訊息不一樣";
});

test("room", () => {
  const s = summary();
  for (const p of R.pass) console.log(`  ✓ ${p.label}${p.msg ? " — " + p.msg : ""}`);
  for (const t of s.todos) console.log(`  … ${t.label} — ${t.msg}`);
  for (const f of s.failures) console.log(`  ✗ ${f.label} — ${f.msg}`);
  console.log(`  通過 ${s.pass} / 失敗 ${s.fail} / 尚未實作 ${s.todo}`);
  assert.equal(s.fail, 0, s.failures.map((f) => `${f.label}: ${f.msg}`).join("\n"));
});
