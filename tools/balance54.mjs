// tools/balance54.mjs — v0.5 next to the v0.6 draft (simplified), both 地方大老 variants, bot against bot (#54).
// Orchestrator's instrument: a peer may run it, does not edit it. Plays the games itself (the engine and the bots,
// with tests/sim.js's move RNG).
//
//   node tools/balance54.mjs [games=600]
//
// All three seats 操盤手 (level 3), seeds 1…N, for v0.5, v0.6 fill "candidate" (4a) and v0.6 fill "free" (4b). Rows:
//   - #54's acceptance (they set the exit code):
//       · v0.5 is untouched: its numbers equal what this tool measured on main before #54;
//       · every v0.6 game ends and is a v0.6 game with its fill (st.rules, st.fill);
//       · v0.6 offers no block, no order choice, no swap and no slot-2 reward choice, and logs no initiative check;
//       · v0.6 is simpler to play: fewer decisions with a real choice per game than v0.5, in both variants.
//   - the owner's bands for each v0.6 variant (printed as 帶內／帶外, never counted): every candidate wins 25–42 %, the
//     average margin ≤ 6 blocks, turnout 80–92 %.
// Then the three side by side: wins, margin, turnout, decisions and checks per game.
import * as E from "../public/shared/engine.js";
import * as B from "../public/shared/bots.js";

const N = Number.parseInt(process.argv[2] || "600", 10);
const NAMES = ["陳", "宋", "連"], BLOCKS = 154;
// v0.5 measured by this tool on main before #54 (600 games).
const V05_MAIN = "win 42.0/30.2/27.8, margin 4.26, turnout 86.1%, votes 45.2/43.7/43.6, choices 447.4, checks 165.1";
const simRng = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const GONE = (m) => (m.type === "play" && m.block) || m.type === "order" || m.type === "swap" || m.type === "noswap" || m.type === "reward";

function run(opts) {
  const t = { ended: 0, rules: 0, gone: [], initiative: 0, wins: [0, 0, 0], votes: [0, 0, 0], margin: 0, onBoard: 0, decisions: 0, choices: 0, checks: 0, errors: [] };
  for (let seed = 1; seed <= N; seed++) {
    try {
      let st = E.createGame(seed, opts); const R = simRng(seed * 977 + 13);
      if (opts.rules === "v0.6" && st.rules === "v0.6" && st.fill === (opts.fill || "candidate")) t.rules++;
      for (let n = 0; n < 20000 && st.phase !== "end"; n++) {
        const seat = E.mustAct(st)[0];
        if (seat == null) throw new Error(`seed ${seed}: nobody to act in ${st.phase}`);
        const legal = E.legalMoves(st, seat);
        if (legal.length > 1) t.choices++;
        if (opts.rules === "v0.6") { const g = legal.find(GONE); if (g && t.gone.length < 3) t.gone.push(`seed ${seed}: ${JSON.stringify(g)}`); }
        const m = B.chooseMove(st, seat, 3, R).move;
        t.decisions++;
        const L0 = st.log.length;
        st = E.apply(st, seat, m);
        for (const e of st.log.slice(L0)) { if (e.t === "check") t.checks++; if (e.t === "initiative" && opts.rules === "v0.6") t.initiative++; }
      }
      if (st.phase !== "end") throw new Error(`seed ${seed}: did not end`);
      t.ended++;
      const v = st.result.votes, s = v.slice().sort((a, b) => b - a);
      t.wins[st.result.winner]++; for (let p = 0; p < 3; p++) t.votes[p] += v[p];
      t.margin += s[0] - s[1]; t.onBoard += v[0] + v[1] + v[2];
    } catch (e) { if (t.errors.length < 3) t.errors.push(e.message.split("\n")[0]); }
  }
  const n = t.ended || 1, f1 = (x) => x.toFixed(1);
  return { ...t, n, winN: t.wins.map((w) => 100 * w / n), win: t.wins.map((w) => f1(100 * w / n)).join("/"), margin: (t.margin / n).toFixed(2),
    turnout: f1(100 * t.onBoard / n / BLOCKS), votes: t.votes.map((x) => f1(x / n)).join("/"), choicesPer: (t.choices / n).toFixed(1), checksPer: (t.checks / n).toFixed(1) };
}

const t0 = Date.now();
const a = run({ rules: "v0.5" }), b = run({ rules: "v0.6", fill: "candidate" }), c = run({ rules: "v0.6", fill: "free" });
const secs = Math.round((Date.now() - t0) / 1000);
const rows = [], band = [];
const rule = (ok, what) => rows.push({ ok, what });
const a5 = `win ${a.win}, margin ${a.margin}, turnout ${a.turnout}%, votes ${a.votes}, choices ${a.choicesPer}, checks ${a.checksPer}`;
rule(N !== 600 || (a.ended === N && a5 === V05_MAIN), N === 600 ? `v0.5 untouched: ${a.ended} of ${N} games, ${a5}${a5 === V05_MAIN ? "" : ` — on main before #54: ${V05_MAIN}`}` : `v0.5: ${a.ended} of ${N} games (${N} ≠ 600: not compared with main)`);
for (const [x, tag] of [[b, "v0.6 candidate"], [c, "v0.6 free"]]) {
  rule(x.ended === N && x.rules === N && !x.errors.length, `${tag}: ${x.ended} of ${N} games ended, ${x.rules} were v0.6 with that fill${x.errors.length ? "; errors: " + x.errors.join(" | ") : ""}`);
  rule(x.ended > 0 && x.rules === N && !x.gone.length && !x.initiative, `${tag}: no block, order, swap or slot-2 choice offered, no initiative check${x.gone.length ? " — " + x.gone.join(", ") : ""}${x.initiative ? ` — ${x.initiative} initiative checks` : ""}`);
  rule(x.ended > 0 && x.rules === N && Number(x.choicesPer) < Number(a.choicesPer), `${tag}: ${x.choicesPer} decisions with a real choice per game (fewer than v0.5's ${a.choicesPer}); checks ${x.checksPer} (v0.5 ${a.checksPer})`);
  const inBand = (okk, what) => band.push(`${okk ? "帶內" : "帶外"} ${tag} ${what}`);
  if (x.rules === N) {
    for (let p = 0; p < 3; p++) inBand(x.winN[p] >= 25 && x.winN[p] <= 42, `${NAMES[p]} wins ${x.winN[p].toFixed(1)} % (25–42; v0.5 ${a.winN[p].toFixed(1)} %)`);
    inBand(Number(x.margin) <= 6, `average margin ${x.margin} blocks (≤ 6; v0.5 ${a.margin})`);
    inBand(Number(x.turnout) >= 80 && Number(x.turnout) <= 92, `turnout ${x.turnout} % (80–92; v0.5 ${a.turnout} %)`);
  } else band.push(`— ${tag} is not running (${x.rules} of ${N} games were v0.6): no bands to read`);
}
let bad = 0;
for (const x of rows) { if (!x.ok) bad++; console.log(`${x.ok ? "✓" : "✗"} ${x.what}`); }
console.log("owner's bands (not counted):");
for (const x of band) console.log(`  ${x}`);
console.log("side by side (v0.5 → v0.6 candidate → v0.6 free):");
console.log(`  wins ${a.win} → ${b.win} → ${c.win}; margin ${a.margin} → ${b.margin} → ${c.margin}; turnout ${a.turnout} → ${b.turnout} → ${c.turnout} %`);
console.log(`  votes ${a.votes} → ${b.votes} → ${c.votes}; decisions with a choice ${a.choicesPer} → ${b.choicesPer} → ${c.choicesPer}; checks ${a.checksPer} → ${b.checksPer} → ${c.checksPer} per game; ${secs} s`);
console.log(bad ? `FAIL: ${bad} of ${rows.length}` : `PASS: ${rows.length} checks`);
process.exit(bad ? 1 : 0);
