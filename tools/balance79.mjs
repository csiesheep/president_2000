// tools/balance79.mjs — every card that spoke of momentum speaks of 士氣 (morale) instead, in the draft without
// momentum (#79). Orchestrator's instrument: a peer may run it, does not edit it. Plays the games itself; about 10 min.
//
//   node tools/balance79.mjs [games=600]
//
// Owner, 2026-10-17: 「檢查每一張牌，提出一些牌可以影響士氣，像是興票案 影響宋士氣」 and 「目標勝率 39/35/25（陳/宋/連）」.
// The option: createGame(seed, { …, momentum: "none", trigger: "always", moraleCards: "full" }). Orchestrator's proposal
// (the owner may change any amount): each momentum a card gives or takes becomes 5 % 士氣; 楊吉雄爆料 (興票案)'s
// 「宋動能歸零」 becomes 「宋士氣 −20%」; 說法反覆's 「連動能 +1」 becomes 「宋士氣 −10%」 (宋's own story turning on him).
// 士氣 stays within 20–80. Only what is written on cards changes: the debate winner's momentum stays nothing (#75), and
// a card's existing 士氣 (+10 %) stays. Without "full", #77 (moraleCards: true) and #75 are unchanged.
// The expected change of 士氣 per card (seat 0 陳, 1 宋, 2 連; "leader": the 頭條's unique leader; "lowest": one of the
// seats with the lowest 士氣, the player's pick; "all": everyone):
export const MORALE = {
  alternation: [[0, 10]], poll_lead: [[1, 10]], poll_published: [["leader", 5]], tvbs_poll: [["lowest", 5]],
  no_nuke4: [[1, 5]], lin_chairman: [[0, 5]], lee_yuan_tseh: [[0, 10]], million_rally: [[0, 5]], chang_chiu: [[0, 15]],
  million_signatures: [[1, 15]], soong_friends: [[1, 5]], kneel_for_votes: [[1, 10]], hsu_hsin_liang: [[1, 5]],
  expel_soong: [[1, 5]], yang_exposes: [[1, -20]], shifting_story: [[1, -10]], hand_in_hand: [[2, 5]], lee_attacks_soong: [[1, 5]],
  ma_leaks_polls: [[1, 5], [0, 5]], party_congress: [[2, 15]], kmt_anniversary: [[2, 5]],
  strait_tension: [[0, 5]], white_paper: [[0, 5]], zhu_rongji: [[0, 5]], stock_crash: [["all", -5]], lee_secret_help: [[2, -5]], pla_drill_rumor: [[0, -5]],
};
// Set-ups, all three seats 操盤手 (level 3), seeds 1…N, v0.7 with issueLuck "lead", momentum "none", trigger "always":
//   B  #75's proposal (起始士氣 50/50/60, no card changes) — must equal #75's numbers;
//   P  "full" with 起始士氣 50/50/50 (the owner's 連 50);  Q  "full" with 55/45/70;  R  "full" with 50/50/60.
// Rows (they set the exit code): B equals #75; P, Q, R end and carry moraleCards "full"; every time a card of the table
// resolves (played as an event, or triggered for its owner), 士氣 moves exactly as the table says (capped at 20 and 80),
// and at least 20 of the 27 cards are seen doing it. The owner's reading (wins ± 95 %, the band 25–42 %, the target
// 39/35/25) is printed only.
import * as E from "../public/shared/engine.js";
import * as B from "../public/shared/bots.js";

const N = Number.parseInt(process.argv[2] || "600", 10);
const NAMES = ["陳", "宋", "連"], TARGET = [39, 35, 25];
const BASE = { rules: "v0.7", issueLuck: "lead", momentum: "none", trigger: "always" };
const B_75 = "win 18.5/50.0/31.5, margin 4.26";
const simRng = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const uniqueMax = (arr) => { let best = -1, max = 0, tie = false; arr.forEach((x, p) => { if (x > max) { max = x; best = p; tie = false; } else if (x === max && x > 0) tie = true; }); return tie ? -1 : best; };
const clamp = (x) => Math.max(20, Math.min(80, x));
// the sets of acceptable 士氣 after a card resolved, from the 士氣 before it (one entry per acceptable outcome)
function outcomes(id, st) {
  const base = st.luck.slice(), outs = [];
  const apply = (adds) => { const r = base.slice(); for (const [p, n] of adds) r[p] = clamp(r[p] + n); return r; };
  const fixed = [], choice = [];
  for (const [who, n] of MORALE[id]) {
    if (who === "all") for (let p = 0; p < 3; p++) fixed.push([p, n]);
    else if (who === "leader") { const p = uniqueMax(st.issues[0].cubes); if (p >= 0) fixed.push([p, n]); }
    else if (who === "lowest") { const low = Math.min(...base); for (let p = 0; p < 3; p++) if (base[p] === low) choice.push([p, n]); }
    else fixed.push([who, n]);
  }
  if (!choice.length) outs.push(apply(fixed)); else for (const c of choice) outs.push(apply([...fixed, c]));
  return outs;
}

function run(name, extra) {
  const opts = { ...BASE, ...extra };
  const t = { name, ended: 0, carry: 0, wins: [0, 0, 0], margin: 0, errors: [], seen: {}, wrong: [] };
  for (let seed = 1; seed <= N; seed++) {
    try {
      let st = E.createGame(seed, opts); const R = simRng(seed * 977 + 13);
      if (extra.moraleCards !== "full" || st.moraleCards === "full") t.carry++;
      let watch = null;
      for (let n = 0; n < 20000 && st.phase !== "end"; n++) {
        const seat = E.mustAct(st)[0];
        if (seat == null) throw new Error(`seed ${seed}: nobody to act in ${st.phase}`);
        const before = st, L0 = st.log.length;
        st = E.apply(st, seat, B.chooseMove(st, seat, 3, R).move);
        if (extra.moraleCards === "full") {
          for (const e of st.log.slice(L0)) if (MORALE[e.card] && ((e.t === "play" && e.mode === "event") || e.t === "trigger")) watch = { id: e.card, outs: outcomes(e.card, before), from: before.luck.slice() };
          if (watch && !(st.pending && st.pending.card === watch.id)) {
            if (watch.outs.some((o) => o.every((x, p) => x === st.luck[p]))) t.seen[watch.id] = (t.seen[watch.id] || 0) + 1;
            else if (t.wrong.length < 3) t.wrong.push(`seed ${seed} turn ${st.turn}: ${watch.id} took 士氣 from ${JSON.stringify(watch.from)} to ${JSON.stringify(st.luck)}, the table says ${watch.outs.map((o) => JSON.stringify(o)).join(" or ")}`);
            watch = null;
          }
        }
      }
      if (st.phase !== "end") throw new Error(`seed ${seed}: did not end`);
      t.ended++;
      const v = st.result.votes, s = v.slice().sort((a, b) => b - a);
      t.wins[st.result.winner]++; t.margin += s[0] - s[1];
    } catch (e) { if (t.errors.length < 3) t.errors.push(e.message.split("\n")[0]); }
  }
  const n = t.ended || 1;
  const winP = t.wins.map((w) => 100 * w / n), ci = winP.map((p) => 196 * Math.sqrt((p / 100) * (1 - p / 100) / n));
  return { ...t, winP, ci, sum: `win ${winP.map((x) => x.toFixed(1)).join("/")}, margin ${(t.margin / n).toFixed(2)}` };
}

const t0 = Date.now();
let live = false;
try { live = E.createGame(1, { ...BASE, moraleCards: "full" }).moraleCards === "full"; } catch { live = false; }
const Bv = run("B", {});
const sets = live ? [["P", [50, 50, 50]], ["Q", [55, 45, 70]], ["R", [50, 50, 60]]].map(([k, luck]) => run(k, { luck, moraleCards: "full" })) : [];
const secs = Math.round((Date.now() - t0) / 1000);
const rows = [];
const rule = (ok, what) => rows.push({ ok, what });
rule(N !== 600 || (Bv.ended === N && Bv.sum === B_75), N === 600 ? `B as #75 measured: ${Bv.ended} of ${N} games, ${Bv.sum}${Bv.sum === B_75 ? "" : ` — #75: ${B_75}`}` : `B: ${Bv.ended} of ${N} games (${N} ≠ 600: not compared)`);
if (!live) rows.push({ ok: true, todo: true, what: "TODO: createGame does not take moraleCards \"full\" yet (P–R not run)" });
for (const x of sets) {
  const kinds = Object.keys(x.seen).length;
  rule(x.ended === N && x.carry === N && !x.errors.length, `${x.name}: ${x.ended} of ${N} games ended, ${x.carry} carry moraleCards "full"${x.errors.length ? "; errors: " + x.errors.join(" | ") : ""}`);
  rule(!x.wrong.length && kinds >= 20, `${x.name}: every card of the table moves 士氣 as written (${kinds} of 27 cards seen, ${Object.values(x.seen).reduce((a, b) => a + b, 0)} times${x.wrong.length ? "; " + x.wrong.join(" | ") : ""})`);
}
let bad = 0;
for (const x of rows) { if (!x.ok) bad++; console.log(`${x.todo ? "…" : x.ok ? "✓" : "✗"} ${x.what}`); }
console.log("owner's reading (not counted): wins per candidate ± 95 % margin; band 25–42 %; the owner's target 39/35/25");
const label = { B: "B  #75 的提案（50/50/60，牌不改）", P: "P  全部改士氣，起始 50/50/50", Q: "Q  全部改士氣，起始 55/45/70", R: "R  全部改士氣，起始 50/50/60" };
for (const x of [Bv, ...sets]) {
  const off = x.winP.reduce((a, p, i) => a + Math.abs(p - TARGET[i]), 0);
  console.log(`  ${label[x.name]}: ${x.winP.map((p, i) => `${NAMES[i]} ${p.toFixed(1)} ± ${x.ci[i].toFixed(1)}`).join(" / ")}; margin ${(x.margin / (x.ended || 1)).toFixed(2)}; off the target by ${off.toFixed(1)} points in all`);
}
console.log(`${secs} s`);
const counted = rows.filter((x) => !x.todo).length;
console.log(bad ? `FAIL: ${bad} of ${counted}` : `PASS: ${counted} checks${live ? "" : " (P–R not built yet)"}`);
process.exit(bad ? 1 : 0);
