// Rulebook v0.6 draft: simplified (issue #54). Orchestrator's file: a peer may run it and falsify against it, and does
// not edit it.
//
//   node --test tests/v06.test.js      (or `npm test`)
//
// Owner, 2026-10-15, on the v0.5 simplification analysis: 「1,2,3,4,6」「5 改成每一輪換一次呢？」「7 每一輪開始決定，由少到多呢？
// 上方候選人，也照票數排」, then on 5: 「隨機排序」. The rules below were copied BY HAND from the vault draft `Projects/president_2000/president_2000 -
// v0.6 草稿（簡化）.md`. v0.6 is a third rule set on top of v0.5; v0.4 and v0.5 stay exactly as they are.
//
// Contract (orchestrator, #54):
//   - E.createGame(seed, { rules: "v0.6", fill: "candidate" | "free" }) starts a v0.6 game: st.rules === "v0.6",
//     st.fill === the option ("candidate" when not given). Everything of v0.5 holds unless changed here.
//   - 1 no block: no play move offers block: true.
//   - 2 the issue slots reward slot 1: 1 momentum + 1 endorsement, slot 2: 1 endorsement (no choice), slot 3: 1 momentum,
//     settled in slot order; no "reward" decision.
//   - 3 no first strategic vote after the debate: the only { t: "strategic" } is election day's (half: false).
//   - 4 no 地方大老: a same-camp fill checks only when an opponent's candidate stands there (fill "candidate"), or never
//     (fill "free"); a cross-camp fill and a steal still always check.
//   - 5 the issue cards are put in a random slot order at the end of every momentum phase, after the decay (the engine's
//     RNG: the same seed, the same order), cubes with them; the issue leader still gains +1 momentum and nobody swaps.
//   - 6 momentum halves rounded down for everyone (陳 too).
//   - 7 no initiative check: at the start of every turn (the debate and election day too) st.order is the seats by votes
//     on the board, fewest first; a tie: less momentum first, then 陳→宋→連. No "order" decision, no { t: "initiative" }.
// Every v0.6 check reports 尚未實作 until the engine knows v0.6.
import test from "node:test";
import assert from "node:assert/strict";
import { R, section, check, eq, ok, nonEmpty, summary } from "./harness.js";
import * as D from "./driver.js";
import * as E from "../public/shared/engine.js";

const { CHEN, SOONG, LIEN, ci } = D;
const V6 = (fill) => (fill ? { rules: "v0.6", fill } : { rules: "v0.6" });
const READY = (() => { try { return E.createGame(1, V6()).rules === "v0.6"; } catch { return false; } })();
const c6 = (name, fn) => check(name, () => (READY ? fn() : 'TODO: 引擎還沒有 v0.6（createGame(seed, { rules: "v0.6" }) 的 st.rules 不是 "v0.6"，#54）'));
const votes = (st) => [0, 1, 2].map((p) => st.counties.reduce((s, c) => s + c.blocks.filter((b) => b.o === p).length, 0));
const names = (st) => st.issues.map((i) => i.name).join(",");
const sameSet = (a, b) => a.split(",").sort().join() === b.split(",").sort().join();
const cubesBy = (st) => Object.fromEntries(st.issues.map((i) => [i.name, i.cubes.join("/")]));
const wantOrder = (v, mom) => [0, 1, 2].sort((a, b) => v[a] - v[b] || mom[a] - mom[b] || a - b);

// Whole games with random legal moves, every step watched by `each(before, move, after, legal)`.
function fuzz(seeds, opts, each) {
  for (const seed of seeds) {
    const Rn = D.rng(seed); let st = E.createGame(seed, opts);
    for (let n = 0; n < 6000 && st.phase !== "end"; n++) {
      const seat = E.mustAct(st)[0]; if (seat == null) throw new Error(`seed ${seed}：卡在 ${st.phase}`);
      const legal = E.legalMoves(st, seat), m = legal[Math.floor(Rn() * legal.length)];
      const next = E.apply(st, seat, m); each(st, m, next, legal); st = next;
    }
    if (st.phase !== "end") throw new Error(`seed ${seed}：6000 步還沒結束（${st.phase}）`);
  }
}
// The twelfth play of turn 1 in a v0.6 game where that seat still holds its candidate card (as in acceptance.test.js).
function atLastPlay(opts = V6()) {
  for (let seed = 1; seed < 80; seed++) {
    let st = E.createGame(seed, opts);
    if (st.phase === "order") continue; // v0.6 has no order decision
    let plays = 0;
    for (let n = 0; n < 3000 && st.phase === "action"; n++) {
      const seat = E.mustAct(st)[0], ms = E.legalMoves(st, seat);
      if (D.isPlayDecision(ms) && plays === 11) { if (ms.some((m) => m.type === "candidate")) return { st, seat }; break; }
      const m = D.quiet(st, seat, ms);
      if (m.type === "play" || m.type === "candidate") plays++;
      st = E.apply(st, seat, m);
    }
  }
  throw new Error("80 個種子都找不到第 12 次出牌時還能出候選人牌的 v0.6 局");
}
const lastPlayQuiet = (st, seat) => D.act(D.act(D.act(st, seat, { type: "candidate" }), seat, { type: "action", kind: "campaign" }), seat, { type: "done" });
const endTurn = (cubes, mom, more) => {
  const { st, seat } = atLastPlay();
  st.mom = mom.slice(); st.issues.forEach((i, k) => { i.cubes = cubes[k].slice(); });
  st.endorse = Array(7).fill(-1); st.endorseDeck = [4]; st.endorseDiscard = [];
  if (more) more(st);
  return { before: names(st), s: lastPlayQuiet(st, seat) };
};

section("v0.6 開局");
c6("createGame(seed, { rules: \"v0.6\", fill }) 開 v0.6：st.rules、st.fill（不給是 candidate）；v0.5 的開局照舊（連經濟民生 2、沒有媒體）", () => {
  for (const [fill, want] of [[undefined, "candidate"], ["candidate", "candidate"], ["free", "free"]]) {
    const st = E.createGame(3, V6(fill));
    let r = eq(`${st.rules} ${st.fill}`, `v0.6 ${want}`, `fill ${fill}`); if (r !== true) return r;
    r = eq(`${st.media} ${st.issues.find((i) => i.name === "econ").cubes.join("/")}`, "undefined 0/0/2", "沒有媒體、連經濟民生 2"); if (r !== true) return r;
  }
  return ok(true, "rules v0.6；fill 預設 candidate、可選 free；沒有媒體、連經濟民生 2");
});

section("v0.6 · 1 封鎖、7 順序");
c6("整局隨機走（兩案各 3 局）：沒有封鎖、沒有選順序、沒有主動權檢定；每回合開始 st.order 照票數由少到多（平手看動能、再看座位）", () => {
  let turns = 0, plays = 0;
  for (const fill of ["candidate", "free"]) fuzz([5401, 5402, 5403], V6(fill), (a, m, b, legal) => {
    const blk = legal.find((x) => x.type === "play" && x.block); if (blk) throw new Error(`還能封鎖：${JSON.stringify(blk)}`);
    if (legal.some((x) => x.type === "order")) throw new Error(`第 ${a.turn} 回合還要選順序`);
    if (legal.some((x) => x.type === "play")) plays++;
    for (const e of b.log.slice(a.log.length)) {
      if (e.t === "initiative") throw new Error(`第 ${b.turn} 回合還有主動權檢定`);
      if (e.t === "turn") { const want = wantOrder(e.votes || votes(b), b.mom); if (b.order.join() !== want.join()) throw new Error(`${fill} 第 ${e.turn} 回合：order ${b.order.join()}，票 ${(e.votes || votes(b)).join("/")}、動能 ${b.mom.join("/")} 應為 ${want.join()}`); turns++; }
    }
  });
  let r = nonEmpty(turns, "回合開始"); if (r !== true) return r;
  r = nonEmpty(plays, "出牌的時刻"); if (r !== true) return r;
  return ok(true, `${turns} 個回合開始的順序都對；${plays} 次出牌都沒有封鎖`);
});
c6("第 1 回合：票 陳 23、宋 35、連 22 → 連、陳、宋；連先出牌", () => {
  const st = E.createGame(7, V6());
  let r = eq(votes(st).join("/"), "23/35/22", "開局的票"); if (r !== true) return r;
  r = eq(`${st.order.join()} ${st.phase} ${JSON.stringify(E.mustAct(st))}`, "2,0,1 action [2]", "順序與第一個出牌的人"); if (r !== true) return r;
  return ok(true, "連 22 → 陳 23 → 宋 35，連先");
});

section("v0.6 · 2 槽獎勵、5 隨機重排、6 減半");
c6("減半一律捨去（陳也是）：動能 3/3/5、議題全 0 → 1/1/2", () => {
  const Z = [0, 0, 0], { s } = endTurn([Z, Z, Z], [3, 3, 5]);
  return eq(`${s.phase} ${s.mom.join("/")}`, "save 1/1/2", "動能結算之後（v0.5 會是 2/1/2）") === true ? ok(true, "3→1、3→1、5→2") : eq(`${s.phase} ${s.mom.join("/")}`, "save 1/1/2", "動能結算之後（v0.5 會是 2/1/2）");
});
c6("第二槽固定給背書、不問；議題總領先者 +1、不交換；方塊跟著議題牌走", () => {
  const Z = [0, 0, 0];
  // 宋 leads slot 2 only (and so the totals): +1 momentum as the issue leader, the endorsement (region 4) for slot 2;
  // 宋's 2 cubes there lose 1 to the decay and stay on that issue card wherever the reorder puts it.
  const { before, s } = endTurn([Z, [0, 2, 0], Z], [0, 0, 0]);
  const slot2 = before.split(",")[1];
  let r = eq(s.phase, "save", "動能結算沒有任何決定，直接到留牌"); if (r !== true) return r;
  r = eq(`${s.mom.join("/")} ${s.endorse[4]}`, "0/1/0 1", "宋：議題總領先者 +1、第二槽抽背書（高屏）"); if (r !== true) return r;
  if (!sameSet(names(s), before)) return `議題牌不見了或多了：${before} → ${names(s)}`;
  r = eq(cubesBy(s)[slot2], "0/1/0", `原本第二槽的「${slot2}」上的方塊（衰減後 宋 1）跟著它`); if (r !== true) return r;
  if (s.log.some((e) => e.t === "momentum" && (e.step === "swap" || e.step === "reward"))) return "還有交換或第二槽的選擇";
  return ok(true, `${before} → ${names(s)}；宋 動能 1、背書 高屏；方塊跟著 ${slot2}`);
});
c6("整局隨機走：每一次動能結算之後議題槽重排（是隨機的：各種排法都出現，不是固定輪轉）；同一個種子同一個結果；沒有交換、沒有第二槽的選擇", () => {
  const perms = {}; let n = 0;
  const seen = (seed) => { const out = []; fuzz([seed], V6(), (a, m, b, legal) => {
    if (legal.some((x) => x.type === "swap" || x.type === "noswap" || x.type === "reward")) throw new Error(`第 ${a.turn} 回合還有交換或獎勵的選擇`);
    if (b.log.slice(a.log.length).some((e) => e.t === "momentum" && e.step === "done")) {
      if (!sameSet(names(a), names(b))) throw new Error(`第 ${a.turn} 回合：${names(a)} → ${names(b)}`);
      const pa = names(a).split(","), pb = names(b).split(","); const p = pb.map((x) => pa.indexOf(x)).join(""); perms[p] = (perms[p] || 0) + 1; out.push(names(b)); n++;
    } }); return out.join("|"); };
  const first = [5411, 5412, 5413, 5414].map(seen);
  let r = nonEmpty(n, "動能結算"); if (r !== true) return r;
  if (Object.keys(perms).length < 4) return `${n} 次動能結算只出現 ${Object.keys(perms).length} 種排法：${JSON.stringify(perms)}（隨機的話 6 種都會出現）`;
  if (seen(5411) !== first[0]) return "同一個種子再跑一次，議題槽的順序不一樣（沒有用引擎的亂數）";
  return ok(true, `${n} 次動能結算，${Object.keys(perms).length} 種排法 ${JSON.stringify(perms)}；同種子重跑相同`);
});

section("v0.6 · 3 棄保");
c6("棄保只在投票日算一次：整局只有一筆 strategic（half: false）", () => {
  let games = 0, bad = null;
  for (const seed of [5421, 5422]) {
    const counts = [];
    fuzz([seed], V6(), (a, m, b) => { for (const e of b.log.slice(a.log.length)) if (e.t === "strategic") counts.push(e.half); });
    if (counts.length !== 1 || counts[0] !== false) bad = `seed ${seed}：strategic ${JSON.stringify(counts)}`;
    games++;
  }
  return bad || ok(true, `${games} 局都只有投票日那一次`);
});

section("v0.6 · 4 地方大老");
// 連 (first to act on turn 1) plays the candidate card and fills an empty blue block in 台北市, where 宋 has 5 cubes (a
// 地方大老 in v0.5); then the same with 宋's candidate moved to 台北市.
function fillTaipei(opts, soongThere) {
  let st = E.createGame(7, opts);
  if (st.phase === "order") st = D.act(st, st.initiative, { type: "order", pos: st.initiative === LIEN ? 0 : 2 });
  if (E.mustAct(st)[0] !== LIEN) throw new Error(`第一個出牌的不是連：${JSON.stringify(E.mustAct(st))}`);
  if (soongThere) st.pos[SOONG] = ci("台北市");
  st.bag = [6, 6, 0]; // a check would fail: no 連 cube in the bag
  st = D.act(st, LIEN, { type: "candidate" }); st = D.act(st, LIEN, { type: "action", kind: "campaign" });
  const c0 = D.checks(st); st = D.act(st, LIEN, { type: "fill", county: ci("台北市") });
  return D.checks(st) - c0;
}
c6("同營填：fill candidate 只在對手候選人在場才檢定（宋 5 顆不算）；fill free 一律不檢定；v0.5 兩種都檢定", () => {
  const got = { a0: fillTaipei(V6("candidate"), false), a1: fillTaipei(V6("candidate"), true), b0: fillTaipei(V6("free"), false), b1: fillTaipei(V6("free"), true), v0: fillTaipei({ rules: "v0.5" }, false) };
  return eq(`${got.a0} ${got.a1} ${got.b0} ${got.b1} ${got.v0}`, "0 1 0 0 1", "檢定次數：candidate 無宋/有宋、free 無宋/有宋、v0.5 只有宋 5 顆") === true
    ? ok(true, "candidate：0 → 宋在場 1；free：0、0；v0.5：1")
    : eq(`${got.a0} ${got.a1} ${got.b0} ${got.b1} ${got.v0}`, "0 1 0 0 1", "檢定次數：candidate 無宋/有宋、free 無宋/有宋、v0.5 只有宋 5 顆");
});

section("v0.5 照舊");
check("v0.5 的局照舊：開局要選順序、有主動權檢定（v0.5 的其他規則由 tests/v05.test.js 管）", () => {
  const st = E.createGame(7, { rules: "v0.5" });
  if (st.phase !== "order") return `v0.5 開局的 phase 應為 order，實際 ${st.phase}`;
  if (!st.log.some((e) => e.t === "initiative")) return "v0.5 開局沒有主動權檢定";
  return ok(true, "v0.5 開局要選順序、有主動權檢定");
});

test("v06", () => {
  const s = summary();
  for (const p of R.pass) console.log(`  ✓ ${p.label}${p.msg ? " — " + p.msg : ""}`);
  for (const t of s.todos) console.log(`  … ${t.label} — ${t.msg}`);
  for (const x of s.failures) console.log(`  ✗ ${x.label} — ${x.msg}`);
  console.log(`  通過 ${s.pass} / 失敗 ${s.fail} / 尚未實作 ${s.todo}`);
  assert.equal(s.fail, 0, s.failures.map((x) => `${x.label}: ${x.msg}`).join("\n"));
});
