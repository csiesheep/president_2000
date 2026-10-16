// Rulebook v0.7 draft: luck (運氣) instead of the bag and the rest cubes (issue #55). Orchestrator's file: a peer may run it
// and falsify against it, and does not edit it.
//
//   node --test tests/v07.test.js      (or `npm test`)
//
// Owner, 2026-10-16: 「移除休息方塊，提出5個點子給了決定機率，原本1960遊戲只有兩個候選人，機率是50%左右，現在變成三個候選人，機率
// 應該還是要50%左右，而不該是33%」, then 「有沒有更簡單的方式，直接是機率，預設50%，連戰預設60%」「所有加減機率方塊的都直接影響機率，
// 像是 +10% -10%」, and on the name 「用 運氣」. The numbers below were copied BY HAND from the vault draft
// `Projects/president_2000/president_2000 - v0.7 草稿（運氣）.md`. v0.7 is a fourth rule set on top of v0.6 (fill "candidate",
// the owner's 「v0.6 4a」); v0.4, v0.5 and v0.6 stay exactly as they are.
//
// Contract (orchestrator, #55):
//   - E.createGame(seed, { rules: "v0.7" }) starts a v0.7 game: st.rules === "v0.7", st.fill === "candidate", and
//     st.luck = [陳, 宋, 連] in percent, [50, 50, 60] at the start; no bag (st.bag undefined), no rest cubes (st.rest
//     undefined). Everything of v0.6 holds unless changed here.
//   - a support check succeeds with the checking seat's luck as the chance; its log entry says which luck it used:
//     { t: "check", seat, ok, luck }. A failure does nothing else.
//   - then the owner, the same day: 「如果沒有特定對手，成功率就是運氣值，有特定對手，就要考慮其的運氣，歸一化成成功率」. A check
//     against a particular opponent succeeds with chance 我 ÷ (我 + 對手) (orchestrator's reading of 歸一化: 50 vs 50 → 50 %,
//     60 vs 50 → 54.5 %); the log entry also says who (vs: the seat, or -1) and the chance used (p, percent; rounding to a
//     whole number allowed): { t: "check", seat, ok, luck, vs, p }. Who the particular opponent is (orchestrator, can be
//     overruled): a steal or a removal → the owner of that cube (m.target); a fill (same camp or cross) in a county where an
//     opponent's candidate stands → that candidate, the one with the higher luck if two stand there; anything else (other
//     fills, election-day canvassing) → none, p = luck. 省府舊部's luck 50 for 連 holds when 連 is the opponent too.
//   - luck stays within 20–80.
//   - the eight 「袋中 +N」 cards give their owner +10 luck instead (張榮發挺扁、張俊雄邱義仁 陳; 百萬連署、張昭雄的醫界、軍公教警 宋;
//     地方派系樁腳、黨員大會、經濟內閣 連), their other effects as before. 軍公教警 (「袋中 +1 宋方塊」) was missing from the
//     draft and from this file at first: found when the owner asked for the list, by reading every card text for 袋.
//   - 省府舊部: for the rest of that turn 連's checks use luck 50.
//   - 楊吉雄爆料 removes 4 of 宋's cubes from the board (連 picks), 說法反覆 2; nothing goes anywhere else.
//   - 連's candidate card: 4 CP.
//   - election day: each canvass check uses luck + 10 × the momentum the seat had before the conversion, at most 80.
// Every v0.7 check reports 尚未實作 until the engine knows v0.7.
import test from "node:test";
import assert from "node:assert/strict";
import { R, section, check, eq, ok, nonEmpty, summary } from "./harness.js";
import * as D from "./driver.js";
import * as E from "../public/shared/engine.js";

const { CHEN, SOONG, LIEN, ci } = D;
const V7 = { rules: "v0.7" };
const READY = (() => { try { return E.createGame(1, V7).rules === "v0.7"; } catch { return false; } })();
const c7 = (name, fn) => check(name, () => (READY ? fn() : 'TODO: 引擎還沒有 v0.7（createGame(seed, { rules: "v0.7" }) 的 st.rules 不是 "v0.7"，#55）'));
const LUCK0 = [50, 50, 60];
const PLUS10 = { chang_yung_fa: CHEN, chang_chiu: CHEN, million_signatures: SOONG, chang_doctors: SOONG, military_civil: SOONG, local_factions: LIEN, party_congress: LIEN, econ_cabinet: LIEN };
const owned = (st, p) => st.counties.reduce((s, c) => s + c.blocks.filter((b) => b.o === p).length, 0);

// Whole games with random legal moves; each(before, move, after).
function fuzz(seeds, each) {
  for (const seed of seeds) {
    const Rn = D.rng(seed); let st = E.createGame(seed, V7);
    for (let n = 0; n < 6000 && st.phase !== "end"; n++) {
      const seat = E.mustAct(st)[0]; if (seat == null) throw new Error(`seed ${seed}：卡在 ${st.phase}`);
      const legal = E.legalMoves(st, seat), m = legal[Math.floor(Rn() * legal.length)];
      const next = E.apply(st, seat, m); each(st, m, next); st = next;
    }
    if (st.phase !== "end") throw new Error(`seed ${seed}：6000 步還沒結束（${st.phase}）`);
  }
}
// The seat to act first in turn 1 of a v0.7 game is 連 (fewest votes); a play decision of `seat` in turn 1, others
// playing quietly before it.
function playDecision(seat, seed = 7) {
  let st = E.createGame(seed, V7);
  for (let n = 0; n < 200; n++) {
    const s = E.mustAct(st)[0], ms = E.legalMoves(st, s);
    if (s === seat && D.isPlayDecision(ms)) return st;
    st = E.apply(st, s, D.quiet(st, s, ms));
  }
  throw new Error(`200 步內沒輪到 seat ${seat} 出牌`);
}
// A must-trigger card (楊吉雄爆料, cards.js must: true) played as an event first takes its CP action and resolves when
// that action ends (#5 ruling 1): the pending stops at stage "kind" with no fx yet. The BE found this (#55, comment
// 6218427496): the loop only walked an fx, so the 爆料 row counted 0 removals on every engine, v0.6 too. The CP action is
// ended at once here (a campaign with nothing done) so that it moves no cube of its own; then the fx is walked.
const playEvent = (st, seat, id) => { D.giveCard(st, seat, id); let s = D.act(st, seat, { type: "play", card: id, mode: "event" });
  for (let n = 0; n < 60 && s.pending && E.mustAct(s).length; n++) {
    const q = E.mustAct(s)[0], ms = E.legalMoves(s, q);
    if (s.pending.fx) { s = E.apply(s, q, ms[0]); continue; }
    if (q !== seat) break;
    const m = ms.find((x) => x.type === "done") || ms.find((x) => x.type === "action" && x.kind === "campaign");
    if (!m) break; s = E.apply(s, q, m);
  }
  return s; };

section("v0.7 開局");
c7("createGame(seed, { rules: \"v0.7\" })：st.rules v0.7、st.fill candidate、運氣 50/50/60、沒有袋子、沒有休息方塊；連的候選人牌 4 CP", () => {
  const st = E.createGame(3, V7);
  let r = eq(`${st.rules} ${st.fill} ${JSON.stringify(st.luck)} ${st.bag} ${st.rest}`, `v0.7 candidate ${JSON.stringify(LUCK0)} undefined undefined`, "開局"); if (r !== true) return r;
  const s = playDecision(LIEN); const c = E.legalMoves(s, LIEN).find((m) => m.type === "candidate");
  if (!c) return "連第一次出牌時沒有候選人牌可以出";
  const k = D.act(s, LIEN, { type: "candidate" });
  r = eq(k.pending && k.pending.cp, 4, "連的候選人牌的 CP"); if (r !== true) return r;
  return ok(true, "v0.7、candidate、50/50/60、沒有袋子與休息方塊；連候選人牌 4 CP");
});

section("v0.7 檢定");
// Grouped by the chance used, in tens (p 54.5 → 50, 58 → 60): the BE found that 8 games give about 680 checks and that no
// whole-number p reached 300 (#55, comments 6218427496, 6218907846), so the row could never pass. Now 24 games, groups of
// at least 150 checks, each within 3 standard errors (+1 point) of the mean chance in it; and at least one such group at
// p ≥ 58 or ≤ 42, where a flat 50 % engine is told apart (the BE's falsification: 50.4 % against 61.2 %).
c7("檢定照成功率：整局隨機走 24 局，每筆檢定寫出運氣、對手、成功率；依成功率每 10 個百分點一組（≥ 150 筆的組），成功的比例在平均成功率的 3 個標準誤（+1）以內，而且有一組離 50 夠遠（≥ 58 或 ≤ 42）；運氣始終在 20–80", () => {
  const by = {}; let n = 0, missing = 0;
  fuzz(Array.from({ length: 24 }, (_, i) => 5501 + i), (a, m, b) => {
    if (b.luck.some((x) => x < 20 || x > 80)) throw new Error(`第 ${b.turn} 回合運氣 ${b.luck.join("/")} 超出 20–80`);
    if (b.bag !== undefined) throw new Error("v0.7 出現了袋子");
    for (const e of b.log.slice(a.log.length)) if (e.t === "check") {
      if (typeof e.luck !== "number" || typeof e.vs !== "number" || typeof e.p !== "number") { missing++; continue; }
      const g = (by[10 * Math.round(e.p / 10)] ??= { y: 0, n: 0, p: 0 }); g.n++; g.p += e.p; if (e.ok) g.y++; n++;
    }
  });
  if (missing) return `${missing} 筆檢定的紀錄沒寫 luck、vs、p`;
  let r = nonEmpty(n, "檢定"); if (r !== true) return r;
  const rows = Object.entries(by).map(([k, g]) => { const mp = g.p / g.n, rate = (100 * g.y) / g.n, se = 100 * Math.sqrt((mp / 100) * (1 - mp / 100) / g.n); return { k: +k, n: g.n, mp, rate, tol: 3 * se + 1 }; });
  const big = rows.filter((x) => x.n >= 150);
  r = nonEmpty(big.filter((x) => x.mp >= 58 || x.mp <= 42).length, "離 50 夠遠（≥ 58 或 ≤ 42）、150 筆以上的成功率組"); if (r !== true) return r;
  const off = big.find((x) => Math.abs(x.rate - x.mp) > x.tol);
  if (off) return `成功率 ${off.k} 那組：${off.n} 筆，平均成功率 ${off.mp.toFixed(1)}%，實際成功 ${off.rate.toFixed(1)}%（差 ${Math.abs(off.rate - off.mp).toFixed(1)}，容許 ${off.tol.toFixed(1)}）`;
  return ok(true, `${n} 筆檢定；${big.map((x) => `${x.k} 組 ${x.n} 筆：平均 ${x.mp.toFixed(1)}%、實際 ${x.rate.toFixed(1)}%`).join("、")}`);
});
// Who the particular opponent is, worked out here from the state before the move (the contract above), and the chance
// that follows: luck when there is none, 100 × luck ÷ (luck + theirs) when there is.
const effLuck = (st, p) => (p === LIEN && st.active.includes("provincial_staff") ? 50 : st.luck[p]);
c7("有特定對手的檢定看兩人的運氣（我 ÷（我 + 對手））：搶、移除看方塊的主人；填塊時縣市裡站著對手候選人就看他（兩人都在看運氣高的）；其他填塊與投票日催票沒有對手，成功率就是運氣", () => {
  const n = { vs: 0, none: 0, election: 0 }; let bad = null;
  fuzz([5521, 5522, 5523, 5524, 5525, 5526], (a, m, b) => {
    if (bad) return;
    for (const e of b.log.slice(a.log.length)) if (e.t === "check") {
      let want = null;
      if (a.phase === "election") want = [-1];
      else if (m.type === "steal" || m.type === "remove") want = [m.target];
      else if (m.type === "fill" || m.type === "cross") {
        const there = [0, 1, 2].filter((q) => q !== e.seat && a.pos[q] === m.county);
        const top = Math.max(...there.map((q) => effLuck(a, q)));
        want = there.length ? there.filter((q) => effLuck(a, q) === top) : [-1];
      }
      if (!want) continue; // a check inside some other move: not classified here
      if (!want.includes(e.vs)) { bad = `第 ${a.turn} 回合 ${JSON.stringify(m)}：檢定的對手是 ${e.vs}（應為 ${want.join(" 或 ")}）`; return; }
      const p = e.vs < 0 ? e.luck : (100 * e.luck) / (e.luck + effLuck(a, e.vs));
      if (Math.abs(e.p - p) > 0.5) { bad = `第 ${a.turn} 回合 ${JSON.stringify(m)}：運氣 ${e.luck}、對手 ${e.vs}${e.vs < 0 ? "" : `（運氣 ${effLuck(a, e.vs)}）`}，成功率寫 ${e.p}（應為 ${p.toFixed(1)}）`; return; }
      if (a.phase === "election") n.election++; else if (e.vs < 0) n.none++; else n.vs++;
    }
  });
  if (bad) return bad;
  for (const [k, what] of [["vs", "有特定對手的檢定"], ["none", "行動階段沒有對手的檢定"], ["election", "投票日的檢定"]]) { const r = nonEmpty(n[k], what); if (r !== true) return r; }
  return ok(true, `有對手 ${n.vs} 筆、行動階段沒有對手 ${n.none} 筆、投票日 ${n.election} 筆，對手與成功率都對`);
});

section("v0.7 牌");
c7("八張原本「袋中 +N」的牌：打出後牌主運氣 +10（其他效果照舊）；連在 80 時打出黨員大會仍是 80", () => {
  const bad = [];
  for (const [id, owner] of Object.entries(PLUS10)) {
    const st = playDecision(owner); const before = st.luck.slice();
    const s = playEvent(st, owner, id);
    const want = before.slice(); want[owner] = Math.min(80, want[owner] + 10);
    if (s.luck.join() !== want.join()) bad.push(`${id}：運氣 ${before.join("/")} → ${s.luck.join("/")}（應為 ${want.join("/")}）`);
  }
  const st = playDecision(LIEN); st.luck = [50, 50, 80];
  const s = playEvent(st, LIEN, "party_congress");
  if (s.luck[LIEN] !== 80) bad.push(`連 80 打出黨員大會變成 ${s.luck[LIEN]}（上限 80）`);
  return bad.length ? bad.join("；") : ok(true, `${Object.keys(PLUS10).length} 張都 +10；上限 80 守住`);
});
c7("楊吉雄爆料：宋盤上少 4 顆（其他照舊）；不再有袋子", () => {
  const st = playDecision(LIEN); const b = owned(st, SOONG);
  const s = playEvent(st, LIEN, "yang_exposes");
  const r = eq(`${b - owned(s, SOONG)} ${s.bag}`, "4 undefined", "宋盤上少的方塊、袋子");
  return r === true ? ok(true, `宋 ${b} → ${owned(s, SOONG)}`) : r;
});
c7("省府舊部：這一回合連的檢定用運氣 50；下一回合回到 60", () => {
  // turn 1 order is 連, 陳, 宋; 宋 plays 省府舊部 third, then 連 steals in a later action phase of the same turn.
  let st = playDecision(SOONG);
  st = playEvent(st, SOONG, "provincial_staff");
  const used = [];
  for (let n = 0; n < 400 && st.turn === 1; n++) {
    const s = E.mustAct(st)[0]; if (s == null) break; const ms = E.legalMoves(st, s);
    let m = D.quiet(st, s, ms);
    if (s === LIEN) { const steal = ms.find((x) => x.type === "remove" || x.type === "steal"); const cand = ms.find((x) => x.type === "candidate"); const camp = ms.find((x) => x.type === "action" && x.kind === "campaign"); m = steal || cand || camp || m; }
    const L0 = st.log.length; st = E.apply(st, s, m);
    for (const e of st.log.slice(L0)) if (e.t === "check" && e.seat === LIEN && st.turn === 1) used.push(e.luck);
  }
  let r = nonEmpty(used.length, "連在第 1 回合的檢定"); if (r !== true) return r;
  if (used.some((l) => l !== 50)) return `連第 1 回合的檢定用了運氣 ${used.join("/")}（應全是 50）`;
  r = eq(st.luck[LIEN], 60, "下一回合連的運氣"); if (r !== true) return r;
  return ok(true, `連第 1 回合 ${used.length} 次檢定都用 50；之後回到 60`);
});

section("v0.7 投票日");
c7("投票日催票：每次檢定用 運氣 + 10 × 轉換前的動能，最多 80", () => {
  let n = 0, bad = null;
  fuzz([5511, 5512, 5513], (a, m, b) => {
    if (!b.election || !b.election.mom) return;
    for (const e of b.log.slice(a.log.length)) if (e.t === "check" && b.phase === "election") {
      const want = Math.min(80, b.luck[e.seat] + 10 * b.election.mom[e.seat]);
      if (e.luck !== want && !bad) bad = `seat ${e.seat}：運氣 ${b.luck[e.seat]}、轉換前動能 ${b.election.mom[e.seat]}，催票檢定用了 ${e.luck}（應為 ${want}）`;
      if ((e.vs !== -1 || e.p !== e.luck) && !bad) bad = `seat ${e.seat}：催票沒有特定對手，紀錄卻是 vs ${e.vs}、p ${e.p}（應為 -1、${e.luck}）`;
      n++;
    }
  });
  if (bad) return bad;
  const r = nonEmpty(n, "投票日的檢定"); if (r !== true) return r;
  return ok(true, `${n} 次催票檢定的運氣都對`);
});

section("v0.6 照舊");
check("v0.6 的局照舊：有袋子、沒有運氣", () => {
  const st = E.createGame(7, { rules: "v0.6" });
  if (!Array.isArray(st.bag) || st.luck !== undefined) return `v0.6 開局：bag ${JSON.stringify(st.bag)}、luck ${JSON.stringify(st.luck)}`;
  return ok(true, "v0.6 開局有袋子、沒有運氣（v0.6 的其他規則由 tests/v06.test.js 管）");
});

test("v07", () => {
  const s = summary();
  for (const p of R.pass) console.log(`  ✓ ${p.label}${p.msg ? " — " + p.msg : ""}`);
  for (const t of s.todos) console.log(`  … ${t.label} — ${t.msg}`);
  for (const x of s.failures) console.log(`  ✗ ${x.label} — ${x.msg}`);
  console.log(`  通過 ${s.pass} / 失敗 ${s.fail} / 尚未實作 ${s.todo}`);
  assert.equal(s.fail, 0, s.failures.map((x) => `${x.label}: ${x.msg}`).join("\n"));
});
