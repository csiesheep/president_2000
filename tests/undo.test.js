// 悔一步 in solo games (issue #43, P1 ⑬). Orchestrator's file: a peer may run it and falsify against it, and does
// not edit it.
//
//   node --test tests/undo.test.js      (or `npm test`)
//
// Owner, 2026-10-15, approving the P1 designs: in a solo game the human may step back to their previous decision,
// as long as the computer has not moved and nothing random has been drawn since (a support check, a reshuffle...).
// Contract (public/solo.js):
//   - S.canUndo(session) → boolean; S.undo(session) → the session as it was before the human's last move;
//   - after S.act(s, m): canUndo is true exactly when that move drew nothing random — the engine's st.rng is unchanged
//     — and then S.undo gives back s: the same st, the same bot rng, the same choices;
//   - a run of such moves undoes one at a time, back to where the run began;
//   - once a bot has moved (S.stepBot), or on a fresh game, canUndo is false;
//   - S.screen shows a button data-undo, enabled, exactly when canUndo; never in the tutorial.
// Reports 尚未實作 until S.canUndo exists.
import test from "node:test";
import assert from "node:assert/strict";
import { R, section, check, ok, nonEmpty, summary } from "./harness.js";
import * as D from "./driver.js";
import * as S from "../public/solo.js";
import * as Tut from "../public/tutorial.js";

const has = typeof S.canUndo === "function" && typeof S.undo === "function";
const undoBtn = (html) => { const m = html.match(/<button[^<>]*\sdata-undo(?:="[^"]*")?[^<>]*>/); return m ? m[0] : null; };
const enabled = (tag) => !!tag && !/\sdisabled[\s=>]/.test(tag);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const labels = (s) => S.choices(s, "zh-Hant").map((c) => c.label).join(" | ");

// The human's decisions in whole solo games: each one with every legal move tried (up to 6).
function samples() {
  const out = [];
  for (const [seat, seed] of [[0, 4301], [1, 4302], [2, 4303]]) {
    let s = S.advance(S.newSolo({ seat, level: 2, seed }));
    const R1 = D.rng(seed);
    for (let n = 0; n < 220 && s.st.phase !== "end"; n++) {
      const ch = S.choices(s, "zh-Hant");
      if (!ch.length) break;
      if (n % 2 === 0) for (const c of ch.slice(0, 6)) out.push({ s, m: c.move, where: `seat ${seat} seed ${seed} 第 ${s.st.turn} 回合 ${s.st.phase} 第 ${n} 步：${c.label}` });
      const nx = S.act(s, ch[Math.floor(R1() * ch.length)].move);
      s = S.botsToMove(nx).length ? nx : nx; // keep the bots queued: the page steps them
      while (S.botsToMove(s).length) s = S.stepBot(s);
    }
  }
  return out;
}
const POOL = has ? samples() : [];
const gate = (fn) => () => {
  if (!has) return "TODO: solo.js 還沒有 canUndo / undo（#43）";
  const ne = nonEmpty(POOL.length, "人的決定"); if (ne !== true) return ne;
  return fn();
};

section("43 悔一步");

check("走一步之後：沒抽到亂數（st.rng 沒變）才能悔；悔回去是同一個局面、同一個電腦亂數、同樣的選項", gate(() => {
  let yes = 0, no = 0;
  for (const p of POOL) {
    const s1 = S.act(p.s, p.m), drew = s1.st.rng !== p.s.st.rng;
    if (S.canUndo(s1) === drew) return `${p.where}：${drew ? "抽過亂數" : "沒抽亂數"}，canUndo 卻是 ${S.canUndo(s1)}`;
    if (drew) { no++; continue; }
    const u = S.undo(s1);
    if (!same(u.st, p.s.st)) return `${p.where}：悔回去的局面跟原來不一樣`;
    if (u.rng !== p.s.rng) return `${p.where}：悔回去之後電腦的亂數變了`;
    if (labels(u) !== labels(p.s)) return `${p.where}：悔回去之後的選項不一樣`;
    yes++;
  }
  const r = nonEmpty(yes, "可以悔的一步"); if (r !== true) return r;
  const r2 = nonEmpty(no, "抽過亂數、不能悔的一步"); if (r2 !== true) return r2;
  return ok(true, `${yes} 步可以悔且悔回原樣，${no} 步抽過亂數不能悔`);
}));

check("連走幾步都沒抽亂數：一次悔一步，可以一路悔回第一步之前", gate(() => {
  let chains = 0;
  for (const p of POOL) {
    const s1 = S.act(p.s, p.m); if (s1.st.rng !== p.s.st.rng) continue;
    const c2 = S.choices(s1, "zh-Hant").find((c) => S.act(s1, c.move).st.rng === s1.st.rng);
    if (!c2 || S.botsToMove(s1).length) continue;
    const s2 = S.act(s1, c2.move);
    if (!S.canUndo(s2)) return `${p.where} → ${c2.label}：兩步都沒抽亂數，第二步卻不能悔`;
    const u1 = S.undo(s2);
    if (!same(u1.st, s1.st)) return `${p.where} → ${c2.label}：悔一次沒有回到第一步之後`;
    if (!S.canUndo(u1)) return `${p.where} → ${c2.label}：悔一次之後，第一步不能再悔`;
    if (!same(S.undo(u1).st, p.s.st)) return `${p.where} → ${c2.label}：悔兩次沒有回到原來的局面`;
    if (++chains >= 40) break;
  }
  const r = nonEmpty(chains, "連兩步都沒抽亂數的例子"); if (r !== true) return r;
  return ok(true, `${chains} 組連兩步，都能一步一步悔回去`);
}));

check("電腦一動就不能悔；剛開的局也不能悔", gate(() => {
  let moved = 0;
  for (const p of POOL) {
    const s1 = S.act(p.s, p.m); if (!S.botsToMove(s1).length) continue;
    if (S.canUndo(S.stepBot(s1))) return `${p.where}：電腦動過之後還能悔`;
    moved++;
  }
  for (const seat of [0, 1, 2]) if (S.canUndo(S.advance(S.newSolo({ seat, level: 2, seed: 4400 + seat })))) return `座位 ${seat}：剛開的局就能悔`;
  const r = nonEmpty(moved, "走完之後輪到電腦的一步"); if (r !== true) return r;
  return ok(true, `${moved} 次電腦動過之後都不能悔`);
}));

check("畫面：能悔時有一顆可以按的 data-undo，不能悔時沒有可以按的", gate(() => {
  let on = 0, off = 0;
  for (const p of POOL.filter((x, i) => i % 3 === 0)) {
    const s1 = S.act(p.s, p.m), btn = undoBtn(S.screen(s1, "zh-Hant"));
    if (S.canUndo(s1) !== enabled(btn)) return `${p.where}：canUndo ${S.canUndo(s1)}，畫面上的按鈕是 ${btn || "沒有"}`;
    if (S.canUndo(s1)) on++; else off++;
    if (enabled(undoBtn(S.screen(p.s, "zh-Hant"))) && !S.canUndo(p.s)) return `${p.where}（走之前）：不能悔卻有按鈕`;
  }
  const r = nonEmpty(on, "畫面上能悔"); if (r !== true) return r;
  return ok(true, `${on} 個畫面有按鈕，${off} 個沒有`);
}));

check("教學裡沒有悔一步", gate(() => {
  let t = Tut.newTutorial(), shown = 0;
  for (let n = 0; n < 30; n++) {
    const st = Tut.step(t, "zh-Hant");
    if (!st || st.kind === "done") break;
    if (enabled(undoBtn(S.screen(t, "zh-Hant")))) return `教學第 ${n} 步（${st.id}）：畫面上有悔一步`;
    shown++;
    if (st.moves && st.moves.length) t = Tut.act(t, st.moves[0]); else t = Tut.next(t);
  }
  const r = nonEmpty(shown, "教學的畫面"); if (r !== true) return r;
  return ok(true, `${shown} 個教學畫面都沒有`);
}));

test("undo", () => {
  const s = summary();
  for (const p of R.pass) console.log(`  ✓ ${p.label}${p.msg ? " — " + p.msg : ""}`);
  for (const t of s.todos) console.log(`  … ${t.label} — ${t.msg}`);
  for (const x of s.failures) console.log(`  ✗ ${x.label} — ${x.msg}`);
  console.log(`  通過 ${s.pass} / 失敗 ${s.fail} / 尚未實作 ${s.todo}`);
  assert.equal(s.fail, 0, s.failures.map((x) => `${x.label}: ${x.msg}`).join("\n"));
});
