// The bots (M2). Orchestrator's file: a peer may run it and falsify against it, and does not edit it.
//
//   node --test tests/bots.test.js      (or `npm test`)
//
// Contract (issue #10): public/shared/bots.js exports
//   chooseMove(st, seat, level, rng) → { move, why }
//   WHY: an array of every why.key the bots can return (the writer translates them for table talk)
// move is one of legalMoves(st, seat) (deep-equal); why = { key, …params } with primitive params;
// level ∈ 1 樁腳 / 2 總幹事 / 3 操盤手; rng() → [0, 1) is the caller's, so games replay.
// Every check reports 尚未實作 until bots.js exports chooseMove. Balance (1000 games) is not
// checked here: `node tests/sim.js` (BE) prints it, and the orchestrator reruns it at the SHA.
import test from "node:test";
import assert from "node:assert/strict";
import { R, section, check, eq, ok, nonEmpty, summary } from "./harness.js";
import * as E from "../public/shared/engine.js";
import * as C from "../public/shared/cards.js";
import * as D from "./driver.js";

let BOTS = null;
try { BOTS = await import("../public/shared/bots.js"); } catch { BOTS = null; }
const READY = !!(BOTS && typeof BOTS.chooseMove === "function");
const cb = (name, fn) => check(name, () => (READY ? fn() : "TODO: public/shared/bots.js 還沒有 chooseMove（#10）"));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const CP = Object.fromEntries([...C.EVENTS, ...C.localCards()].map((c) => [c.id, c.cp]));
const NAMES = ["陳", "宋", "連"];
// Orchestrator's numbers for #10, not from the design docs: see the brief.
const LV3_GAME_MS = 1500;  // average time chooseMove spends in one all-操盤手 game, on the owner's machine
const LV3_SAVE_CP = 2.9;   // average CP of the cards 操盤手 sends to the debate (the early deck averages 2.55)

// One bot game: levels[seat] plays seat. Returns { st, moves, bad, ms, decisions, debateCP } where
// bad is the first problem, ms the time spent inside chooseMove, debateCP the CP of every card in
// the debate piles when turn 6 begins.
function botGame(seed, levels, { cap = 20000, record = false } = {}) {
  let st = E.createGame(seed);
  const rng = D.rng(seed * 977 + 13);
  const moves = [];
  const why = new Set(Array.isArray(BOTS.WHY) ? BOTS.WHY : []);
  let ms = 0, decisions = 0, debateCP = null;
  const fail = (bad) => ({ st, moves, bad, ms, decisions, debateCP });
  for (let n = 0; n < cap && st.phase !== "end"; n++) {
    if (st.turn === 6 && !debateCP) debateCP = st.savedDebate.flat().map((id) => CP[id]);
    const seats = E.mustAct(st);
    if (!seats.length) return fail(`seed ${seed} 第 ${st.turn} 回合 ${st.phase}：沒有人要動`);
    const seat = seats[0];
    const legal = E.legalMoves(st, seat);
    const where = `seed ${seed} 第 ${st.turn} 回合 ${st.phase} ${NAMES[seat]}（等級 ${levels[seat]}）`;
    const before = JSON.stringify(st);
    let out;
    const t0 = performance.now();
    try { out = BOTS.chooseMove(st, seat, levels[seat], rng); } catch (e) { return fail(`${where}：chooseMove 丟錯 ${e.message}`); }
    ms += performance.now() - t0; decisions++;
    if (JSON.stringify(st) !== before) return fail(`${where}：chooseMove 改了傳進來的 state`);
    if (!out || !legal.some((m) => same(m, out.move))) return fail(`${where}：不合法的動作 ${JSON.stringify(out && out.move)}`);
    if (!out.why || typeof out.why.key !== "string" || !why.has(out.why.key)) return fail(`${where}：why.key 不在 WHY 裡（${JSON.stringify(out.why)}）`);
    const params = Object.entries(out.why).filter(([k, v]) => v !== null && typeof v === "object");
    if (params.length) return fail(`${where}：why 的參數要是數字或字串（${params[0][0]}）`);
    if (record) moves.push([seat, out.move]);
    st = E.apply(st, seat, out.move);
  }
  if (st.phase !== "end") return fail(`seed ${seed}：${cap} 步還沒結束（第 ${st.turn} 回合 ${st.phase}）`);
  return { st, moves, bad: null, ms, decisions, debateCP };
}

section("10 bot");
const self = {};
cb("三個等級各自三人對打 3 局到結束：每一步都是合法動作、why.key 在 WHY 裡，不丟錯、不卡、不改傳進來的 state", () => {
  const r = nonEmpty(Array.isArray(BOTS.WHY) ? BOTS.WHY.length : 0, "bots.js 的 WHY"); if (r !== true) return r;
  const out = [];
  for (const lv of [1, 2, 3]) {
    self[lv] = [];
    for (let seed = 1; seed <= 3; seed++) {
      const g = botGame(seed + lv * 100, [lv, lv, lv]);
      if (g.bad) return g.bad;
      self[lv].push(g);
    }
    const ms = self[lv].reduce((a, g) => a + g.ms, 0) / 3, dec = self[lv].reduce((a, g) => a + g.decisions, 0) / 3;
    out.push(`等級 ${lv} 平均 ${Math.round(dec)} 個決定、${Math.round(ms)} ms`);
  }
  return ok(true, out.join("；"));
});
cb(`速度：操盤手三人對打，一局花在 chooseMove 的時間平均 ≤ ${LV3_GAME_MS} ms（1000 局的平衡要跑得完）`, () => {
  if (!self[3] || self[3].length !== 3) return "上一條沒跑完，沒有操盤手的對局可量";
  const ms = self[3].reduce((a, g) => a + g.ms, 0) / 3;
  return ms <= LV3_GAME_MS ? ok(true, `平均 ${Math.round(ms)} ms／局`) : `操盤手平均 ${Math.round(ms)} ms／局，超過 ${LV3_GAME_MS}`;
});
cb(`留牌：操盤手送進政見發表會的牌平均 ≥ ${LV3_SAVE_CP} CP（前期牌庫平均 2.55）`, () => {
  if (!self[3] || self[3].length !== 3) return "上一條沒跑完，沒有操盤手的對局可量";
  const cps = self[3].flatMap((g) => g.debateCP || []);
  const r = nonEmpty(cps.length, "第 6 回合開始時的政見發表會堆"); if (r !== true) return r;
  const avg = cps.reduce((a, b) => a + b, 0) / cps.length;
  const four = cps.filter((x) => x === 4).length;
  return avg >= LV3_SAVE_CP ? ok(true, `${cps.length} 張平均 ${avg.toFixed(2)} CP（4 CP ${four} 張）`) : `${cps.length} 張平均只有 ${avg.toFixed(2)} CP（4 CP ${four} 張）`;
});
cb("可重放：同一個種子、同一個 rng、同一組等級，bot 對打走到同一個結果", () => {
  const a = botGame(7, [3, 2, 1], { record: true }), b = botGame(7, [3, 2, 1], { record: true });
  if (a.bad || b.bad) return a.bad || b.bad;
  const r = eq(same(a.st, b.st) && same(a.moves, b.moves), true, "兩次的結束狀態與每一步"); if (r !== true) return r;
  return ok(true, `${a.moves.length} 步相同，當選人 ${NAMES[a.st.result.winner]}`);
});
cb("不偷看：別人的手牌與留牌、牌庫與棄牌堆、背書卡順序、引擎的亂數都換掉，三個等級在同一個 rng 下做一樣的決定", () => {
  let checked = 0;
  for (let seed = 1; seed <= 3; seed++) {
    let st = E.createGame(seed + 50);
    const R1 = D.rng(seed);
    for (let n = 0; n < 4000 && st.phase !== "end"; n++) {
      const seat = E.mustAct(st)[0];
      if (n % 23 === 0) {
        // Scramble everything view(st, seat) hides: other seats' hands, saved piles and face-down
        // debate picks, the deck and discard contents, the endorsement deck, the engine's RNG.
        const alt = E.clone(st);
        const others = [0, 1, 2].filter((p) => p !== seat);
        const piles = [alt.decks.early, alt.decks.late, alt.decks.discard, alt.decks.earlyDiscard,
          ...others.flatMap((p) => [alt.hands[p], alt.savedDebate[p], alt.savedElection[p]])];
        const pool = piles.flatMap((x) => x);
        const mix = D.rng(n + seed * 1000);
        for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(mix() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
        for (const pile of piles) pile.splice(0, pile.length, ...pool.splice(0, pile.length));
        if (alt.debate) for (const p of others) if (alt.debate.picks[p]) alt.debate.picks[p] = alt.savedDebate[p][0] || alt.debate.picks[p];
        alt.endorseDeck.reverse();
        alt.rng = (alt.rng ^ 0x5bd1e995) >>> 0; alt.seed = alt.seed + 1;
        for (const lv of [1, 2, 3]) {
          const a = BOTS.chooseMove(st, seat, lv, D.rng(n)), b = BOTS.chooseMove(alt, seat, lv, D.rng(n));
          if (!same(a.move, b.move)) return `seed ${seed + 50} 第 ${st.turn} 回合 ${st.phase} ${NAMES[seat]} 等級 ${lv}：看不到的東西換了，決定也變了（${JSON.stringify(a.move)} → ${JSON.stringify(b.move)}）`;
          checked++;
        }
      }
      st = E.apply(st, seat, BOTS.chooseMove(st, seat, 3, R1).move);
    }
  }
  const r = nonEmpty(checked, "比對過的決定"); if (r !== true) return r;
  return ok(true, `${checked} 個決定在看不到的東西換掉之後都一樣`);
});
cb("強弱：一個操盤手對兩個樁腳，操盤手輪流坐三個位子各 6 局，18 局至少贏 9 局", () => {
  let wins = 0;
  const per = [0, 0, 0];
  for (let seat = 0; seat < 3; seat++) {
    for (let k = 0; k < 6; k++) {
      const levels = [1, 1, 1]; levels[seat] = 3;
      const g = botGame(300 + seat * 10 + k, levels);
      if (g.bad) return g.bad;
      if (g.st.result.winner === seat) { wins++; per[seat]++; }
    }
  }
  const msg = `操盤手 ${wins}/18（坐陳 ${per[0]}/6、坐宋 ${per[1]}/6、坐連 ${per[2]}/6）`;
  return wins >= 9 ? ok(true, msg) : `${msg}，不到 9`;
});

test("bots", () => {
  const s = summary();
  for (const p of R.pass) console.log(`  ✓ ${p.label}${p.msg ? " — " + p.msg : ""}`);
  for (const t of s.todos) console.log(`  … ${t.label} — ${t.msg}`);
  for (const f of s.failures) console.log(`  ✗ ${f.label} — ${f.msg}`);
  console.log(`  通過 ${s.pass} / 失敗 ${s.fail} / 尚未實作 ${s.todo}`);
  assert.equal(s.fail, 0, s.failures.map((f) => `${f.label}: ${f.msg}`).join("\n"));
});
