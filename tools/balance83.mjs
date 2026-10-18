// tools/balance83.mjs — a beginner level (新手, level 0) a new player can beat (#83). Orchestrator's instrument: a peer may
// run it, does not edit it. Plays the games itself; about 15 min.
//
//   node tools/balance83.mjs [games per seat=300]
//
// Owner, 2026-10-18: 「請打磨此遊戲，直到其具有商業價值」 and, for the business: 「先免費網頁上線」. The commercial audit (D, the
// vault's 「商業盤點 2026-10-18 · D」) found a new player cannot win: a 「稍懂的新手」 (each decision 50 % what level 1 would
// play, 50 % a uniformly random legal move) wins 8.9 % against two level-1 bots, 0 % as 陳; commercial games usually give a
// new player three to five in ten against the easiest bots. Orchestrator's proposal (#83, the owner may change it): a new
// bot level 0 「新手」, below 助選員, that such a player beats 30–50 % of the time in every seat.
// Rules: v0.8 (the game as played since #82): { rules: "v0.7", issueLuck: "lead", momentum: "none", trigger: "always",
// moraleCards: "full", luck: [50, 50, 50] }. Seeds 1…N per set-up, simRng(seed * 977 + 13) for the bots, a second stream
// simRng(seed * 7919 + 5) for the novice's coin and its random picks.
// Rows (they set the exit code):
//   - bots.js lists level 0 (B.BOT_LEVELS includes 0) and B.chooseMove(st, seat, 0, rng, { humans }) gives a legal move
//     at every decision of every game below (尚未實作 until BOT_LEVELS includes 0). humans lists the seats a person plays
//     (here: the one seat that is not level 0): the orchestrator's probes found 30–50 % in every seat out of reach for a
//     level 0 that does not know where the human sits (陳 and 連 want opposite strengths of the same bots), and within
//     reach for one that does;
//   - N1 the novice against two level-0 bots wins 30–50 % in each seat (陳, 宋, 連 apart), N games per seat;
//   - W level 1 against two level-0 bots wins at least 50 % over the three seats (level 0 is below 助選員);
//   - levels 1–3 are untouched: L1×3, L2×3 and L3×3 (seeds 1…300, 1…300, 1…600) equal what they gave before #83.
// The owner's reading (not counted): the random clicker against two level-0 bots, the novice against two level-1 bots,
// and level 0's mix of actions (place, steal, issue, event).
import * as E from "../public/shared/engine.js";
import * as B from "../public/shared/bots.js";

const N = Number.parseInt(process.argv[2] || "300", 10);
const NAMES = ["陳", "宋", "連"];
const OPTS = { rules: "v0.7", issueLuck: "lead", momentum: "none", trigger: "always", moraleCards: "full", luck: [50, 50, 50] };
// Before #83 (main 8391ffe, measured with this file's own loop): levels 1–3 playing themselves.
const PIN = { L1: "win 5.7/83.0/11.3, margin 5.79", L2: "win 31.3/41.7/27.0, margin 3.51", L3: "win 40.3/32.3/27.3, margin 3.96" };
const simRng = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const HAS0 = Array.isArray(B.BOT_LEVELS) && B.BOT_LEVELS.includes(0);

// An agent: (st, seat, legal, R, r) → move. "L<k>": bot level k; "N": the novice; "X": the random clicker.
// A bot is asked at every step, one move or many, as tools/balance79.mjs does (its picks draw on R), so L3×3 here equals
// balance79's P; the novice and the clicker take a lone move without a draw.
const agent = (spec) => (st, seat, legal, R, r, humans) => {
  if (spec === "L0") return B.chooseMove(st, seat, 0, R, { humans }).move;
  if (spec[0] === "L") return B.chooseMove(st, seat, Number(spec.slice(1)), R).move;
  if (legal.length === 1) return legal[0];
  if (spec === "X") return legal[Math.floor(r() * legal.length) % legal.length];
  if (spec === "N") return r() < 0.5 ? B.chooseMove(st, seat, 1, R).move : legal[Math.floor(r() * legal.length) % legal.length];
};
const key = (m) => JSON.stringify(m);
function play(seed, specs, watch0) {
  let st = E.createGame(seed, OPTS); const R = simRng(seed * 977 + 13), r = simRng(seed * 7919 + 5), ag = specs.map(agent);
  const humans = [0, 1, 2].filter((p) => specs[p] !== "L0");
  for (let n = 0; n < 20000 && st.phase !== "end"; n++) {
    const seat = E.mustAct(st)[0];
    if (seat == null) throw new Error(`seed ${seed}: nobody to act in ${st.phase}`);
    const legal = E.legalMoves(st, seat), m = ag[seat](st, seat, legal, R, r, humans);
    if (specs[seat] === "L0" && legal.length > 1) {
      if (!legal.some((x) => key(x) === key(m))) throw new Error(`seed ${seed}: level 0 gave a move that is not legal: ${key(m).slice(0, 120)}`);
      if (watch0) watch0[m.type || "other"] = (watch0[m.type || "other"] || 0) + 1;
    }
    st = E.apply(st, seat, m);
  }
  if (st.phase !== "end") throw new Error(`seed ${seed}: did not end`);
  const v = st.result.votes, s = v.slice().sort((a, b) => b - a);
  return { winner: st.result.winner, margin: s[0] - s[1] };
}
// One seat of `who` against two of `vs`, seeds 1…n; returns that seat's wins.
function seatRun(who, vs, seat, n, watch0) {
  let wins = 0, ended = 0, err = null;
  for (let seed = 1; seed <= n; seed++) {
    const specs = [vs, vs, vs]; specs[seat] = who;
    try { const g = play(seed, specs, watch0); ended++; if (g.winner === seat) wins++; } catch (e) { if (!err) err = e.message.split("\n")[0]; }
  }
  return { wins, ended, err, p: (100 * wins) / (ended || 1) };
}
function selfRun(spec, n) {
  const w = [0, 0, 0]; let margin = 0, ended = 0;
  for (let seed = 1; seed <= n; seed++) { const g = play(seed, [spec, spec, spec]); ended++; w[g.winner]++; margin += g.margin; }
  return `win ${w.map((x) => ((100 * x) / ended).toFixed(1)).join("/")}, margin ${(margin / ended).toFixed(2)}`;
}
const ci = (p, n) => 196 * Math.sqrt((p / 100) * (1 - p / 100) / n);

const t0 = Date.now();
const rows = [];
const rule = (ok, what) => rows.push({ ok, what });
const PINN = { L1: 300, L2: 300, L3: 600 };
for (const lv of ["L1", "L2", "L3"]) {
  const got = selfRun(lv, PINN[lv]);
  rule(got === PIN[lv], `${lv}×3 untouched (seeds 1…${PINN[lv]}): ${got}${got === PIN[lv] ? "" : ` — before #83: ${PIN[lv]}`}`);
}
const reading = [];
if (!HAS0) rule(false, "bots.js has no level 0 (B.BOT_LEVELS does not include 0; #83 landed it at 7bbebcc): N1 and W not run");
else {
  const watch0 = {};
  const n1 = [0, 1, 2].map((seat) => seatRun("N", "L0", seat, N, watch0));
  const errs = n1.map((x) => x.err).filter(Boolean);
  rule(!errs.length && n1.every((x) => x.ended === N), `level 0 plays every game to the end with legal moves (${n1.reduce((a, x) => a + x.ended, 0)} of ${3 * N} games${errs.length ? "; " + errs[0] : ""})`);
  rule(n1.every((x) => x.p >= 30 && x.p <= 50), `N1 the novice against two level-0 bots wins 30–50 % in each seat: ${n1.map((x, s) => `${NAMES[s]} ${x.p.toFixed(1)} ± ${ci(x.p, x.ended).toFixed(1)}`).join(" / ")} (${N} games per seat)`);
  const w = [0, 1, 2].map((seat) => seatRun("L1", "L0", seat, N));
  const wAll = w.reduce((a, x) => a + x.wins, 0) * 100 / (w.reduce((a, x) => a + x.ended, 0) || 1);
  rule(wAll >= 50, `W level 1 against two level-0 bots wins at least 50 %: ${wAll.toFixed(1)} % (${w.map((x, s) => `${NAMES[s]} ${x.p.toFixed(1)}`).join(" / ")})`);
  const x = [0, 1, 2].map((seat) => seatRun("X", "L0", seat, N));
  reading.push(`the random clicker against two level-0 bots: ${x.map((y, s) => `${NAMES[s]} ${y.p.toFixed(1)}`).join(" / ")}`);
  const tot = Object.values(watch0).reduce((a, b) => a + b, 0) || 1;
  reading.push(`level 0's moves (as the novice's rivals): ${Object.entries(watch0).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${((100 * v) / tot).toFixed(1)} %`).join(", ")}`);
}
const n1L1 = [0, 1, 2].map((seat) => seatRun("N", "L1", seat, Math.min(N, 200)));
reading.push(`the novice against two level-1 bots (as before #83: 8.9 % over the seats): ${n1L1.map((y, s) => `${NAMES[s]} ${y.p.toFixed(1)}`).join(" / ")}`);
let bad = 0;
for (const r of rows) { if (!r.ok) bad++; console.log(`${r.todo ? "…" : r.ok ? "✓" : "✗"} ${r.what}`); }
console.log("owner's reading (not counted):"); for (const l of reading) console.log("  " + l);
console.log(`${Math.round((Date.now() - t0) / 1000)} s`);
const counted = rows.filter((r) => !r.todo).length;
console.log(bad ? `FAIL: ${bad} of ${counted}` : `PASS: ${counted} checks${HAS0 ? "" : " (level 0 not built yet)"}`);
process.exit(bad ? 1 : 0);
