// A decision with one option only is made by itself (issue #70), as far as node can see it. Orchestrator's file: a peer
// may run it and falsify against it, and does not edit it. That the page really makes it without a tap, says so and
// does not loop on undo is measured in a browser (tools/auto70.mjs).
//
//   node --test tests/auto70.test.js      (or `npm test`)
//
// Owner, 2026-10-17, on the audit (「一局 134 個決定，其中 11% 只有一個選項」, proposal: 「只有一個選項的決定自動做掉，畫面只閃
// 一下結果（悔一步還在）」): 「好，都修，先給我看建議修改後的圖，再開工」; on the canvas 「UX 巡檢 · 建議修改」 (row 6): 「Go」.
// Contract, public/solo.js:
//   - autoChoice(session, lang) → the move of the only choice when the human has exactly one (choices(session, lang) has
//     length 1) and the session is not the tutorial (session.tut); null otherwise;
//   - act(session, move, { auto: true }) plays that move like act(session, move) and marks the step as made by itself:
//     undo(session) goes back past steps made by themselves to the state before the last move the human made, and
//     canUndo(session) is false when the steps kept are all made by themselves; a step that drew (the engine's rng
//     moved) drops the history as before (drew: true).
import test from "node:test";
import assert from "node:assert/strict";
import { R, section, check, ok, nonEmpty, summary } from "./harness.js";
import * as D from "./driver.js";
import * as S from "../public/solo.js";
import * as Tut from "../public/tutorial.js";

const LANGS = ["zh-Hant", "en"];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Solo games stepped one move at a time; every state where the human decides is kept.
function states() {
  const out = [];
  for (let i = 0; i < 8; i++) {
    const seat = i % 3, seed = 7001 + i;
    let s = S.newSolo({ seat, level: 2, seed });
    const R1 = D.rng(seed);
    for (let n = 0; n < 4000 && s.st.phase !== "end"; n++) {
      const bots = S.botsToMove(s).length > 0, ch = S.choices(s, "zh-Hant");
      if (ch.length) out.push({ s, where: `seat ${seat} seed ${seed} 第 ${s.st.turn} 回合第 ${n} 步` });
      if (bots && (!ch.length || R1() < 0.5)) s = S.stepBot(s);
      else { if (!ch.length) break; s = S.act(s, ch[Math.floor(R1() * ch.length)].move); }
    }
  }
  return out;
}
const POOL = states();

const gate = (fn) => () => {
  const ne = nonEmpty(POOL.length, "牌桌的狀態"); if (ne !== true) return ne;
  if (typeof S.autoChoice !== "function") return "solo.js 沒有 autoChoice（#70 已上線，1a54d50；這是退步，不是尚未實作）";
  return fn();
};

section("70 只有一個選項就自己做掉");

check("autoChoice：只有一個選項時給那一步，兩個以上給 null（中英文一樣）", gate(() => {
  let one = 0, many = 0;
  for (const p of POOL) for (const lang of LANGS) {
    const ch = S.choices(p.s, lang), got = S.autoChoice(p.s, lang);
    if (ch.length === 1) { if (!same(got, ch[0].move)) return `${p.where}（${lang}）：只有「${ch[0].label}」，autoChoice 給 ${JSON.stringify(got)}`; one++; }
    else if (got !== null) return `${p.where}（${lang}）：有 ${ch.length} 個選項，autoChoice 卻給 ${JSON.stringify(got)}`;
    else many++;
  }
  const r = nonEmpty(one, "只有一個選項的狀態"); if (r !== true) return r;
  return ok(true, `${one} 個只有一個選項的狀態給了那一步，${many} 個多選項的狀態給 null`);
}));

check("教學裡不自己做：autoChoice 一律 null", gate(() => {
  let n = 0;
  const t = Tut.newTutorial();
  if (S.autoChoice(t, "zh-Hant") !== null) return "教學開頭 autoChoice 不是 null";
  for (const p of POOL) {
    if (S.choices(p.s, "zh-Hant").length !== 1) continue;
    const tut = { ...p.s, tut: { i: 0 } };
    if (S.autoChoice(tut, "zh-Hant") !== null) return `${p.where}：帶著 tut 的 session，autoChoice 給 ${JSON.stringify(S.autoChoice(tut, "zh-Hant"))}`;
    n++;
  }
  const r = nonEmpty(n, "只有一個選項的狀態"); if (r !== true) return r;
  return ok(true, `教學開頭與 ${n} 個帶 tut 的狀態都是 null`);
}));

check("悔一步跳過自己做掉的那一步：自己出手 → 只剩一個（自動）→ 又輪到自己，悔一步回到出手之前", gate(() => {
  let n = 0;
  for (const p of POOL) {
    const s1 = p.s, ch = S.choices(s1, "zh-Hant");
    if (ch.length < 2 || S.botsToMove(s1).length) continue;
    for (const c of ch) {
      const s2 = S.act(s1, c.move);
      if (S.botsToMove(s2).length || s2.st.rng !== s1.st.rng) continue;
      const c2 = S.choices(s2, "zh-Hant");
      if (c2.length !== 1) continue;
      const s3 = S.act(s2, c2[0].move, { auto: true });
      if (s3.st.rng !== s2.st.rng || S.botsToMove(s3).length || S.choices(s3, "zh-Hant").length < 2) continue;
      if (!S.canUndo(s3)) return `${p.where}：「${c.label}」→ 自動「${c2[0].label}」之後不能悔`;
      const back = S.undo(s3);
      if (!same(back.st, s1.st)) return `${p.where}：「${c.label}」→ 自動「${c2[0].label}」之後悔一步，沒有回到「${c.label}」之前${same(back.st, s2.st) ? "（停在只剩一個選項的那一步，會再自動做一次）" : ""}`;
      n++;
    }
  }
  const r = nonEmpty(n, "自己出手 → 只剩一個 → 又輪到自己的狀態"); if (r !== true) return r;
  return ok(true, `${n} 次悔一步都回到自己出手之前`);
}));

check("只剩自己做掉的步驟可悔時，不能悔（canUndo false）；自動那一步抽了檢定，照舊不能悔（drew）", gate(() => {
  let fresh = 0, drew = 0;
  for (const p of POOL) {
    const ch = S.choices(p.s, "zh-Hant");
    if (ch.length !== 1) continue;
    const s2 = { ...p.s, undo: [], drew: false };
    const s3 = S.act(s2, ch[0].move, { auto: true });
    if (s3.st.rng !== s2.st.rng) {
      if (S.canUndo(s3) || !s3.drew) return `${p.where}：自動「${ch[0].label}」抽了檢定，canUndo ${S.canUndo(s3)}、drew ${s3.drew}`;
      drew++; continue;
    }
    if (S.canUndo(s3)) return `${p.where}：歷史裡只有自動的「${ch[0].label}」，卻可以悔`;
    fresh++;
  }
  for (const [n, w] of [[fresh, "自動而且沒抽的那一步"], [drew, "自動而且抽了檢定的那一步"]]) { const r = nonEmpty(n, w); if (r !== true) return r; }
  return ok(true, `${fresh} 次只剩自動的步驟不能悔，${drew} 次自動抽了檢定不能悔`);
}));

check("一般的悔一步照舊：自己連走兩步，悔一步回到第二步之前", gate(() => {
  let n = 0;
  for (const p of POOL) {
    const s1 = p.s, ch = S.choices(s1, "zh-Hant");
    if (ch.length < 2 || S.botsToMove(s1).length) continue;
    const s2 = S.act(s1, ch[0].move);
    if (S.botsToMove(s2).length || s2.st.rng !== s1.st.rng) continue;
    const c2 = S.choices(s2, "zh-Hant");
    if (c2.length < 2) continue;
    const s3 = S.act(s2, c2[0].move);
    if (s3.st.rng !== s2.st.rng || S.botsToMove(s3).length) continue;
    if (!S.canUndo(s3) || !same(S.undo(s3).st, s2.st)) return `${p.where}：連走「${ch[0].label}」「${c2[0].label}」，悔一步沒有回到第二步之前`;
    n++;
  }
  const r = nonEmpty(n, "自己連走兩步的狀態"); if (r !== true) return r;
  return ok(true, `${n} 次`);
}));

test("auto70", () => {
  const s = summary();
  for (const p of R.pass) console.log(`  ✓ ${p.label}${p.msg ? " — " + p.msg : ""}`);
  for (const t of s.todos) console.log(`  … ${t.label} — ${t.msg}`);
  for (const x of s.failures) console.log(`  ✗ ${x.label} — ${x.msg}`);
  console.log(`  通過 ${s.pass} / 失敗 ${s.fail} / 尚未實作 ${s.todo}`);
  assert.equal(s.fail, 0, s.failures.map((x) => `${x.label}: ${x.msg}`).join("\n"));
});
