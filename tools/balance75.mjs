// tools/balance75.mjs — the game without momentum, bot against bot (#75). Orchestrator's instrument: a peer may run it,
// does not edit it. Plays the games itself (the engine and the bots, with tests/sim.js's move RNG); about 6 minutes.
//
//   node tools/balance75.mjs [games=600]
//
// Owner, 2026-10-17: 「想要移除動能點；敵人事件一定觸發/去除動能變催票運氣；模擬一下對勝率的影響」.
// Four set-ups, all three seats 操盤手 (level 3), seeds 1…N, on the rules new games are played with (v0.7, issueLuck
// "lead"):
//   A  as played today (momentum, a trigger costs the owner 1 momentum);
//   B  the owner's proposal: createGame opts { momentum: "none", trigger: "always" } — no momentum anywhere, and an
//      opponent's event played for CP always resolves for its owner;
//   C  { momentum: "none", trigger: "never" } — no momentum and nobody triggers (what removing momentum alone does);
//   D  { trigger: "always" } — momentum kept, but triggers are free and always happen (what the trigger change alone does).
// Rows (they set the exit code):
//   - A is untouched: its numbers equal what this tool measured on main before #75;
//   - B, C, D: every game ends and carries its options (st.momentum, st.trigger);
//   - B, C: momentum stays 0 the whole game (st.mom), no decision ever offers a trigger or a momentum reward, and every
//     election-day check's chance has no momentum in it (chance − min(80, luck) is 0, 10, 20 or 30: the leads only;
//     or the 95 cap);
//   - B, D: no decision ever offers a trigger; every opponent's event played for CP that its owner could play as an
//     event (owner ≠ player, not 「必觸發」, not local, its 「僅在…之後」 card already played, its turn limits met) is
//     followed by a trigger for that owner before the next play;
//   - C: no trigger at all.
// The owner's reading (printed, never counted): each candidate's wins with a 95 % margin, the band 25–42 %, the average
// margin, turnout, triggers per game, decisions with a choice.
import * as E from "../public/shared/engine.js";
import * as B from "../public/shared/bots.js";
import { EVENTS } from "../public/shared/cards.js";

const N = Number.parseInt(process.argv[2] || "600", 10);
const NAMES = ["陳", "宋", "連"], SEATS = ["chen", "soong", "lien"], BLOCKS = 154;
const BASE = { rules: "v0.7", issueLuck: "lead" };
// A, measured by this tool on main before #75 (600 games).
const A_MAIN = "win 36.5/34.8/28.7, margin 3.38, turnout 87.4%, triggers 9.15, choices 451.9";
const CARD = Object.fromEntries(EVENTS.map((c) => [c.id, c]));
const simRng = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const ownerOf = (c) => (c && c.owner ? SEATS.indexOf(c.owner) : -1);

function run(name, extra) {
  const opts = { ...BASE, ...extra };
  const t = { name, ended: 0, carry: 0, wins: [0, 0, 0], margin: 0, onBoard: 0, choices: 0, triggers: 0, eligible: 0, missed: [], errors: [],
    momSeen: [], trigOffered: 0, rewardMom: 0, elect: 0, electBad: [] };
  for (let seed = 1; seed <= N; seed++) {
    try {
      let st = E.createGame(seed, opts); const R = simRng(seed * 977 + 13);
      if ((extra.momentum == null || st.momentum === extra.momentum) && (extra.trigger == null || st.trigger === extra.trigger)) t.carry++;
      let open = null; // an opponent's event played for CP that its owner could play as an event, waiting for its trigger
      for (let n = 0; n < 20000 && st.phase !== "end"; n++) {
        const seat = E.mustAct(st)[0];
        if (seat == null) throw new Error(`seed ${seed}: nobody to act in ${st.phase}`);
        const legal = E.legalMoves(st, seat);
        if (legal.length > 1) t.choices++;
        if (legal.some((m) => m.type === "trigger")) t.trigOffered++;
        if (legal.some((m) => m.type === "reward" && m.pick === "mom")) t.rewardMom++;
        const m = B.chooseMove(st, seat, 3, R).move;
        const L0 = st.log.length, before = st;
        st = E.apply(st, seat, m);
        for (const e of st.log.slice(L0)) {
          if (e.t === "play") {
            if (open) { t.missed.length < 3 && t.missed.push(`seed ${seed} turn ${before.turn}: ${open} played for CP, no trigger`); open = null; }
            const c = CARD[e.card];
            if (e.mode === "cp" && c && !c.must && !c.local && ownerOf(c) >= 0 && ownerOf(c) !== e.seat &&
              !(c.cond && !(before.flags && before.flags.played && before.flags.played[c.cond])) && !(c.turnMax && before.turn > c.turnMax) &&
              !(c.lawful && before.turn !== 8) && E.effectImplemented(c.id)) { open = c.id; t.eligible++; }
          }
          if (e.t === "trigger") { t.triggers++; if (open && e.card === open && e.seat === ownerOf(CARD[open])) open = null; }
          if (e.t === "check" && st.phase === "election" && typeof e.p === "number") {
            t.elect++;
            const rest = e.p - Math.min(80, st.luck[e.seat]);
            if (extra.momentum === "none" && ![0, 10, 20, 30].includes(rest) && e.p !== 95 && t.electBad.length < 3) t.electBad.push(`seed ${seed}: ${NAMES[e.seat]} chance ${e.p}, luck ${st.luck[e.seat]}`);
          }
        }
        if (extra.momentum === "none" && Array.isArray(st.mom) && st.mom.some((x) => x !== 0) && t.momSeen.length < 3) t.momSeen.push(`seed ${seed} turn ${st.turn}: mom ${JSON.stringify(st.mom)}`);
      }
      if (st.phase !== "end") throw new Error(`seed ${seed}: did not end`);
      t.ended++;
      const v = st.result.votes, s = v.slice().sort((a, b) => b - a);
      t.wins[st.result.winner]++; t.margin += s[0] - s[1]; t.onBoard += v[0] + v[1] + v[2];
    } catch (e) { if (t.errors.length < 3) t.errors.push(e.message.split("\n")[0]); }
  }
  const n = t.ended || 1, f1 = (x) => x.toFixed(1);
  const winP = t.wins.map((w) => 100 * w / n);
  const ci = winP.map((p) => 196 * Math.sqrt((p / 100) * (1 - p / 100) / n));
  return { ...t, n, winP, ci, sum: `win ${winP.map(f1).join("/")}, margin ${(t.margin / n).toFixed(2)}, turnout ${f1(100 * t.onBoard / n / BLOCKS)}%, triggers ${(t.triggers / n).toFixed(2)}, choices ${(t.choices / n).toFixed(1)}` };
}

const t0 = Date.now();
const live = E.createGame(1, { ...BASE, momentum: "none", trigger: "always" }).momentum === "none";
const A = run("A", {});
const [Bv, C, D] = live ? [run("B", { momentum: "none", trigger: "always" }), run("C", { momentum: "none", trigger: "never" }), run("D", { trigger: "always" })] : [null, null, null];
const secs = Math.round((Date.now() - t0) / 1000);
const rows = [];
const rule = (ok, what) => rows.push({ ok, what });
rule(N !== 600 || (A.ended === N && A.sum === A_MAIN), N === 600 ? `A untouched: ${A.ended} of ${N} games, ${A.sum}${A.sum === A_MAIN ? "" : ` — on main before #75: ${A_MAIN}`}` : `A: ${A.ended} of ${N} games (${N} ≠ 600: not compared with main)`);
if (!live) rows.push({ ok: true, todo: true, what: "TODO: createGame does not take momentum \"none\" / trigger \"always\" yet (B, C, D not run)" });
else {
  for (const x of [Bv, C, D]) rule(x.ended === N && x.carry === N && !x.errors.length, `${x.name}: ${x.ended} of ${N} games ended, ${x.carry} carry their options${x.errors.length ? "; errors: " + x.errors.join(" | ") : ""}`);
  for (const x of [Bv, C]) {
    rule(x.ended > 0 && !x.momSeen.length && !x.trigOffered && !x.rewardMom, `${x.name}: momentum stays 0, no trigger or momentum reward offered (${x.momSeen.length ? x.momSeen.join(", ") : "mom 0 all game"}; ${x.trigOffered} trigger offers, ${x.rewardMom} momentum rewards offered)`);
    rule(x.elect > 0 && !x.electBad.length, `${x.name}: election-day chances hold no momentum (${x.elect} checks${x.electBad.length ? "; " + x.electBad.join(", ") : ""})`);
  }
  for (const x of [Bv, D]) rule(x.ended > 0 && !x.trigOffered && x.eligible > 0 && !x.missed.length, `${x.name}: an opponent's event played for CP always triggers for its owner, nobody is asked (${x.triggers} triggers for ${x.eligible} such plays, ${x.trigOffered} trigger offers${x.missed.length ? "; " + x.missed.join(" | ") : ""})`);
  rule(C.ended > 0 && C.triggers === 0, `C: nobody triggers (${C.triggers} triggers)`);
}
let bad = 0;
for (const x of rows) { if (!x.ok) bad++; console.log(`${x.todo ? "…" : x.ok ? "✓" : "✗"} ${x.what}`); }
console.log("owner's reading (not counted): wins per candidate ± 95 % margin, band 25–42 %");
for (const x of [A, Bv, C, D].filter(Boolean)) {
  const w = x.winP.map((p, i) => `${NAMES[i]} ${p.toFixed(1)} ± ${x.ci[i].toFixed(1)} ${p >= 25 && p <= 42 ? "帶內" : "帶外"}`).join(" / ");
  console.log(`  ${x.name}: ${w}; ${x.sum.replace(/^win [^,]*, /, "")}`);
}
console.log(`${secs} s`);
console.log(bad ? `FAIL: ${bad} of ${rows.filter((x) => !x.todo).length}` : `PASS: ${rows.filter((x) => !x.todo).length} checks${live ? "" : " (B, C, D not built yet)"}`);
process.exit(bad ? 1 : 0);
