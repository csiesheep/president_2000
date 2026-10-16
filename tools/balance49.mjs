// tools/balance49.mjs — v0.4 next to the v0.5 draft (ads and media folded into the issues), bot against bot (#49).
// Orchestrator's instrument: a peer may run it, does not edit it. Plays the games itself (the engine and the bots,
// with tests/sim.js's move RNG), not through tests/sim.js.
//
//   node tools/balance49.mjs [games=600]
//
// All three seats 操盤手 (level 3), seeds 1…N, for each rule set. Two kinds of rows:
//   - #49's acceptance (they set the exit code):
//       · v0.4 is untouched: its numbers equal what this tool measured on main 10eefec, before #49;
//       · every v0.5 game ends, is a v0.5 game (st.rules), and no bot ever chose an ad or media move;
//       · the v0.5 bots use the issues at all: some seat spends at least 5 % of its CP on the issue action. Each seat's
//         share is printed and not counted (orchestrator's ruling on #49: a seat for whom the issues are not worth it in
//         v0.5 plays its best and leaves them; forcing 5 % on every seat made 連 play worse and the numbers the owner
//         reads less true. That 連 does best leaving the issues is itself a finding for the owner).
//   - the owner's bands for v0.5 (printed as 帶內／帶外, never counted: whether v0.5 is still a three-way race is the
//     owner's call, not the peer's): every candidate wins 25–42 %, the average margin ≤ 6 blocks, turnout 80–92 %.
// Then the two rule sets side by side: where the CP went, the leader's +1 momentum (media leader in v0.4, issue leader
// in v0.5), swaps, what election day converted, decisions per game.
import * as E from "../public/shared/engine.js";
import * as B from "../public/shared/bots.js";

const N = Number.parseInt(process.argv[2] || "600", 10);
const NAMES = ["陳", "宋", "連"], BLOCKS = 154;
// v0.4 measured by this tool on main 10eefec (600 games), before #49.
const V04_MAIN = { games: 600, win: "37.8/32.7/29.5", margin: "4.07", turnout: "85.8", votes: "44.8/43.9/43.4", decisions: "486.9", cp: "41.5/26.3/32.2 91.5/5.1/3.4 87.4/12.1/0.4" };
const simRng = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const BAD = (m) => m.type === "ad" || m.type === "media" || (m.type === "action" && m.kind === "ads");

function run(opts) {
  const t = { games: 0, ended: 0, rules: 0, bad: [], wins: [0, 0, 0], votes: [0, 0, 0], margin: 0, onBoard: 0, decisions: 0,
    cp: [0, 1, 2].map(() => ({ campaign: 0, ads: 0, issue: 0 })), lead: [0, 0, 0], swaps: 0, conv: [0, 1, 2].map(() => ({ media: 0, issue: 0, mom: 0 })), errors: [] };
  for (let seed = 1; seed <= N; seed++) {
    t.games++;
    try {
      let st = E.createGame(seed, opts); const R = simRng(seed * 977 + 13);
      if (opts.rules && st.rules === opts.rules) t.rules++;
      for (let n = 0; n < 20000 && st.phase !== "end"; n++) {
        const seat = E.mustAct(st)[0];
        if (seat == null) throw new Error(`seed ${seed}: nobody to act in ${st.phase}`);
        const m = B.chooseMove(st, seat, 3, R).move;
        t.decisions++;
        if (BAD(m) && t.bad.length < 3) t.bad.push(`seed ${seed}: ${JSON.stringify(m)}`);
        if (m.type === "action" && st.pending) t.cp[seat][m.kind] = (t.cp[seat][m.kind] || 0) + st.pending.cp;
        const before = st.log.length, media = Array.isArray(st.media) ? st.media.slice() : [0, 0, 0], issues = st.issues.map((i) => i.cubes.slice()), mom = st.mom.slice();
        st = E.apply(st, seat, m);
        for (const e of st.log.slice(before)) {
          if (e.t === "momentum" && (e.step === "media" || e.step === "lead")) t.lead[e.seat]++;
          if (e.t === "momentum" && e.step === "swap") t.swaps++;
          if (e.t === "convert") for (let p = 0; p < 3; p++) { t.conv[p].media += media[p]; t.conv[p].issue += issues.reduce((s, c) => s + c[p], 0); t.conv[p].mom += 2 * mom[p]; }
        }
      }
      if (st.phase !== "end") throw new Error(`seed ${seed}: did not end`);
      t.ended++;
      const v = st.result.votes, s = v.slice().sort((a, b) => b - a);
      t.wins[st.result.winner]++; for (let p = 0; p < 3; p++) t.votes[p] += v[p];
      t.margin += s[0] - s[1]; t.onBoard += v[0] + v[1] + v[2];
    } catch (e) { if (t.errors.length < 3) t.errors.push(e.message.split("\n")[0]); }
  }
  const n = t.ended || 1, f1 = (x) => x.toFixed(1);
  const cpPct = t.cp.map((c) => { const all = c.campaign + c.ads + c.issue || 1; return { campaign: 100 * c.campaign / all, ads: 100 * c.ads / all, issue: 100 * c.issue / all }; });
  return { ...t, n,
    win: t.wins.map((w) => f1(100 * w / n)).join("/"), winN: t.wins.map((w) => 100 * w / n),
    margin: (t.margin / n).toFixed(2), turnout: f1(100 * t.onBoard / n / BLOCKS), votes: t.votes.map((x) => f1(x / n)).join("/"),
    decisions: (t.decisions / t.games).toFixed(1), cpPct,
    cpStr: cpPct.map((c) => `${f1(c.campaign)}/${f1(c.ads)}/${f1(c.issue)}`).join(" "),
  };
}

const t0 = Date.now();
const a = run({}), b = run({ rules: "v0.5" });
const secs = Math.round((Date.now() - t0) / 1000);
const rows = [], band = [];
const rule = (ok, what) => rows.push({ ok, what });
// #49's acceptance
const same = N === V04_MAIN.games;
const a4 = `win ${a.win}, margin ${a.margin}, turnout ${a.turnout}%, votes ${a.votes}, decisions ${a.decisions}, CP 競選/廣告/議題 ${a.cpStr}`;
const m4 = `win ${V04_MAIN.win}, margin ${V04_MAIN.margin}, turnout ${V04_MAIN.turnout}%, votes ${V04_MAIN.votes}, decisions ${V04_MAIN.decisions}, CP 競選/廣告/議題 ${V04_MAIN.cp}`;
rule(!same || (a.ended === N && a4 === m4), same ? `v0.4 untouched: ${a.ended} of ${N} games, ${a4}${a4 === m4 ? "" : ` — on main 10eefec: ${m4}`}` : `v0.4: ${a.ended} of ${N} games (${N} ≠ 600: not compared with main)`);
rule(b.ended === N && b.rules === N && !b.errors.length, `v0.5: ${b.ended} of ${N} games ended, ${b.rules} were v0.5 games (st.rules)${b.errors.length ? "; errors: " + b.errors.join(" | ") : ""}`);
rule(b.ended > 0 && b.bad.length === 0, `v0.5: no ad or media move chosen by a bot${b.bad.length ? " — " + b.bad.join(", ") : ""} (${b.ended} games)`);
rule(b.ended > 0 && b.rules === N && b.cpPct.some((c) => c.issue >= 5), `v0.5: some seat spends ≥ 5 % of its CP on issues (each seat's share is a reading) — ${b.cpPct.map((c, p) => `${NAMES[p]} ${c.issue.toFixed(1)} %`).join(", ")} (v0.4: ${a.cpPct.map((c, p) => `${NAMES[p]} ${c.issue.toFixed(1)} %`).join(", ")})`);
// the owner's bands
const inBand = (okk, what) => band.push(`${okk ? "帶內" : "帶外"} ${what}`);
for (let p = 0; p < 3; p++) inBand(b.winN[p] >= 25 && b.winN[p] <= 42, `v0.5 ${NAMES[p]} wins ${b.winN[p].toFixed(1)} % (25–42; v0.4 ${a.winN[p].toFixed(1)} %)`);
inBand(Number(b.margin) <= 6, `v0.5 average margin ${b.margin} blocks (≤ 6; v0.4 ${a.margin})`);
inBand(Number(b.turnout) >= 80 && Number(b.turnout) <= 92, `v0.5 turnout ${b.turnout} % (80–92; v0.4 ${a.turnout} %)`);

let bad = 0;
for (const x of rows) { if (!x.ok) bad++; console.log(`${x.ok ? "✓" : "✗"} ${x.what}`); }
console.log("owner's bands (not counted):");
if (b.rules === N) for (const x of band) console.log(`  ${x}`);
else console.log(`  — v0.5 is not running (${b.rules} of ${N} games were v0.5): no bands to read`);
const per = (r, x) => (x / r.n).toFixed(2);
console.log("side by side (per game unless said):");
console.log(`  wins ${a.win} → ${b.win}; votes ${a.votes} → ${b.votes}; margin ${a.margin} → ${b.margin}; turnout ${a.turnout} → ${b.turnout} %`);
for (let p = 0; p < 3; p++) console.log(`  ${NAMES[p]} CP 競選/廣告/議題 ${a.cpStr.split(" ")[p]} → ${b.cpStr.split(" ")[p]} %; leader +1 ${per(a, a.lead[p])} → ${per(b, b.lead[p])}; election day media/issue/momentum → bag ${per(a, a.conv[p].media)}/${per(a, a.conv[p].issue)}/${per(a, a.conv[p].mom)} → ${per(b, b.conv[p].media)}/${per(b, b.conv[p].issue)}/${per(b, b.conv[p].mom)}`);
console.log(`  swaps ${per(a, a.swaps)} → ${per(b, b.swaps)}; decisions ${a.decisions} → ${b.decisions}; ${secs} s`);
console.log(bad ? `FAIL: ${bad} of ${rows.length}` : `PASS: ${rows.length} checks`);
process.exit(bad ? 1 : 0);
