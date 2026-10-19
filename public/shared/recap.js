// What the end page and the CP warning read (issue #90, orchestrator 裁決 #90; the contract is the head of
// tests/endfacts90.test.js). Pure: it reads a finished state or any seat's view of it (the view keeps the board, the
// log, the luck, st.election and st.result, which is all this reads), so recap(view) equals recap(state) and a room
// (src/roomcore.js) gets the same answer as a solo game.
//
//   recap(v)     null before the end; at the end { votes, winner, decidedBy, sources, trend, leads, issueLeads,
//                canvass, debates, gifts, received } (each below);
//   moraleOf(id) the 士氣 card id's event moves when it happens, [[who, points], …] (engine.js, beside MORALE_FULL).
import { canvassLuck, moraleOf, SEATS } from "./engine.js";
import { EVENTS } from "./cards.js";

export { moraleOf };

const SEAT = [0, 1, 2];
const OWNER = Object.fromEntries(EVENTS.map((e) => [e.id, SEATS.indexOf(e.owner)])); // -1: 外力

// The unique largest, or -1 (a tie, or nobody has any): who leads a county.
function leaderOf(n) {
  const m = Math.max(...n);
  return m > 0 && n.filter((x) => x === m).length === 1 ? n.indexOf(m) : -1;
}
// The count's first rule that puts one seat alone ahead (the engine writes it into st.result since #90; a game that
// ended before #90 gets it here from the same numbers).
function decided(r) {
  let pool = SEAT;
  for (const k of ["votes", "leads", "momentum"]) {
    const m = Math.max(...pool.map((p) => r[k][p]));
    pool = pool.filter((p) => r[k][p] === m);
    if (pool.length === 1) return k;
  }
  return "order";
}

export function recap(v) {
  if (!v || v.phase !== "end" || !v.result) return null;
  const r = v.result, log = v.log || [];
  // trend: the votes each turn's own log entry was written with (#40: as the turn began, so as the turn before it
  // ended), turn 9's row the count. A turn the log does not have (a game set up at a later turn) is votes null.
  const trend = [];
  for (let t = 1; t <= 8; t++) {
    const e = log.find((x) => x.t === "turn" && x.turn === t + 1);
    trend.push({ turn: t, votes: e && e.votes ? e.votes.slice() : null });
  }
  trend.push({ turn: 9, votes: r.votes.slice() });
  // leads: the counties where a seat has the most blocks alone, at the end.
  const leads = [[], [], []];
  v.counties.forEach((c, k) => { const p = leaderOf(SEAT.map((q) => c.blocks.filter((b) => b.o === q).length)); if (p >= 0) leads[p].push(k); });
  // election day, from the conversion on: the issues led then (#58 丙 logs them; a game without 丙 has none: null),
  // the cards canvassed, the checks and their successes, and the luck those checks used.
  const ci = log.findIndex((e) => e.t === "convert"), conv = log[ci], day = ci < 0 ? [] : log.slice(ci);
  const issueLeads = conv && conv.leads ? conv.leads.slice() : null;
  const canvass = SEAT.map((p) => ({
    cards: day.filter((e) => e.t === "canvass" && e.seat === p && e.card).length,
    checks: day.filter((e) => e.t === "check" && e.seat === p).length,
    hits: day.filter((e) => e.t === "check" && e.seat === p && e.ok).length,
    luck: canvassLuck(v, p),
  }));
  // debates: the issues each seat won at the policy forum (turn 6).
  const debates = SEAT.map((p) => log.filter((e) => e.t === "debate" && e.step === "settle" && e.seat === p).length);
  // gifts / received: a rival's event played for CP whose trigger, before the next card is played, made it happen for
  // its owner (#75 "always" logs it auto; a paid trigger logs it too).
  const gifts = [[], [], []], received = [[], [], []];
  let play = null;
  for (const e of log) {
    if (e.t === "play") { play = e; continue; }
    if (e.t !== "trigger" || !play || play.mode !== "cp" || play.card !== e.card) continue;
    const q = OWNER[e.card];
    if (q === undefined || q < 0 || q !== e.seat || q === play.seat) continue;
    gifts[play.seat].push({ card: e.card, to: q });
    received[q].push({ card: e.card, by: play.seat });
    play = null;
  }
  return {
    votes: r.votes.slice(),
    winner: r.winner,
    decidedBy: r.decidedBy ?? decided(r),
    sources: r.sources ? r.sources.map((o) => ({ ...o })) : null,
    trend, leads, issueLeads, canvass, debates, gifts, received,
  };
}
