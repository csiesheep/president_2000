// tools/balance55.mjs — v0.6 (4a, the owner's pick) next to the v0.7 draft (luck instead of the bag), bot against bot (#55).
// Orchestrator's instrument: a peer may run it, does not edit it. Plays the games itself (the engine and the bots,
// with tests/sim.js's move RNG).
//
//   node tools/balance55.mjs [games=600]
//
// All three seats 操盤手 (level 3), seeds 1…N, v0.6 fill "candidate" and v0.7. Rows:
//   - #55's acceptance (they set the exit code):
//       · v0.6 is untouched: its numbers equal what this tool measured on main before #55;
//       · every v0.7 game ends and is a v0.7 game; no bag, no rest cubes, luck within 20–80 all game long;
//       · every v0.7 check carries the chance it used (p: the luck, or against a particular opponent 我 ÷ (我 + 對手)),
//         and checks succeed as often as that chance says (overall, within 3 points).
//   - the owner's reading (printed, never counted): the bands (every candidate wins 25–42 %, the average margin ≤ 6,
//     turnout 80–92 %) and how often each candidate's checks succeed — the owner asked for about 50 %, not 33 %.
// Then the two side by side.
import * as E from "../public/shared/engine.js";
import * as B from "../public/shared/bots.js";

const N = Number.parseInt(process.argv[2] || "600", 10);
const NAMES = ["陳", "宋", "連"], BLOCKS = 154;
// v0.6 (fill candidate) measured by this tool on main before #55 (600 games).
const V06_MAIN = "win 34.5/34.3/31.2, margin 3.19, turnout 86.4%, votes 44.8/44.3/44.0, choices 432.0, checks 165.4";
const simRng = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

function run(opts) {
  const t = { ended: 0, rules: 0, bad: [], wins: [0, 0, 0], votes: [0, 0, 0], margin: 0, onBoard: 0, choices: 0, checks: 0,
    tried: [0, 0, 0], won: [0, 0, 0], expect: 0, noLuck: 0, luckEnd: [0, 0, 0], errors: [] };
  for (let seed = 1; seed <= N; seed++) {
    try {
      let st = E.createGame(seed, opts); const R = simRng(seed * 977 + 13);
      if (st.rules === opts.rules) t.rules++;
      for (let n = 0; n < 20000 && st.phase !== "end"; n++) {
        const seat = E.mustAct(st)[0];
        if (seat == null) throw new Error(`seed ${seed}: nobody to act in ${st.phase}`);
        if (E.legalMoves(st, seat).length > 1) t.choices++;
        const m = B.chooseMove(st, seat, 3, R).move;
        const L0 = st.log.length;
        st = E.apply(st, seat, m);
        for (const e of st.log.slice(L0)) if (e.t === "check") {
          t.checks++; t.tried[e.seat]++; if (e.ok) t.won[e.seat]++;
          if (opts.rules === "v0.7") { if (typeof e.p === "number") t.expect += e.p / 100; else t.noLuck++; } // p: the chance used (the luck, or 我 ÷ (我 + 對手))
        }
        if (opts.rules === "v0.7" && t.bad.length < 3) {
          if (st.bag !== undefined || st.rest !== undefined) t.bad.push(`seed ${seed}: bag or rest cubes`);
          else if (!Array.isArray(st.luck) || st.luck.some((x) => x < 20 || x > 80)) t.bad.push(`seed ${seed} turn ${st.turn}: luck ${JSON.stringify(st.luck)}`);
        }
      }
      if (st.phase !== "end") throw new Error(`seed ${seed}: did not end`);
      t.ended++;
      if (Array.isArray(st.luck)) for (let p = 0; p < 3; p++) t.luckEnd[p] += st.luck[p];
      const v = st.result.votes, s = v.slice().sort((a, b) => b - a);
      t.wins[st.result.winner]++; for (let p = 0; p < 3; p++) t.votes[p] += v[p];
      t.margin += s[0] - s[1]; t.onBoard += v[0] + v[1] + v[2];
    } catch (e) { if (t.errors.length < 3) t.errors.push(e.message.split("\n")[0]); }
  }
  const n = t.ended || 1, f1 = (x) => x.toFixed(1);
  return { ...t, n, winN: t.wins.map((w) => 100 * w / n), win: t.wins.map((w) => f1(100 * w / n)).join("/"), margin: (t.margin / n).toFixed(2),
    turnout: f1(100 * t.onBoard / n / BLOCKS), votes: t.votes.map((x) => f1(x / n)).join("/"), choicesPer: (t.choices / n).toFixed(1), checksPer: (t.checks / n).toFixed(1),
    rate: t.tried.map((x, p) => (x ? (100 * t.won[p]) / x : 0)), total: t.won.reduce((a, b) => a + b, 0), luckAvg: t.luckEnd.map((x) => (x / n).toFixed(0)).join("/") };
}

const t0 = Date.now();
const a = run({ rules: "v0.6", fill: "candidate" }), b = run({ rules: "v0.7" });
const secs = Math.round((Date.now() - t0) / 1000);
const rows = [], band = [];
const rule = (ok, what) => rows.push({ ok, what });
const a6 = `win ${a.win}, margin ${a.margin}, turnout ${a.turnout}%, votes ${a.votes}, choices ${a.choicesPer}, checks ${a.checksPer}`;
rule(N !== 600 || (a.ended === N && a6 === V06_MAIN), N === 600 ? `v0.6 untouched: ${a.ended} of ${N} games, ${a6}${a6 === V06_MAIN ? "" : ` — on main before #55: ${V06_MAIN}`}` : `v0.6: ${a.ended} of ${N} games (${N} ≠ 600: not compared with main)`);
rule(b.ended === N && b.rules === N && !b.errors.length, `v0.7: ${b.ended} of ${N} games ended, ${b.rules} were v0.7${b.errors.length ? "; errors: " + b.errors.join(" | ") : ""}`);
rule(b.rules === N && b.ended > 0 && !b.bad.length, `v0.7: no bag, no rest cubes, luck within 20–80 all game long${b.bad.length ? " — " + b.bad.join(", ") : ""}`);
const real = b.checks ? (100 * b.total) / b.checks : 0, want = b.checks - b.noLuck ? (100 * b.expect) / (b.checks - b.noLuck) : 0;
rule(b.rules === N && b.checks > 0 && !b.noLuck && Math.abs(real - want) <= 3, `v0.7: checks succeed as their chance says — ${real.toFixed(1)} % succeeded, the chance used averages ${want.toFixed(1)} % (within 3)${b.noLuck ? `; ${b.noLuck} checks without p` : ""}`);
if (b.rules === N) {
  for (let p = 0; p < 3; p++) band.push(`${b.winN[p] >= 25 && b.winN[p] <= 42 ? "帶內" : "帶外"} v0.7 ${NAMES[p]} wins ${b.winN[p].toFixed(1)} % (25–42; v0.6 ${a.winN[p].toFixed(1)} %)`);
  band.push(`${Number(b.margin) <= 6 ? "帶內" : "帶外"} v0.7 average margin ${b.margin} blocks (≤ 6; v0.6 ${a.margin})`);
  band.push(`${Number(b.turnout) >= 80 && Number(b.turnout) <= 92 ? "帶內" : "帶外"} v0.7 turnout ${b.turnout} % (80–92; v0.6 ${a.turnout} %)`);
  band.push(`checks succeed: v0.6 ${a.rate.map((r, p) => `${NAMES[p]} ${r.toFixed(1)}`).join(" / ")} % → v0.7 ${b.rate.map((r, p) => `${NAMES[p]} ${r.toFixed(1)}`).join(" / ")} % (the owner: about 50 %); luck at the end ${b.luckAvg}`);
} else band.push(`— v0.7 is not running (${b.rules} of ${N} games were v0.7): no bands to read`);
let bad = 0;
for (const x of rows) { if (!x.ok) bad++; console.log(`${x.ok ? "✓" : "✗"} ${x.what}`); }
console.log("owner's reading (not counted):");
for (const x of band) console.log(`  ${x}`);
console.log("side by side (v0.6 candidate → v0.7):");
console.log(`  wins ${a.win} → ${b.win}; margin ${a.margin} → ${b.margin}; turnout ${a.turnout} → ${b.turnout} %; votes ${a.votes} → ${b.votes}`);
console.log(`  decisions with a choice ${a.choicesPer} → ${b.choicesPer}; checks ${a.checksPer} → ${b.checksPer} per game; ${secs} s`);
console.log(bad ? `FAIL: ${bad} of ${rows.length}` : `PASS: ${rows.length} checks`);
process.exit(bad ? 1 : 0);
