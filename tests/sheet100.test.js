// An opened hand card never hides the decision you have to make (issue #100). Orchestrator's file: a peer may run it and
// falsify against it, and does not edit it. That a quick second tap on a decision is not swallowed is tools/tap100.mjs.
//
//   node --test tests/sheet100.test.js      (or `npm test`)
//
// The audit (商業盤點 C, item 12): with a hand card opened, a decision that is not a card play (the kind of action, the
// issue, where to place, whom to take from) drew no button at all — only 「現在不能打這張牌。」 — until 「← 收起」 was
// pressed; in a room the 60 s clock ran out and the computer played. Measured on main 67c3d2d, six solo games: kind of
// action 124 of 124 such screens lost every button, issue 99 of 99, steal 96 of 96, fill 37 of 56, cross 8 of 17.
// Contract (orchestrator, #100): on the human's decision that is not a card play, Solo.screen with a hand card opened
// ({ sel: <card> }) draws every decision button ([data-move]) it draws with nothing opened (the same moves); the card
// itself may still show. A failure when any screen loses one or more (since #100 landed, af7769c, also when they all
// do; before, that reported 尚未實作).
import test from "node:test";
import assert from "node:assert/strict";
import { R, section, check, ok, nonEmpty, summary } from "./harness.js";
import * as S from "../public/solo.js";
import * as D from "./driver.js";

const LANGS = ["zh-Hant", "en"];
const movesOf = (html) => new Set([...html.matchAll(/data-move="([^"]*)"/g)].map((m) => m[1]));
function cases() {
  const out = [];
  for (let seed = 1; seed <= 8; seed++) {
    let s = S.advance(S.newSolo({ seat: seed % 3, level: 1, seed }));
    const Rr = D.rng(seed * 7 + 1);
    for (let n = 0; n < 700 && s.st.phase !== "end"; n++) {
      const ch = S.choices(s, "zh-Hant");
      if (!ch.length) { s = S.advance(s); continue; }
      const play = ch.some((c) => c.move.card || c.move.type === "candidate");
      const hand = s.st.hands[s.seat];
      if (!play && hand.length && ch.length > 1 && n % 2 === 0) out.push({ seed, s, kind: `${s.st.phase}:${ch[0].move.type}`, card: hand[n % hand.length] });
      s = S.advance(S.act(s, ch[Math.floor(Rr() * ch.length)].move));
    }
  }
  return out;
}
section("100 打開的牌不蓋住決定");
check("不是出牌的決定：打開一張手牌時，沒打開時畫的每一顆決定按鈕都還在（中英）", () => {
  const all = cases(), bad = [], kinds = {};
  let n = 0, hidden = 0, none = 0;
  for (const c of all) for (const lang of LANGS) {
    const a = movesOf(S.screen(c.s, lang)), b = movesOf(S.screen(c.s, lang, { sel: c.card }));
    if (!a.size) continue;
    n++;
    const lost = [...a].filter((m) => !b.has(m));
    const k = kinds[c.kind] || (kinds[c.kind] = { n: 0, lost: 0 });
    k.n++;
    if (lost.length === a.size) none++;
    if (lost.length) { hidden++; k.lost++; if (bad.length < 4) bad.push(`種子 ${c.seed} ${lang} ${c.kind}：打開「${c.card}」後少了 ${lost.length} / ${a.size} 顆`); }
  }
  const z = nonEmpty(n, "不是出牌、手上有牌、有兩個以上選項的決定"); if (z !== true) return z;
  const table = Object.entries(kinds).map(([k, v]) => `${k} ${v.lost}/${v.n}`).join("、");
  // as on main: (nearly) every such screen draws none of the decision's buttons
  if (none >= 0.9 * n) return `#100 上線之後是失敗：打開的牌還會蓋住決定（${none}/${n} 個畫面一顆決定按鈕都沒有：${table}）`;
  return ok(!hidden, hidden ? `${hidden}/${n} 個畫面少了按鈕（${table}）；例：${bad.join("；")}` : `${n} 個畫面都在（${table}）`);
});

test("sheet100", () => {
  const s = summary();
  for (const p of R.pass) console.log(`  ✓ ${p.label}${p.msg ? " — " + p.msg : ""}`);
  for (const t of s.todos) console.log(`  … ${t.label} — ${t.msg}`);
  for (const x of s.failures) console.log(`  ✗ ${x.label} — ${x.msg}`);
  console.log(`  通過 ${s.pass} / 失敗 ${s.fail} / 尚未實作 ${s.todo}`);
  assert.equal(s.fail, 0, s.failures.map((x) => `${x.label}: ${x.msg}`).join("\n"));
});
