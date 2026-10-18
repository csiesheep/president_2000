// tools/balance77.mjs — the game without momentum (#75's B) with the four momentum-only cards turned into 士氣 (morale)
// cards and 連's starting 士氣 at 50, bot against bot (#77). Orchestrator's instrument: a peer may run it, does not edit
// it. Plays the games itself (the engine and the bots, with tests/sim.js's move RNG); about 12 minutes.
//
//   node tools/balance77.mjs [games=600]
//
// Owner, 2026-10-17, after the simulations of #75: 「1 把運氣 改叫 士氣；2 連 士氣改為 50；3 4張空牌改成士氣」. (1) is #76,
// only words. (2) and (3) go into the draft without momentum and are simulated first; the game as played is unchanged.
// The option: createGame(seed, { …, momentum: "none", trigger: "always", moraleCards: true }) — under it (orchestrator's
// amounts: a card's 士氣 is LUCK_CARD, 10, as on the cards that already give 士氣):
//   政黨輪替 (alternation)  陳士氣 +10%
//   民調領先 (poll_lead)    僅第 1–3 回合可當事件出：宋士氣 +10%
//   民調公布 (poll_published) 頭條議題的領先者士氣 +10%（平手沒有人）
//   TVBS 民調 (tvbs_poll)   士氣最低者 +10%（平手由出牌者選）
// 士氣 stays within 20–80 as now. Without moraleCards, nothing changes.
// Set-ups, all three seats 操盤手 (level 3), seeds 1…N, v0.7 with issueLuck "lead", momentum "none", trigger "always":
//   B  #75's proposal as it is (起始士氣 50/50/60, the four cards blank);
//   E  the owner's: 起始士氣 50/50/50, moraleCards;
//   F  E with 陳 at 60;   G  E with 宋 at 40;   H  E with 陳 60 and 宋 40.
// Rows (they set the exit code): B equals what #75 measured; E–H end and carry moraleCards; in E–H every time one of the
// four cards is played as an event or triggered for its owner, its 士氣 lands as above (the seat, +10 or up to 80, nobody
// else moves), and each of the four is seen doing it. The owner's reading (wins ± 95 %, band 25–42 %) is printed only.
import * as E from "../public/shared/engine.js";
import * as B from "../public/shared/bots.js";

const N = Number.parseInt(process.argv[2] || "600", 10);
const NAMES = ["陳", "宋", "連"], BLOCKS = 154;
const BASE = { rules: "v0.7", issueLuck: "lead", momentum: "none", trigger: "always" };
const B_75 = "win 18.5/50.0/31.5, margin 4.26"; // #75's B, measured on main aea927d (600 games)
const FOUR = ["alternation", "poll_lead", "poll_published", "tvbs_poll"];
const simRng = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const uniqueMax = (arr) => { let best = -1, max = 0, tie = false; arr.forEach((x, p) => { if (x > max) { max = x; best = p; tie = false; } else if (x === max && x > 0) tie = true; }); return tie ? -1 : best; };
// whom a card's 士氣 should reach, read off the state before it resolved: a seat, a list (any one of them), or none
function target(id, st) {
  if (id === "alternation") return [0];
  if (id === "poll_lead") return [1];
  if (id === "poll_published") { const p = uniqueMax(st.issues[0].cubes); return p >= 0 ? [p] : []; }
  const low = Math.min(...st.luck); return [0, 1, 2].filter((p) => st.luck[p] === low);
}

function run(name, extra) {
  const opts = { ...BASE, ...extra };
  const t = { name, ended: 0, carry: 0, wins: [0, 0, 0], margin: 0, onBoard: 0, errors: [], seen: Object.fromEntries(FOUR.map((k) => [k, 0])), wrong: [] };
  for (let seed = 1; seed <= N; seed++) {
    try {
      let st = E.createGame(seed, opts); const R = simRng(seed * 977 + 13);
      if (!extra.moraleCards || st.moraleCards === true) t.carry++;
      let watch = null; // { id, before, want }
      for (let n = 0; n < 20000 && st.phase !== "end"; n++) {
        const seat = E.mustAct(st)[0];
        if (seat == null) throw new Error(`seed ${seed}: nobody to act in ${st.phase}`);
        const before = st, L0 = st.log.length;
        st = E.apply(st, seat, B.chooseMove(st, seat, 3, R).move);
        if (extra.moraleCards) {
          for (const e of st.log.slice(L0)) {
            if (FOUR.includes(e.card) && ((e.t === "play" && e.mode === "event") || e.t === "trigger")) watch = { id: e.card, before: before.luck.slice(), want: target(e.card, before) };
          }
          if (watch && !(st.pending && st.pending.card === watch.id)) {
            const d = st.luck.map((x, p) => x - watch.before[p]), up = [0, 1, 2].filter((p) => d[p] !== 0);
            const okSeat = watch.want.length === 0 ? up.length === 0 : up.length === 1 && watch.want.includes(up[0]) && d[up[0]] === Math.min(10, 80 - watch.before[up[0]]);
            const capped = watch.want.length > 0 && up.length === 0 && watch.want.every((p) => watch.before[p] >= 80);
            if (okSeat || capped) t.seen[watch.id]++;
            else if (t.wrong.length < 3) t.wrong.push(`seed ${seed} turn ${st.turn}: ${watch.id} moved 士氣 by ${JSON.stringify(d)} (from ${JSON.stringify(watch.before)}; to ${watch.want.map((p) => NAMES[p]).join("/") || "nobody"})`);
            watch = null;
          }
        }
      }
      if (st.phase !== "end") throw new Error(`seed ${seed}: did not end`);
      t.ended++;
      const v = st.result.votes, s = v.slice().sort((a, b) => b - a);
      t.wins[st.result.winner]++; t.margin += s[0] - s[1]; t.onBoard += v[0] + v[1] + v[2];
    } catch (e) { if (t.errors.length < 3) t.errors.push(e.message.split("\n")[0]); }
  }
  const n = t.ended || 1;
  const winP = t.wins.map((w) => 100 * w / n), ci = winP.map((p) => 196 * Math.sqrt((p / 100) * (1 - p / 100) / n));
  return { ...t, winP, ci, sum: `win ${winP.map((x) => x.toFixed(1)).join("/")}, margin ${(t.margin / n).toFixed(2)}`, turnout: (100 * t.onBoard / n / BLOCKS).toFixed(1) };
}

const t0 = Date.now();
let live = false;
try { live = E.createGame(1, { ...BASE, moraleCards: true }).moraleCards === true; } catch { live = false; }
const Bv = run("B", {});
const sets = live ? [["E", { luck: [50, 50, 50], moraleCards: true }], ["F", { luck: [60, 50, 50], moraleCards: true }], ["G", { luck: [50, 40, 50], moraleCards: true }], ["H", { luck: [60, 40, 50], moraleCards: true }]].map(([k, x]) => run(k, x)) : [];
const secs = Math.round((Date.now() - t0) / 1000);
const rows = [];
const rule = (ok, what) => rows.push({ ok, what });
rule(N !== 600 || (Bv.ended === N && Bv.sum === B_75), N === 600 ? `B as #75 measured: ${Bv.ended} of ${N} games, ${Bv.sum}${Bv.sum === B_75 ? "" : ` — #75: ${B_75}`}` : `B: ${Bv.ended} of ${N} games (${N} ≠ 600: not compared)`);
if (!live) rows.push({ ok: true, todo: true, what: "TODO: createGame does not take moraleCards yet (E–H not run)" });
for (const x of sets) {
  rule(x.ended === N && x.carry === N && !x.errors.length, `${x.name}: ${x.ended} of ${N} games ended, ${x.carry} carry moraleCards${x.errors.length ? "; errors: " + x.errors.join(" | ") : ""}`);
  rule(!x.wrong.length && FOUR.every((k) => x.seen[k] > 0), `${x.name}: the four cards give 士氣 as written (${FOUR.map((k) => `${k} ${x.seen[k]}`).join(", ")}${x.wrong.length ? "; " + x.wrong.join(" | ") : ""})`);
}
let bad = 0;
for (const x of rows) { if (!x.ok) bad++; console.log(`${x.todo ? "…" : x.ok ? "✓" : "✗"} ${x.what}`); }
console.log("owner's reading (not counted): wins per candidate ± 95 % margin, band 25–42 %");
const label = { B: "B  #75 的提案（士氣 50/50/60，四張空牌）", E: "E  owner 的（士氣 50/50/50，四張士氣牌）", F: "F  E，陳 60", G: "G  E，宋 40", H: "H  E，陳 60、宋 40" };
for (const x of [Bv, ...sets]) console.log(`  ${label[x.name]}: ${x.winP.map((p, i) => `${NAMES[i]} ${p.toFixed(1)} ± ${x.ci[i].toFixed(1)} ${p >= 25 && p <= 42 ? "帶內" : "帶外"}`).join(" / ")}; margin ${(x.margin / (x.ended || 1)).toFixed(2)}, turnout ${x.turnout}%`);
console.log(`${secs} s`);
const counted = rows.filter((x) => !x.todo).length;
console.log(bad ? `FAIL: ${bad} of ${counted}` : `PASS: ${counted} checks${live ? "" : " (E–H not built yet)"}`);
process.exit(bad ? 1 : 0);
