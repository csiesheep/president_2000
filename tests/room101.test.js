// A room's names and chat cannot carry invisible or reordering characters, and one connection cannot flood the room
// (issue #101), as far as the pure core shows it. Orchestrator's file: a peer may run it and falsify against it, and does
// not edit it. Guessing room codes from one address is tools/room101.mjs (it needs the Worker).
//
//   node --test tests/room101.test.js      (or `npm test`)
//
// The audit (商業盤點 E, multiplayer): names keep RLO, zero-width and other format characters, so a name can pass for
// someone else's (「Bob」 and 「Bob」 + a zero-width space; a right-to-left override turns the rest of a line around);
// there is no rate limit of any kind.
// Contract (orchestrator, #101):
//   - src/roomcore.js: a name (open's `name`) and a chat line, in this order: every control character (Cc, C0 and C1), format character
//     (Cf: bidi marks, embeddings, overrides and isolates, zero-width space / joiner / non-joiner, word joiner, BOM, soft
//     hyphen, …) and lone surrogate that is not white space goes; then each run of white space (\p{White_Space}: spaces,
//     no-break spaces, tabs, line breaks and NEL, line and paragraph separators) becomes one space; the text is NFC; the
//     ends are trimmed; a name keeps at most 24 code points (never half of one), a line 200. A name with nothing left is
//     what an empty name is today.
//   - src/roomcore.js, chat: at most 5 lines from one player within any 10 s; one more is answered { t: "error", code:
//     "rate_limited" } (to the sender only), is not sent to anyone and not kept (the room does not change, as for every
//     error: tests/room.test.js).
//   - src/limits.js (pure: no Cloudflare, no clock, nothing random) exports
//       LIMITS = { msg: { max: 30, per: 10_000 }, miss: { max: 20, per: 600_000 }, create: { max: 30, per: 600_000 } }
//       limiter({ max, per }) → { allow(key, now) }   true while `key` has had fewer than `max` calls within the last
//                                                      `per` ms; every call counts, allowed or not (a flood that never
//                                                      pauses never gets through)
//     The Durable Object asks limiter(LIMITS.msg) for every message of a connection (key: the connection) before the core
//     sees it, and answers a refused one { t: "error", code: "rate_limited" }; `miss` and `create` are the Worker's, per
//     client address (tools/room101.mjs measures those, and the wiring).
//   - a game played at a quick person's pace (a move every 400 ms, the whole game, through limiter(LIMITS.msg)) meets no
//     rate_limited.
// Reports 尚未實作 while names behave as on main (format characters kept), while chat is never rate_limited, and until
// src/limits.js exists.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { R, section, check, ok, nonEmpty, summary } from "./harness.js";
import * as RC from "../src/roomcore.js";

const T0 = 1_000_000;
function world() {
  const w = { room: RC.newRoom({ code: "ABCD", seed: "101", now: T0 }), inbox: {} };
  w.do = (ev, at) => { const r = RC.handle(JSON.parse(JSON.stringify(w.room)), ev, at); w.room = r.room; for (const o of r.out) (w.inbox[o.to] ??= []).push(o.msg); return r.out; };
  w.open = (conn, name, at = T0) => w.do({ type: "open", conn, name, token: null }, at);
  w.msg = (conn, data, at) => w.do({ type: "msg", conn, data }, at);
  return w;
}
// The name the room shows for a player who opened with `name` and sat in seat 0.
function shown(name) {
  const w = world(); w.open("A", name); const out = w.msg("A", { t: "sit", seat: 0 }, T0 + 1);
  const m = [...out].reverse().find((o) => o.msg.t === "room");
  return m ? m.msg.seats[0].name : undefined;
}
// The line the room sends for `text` (null when none is sent).
function said(text) {
  const w = world(); w.open("A", "Ann"); w.msg("A", { t: "sit", seat: 0 }, T0 + 1);
  const out = w.msg("A", { t: "chat", text }, T0 + 2), m = out.find((o) => o.msg.t === "chat");
  return m ? m.msg.lines[m.msg.lines.length - 1].text : null;
}
const cps = (s) => Array.from(String(s ?? "")).map((c) => "U+" + c.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")).join(" ");
const FORMAT = /[\p{Cc}\p{Cf}\p{Cs}]/u, CF = /\p{Cf}/u; // main keeps every Cf (it drops C0 only)
const EMPTY = shown("");
// input → what the room must show (hand-written; the cases with a format character are the ones main keeps)
const NAMES = [
  ["‮evil", "evil", "RLO"],
  ["Bo​b", "Bob", "零寬空格"],
  ["Al﻿ice", "Alice", "BOM（在中間：在頭尾的會被 trim 掉）"],
  ["A⁦B⁩", "AB", "isolate"],
  ["Joe‎", "Joe", "LRM"],
  ["李‍登輝", "李登輝", "ZWJ"],
  ["A­B", "AB", "軟連字號"],
  ["X\u0085Y", "X Y", "C1 的 NEL（是空白，變一個空格）"],
  ["X\u009BY", "XY", "C1 的 CSI（不是空白，拿掉）"],
  ["a ​ b", "a b", "空格之間夾零寬空格"],
  ["Ann  Lee", "Ann Lee", "兩個不換行空格"],
  ["Tom \t Lee", "Tom Lee", "空格與 tab"],
  ["a b", "a b", "行分隔符"],
  ["émile", "émile", "NFC"],
  ["😀".repeat(30), "😀".repeat(24), "24 個字（code point），不切半個"],
  ["  選民甲  ", "選民甲", "頭尾空白"],
  ["Bob", "Bob", "一般名字"],
];
const HAS_FORMAT = NAMES.filter(([i]) => CF.test(i));

section("101 名字與聊天");
check("名字：拿掉控制與格式字元、空白收成一個、NFC、24 個字（逐條手寫的期望）", () => {
  const bad = [], kept = [];
  for (const [input, want, what] of NAMES) {
    const got = shown(input);
    if (got !== want) bad.push(`${what}：${cps(input)} → ${cps(got)}，應是 ${cps(want)}`);
    if (CF.test(input) && CF.test(got || "")) kept.push(what);
  }
  const z = nonEmpty(HAS_FORMAT.length, "帶格式字元的名字"); if (z !== true) return z;
  if (kept.length === HAS_FORMAT.length) return `TODO: 名字裡的格式字元都還在（${kept.join("、")}）`;
  return ok(!bad.length, bad.length ? `${bad.length}/${NAMES.length} 條不對：${bad.slice(0, 4).join("；")}` : `${NAMES.length} 條都對`);
});
check("名字：全是格式字元的名字，跟空的名字一樣", () => {
  const got = shown("​‮⁦");
  if (FORMAT.test(got || "")) return `TODO: 格式字元還在（${cps(got)}）`;
  return ok(got === EMPTY, `${cps(got)}（空的名字是 ${JSON.stringify(EMPTY)}）`);
});
check("聊天：同樣拿掉控制與格式字元、空白收成一個、NFC、200 個字", () => {
  const LINES = [["‮txet", "txet"], ["hi​ there", "hi there"], ["a\nb", "a b"], ["é", "é"], ["好😀", "好😀"], ["x".repeat(250), "x".repeat(200)]];
  const bad = [];
  for (const [input, want] of LINES) { const got = said(input); if (got !== want) bad.push(`${cps(input).slice(0, 40)} → ${cps(got).slice(0, 40)}，應是 ${cps(want).slice(0, 40)}`); }
  if (FORMAT.test(said("‮txet") || "") && FORMAT.test(said("hi​ there") || "")) return "TODO: 聊天裡的格式字元還在";
  return ok(!bad.length, bad.length ? bad.join("；") : `${LINES.length} 條都對`);
});

section("101 一條連線不能洗版");
const limited = (out) => out.some((o) => o.msg.t === "error" && o.msg.code === "rate_limited");
const SPEC = { msg: { max: 30, per: 10_000 }, miss: { max: 20, per: 600_000 }, create: { max: 30, per: 600_000 } };
const FILE = new URL("../src/limits.js", import.meta.url);
let L = null, L_ERR = null;
if (existsSync(FILE)) { try { L = await import(FILE.href); } catch (e) { L_ERR = e; } }
const cL = (name, fn) => check(name, () => {
  if (!existsSync(FILE)) return "TODO: src/limits.js 還沒有（#101）";
  if (L_ERR) return `src/limits.js 在 node 裡 import 就丟錯：${L_ERR.message}`;
  if (!L.LIMITS || typeof L.limiter !== "function") return "TODO: src/limits.js 還沒有 LIMITS、limiter（#101）";
  return fn();
});
cL("LIMITS 跟契約一樣（每條連線 10 秒 30 則；每個位址 10 分鐘猜錯 20 次、開 30 間房）", () => {
  const got = JSON.stringify(L.LIMITS), want = JSON.stringify(SPEC);
  return ok(got === want, got === want ? got : `是 ${got}，契約是 ${want}`);
});
cL("limiter：10 秒內 30 次都放行；第 31 次擋下；一直不停地送就一直擋；停 10 秒後又放行；別的 key 不受影響", () => {
  const lim = L.limiter(SPEC.msg), bad = [];
  const first = []; for (let i = 0; i < 30; i++) first.push(lim.allow("A", T0 + i * 100));
  if (first.some((x) => x !== true)) bad.push(`前 30 次有 ${first.filter((x) => x !== true).length} 次沒放行`);
  if (lim.allow("A", T0 + 3000) !== false) bad.push("第 31 次（第 3 秒）放行了");
  let through = 0; for (let t = T0 + 3100; t <= T0 + 20_000; t += 100) if (lim.allow("A", t)) through++;
  if (through) bad.push(`第 3–20 秒每 100 ms 送一次，放行了 ${through} 次（被擋的也要算，一直送就一直擋）`);
  if (lim.allow("A", T0 + 30_100) !== true) bad.push("停 10 秒後沒有放行");
  if (lim.allow("B", T0 + 3000) !== true) bad.push("別的 key 也被擋了");
  return ok(!bad.length, bad.join("；") || "30 次放行、第 31 次擋、不停地送一直擋、停 10 秒放行、B 不受影響");
});
check("聊天：一位玩家 6 秒內說 12 句，送出前 5 句，第 6–12 句 rate_limited、誰都沒收到、房間不留；20 秒後又能說", () => {
  const w = world(); w.open("A", "Ann"); w.open("B", "Bo"); w.msg("A", { t: "sit", seat: 0 }, T0); w.msg("B", { t: "sit", seat: 1 }, T0);
  const kept0 = w.room.chat.length, outs = [];
  for (let i = 0; i < 12; i++) outs.push(w.msg("A", { t: "chat", text: `第 ${i + 1} 句` }, T0 + 100 + i * 500));
  const toB = outs.map((o) => o.some((x) => x.to === "B" && x.msg.t === "chat")), n = toB.filter(Boolean).length, kept = w.room.chat.length - kept0;
  const later = w.msg("A", { t: "chat", text: "第 13 句" }, T0 + 20_000);
  if (n === 12) return "TODO: 12 句都照送（聊天還沒有限速）";
  const bad = [];
  if (toB.slice(0, 5).some((x) => !x)) bad.push(`前 5 句有 ${toB.slice(0, 5).filter((x) => !x).length} 句沒送到 B`);
  if (n !== 5) bad.push(`送到 B 的是 ${n} 句（應是 5 句）`);
  const notLimited = outs.slice(5).filter((o) => !limited(o)).length; if (notLimited) bad.push(`第 6–12 句有 ${notLimited} 句沒有回 rate_limited`);
  if (kept !== 5) bad.push(`房間留了 ${kept} 句（應是 5 句）`);
  if (!later.some((x) => x.to === "B" && x.msg.t === "chat")) bad.push("20 秒後的第 13 句沒有送出");
  return ok(!bad.length, bad.join("；") || "前 5 句照送，第 6–12 句 rate_limited 而且沒人收到、房間不留，20 秒後第 13 句照送");
});
cL("一個人照快手的速度（每 400 ms 一步）打完一整局，每一則都先過 limiter(LIMITS.msg)，一次 rate_limited 都沒有", () => {
  const lim = L.limiter(L.LIMITS.msg), w = world(), core = w.msg;
  // every message of the connection goes through the limiter first, as the Durable Object does
  w.msg = (conn, data, at) => (lim.allow(conn, at) ? core(conn, data, at) : [{ to: conn, msg: { t: "error", code: "rate_limited" } }]);
  w.open("A", "Ann"); w.msg("A", { t: "sit", seat: 0 }, T0);
  const legalIn = (out, prev) => { const s = out.filter((o) => o.to === "A" && o.msg.t === "state").pop(); return s ? s.msg.legal : prev; };
  let legal = legalIn(w.msg("A", { t: "start", level: 1 }, T0 + 10), []), now = T0 + 10, moves = 0, hits = 0, stuck = 0;
  for (let n = 0; n < 4000 && w.room.st && w.room.st.phase !== "end"; n++) {
    if (!legal.length) { if (++stuck > 5) break; now = Math.max(now + 1000, w.room.alarmAt || 0); legal = legalIn(w.do({ type: "alarm" }, now), legal); continue; }
    stuck = 0; now += 400; moves++;
    const out = w.msg("A", { t: "move", move: legal[0] }, now);
    if (limited(out)) hits++;
    legal = legalIn(out, []);
  }
  const z = nonEmpty(moves, "這一局人做的決定"); if (z !== true) return z;
  return ok(!hits && w.room.st.phase === "end", `${moves} 步、rate_limited ${hits} 次、局面 ${w.room.st && w.room.st.phase}`);
});

test("room101", () => {
  const s = summary();
  for (const p of R.pass) console.log(`  ✓ ${p.label}${p.msg ? " — " + p.msg : ""}`);
  for (const t of s.todos) console.log(`  … ${t.label} — ${t.msg}`);
  for (const x of s.failures) console.log(`  ✗ ${x.label} — ${x.msg}`);
  console.log(`  通過 ${s.pass} / 失敗 ${s.fail} / 尚未實作 ${s.todo}`);
  assert.equal(s.fail, 0, s.failures.map((x) => `${x.label}: ${x.msg}`).join("\n"));
});
