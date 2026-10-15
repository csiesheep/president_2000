// The turn's start in the log carries the votes at that moment (issue #40), so the table can say how far each
// candidate moved in a turn (the turn card, #44). Orchestrator's file: a peer may run it and falsify against it,
// and does not edit it.
//
//   node --test tests/turnlog.test.js      (or `npm test`)
//
// Owner, 2026-10-15, approving the P1 designs (「Go ahead」): the turn card shows each candidate's votes and the change
// since the last turn. Contract: every { t: "turn" } log entry has votes: [陳, 宋, 連], the number of blocks each seat
// owns on the board when the turn starts (one block = 10萬 votes, the number on the candidate panels). Turns 1–9,
// the debate (turn 6) and election day (turn 9) included. Reports 尚未實作 until a turn entry has votes.
import test from "node:test";
import assert from "node:assert/strict";
import { R, section, check, ok, nonEmpty, summary } from "./harness.js";
import * as D from "./driver.js";
import * as E from "../public/shared/engine.js";

// Counted here, from the board, not with the engine's own tally.
const onBoard = (st) => [0, 1, 2].map((p) => st.counties.reduce((s, c) => s + c.blocks.filter((b) => b.o === p).length, 0));

// Whole games with random legal moves; every turn entry is checked against the board right after the move that
// wrote it (turn start draws and deals, it does not place blocks).
function games() {
  const out = [];
  for (const seed of [4001, 4002, 4003, 4004]) {
    let st = E.createGame(seed);
    const R1 = D.rng(seed);
    const seen = (s, from) => s.log.slice(from).map((e, i) => ({ e, at: from + i })).filter((x) => x.e.t === "turn");
    for (const x of seen(st, 0)) out.push({ seed, turn: x.e.turn, entry: x.e, board: onBoard(st) });
    for (let n = 0; n < 6000 && st.phase !== "end"; n++) {
      const seats = E.mustAct(st); if (!seats.length) break;
      const moves = E.legalMoves(st, seats[0]);
      const before = st.log.length;
      st = E.apply(st, seats[0], moves[Math.floor(R1() * moves.length)]);
      for (const x of seen(st, before)) out.push({ seed, turn: x.e.turn, entry: x.e, board: onBoard(st) });
    }
  }
  return out;
}
const TURNS = games();
const gate = (fn) => () => {
  const ne = nonEmpty(TURNS.length, "回合開始的紀錄"); if (ne !== true) return ne;
  if (!TURNS.some((x) => Array.isArray(x.entry.votes))) return "TODO: 回合紀錄還沒有 votes（#40）";
  return fn();
};

section("40 回合紀錄帶票數");

check("每一個回合開始的紀錄都有 votes：三個整數，等於那時盤面上三人各自的方塊數", gate(() => {
  for (const x of TURNS) {
    const v = x.entry.votes;
    if (!Array.isArray(v) || v.length !== 3 || !v.every(Number.isInteger)) return `seed ${x.seed} 第 ${x.turn} 回合：votes 是 ${JSON.stringify(v)}`;
    if (v.some((n, i) => n !== x.board[i])) return `seed ${x.seed} 第 ${x.turn} 回合：votes ${JSON.stringify(v)}，盤面上是 ${JSON.stringify(x.board)}`;
  }
  return ok(true, `${TURNS.length} 個回合開始，票數都跟盤面一致`);
}));

check("九個回合都有：每局的回合紀錄是 1 到 9 各一筆（政見發表會、投票日也算）", gate(() => {
  for (const seed of new Set(TURNS.map((x) => x.seed))) {
    const turns = TURNS.filter((x) => x.seed === seed).map((x) => x.turn);
    if (turns.join(",") !== "1,2,3,4,5,6,7,8,9") return `seed ${seed}：回合紀錄是 ${turns.join(",")}`;
  }
  return ok(true, "每局 1–9 回合各一筆");
}));

test("turnlog", () => {
  const s = summary();
  for (const p of R.pass) console.log(`  ✓ ${p.label}${p.msg ? " — " + p.msg : ""}`);
  for (const t of s.todos) console.log(`  … ${t.label} — ${t.msg}`);
  for (const x of s.failures) console.log(`  ✗ ${x.label} — ${x.msg}`);
  console.log(`  通過 ${s.pass} / 失敗 ${s.fail} / 尚未實作 ${s.todo}`);
  assert.equal(s.fail, 0, s.failures.map((x) => `${x.label}: ${x.msg}`).join("\n"));
});
