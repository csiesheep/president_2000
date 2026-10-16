// v0.7 option 丙 (issue #58): on election day each issue a seat leads adds 10 to its canvassing luck, outside the 80 cap;
// and v0.7's starting luck as an option. Orchestrator's file: a peer may run it and falsify against it, and does not edit it.
//
//   node --test tests/v07issue.test.js      (or `npm test`)
//
// Owner, 2026-10-16: 「議題方塊投票日換成運氣，提出可行方案」; of the four proposals (vault: v0.7 草稿, 「議題方塊在投票日換成運氣」)
// 「丙，用 50/50/55 跑模擬」. 丙 as proposed: 「每領先一個議題（議題牌上自己的方塊最多，平手無人）+10%，在上限之外，催票運氣最多 95」.
// Contract (orchestrator, #58):
//   - E.createGame(seed, { rules: "v0.7", luck: [陳, 宋, 連], issueLuck: "lead" }): st.luck starts as given, st.issueLuck
//     === "lead". Without them a v0.7 game is the draft exactly (st.luck [50, 50, 60], no st.issueLuck): v0.4–v0.7 as on
//     main, game for game.
//   - with issueLuck "lead", the conversion's log entry also says how many issues each seat led at that moment (before the
//     cubes are cleared): { t: "convert", mom, leads: [n, n, n] }. A seat leads an issue when it has more cubes on that card
//     than each other seat (ties: nobody), so 0–3 each.
//   - each canvassing check then uses min(95, min(80, luck + 10 × momentum before the conversion) + 10 × leads); vs -1 and
//     p equal to it (the check log of #55).
// Every check reports 尚未實作 until createGame knows issueLuck.
import test from "node:test";
import assert from "node:assert/strict";
import { R, section, check, eq, ok, nonEmpty, summary } from "./harness.js";
import * as D from "./driver.js";
import * as E from "../public/shared/engine.js";

const C = { rules: "v0.7", luck: [50, 50, 55], issueLuck: "lead" };
const READY = (() => { try { return E.createGame(1, C).issueLuck === "lead"; } catch { return false; } })();
const c58 = (name, fn) => check(name, () => (READY ? fn() : 'TODO: createGame(seed, { rules: "v0.7", issueLuck: "lead" }) 的 st.issueLuck 不是 "lead"（#58）'));
const ledBy = (st) => [0, 1, 2].map((p) => st.issues.filter((i) => i.cubes[p] > 0 && i.cubes.every((c, q) => q === p || c < i.cubes[p])).length);
const want = (luck, mom, leads) => Math.min(95, Math.min(80, luck + 10 * mom) + 10 * leads);

// Random legal moves; each(before, move, after).
function fuzz(seeds, opts, each) {
  for (const seed of seeds) {
    const Rn = D.rng(seed); let st = E.createGame(seed, opts);
    for (let n = 0; n < 6000 && st.phase !== "end"; n++) {
      const seat = E.mustAct(st)[0], legal = E.legalMoves(st, seat), m = legal[Math.floor(Rn() * legal.length)];
      const next = E.apply(st, seat, m); each(st, m, next); st = next;
    }
    if (st.phase !== "end") throw new Error(`seed ${seed}：6000 步還沒結束（${st.phase}）`);
  }
}

section("58 v0.7 選項：開局運氣、丙");
c58("選項：luck 給開局運氣、issueLuck \"lead\" 記在 st；不給選項的 v0.7 就是草稿（50/50/60，沒有 issueLuck）", () => {
  const a = E.createGame(3, C), b = E.createGame(3, { rules: "v0.7" }), c = E.createGame(3, { rules: "v0.7", luck: [55, 50, 60] });
  return eq(`${a.luck} ${a.issueLuck} | ${b.luck} ${b.issueLuck} | ${c.luck} ${c.issueLuck}`, "50,50,55 lead | 50,50,60 undefined | 55,50,60 undefined", "三種開局");
});
c58("轉換時記下各家領先的議題數（議題牌上自己的方塊最多、平手無人），跟轉換前的局面一致（整局隨機走 12 局）", () => {
  let n = 0, some = 0, bad = null;
  fuzz(Array.from({ length: 12 }, (_, i) => 5801 + i), C, (a, m, b) => {
    if (bad || a.phase === "election" || b.phase !== "election") return;
    const e = b.log.slice(a.log.length).find((x) => x.t === "convert");
    if (!e || !Array.isArray(e.leads)) { bad = `第 ${a.turn} 回合進入投票日，轉換的紀錄沒有 leads：${JSON.stringify(e)}`; return; }
    const w = ledBy(a);
    if (e.leads.join() !== w.join()) bad = `議題 ${a.issues.map((i) => `${i.name} ${i.cubes.join("/")}`).join("、")}：紀錄 leads ${e.leads.join("/")}，應為 ${w.join("/")}`;
    n++; if (w.some((x) => x > 0)) some++;
  });
  if (bad) return bad;
  let r = nonEmpty(n, "轉換"); if (r !== true) return r;
  r = nonEmpty(some, "有人領先議題的轉換"); if (r !== true) return r;
  return ok(true, `${n} 次轉換的 leads 都對（${some} 次有人領先）`);
});
// Set up by hand: a quiet 丙 game is taken to the move that starts election day; on a copy of the state before it, luck,
// momentum and the three issue cards are set, then that move is made and election day is played quietly. Two set-ups:
//   1. luck 60/50/55, momentum 3/4/0, issues led 1/0/2 → 90 (the inner cap: 60 + 30 is 90, held to 80, + 10), 80 (50 + 40
//      held to 80, no lead), 75 (55 + 20).
//   2. luck 70/50/55, momentum 1/0/0, issues led 2/0/1 → 95 (80 + 20 is 100, held to 95), 50, 65.
function electionWith(luck, mom, cubes) {
  let st = E.createGame(7, C);
  for (let n = 0; n < 20000; n++) {
    const s = E.mustAct(st)[0], ms = E.legalMoves(st, s), m = D.quiet(st, s, ms), next = E.apply(st, s, m);
    if (next.phase === "election") {
      const a = JSON.parse(JSON.stringify(st));
      a.luck = luck.slice(); a.mom = mom.slice();
      for (const i of a.issues) i.cubes = cubes[i.name].slice();
      let b = E.apply(a, s, m); const used = [[], [], []];
      for (let k = 0; k < 4000 && b.phase !== "end"; k++) {
        const q = E.mustAct(b)[0], L0 = b.log.length; b = E.apply(b, q, D.quiet(b, q, E.legalMoves(b, q)));
        for (const e of b.log.slice(L0)) if (e.t === "check") used[e.seat].push(`${e.luck}/${e.vs}/${e.p}`);
      }
      return { leads: (b.log.find((e) => e.t === "convert") || {}).leads, used };
    }
    st = next;
  }
  throw new Error("20000 步內沒走到投票日");
}
c58("催票運氣 = min(95, min(80, 運氣 + 10 × 轉換前動能) + 10 × 領先的議題數)；兩個人為的局面，內層 80 與外層 95 都碰到", () => {
  const cases = [
    { luck: [60, 50, 55], mom: [3, 4, 0], cubes: { cross: [3, 1, 0], clean: [0, 1, 2], econ: [1, 0, 2] }, leads: "1,0,2", luckUsed: [90, 80, 75] },
    { luck: [70, 50, 55], mom: [1, 0, 0], cubes: { cross: [2, 0, 1], clean: [2, 1, 0], econ: [0, 0, 1] }, leads: "2,0,1", luckUsed: [95, 50, 65] },
  ];
  const seen = [];
  for (const [i, c] of cases.entries()) {
    const out = electionWith(c.luck, c.mom, c.cubes);
    let r = eq(String(out.leads), c.leads, `局面 ${i + 1} 的 leads`); if (r !== true) return r;
    for (let p = 0; p < 3; p++) {
      const w = c.luckUsed[p], got = out.used[p];
      r = nonEmpty(got.length, `局面 ${i + 1} seat ${p} 的催票檢定`); if (r !== true) return r;
      if (w !== want(c.luck[p], c.mom[p], +c.leads.split(",")[p])) return `局面 ${i + 1}：測試自己的期望值算錯（seat ${p}）`;
      const off = got.find((g) => g !== `${w}/-1/${w}`);
      if (off) return `局面 ${i + 1} seat ${p}（運氣 ${c.luck[p]}、動能 ${c.mom[p]}、領先 ${c.leads.split(",")[p]}）：檢定寫 運氣/vs/p = ${off}，應為 ${w}/-1/${w}`;
      seen.push(`${w}×${got.length}`);
    }
  }
  return ok(true, `催票檢定的運氣：${seen.join("、")}`);
});
c58("整局隨機走 12 局：每次催票檢定都照上式（用該局轉換紀錄的 leads 與動能）", () => {
  let n = 0, led = 0, bad = null;
  fuzz(Array.from({ length: 12 }, (_, i) => 5821 + i), C, (a, m, b) => {
    if (bad || b.phase !== "election" || !b.election || !b.election.mom) return;
    const conv = b.log.find((e) => e.t === "convert"); if (!conv || !conv.leads) { bad = "投票日沒有轉換紀錄的 leads"; return; }
    for (const e of b.log.slice(a.log.length)) if (e.t === "check") {
      const w = want(b.luck[e.seat], b.election.mom[e.seat], conv.leads[e.seat]);
      if (e.luck !== w || e.vs !== -1 || e.p !== w) { bad = `seat ${e.seat}：運氣 ${b.luck[e.seat]}、動能 ${b.election.mom[e.seat]}、領先 ${conv.leads[e.seat]}，檢定寫 ${e.luck}/${e.vs}/${e.p}（應為 ${w}/-1/${w}）`; return; }
      n++; if (conv.leads[e.seat] > 0) led++;
    }
  });
  if (bad) return bad;
  let r = nonEmpty(n, "催票檢定"); if (r !== true) return r;
  r = nonEmpty(led, "有領先議題的人做的催票檢定"); if (r !== true) return r;
  return ok(true, `${n} 次催票檢定（${led} 次有領先加成）都對`);
});
check("不給選項的 v0.7 照舊：轉換紀錄沒有 leads、催票不加議題（整局隨機走 4 局）", () => {
  let n = 0, bad = null;
  try {
    fuzz([5841, 5842, 5843, 5844], { rules: "v0.7" }, (a, m, b) => {
      if (bad || b.phase !== "election" || !b.election || !b.election.mom) return;
      const conv = b.log.find((e) => e.t === "convert"); if (conv && conv.leads !== undefined) { bad = `草稿的轉換紀錄出現 leads：${JSON.stringify(conv)}`; return; }
      for (const e of b.log.slice(a.log.length)) if (e.t === "check") {
        const w = Math.min(80, b.luck[e.seat] + 10 * b.election.mom[e.seat]);
        if (e.luck !== w) { bad = `seat ${e.seat}：草稿的催票用了 ${e.luck}（應為 ${w}）`; return; }
        n++;
      }
    });
  } catch (err) { return `草稿的 v0.7 走不完：${err.message}`; }
  if (bad) return bad;
  const r = nonEmpty(n, "草稿的催票檢定"); if (r !== true) return r;
  return ok(true, `${n} 次催票檢定都是 min(80, 運氣 + 10 × 動能)`);
});

test("v07issue", () => {
  const s = summary();
  for (const p of R.pass) console.log(`  ✓ ${p.label}${p.msg ? " — " + p.msg : ""}`);
  for (const t of s.todos) console.log(`  … ${t.label} — ${t.msg}`);
  for (const x of s.failures) console.log(`  ✗ ${x.label} — ${x.msg}`);
  console.log(`  通過 ${s.pass} / 失敗 ${s.fail} / 尚未實作 ${s.todo}`);
  assert.equal(s.fail, 0, s.failures.map((x) => `${x.label}: ${x.msg}`).join("\n"));
});
