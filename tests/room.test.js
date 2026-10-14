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
import * as BOTS from "../public/shared/bots.js";

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

// ---- bot 的步與倒數（#16）. Every state message also carries
//   botMoves: [{ seat, move, why }]  every move a bot made in this handle, in order (bot seats,
//                                    taken-over seats, timed-out moves); [] if none. why is the
//                                    bot's { key, …params }, so the page can show the table talk
//                                    and say what the bot did
//   deadline: ms | null              the earliest time a connected human's pending decision times
//                                    out (the same in every seat's message); null if none
// Reports 尚未實作 until a state message has a `botMoves` field.
const BOTMOVES = (() => {
  if (!RC) return false;
  try { const { w } = twoHumans(91); return Object.values(w.inbox).flat().some((m) => m.t === "state" && "botMoves" in m); } catch { return false; }
})();
const c16 = (name, fn) => c13(name, () => (BOTMOVES ? fn() : "TODO: state 訊息還沒有 botMoves（#16）"));
c16("bot 的步：每則 state 的 botMoves 照順序套回去，剛好從人類那一步之後走到現在的局面；why.key 在 WHY 裡；每個人收到的一樣", () => {
  const { w } = twoHumans(93, 2);
  const why = new Set(BOTS.WHY);
  let handles = 0, moves = 0;
  const R1 = D.rng(11);
  for (let n = 0; n < 400 && w.room.st.phase !== "end"; n++) {
    const must = E.mustAct(w.room.st).filter((s) => s in humanConn);
    if (!must.length) return "沒有人類要動";
    const seat = must[0], st = w.last(humanConn[seat], "state");
    const before = E.clone(w.room.st), move = st.legal[Math.floor(R1() * st.legal.length)];
    const out = w.msg(humanConn[seat], { t: "move", move }, w.now + 1000);
    const states = out.filter((o) => o.msg.t === "state");
    if (!states.length) continue;
    for (const o of states) if (!Array.isArray(o.msg.botMoves)) return `state 沒有 botMoves 陣列（送給 ${o.to}）`;
    if (new Set(states.map((o) => JSON.stringify(o.msg.botMoves))).size > 1) return `第 ${w.room.st.turn} 回合：同一次 handle，兩個人收到的 botMoves 不一樣`;
    let s = E.apply(before, seat, move);
    for (const b of states[0].msg.botMoves) {
      if (!b.why || !why.has(b.why.key)) return `botMoves 的 why.key 不在 WHY：${JSON.stringify(b)}`;
      if (Object.values(b.why).some((v) => v !== null && typeof v === "object")) return `why 的參數要是數字或字串：${JSON.stringify(b.why)}`;
      // Everyone is online and moves within a second, so only seat 2 (the bot) moves on its own.
      if (b.seat !== 2) return `這局只有 seat 2 是 bot，botMoves 卻有 seat ${b.seat}`;
      try { s = E.apply(s, b.seat, b.move); } catch (e) { return `第 ${w.room.st.turn} 回合：botMoves 套不回去（${JSON.stringify(b.move)}：${e.message}）`; }
    }
    if (!same(s, w.room.st)) return `第 ${w.room.st.turn} 回合 ${w.room.st.phase}：人類那一步加上 ${states[0].msg.botMoves.length} 個 botMoves，走不到現在的局面`;
    if (states[0].msg.botMoves.length) { handles++; moves += states[0].msg.botMoves.length; }
  }
  const r = nonEmpty(moves, "bot 的步"); if (r !== true) return r;
  return ok(true, `${handles} 次 handle 共 ${moves} 個 bot 的步，逐步套回去都對得上`);
});
c16("倒數：連線中的人類要動時，每一則 state 都帶 deadline = 這個決定開始的時間 + 60 秒；沒有人類要動時是 null", () => {
  const { w } = twoHumans(95);
  const R1 = D.rng(12);
  let checked = 0;
  for (let n = 0; n < 200 && w.room.st.phase !== "end"; n++) {
    const must = E.mustAct(w.room.st).filter((s) => s in humanConn);
    if (!must.length) return "沒有人類要動";
    const seat = must[0], st = w.last(humanConn[seat], "state");
    const at = w.now + 1000, mustBefore = E.mustAct(w.room.st);
    const out = w.msg(humanConn[seat], { t: "move", move: st.legal[Math.floor(R1() * st.legal.length)] }, at);
    const mustNow = E.mustAct(w.room.st), humans = mustNow.filter((s) => s in humanConn);
    for (const o of out.filter((x) => x.msg.t === "state")) {
      if (!humans.length || w.room.st.phase === "end") { if (o.msg.deadline !== null) return `沒有人類要動，deadline 卻是 ${o.msg.deadline}`; continue; }
      // Checked only when every human who must act now started deciding with this move: the one
      // who just moved (every decision restarts the clock, #13 裁決 5) or one who was not asked
      // before. In simultaneous steps (save, debate) another human may have been waiting longer.
      if (!humans.every((h) => h === seat || !mustBefore.includes(h))) continue;
      if (o.msg.deadline !== at + MIN) return `第 ${w.room.st.turn} 回合 ${w.room.st.phase}：deadline 應該是 ${at + MIN}，實際 ${o.msg.deadline}`;
      checked++;
    }
  }
  const r = nonEmpty(checked, "帶 deadline 的 state"); if (r !== true) return r;
  return ok(true, `${checked} 則 state 的 deadline 都是該決定開始 + 60 秒`);
});

// Chat and rematch (#16; plan M4 "chat … rematch"):
//   { t: "chat", text } from a conn → { t: "chat", lines: [{ seat, name, text, at }] } to every
//     connected conn; text trimmed, control characters dropped, cut to 200 characters; an empty
//     text is an error to the sender. The room keeps the last 50 lines and sends them, as one
//     chat message, to a conn when it opens.
//   { t: "rematch" } from the host once the game has ended → a new game, same seats and level,
//     a new engine seed; before the end, or from anyone else, an error to the sender only.
const lastChat = (w, conn) => w.last(conn, "chat");
c16("聊天：送出去每個人都收到（名字、座位、文字）；前後空白去掉、控制字元拿掉、超過 200 字截斷；空字串只回 error 給送的人；新連上的人收到最近的聊天", () => {
  const w = world(97);
  w.open("A", "Ann"); w.open("B", "Bo");
  w.msg("A", { t: "sit", seat: 0 });
  w.msg("A", { t: "chat", text: "  誰要當阿扁？\u0007 " });
  for (const conn of ["A", "B"]) {
    const c = lastChat(w, conn);
    const line = c && c.lines && c.lines[c.lines.length - 1];
    if (!line) return `${conn} 沒收到聊天`;
    const r = eq(`${line.name}|${line.seat}|${line.text}`, "Ann|0|誰要當阿扁？", `${conn} 收到的聊天`); if (r !== true) return r;
  }
  w.msg("B", { t: "chat", text: "x".repeat(300) });
  const long = lastChat(w, "A").lines.slice(-1)[0];
  let r = eq(`${long.seat}|${long.text.length}`, "null|200", "沒入座的 B 送 300 字（座位、長度）"); if (r !== true) return r;
  const before = JSON.stringify(w.room);
  const out = w.msg("B", { t: "chat", text: "   " });
  r = eq(out.length === 1 && out[0].to === "B" && out[0].msg.t === "error" && JSON.stringify(w.room) === before, true, "空白聊天：只回 error 給 B、房間不變"); if (r !== true) return r;
  w.open("C", "Cy");
  const hist = lastChat(w, "C");
  r = eq(hist && hist.lines.map((l) => l.text.slice(0, 6)).join("|"), "誰要當阿扁？|xxxxxx", "C 連上時收到的聊天紀錄"); if (r !== true) return r;
  for (let i = 0; i < 60; i++) w.msg("A", { t: "chat", text: `line ${i}` });
  w.open("D", "Di");
  r = eq(lastChat(w, "D").lines.length, 50, "D 連上時收到的聊天紀錄條數"); if (r !== true) return r;
  return ok(true, "廣播、清理、截斷、空字串、紀錄 50 條");
});
c16("再來一局：結束之前或不是房主按，只回 error；房主在結束後按，同樣的座位與 bot 等級開新的一局，發的牌不一樣", () => {
  const { w } = twoHumans(99, 1);
  const firstHand = JSON.stringify(w.room.st.hands[0]);
  let before = JSON.stringify(w.room);
  let out = w.msg("A", { t: "rematch" }, w.now + 10);
  let r = eq(out.length === 1 && out[0].to === "A" && out[0].msg.t === "error" && JSON.stringify(w.room) === before, true, "還沒結束就按：只回 error 給 A、房間不變"); if (r !== true) return r;
  const bad = playHumans(w, D.rng(13));
  if (bad) return bad;
  r = eq(w.room.st.phase, "end", "第一局結束"); if (r !== true) return r;
  before = JSON.stringify(w.room);
  out = w.msg("B", { t: "rematch" }, w.now + 10);
  r = eq(out.length === 1 && out[0].to === "B" && out[0].msg.t === "error" && JSON.stringify(w.room) === before, true, "不是房主按：只回 error 給 B、房間不變"); if (r !== true) return r;
  w.msg("A", { t: "rematch" }, w.now + 10);
  r = eq(`${w.room.st.phase !== "end"} ${w.room.st.turn}`, "true 1", "房主按之後：新的一局在第 1 回合"); if (r !== true) return r;
  const seats = w.last("B", "room").seats.map((s) => s.kind).join(",");
  r = eq(seats, "human,human,bot", "新的一局的座位"); if (r !== true) return r;
  for (const [conn, seat] of [["A", 0], ["B", 1]]) {
    const s = w.last(conn, "state");
    if (!s || !same(s.view, E.view(w.room.st, seat))) return `${conn} 沒收到新的一局 seat ${seat} 的 state`;
  }
  r = eq(JSON.stringify(w.room.st.hands[0]) !== firstHand, true, "新的一局 seat 0 的手牌跟第一局不一樣（新的種子）"); if (r !== true) return r;
  return ok(true, "結束前、非房主都被拒；房主再開一局，座位不變、牌不同");
});

test("room", () => {
  const s = summary();
  for (const p of R.pass) console.log(`  ✓ ${p.label}${p.msg ? " — " + p.msg : ""}`);
  for (const t of s.todos) console.log(`  … ${t.label} — ${t.msg}`);
  for (const f of s.failures) console.log(`  ✗ ${f.label} — ${f.msg}`);
  console.log(`  通過 ${s.pass} / 失敗 ${s.fail} / 尚未實作 ${s.todo}`);
  assert.equal(s.fail, 0, s.failures.map((f) => `${f.label}: ${f.msg}`).join("\n"));
});
