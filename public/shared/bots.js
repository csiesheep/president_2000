// The bots (M2, #10): three levels for solo play and for filling a room seat.
//
//   chooseMove(st, seat, level, rng) → { move, why }
//
// `move` is one of E.legalMoves(st, seat), returned as that very object; `why`
// is { key, …params } with key in WHY and every param a number or a string
// (table talk is written from the key, #10 §二). level 1 樁腳, 2 總幹事, 3 操盤手.
// rng() → [0, 1) is the caller's; nothing here touches Math.random, so a game
// replays from its seed, the rng and the levels.
//
// No peeking (#10 §四): a decision reads only what E.view(st, seat) shows —
// the board, the tracks, momentum, bags, rest areas, media, endorsements, the
// pending play and its effect queue, the debate board (another seat's pick
// only as "made or not"), this seat's own hand and saved piles, and the other
// piles as counts. Nothing reads another seat's cards, the decks, the
// endorsement deck, st.rng or st.seed. `see()` below is the only reader of st
// and lists what it takes. The bots never look ahead with E.apply, so no
// hidden state is ever needed; every estimate is the model below.
//
// The heuristics start from the design simulator (vault sim/sim.js), rewritten
// for this engine's move-by-move contract:
//   · the projection: each county's empty blue floating blocks go to the blue
//     leader softened by the gap (SOFT), the empty green ones to 陳 when he has
//     a cube there; the objective is own projected votes against the
//     opponents', the strongest one weighted most (rel());
//   · campaign / ads / issue estimates for a card's CP, event values per card,
//     the harm of playing an opponent's card when its owner can trigger it, and
//     the initiative holder going last when ahead.
// The three levels (orchestrator ruling in #10 §三.2):
//   1 樁腳: counts cubes, campaigns only (filling its own camp or the other,
//     never stealing), never triggers or blocks, always goes first, saves and
//     takes its momentum reward at random.
//   2 總幹事: the softened strategic-vote projection, every kind of action and
//     steals, triggers, and blocks a big card it has chosen to play; issue
//     actions only for its own lead.
//   3 操盤手: also keeps high-CP cards for the debate, plays the debate,
//     picks cards around the owner's momentum (blocks or avoids big ones),
//     cuts issue leads to a tie, and sharpens the projection towards the
//     exact strategic vote as election day nears, holding gaps at one.
import * as E from "./engine.js";
import { COUNTIES, REGIONS, REGION_EDGES, CAMP, SEATS, BOSS_THRESHOLD, countyIndex } from "./board.js";
import { EVENTS, localCards, CANDIDATE_CARDS, REST_CUBES, HAND } from "./cards.js";

export const WHY = [
  "only_move",
  "order_first", "order_last",
  "play_event", "play_cp", "play_external", "play_must", "play_candidate", "block_trigger", "dodge_trigger",
  "trigger_event", "pass_trigger",
  "campaign", "advertise", "issue_action",
  "move_region", "fill_swing", "fill_open", "cross_fill", "steal_cube", "campaign_done",
  "ad_roll", "ads_done", "media_lead", "media_cut",
  "issue_lead", "issue_tie", "issue_done",
  "effect_place", "effect_remove", "effect_convert", "effect_media", "effect_tvbs", "local_place",
  "swap_issue", "no_swap", "reward_momentum", "reward_endorse",
  "save_high_cp", "save_county", "save_random",
  "debate_card", "award_place",
  "canvass_card", "canvass_place", "canvass_remove", "hold_gap",
];

const CHEN = 0, SOONG = 1, LIEN = 2;
const NC = COUNTIES.length;
const CARD = Object.fromEntries(EVENTS.map((c) => [c.id, c]).concat(localCards().map((c) => [c.id, c])));
const REG = COUNTIES.map((c) => c[1]);
const INREG = REGIONS.map((_, r) => COUNTIES.map((c, k) => k).filter((k) => REG[k] === r));
const ci = (n) => countyIndex(n);
const OTHER = (t) => (t === "G" ? "B" : "G");

// Region distances for candidate movement (§7.1, §13).
const RDIST = REGIONS.map((_, a) => {
  const d = REGIONS.map(() => -1); d[a] = 0;
  const q = [a];
  while (q.length) {
    const x = q.shift();
    for (const [u, v] of REGION_EDGES) {
      const y = u === x ? v : v === x ? u : -1;
      if (y >= 0 && d[y] < 0) { d[y] = d[x] + 1; q.push(y); }
    }
  }
  return d;
});
const regionCost = (seat, fromCounty, r) => { const d = RDIST[REG[fromCounty]][r]; return seat === SOONG ? Math.min(d, 1) : d; };

// Value of things that are not votes, in projected votes (blocks).
const MOMV = 0.6;          // one momentum: triggers, blocks, two bag cubes on election day
const BAGV = 0.3;          // one cube in one's own bag: support-check odds
// Leading the issue in slot 1 / 2 / 3 at the next momentum phase: +1 momentum
// and an endorsement / the better of the two / +1 momentum. A lead of one cube
// is worth less: anyone acting later this turn can tie it.
const SV = [1.2, 0.8, 0.55];
// How much a seat counts an opponent's gain against its own: the strongest
// opponent W_MAIN, the other W_OTHER (a little more when close). Below 1 in
// sum, so taking a cube from the leader is worth less than adding one's own:
// it helps the third seat too. 樁腳 counts every cube the same.
const W_MAIN = 0.65, W_OTHER = [0.3, 0.35];
// An empty block is not a banked vote before election day (a cross-fill or a
// steal can still take it): an empty green counts this much for 陳 where he
// has a cube, an empty blue this much (times the flow) for the blue leader.
// 操盤手 discounts a green county held by one cube once more, and counts
// every empty block in full on election day.
const EW_GREEN = 0.5, EW_BLUE = 0.6, EW_ONE_CUBE = 0.85;
// A region's media lead: a base, plus each own-camp fill it frees from a
// boss check (up to 3 per county), times the odds of failing that check.
const MEDIA_LEAD = 0.25, MEDIA_WAIVE = 0.35;
const ISSUE_CUBE = 0.12;   // an issue cube becomes a bag cube on election day
const MEDIA_CUBE = 0.15;   // likewise a media cube
// Soft strategic-vote flow by |宋 − 連| in the county (design sim's SOFT), a
// sharper one for 操盤手 in turns 7–8, and the rule itself on election day.
const SOFT = [0, 0.35, 0.8, 1, 1];
const SHARP = [0, 0.12, 0.92, 1, 1];
const EXACT = [0, 0, 1, 1, 1];
const KEEP_CP = 2.0;      // 操盤手: value of one more CP in the debate pile, per card kept
const SOUTH = [...INREG[3], ...INREG[4]];
const DPP97 = ["台北縣", "桃園縣", "新竹縣", "台中縣", "台中市", "台南縣", "台南市", "高雄縣", "屏東縣", "宜蘭縣", "嘉義市"].map(ci);

const leaderOf = (arr) => {
  let best = -1, max = 0, tie = false;
  for (let p = 0; p < 3; p++) {
    if (arr[p] > max) { max = arr[p]; best = p; tie = false; } else if (arr[p] === max && max > 0) tie = true;
  }
  return tie ? -1 : best;
};
const add3 = (a, b, k = 1) => { a[0] += b[0] * k; a[1] += b[1] * k; a[2] += b[2] * k; return a; };
const r2 = (x) => Math.round(x * 100) / 100;

// ------------------------------------------------------------------ what a seat sees

// The only reader of st. Everything taken here is in E.view(st, seat).
function see(st, seat) {
  return {
    seat,
    turn: st.turn, phase: st.phase, step: st.step, initiative: st.initiative,
    counties: st.counties.map((c) => {
      const v = [0, 0, 0], ty = [{ G: 0, B: 0, N: 0 }, { G: 0, B: 0, N: 0 }, { G: 0, B: 0, N: 0 }], e = { G: 0, B: 0, N: 0 };
      for (const b of c.blocks) { if (b.o >= 0) { v[b.o]++; ty[b.o][b.t]++; } else e[b.t]++; }
      return { v, ty, G: e.G, B: e.B, N: e.N };
    }),
    pos: st.pos.slice(), mom: st.mom.slice(), bag: st.bag.slice(), rest: st.rest.slice(),
    media: st.media.map((m) => m.slice()),
    issues: st.issues.map((i) => ({ name: i.name, cubes: i.cubes.slice() })),
    endorse: st.endorse.slice(),
    active: st.active.slice(), played: { ...st.flags.played }, crossFree: st.flags.crossFree.slice(),
    candidateUsed: st.candidateUsed.slice(),
    pending: st.pending ? JSON.parse(JSON.stringify(st.pending)) : null,
    debate: st.debate ? {
      picked: st.debate.picks.map((pk) => !!pk),
      placed: JSON.parse(JSON.stringify(st.debate.placed)),
      settled: st.debate.settled.slice(), award: st.debate.award ? { ...st.debate.award } : null,
    } : null,
    election: st.election ? { stage: st.election.stage, county: st.election.county, left: st.election.left, choose: st.election.choose } : null,
    hand: st.hands[seat].slice(),
    savedDebate: st.savedDebate[seat].slice(),
    savedElection: st.savedElection[seat].slice(),
    pileCounts: st.savedDebate.map((h) => h.length),
  };
}

// ------------------------------------------------------------------ the bot

class Bot {
  constructor(st, seat, level, rng) {
    this.v = see(st, seat);
    this.p = seat; this.lv = level; this.rng = rng;
    const t = this.v.turn;
    this.flow = level === 1 ? null : level >= 3 && t >= 9 ? EXACT : level >= 3 && t >= 7 ? SHARP : SOFT;
    this.pc = this.v.counties.map((_, k) => this.projCounty(k));
    this.T = this.pc.reduce((a, x) => add3(a, x), [0, 0, 0]);
    this.W = [0, 1, 2].map((q) => this.weights(q));
    this.share = [0, 1, 2].map((q) => { const s = this.v.bag[0] + this.v.bag[1] + this.v.bag[2]; return s ? this.v.bag[q] / s : 1 / 3; });
  }

  // How much seat q counts each seat's gains (W_MAIN, W_OTHER above).
  weights(q) {
    const opp = [0, 1, 2].filter((x) => x !== q);
    const [a, b] = this.T[opp[0]] >= this.T[opp[1]] ? opp : [opp[1], opp[0]];
    const w = [0, 0, 0];
    w[q] = 1;
    if (this.lv === 1) { w[a] = 1; w[b] = 1; return w; }
    w[a] = W_MAIN;
    w[b] = Math.max(W_OTHER[0], Math.min(W_OTHER[1], W_OTHER[1] - (this.T[a] - this.T[b]) / 8));
    return w;
  }
  rel(V, q = this.p) { const w = this.W[q]; let s = V[q]; for (let x = 0; x < 3; x++) if (x !== q) s -= w[x] * V[x]; return s; }

  // ---------------------------------------------------------------- projection

  projCounty(k) {
    const c = this.v.counties[k];
    const out = c.v.slice();
    if (!this.flow) return out;
    const gap = c.v[SOONG] - c.v[LIEN];
    const exact = this.lv >= 3 && this.v.turn >= 9;
    const ewB = exact ? 1 : EW_BLUE, ewG = exact ? 1 : EW_GREEN;
    if (c.B && gap) out[gap > 0 ? SOONG : LIEN] += c.B * this.flow[Math.min(Math.abs(gap), 4)] * ewB;
    if (c.G && c.v[CHEN] >= 1) out[CHEN] += c.G * ewG * (this.lv >= 3 && !exact && c.v[CHEN] === 1 ? EW_ONE_CUBE : 1);
    // endorsements: half the grey blocks of the region's holder (§十二 6)
    const h = this.v.endorse[REG[k]];
    if (h >= 0 && c.N >= 2) out[h] += Math.floor(c.N / 2) * (exact ? 1 : 0.5);
    return out;
  }
  // ΔT of a change to county k: ops are [kind, seat, type] with kind "add" (a
  // cube of seat on an empty block of type), "rem" (seat's cube on type), "conv".
  delta(k, ops) {
    const c = this.v.counties[k];
    const save = { v: c.v.slice(), ty: c.ty.map((x) => ({ ...x })), G: c.G, B: c.B, N: c.N };
    for (const [kind, q, t] of ops) this.mutate(c, kind, q, t);
    const nv = this.projCounty(k);
    Object.assign(c, save);
    const old = this.pc[k];
    return [nv[0] - old[0], nv[1] - old[1], nv[2] - old[2]];
  }
  mutate(c, kind, q, t) {
    if (kind === "add") { c.v[q]++; c.ty[q][t]++; c[t]--; }
    else if (kind === "rem") { c.v[q]--; c.ty[q][t]--; c[t]++; }
    else { c.N--; c.G++; }
  }
  // Commit a change (for multi-step estimates); returns an undo function.
  commit(k, ops) {
    const c = this.v.counties[k];
    const save = { v: c.v.slice(), ty: c.ty.map((x) => ({ ...x })), G: c.G, B: c.B, N: c.N };
    const oldPc = this.pc[k];
    for (const [kind, q, t] of ops) this.mutate(c, kind, q, t);
    this.pc[k] = this.projCounty(k);
    add3(this.T, this.pc[k]); add3(this.T, oldPc, -1);
    return () => { add3(this.T, this.pc[k], -1); add3(this.T, oldPc); Object.assign(c, save); this.pc[k] = oldPc; };
  }

  // ---------------------------------------------------------------- checks (§8.1)

  regionLeader(r) { return leaderOf(this.v.media[r]); }
  ownFree(q) { return (q === CHEN && this.v.active.includes("lee_yuan_tseh")) || (q === SOONG && this.v.active.includes("walk_everywhere")); }
  fillNeedsCheck(q, k) {
    if (this.ownFree(q)) return false;
    if (this.regionLeader(REG[k]) === q) return false;
    const c = this.v.counties[k];
    for (let x = 0; x < 3; x++) if (x !== q && c.v[x] >= BOSS_THRESHOLD) return true;
    for (let x = 0; x < 3; x++) if (x !== q && this.v.pos[x] === k) return true;
    return false;
  }
  pFill(q, k) { return this.fillNeedsCheck(q, k) ? this.share[q] : 1; }
  pCross(q) { return this.v.crossFree[q] > 0 ? 1 : this.share[q]; }

  // The placements / removals open to q in county k, each with its odds.
  // what: "fill" own camp, "cross" the other camp, "steal" a cube of q2's.
  options(q, k, { cross = true, steal = true, check = true, grey = false } = {}) {
    const c = this.v.counties[k], own = CAMP[q], oth = OTHER(own), out = [];
    if (c[own] > 0) out.push({ type: "fill", ops: [["add", q, own]], p: check ? this.pFill(q, k) : 1 });
    if (cross && c[oth] > 0) out.push({ type: "cross", ops: [["add", q, oth]], p: check ? this.pCross(q) : 1 });
    if (grey && c.N > 0) out.push({ type: "grey", ops: [["add", q, "N"]], p: 1 });
    if (steal) for (let x = 0; x < 3; x++) {
      if (x === q) continue;
      for (const t of ["G", "B", "N"]) if (c.ty[x][t] > 0) out.push({ type: "steal", target: x, t, ops: [["rem", x, t]], p: check ? this.share[q] : 1 });
    }
    return out;
  }
  // Expected gain of an action that succeeds with odds p. (A failed check also
  // takes the drawn cube out of its owner's bag; measured in #10, counting it
  // made every seat steal more and added no strength, so it is left out.)
  ev(p, gain) { return p * gain; }
  // Best expected gain (for q) of one option in county k; returns { ev, opt, d }.
  bestIn(q, k, o) {
    let best = null;
    for (const opt of this.options(q, k, o)) {
      const d = this.delta(k, opt.ops);
      const ev = this.ev(opt.p, this.rel(d, q));
      if (!best || ev > best.ev) best = { ev, opt, d };
    }
    return best;
  }

  // ---------------------------------------------------------------- CP estimates

  // Per region: the gains of greedy operations, up to 3 per county.
  campaignLists(q = this.p) {
    if (this._camp) return this._camp;
    const o = { steal: this.lv >= 2 };
    const lists = REGIONS.map((_, r) => {
      const gains = [];
      for (const k of INREG[r]) {
        const undo = [];
        for (let n = 0; n < 3; n++) {
          const b = this.bestIn(q, k, o);
          if (!b || b.ev <= 0.02) break;
          gains.push(b.ev);
          undo.push(this.commit(k, b.opt.ops));
        }
        while (undo.length) undo.pop()();
      }
      return gains.sort((a, b) => b - a);
    });
    this._camp = lists;
    return lists;
  }
  campaignValue(cp, fixedRegion = -1) {
    const lists = this.campaignLists();
    let best = { v: 0, r: -1 };
    for (let r = 0; r < REGIONS.length; r++) {
      if (fixedRegion >= 0 && r !== fixedRegion) continue;
      const rem = cp - (fixedRegion >= 0 ? 0 : regionCost(this.p, this.v.pos[this.p], r));
      if (rem < 1) continue;
      let v = 0;
      for (let i = 0; i < rem && i < lists[r].length; i++) v += lists[r][i];
      if (v > best.v) best = { v, r };
    }
    return best;
  }

  // Issue-lead value: the leader of each slot gets SV[slot] at the next momentum phase.
  issueVec(issues) {
    const V = [0, 0, 0];
    if (this.v.turn >= 9) return V;
    issues.forEach((i, s) => {
      const l = leaderOf(i.cubes);
      if (l < 0) return;
      const second = Math.max(...i.cubes.filter((_, q) => q !== l));
      V[l] += SV[s] * (i.cubes[l] - second >= 2 ? 1 : 0.75);
    });
    for (const i of issues) for (let q = 0; q < 3; q++) V[q] += i.cubes[q] * ISSUE_CUBE;
    return V;
  }
  issueChange(changes, q = this.p) {
    const before = this.issueVec(this.v.issues);
    const after = this.issueVec(this.v.issues.map((i) => {
      const c = i.cubes.slice();
      for (const [name, x, n] of changes) if (name === i.name) c[x] = Math.max(0, c[x] + n);
      return { name: i.name, cubes: c };
    }));
    return [after[0] - before[0], after[1] - before[1], after[2] - before[2]];
  }
  // Greedy issue plan for cp: { v, first } (first: the first step).
  issueValue(cp, placed = 0) {
    if (this.v.turn >= 9) return { v: 0, first: null };
    const saved = this.v.issues.map((i) => i.cubes.slice());
    let budget = cp, total = 0, first = null, n = placed;
    for (let guard = 0; guard < 8; guard++) {
      const cost = n ? 2 : 1;
      if (cost > budget) break;
      let best = null;
      for (const i of this.v.issues) {
        const opts = [{ name: i.name, x: this.p, n: 1 }];
        if (this.lv >= 3) for (let x = 0; x < 3; x++) if (x !== this.p && i.cubes[x] > 0) opts.push({ name: i.name, x, n: -1, target: x });
        for (const o of opts) {
          // 總幹事 plays an issue for its own lead; 操盤手 also for denying one (a tie)
          const ch = this.issueChange([[o.name, o.x, o.n]]);
          const d = this.lv >= 3 ? this.rel(ch) : ch[this.p];
          const l0 = leaderOf(i.cubes), c2 = i.cubes.slice();
          c2[o.x] = Math.max(0, c2[o.x] + o.n);
          o.tie = l0 >= 0 && l0 !== this.p && leaderOf(c2) < 0;
          if (!best || d > best.d) best = { d, o };
        }
      }
      if (!best || best.d <= 0.05 * cost) break;
      total += best.d; budget -= cost; n++;
      if (!first) first = best.o;
      const it = this.v.issues.find((i) => i.name === best.o.name);
      it.cubes[best.o.x] = Math.max(0, it.cubes[best.o.x] + best.o.n);
    }
    this.v.issues.forEach((i, s) => { i.cubes = saved[s]; });
    return { v: total, first };
  }

  // Media: region leaders skip the boss / candidate checks there, the national
  // leader may swap issue slots; every cube becomes a bag cube on election day.
  mediaVec(media) {
    const V = [0, 0, 0];
    for (let r = 0; r < REGIONS.length; r++) {
      const l = leaderOf(media[r]);
      if (l < 0) continue;
      // the checks the lead waives: own-camp fills where another seat is a boss
      let waived = 0;
      for (const k of INREG[r]) {
        const c = this.v.counties[k];
        if ([0, 1, 2].some((x) => x !== l && c.v[x] >= BOSS_THRESHOLD)) waived += Math.min(c[CAMP[l]], 3);
      }
      V[l] += MEDIA_LEAD + waived * (1 - this.share[l]) * MEDIA_WAIVE;
    }
    const nat = leaderOf([0, 1, 2].map((q) => media.reduce((s, m) => s + m[q], 0)));
    if (nat >= 0) V[nat] += 0.4;
    for (const m of media) for (let q = 0; q < 3; q++) V[q] += m[q] * MEDIA_CUBE;
    return V;
  }
  mediaChange(r, q, n) {
    const before = this.mediaVec(this.v.media);
    const m2 = this.v.media.map((m) => m.slice());
    m2[r][q] = Math.max(0, m2[r][q] + n);
    const after = this.mediaVec(m2);
    return [after[0] - before[0], after[1] - before[1], after[2] - before[2]];
  }
  bestMedia(q = this.p, { pool = null, removeOnly = -1 } = {}) {
    let best = null;
    for (let r = 0; r < REGIONS.length; r++) {
      if (pool && !pool.includes(r)) continue;
      if (removeOnly >= 0) {
        if (this.v.media[r][removeOnly] <= 0) continue;
        const d = this.mediaChange(r, removeOnly, -1), ev = this.rel(d, q);
        if (!best || ev > best.ev) best = { ev, r, d, target: removeOnly };
        continue;
      }
      const d = this.mediaChange(r, q, 1), ev = this.rel(d, q);
      if (!best || ev > best.ev) best = { ev, r, d };
      if (pool) continue;
      for (let x = 0; x < 3; x++) {
        if (x === q || this.v.media[r][x] <= 0) continue;
        const d2 = this.mediaChange(r, x, -1), ev2 = this.rel(d2, q);
        if (ev2 > best.ev) best = { ev: ev2, r, d: d2, target: x };
      }
    }
    return best;
  }
  adsValue(cp) {
    const b = this.bestMedia();
    return cp * this.share[this.p] * Math.max(b ? b.ev : 0, 0.15) * 0.85;
  }

  cpValue(cp) {
    const camp = this.campaignValue(cp).v;
    if (this.lv === 1) return { v: camp, kind: "campaign" };
    const ads = this.adsValue(cp), iss = this.issueValue(cp).v;
    if (camp >= ads && camp >= iss) return { v: camp, kind: "campaign" };
    return ads >= iss ? { v: ads, kind: "ads" } : { v: iss, kind: "issue" };
  }

  // ---------------------------------------------------------------- event values

  // Expected result of chooser q placing n cubes: ΔT summed (q picks greedily).
  vPlace(q, n, { pool = null, check = false, own = false, pick = "distinct", fromBag = false } = {}) {
    const V = [0, 0, 0], undo = [], used = [];
    if (fromBag) n = Math.min(n, this.v.bag[q]);
    let same = null;
    for (let i = 0; i < n; i++) {
      let best = null;
      const ks = same !== null ? [same] : pool || COUNTIES.map((_, k) => k);
      for (const k of ks) {
        if (pick === "distinct" && used.includes(k)) continue;
        const b = this.bestIn(q, k, { cross: !own, steal: false, check });
        if (b && (!best || b.ev > best.ev)) best = { ...b, k };
      }
      if (!best || best.ev <= -0.5) break;
      add3(V, best.d, best.opt.p);
      used.push(best.k);
      if (pick === "same") same = best.k;
      undo.push(this.commit(best.k, best.opt.ops));
    }
    while (undo.length) undo.pop()();
    return V;
  }
  // Chooser q removes n of target's cubes.
  vRemove(q, target, n, { pool = null, check = false, pick = "distinct", toBag = false } = {}) {
    const V = [0, 0, 0], undo = [], used = [];
    let same = null;
    for (let i = 0; i < n; i++) {
      let best = null;
      const ks = same !== null ? [same] : pool || COUNTIES.map((_, k) => k);
      for (const k of ks) {
        if (pick === "distinct" && used.includes(k)) continue;
        const c = this.v.counties[k];
        for (const t of ["G", "B", "N"]) {
          if (c.ty[target][t] <= 0) continue;
          const d = this.delta(k, [["rem", target, t]]), ev = this.rel(d, q);
          if (!best || ev > best.ev) best = { ev, d, k, t };
        }
      }
      if (!best) break;
      const pr = check ? this.share[q] : 1;
      add3(V, best.d, pr);
      if (toBag) V[target] += BAGV * pr;
      used.push(best.k);
      if (pick === "same") same = best.k;
      undo.push(this.commit(best.k, [["rem", target, best.t]]));
    }
    while (undo.length) undo.pop()();
    return V;
  }
  // The swap cards (棄連保扁 …): in one county target −1 (checked), then q +1 (checked).
  vSwap(q, target) {
    let best = null;
    const sh = this.share[q];
    for (let k = 0; k < NC; k++) {
      const c = this.v.counties[k];
      for (const t of ["G", "B", "N"]) {
        if (c.ty[target][t] <= 0) continue;
        const d = this.delta(k, [["rem", target, t]]);
        const undo = this.commit(k, [["rem", target, t]]);
        const b = this.bestIn(q, k, { steal: false });
        undo();
        const V = add3([0, 0, 0], d, sh);
        if (b) add3(V, b.d, b.opt.p * sh);
        const ev = this.rel(V, q);
        if (!best || ev > best.ev) best = { ev, V };
      }
    }
    if (best) return best.V;
    return this.vPlace(q, 1, { check: true });
  }
  vMom(q, n) { const V = [0, 0, 0]; V[q] = n >= 0 ? n * MOMV : -Math.min(this.v.mom[q], -n) * MOMV; return V; }
  vBag(q, n) { const V = [0, 0, 0]; V[q] = n * BAGV; return V; }
  vIssue(...changes) { return this.issueChange(changes); }
  vMedia(q, n, { pool = null, target = -1 } = {}) {
    const b = this.bestMedia(q, { pool, removeOnly: target });
    const V = [0, 0, 0];
    if (b) add3(V, b.d, n > 1 ? 1 + 0.75 * (n - 1) : 1);
    return V;
  }
  // Rest of this turn for a 本回合 card that waives checks for q.
  playsLeft(q) { return Math.max(0, HAND.play - this.v.step - (this.v.pending && this.v.pending.seat === q ? 1 : 0)); }

  // The event of card id resolved for seat `by`, as a value vector.
  eventVec(id, by = this.p) {
    const c = CARD[id];
    if (c.owner === "local") { const k = ci(c.county); const b = this.bestIn(by, k, { steal: false }); return b ? add3([0, 0, 0], b.d, b.opt.p) : [0, 0, 0]; }
    const f = EV[id];
    return f ? f(this, by) : [0, 0, 0];
  }
  ownEventAllowed(q, c) {
    if (c.owner !== SEATS[q]) return false;
    if (c.turnMax && this.v.turn > c.turnMax) return false;
    if (c.lawful && this.v.turn !== 8) return false;
    if (c.cond && !this.v.played[c.cond]) return false;
    return true;
  }
  // Would q trigger its card if someone played it for CP now?
  wouldTrigger(q, id) {
    const c = CARD[id];
    if (c.must || this.v.mom[q] < 1 || !this.ownEventAllowed(q, c)) return false;
    return this.rel(this.eventVec(id, q), q) - MOMV >= 0.3;
  }

  // ---------------------------------------------------------------- decisions

  decide(legal) {
    const v = this.v;
    if (v.phase === "order") return this.order(legal, false);
    if (v.phase === "save") return this.save(legal);
    if (v.phase === "debate") return v.debate && v.debate.award ? this.place(legal, "award_place") : this.debate(legal);
    if (v.phase === "election") {
      if (v.election.stage === "order") return this.order(legal, true);
      if (v.election.choose) return this.canvass(legal);
      return this.canvassCard(legal);
    }
    if (v.phase === "momentum") return v.pending.stage === "swap" ? this.swap(legal) : this.reward(legal);
    const pd = v.pending;
    if (!pd) return this.play(legal);
    switch (pd.stage) {
      case "trigger": return this.trigger(legal);
      case "effect": return this.effect(legal);
      case "local": return this.place(legal, "local_place");
      case "kind": return this.kind(legal);
      case "campaign": return this.campaign(legal);
      case "ads": return this.ads(legal);
      case "media": return this.mediaPick(legal);
      case "issue": return this.issue(legal);
    }
    return { move: legal[0], why: { key: "only_move" } };
  }

  pickRandom(legal) { return legal[Math.floor(this.rng() * legal.length) % legal.length]; }

  order(legal, election) {
    const lead = this.rel(this.T) > 0;
    if (this.lv === 1) return { move: legal.find((m) => m.pos === 0) || legal[0], why: { key: "order_first" } };
    const last = election && this.lv >= 3 ? true : lead;
    const pos = last ? 2 : 0;
    return { move: legal.find((m) => m.pos === pos), why: { key: last ? "order_last" : "order_first", lead: r2(this.rel(this.T)) } };
  }

  // ----- playing a card

  play(legal) {
    const v = this.v, p = this.p, lv = this.lv;
    const cpCache = {};
    const cpv = (cp) => (cpCache[cp] ??= this.cpValue(cp));
    const restV = (cp) => (lv >= 2 ? (REST_CUBES[cp] + (p === LIEN && !v.active.includes("provincial_staff") ? 1 : 0)) * BAGV : 0);
    // 操盤手 keeps the best card for the pile being built (turns 1–5: the debate, by CP).
    const keep = lv >= 3 ? this.keepPlan() : null;
    const opts = [];
    for (const m of legal) {
      if (lv === 1 && m.block) continue;
      if (m.type === "candidate") {
        const cc = CANDIDATE_CARDS[SEATS[p]];
        let val = cpv(cc.cp).v + (lv >= 2 ? cc.rest * BAGV : 0) - 0.8;
        if (lv === 1) {
          // 樁腳: plays it on a turn picked at random among 1–3, at its first play
          const t = v.turn;
          val = v.step === 0 && t <= 3 && this.rng() < 1 / (4 - t) ? 99 : -99;
        }
        if (v.turn === 8 && v.step === 3) val += 99; // the last chance
        opts.push({ m, val, why: { key: "play_candidate", cp: cc.cp } });
        continue;
      }
      const c = CARD[m.card];
      let val, why;
      const base = cpv(c.cp);
      if (c.must) {
        const ev = this.rel(this.eventVec(m.card, LIEN));
        val = base.v + (lv >= 3 ? ev : 0);
        why = { key: "play_must", card: m.card };
      } else if (c.owner === "ext") {
        const ev = lv === 1 ? 0 : this.rel(this.eventVec(m.card, p));
        val = base.v + ev;
        why = { key: "play_external", card: m.card, value: r2(ev) };
      } else if (c.owner === "local") {
        if (m.mode === "event") { val = lv >= 2 ? this.rel(this.eventVec(m.card, p)) : -1; why = { key: "play_event", card: m.card }; }
        else { val = base.v; why = { key: "play_cp", card: m.card, kind: base.kind }; }
      } else if (c.owner === SEATS[p]) {
        if (m.mode === "event") {
          const ev = this.rel(this.eventVec(m.card, p));
          val = ev; why = { key: "play_event", card: m.card, value: r2(ev) };
        } else { val = base.v; why = { key: "play_cp", card: m.card, kind: base.kind }; }
      } else {
        // an opponent's card, for CP
        const q = SEATS.indexOf(c.owner);
        const trig = this.wouldTrigger(q, m.card);
        const harm = trig ? this.rel(add3(this.eventVec(m.card, q), this.vMom(q, -1))) : 0;
        // 總幹事 picks the card by its CP alone, then blocks it if it is a big
        // one its owner would trigger; 操盤手 weighs the harm or the block's
        // cost into the choice of card itself.
        const big = trig && harm <= -2.5;
        if (m.block) {
          why = { key: "block_trigger", card: m.card, harm: r2(-harm) };
          if (lv === 2) val = big ? base.v : -99;
          else val = trig ? base.v - 2 * MOMV : -99;
        } else {
          val = base.v + (lv >= 3 ? harm : 0);
          why = trig ? { key: "play_cp", card: m.card, kind: base.kind } : { key: lv >= 3 ? "dodge_trigger" : "play_cp", card: m.card, kind: base.kind };
          if (lv === 2 && big && v.mom[p] >= 2) val -= 0.02; // the block above is the same card, blocked
        }
      }
      val += restV(c.cp);
      if (keep && keep.has(m.card)) val -= keep.get(m.card);
      opts.push({ m, val, why });
    }
    opts.sort((a, b) => b.val - a.val);
    const best = opts[0] || { m: legal[0], why: { key: "play_cp" } };
    return { move: best.m, why: best.why };
  }

  // 操盤手: the card(s) to keep for the pile being built, with the cost of
  // playing each instead. Turns 1–5: the debate pile, by CP (a local card
  // goes to any issue); turns 7–8: the election pile, by its county.
  keepPlan() {
    const v = this.v;
    if (v.turn === 6 || v.turn >= 9) return null;
    const hand = v.hand.filter((id) => !CARD[id].must);
    const plays = Math.max(0, HAND.play - v.step);
    const nKeep = Math.max(0, hand.length - plays);
    if (!nKeep || hand.length < 2) return null;
    const score = (id) => (v.turn <= 5 ? CARD[id].cp + (CARD[id].icon ? 0 : 0.2) : this.canvassScore(ci(CARD[id].county)));
    const ranked = hand.slice().sort((a, b) => score(b) - score(a));
    const keepN = Math.min(nKeep, ranked.length - 1);
    if (keepN <= 0) return null;
    const next = score(ranked[keepN]);
    const coef = v.turn <= 5 ? KEEP_CP : 1;
    const out = new Map();
    for (let i = 0; i < keepN; i++) out.set(ranked[i], coef * (score(ranked[i]) - next));
    return out;
  }
  // How much a card's county is worth for election-day canvassing.
  canvassScore(k) {
    const c = this.v.counties[k];
    let o = c.G + c.B + c.N;
    for (let x = 0; x < 3; x++) if (x !== this.p) o += c.v[x];
    return Math.min(o, 3) * 0.5 + (c.G + c.B + c.N + c.v[0] + c.v[1] + c.v[2]) * 0.02;
  }

  trigger(legal) {
    const card = this.v.pending.card;
    const ev = this.rel(this.eventVec(card, this.p));
    const go = this.lv >= 2 && ev - MOMV >= 0.3;
    const m = legal.find((x) => x.type === (go ? "trigger" : "pass"));
    return { move: m, why: { key: go ? "trigger_event" : "pass_trigger", card, value: r2(ev) } };
  }

  kind(legal) {
    const cp = this.v.pending.cp;
    const best = this.cpValue(cp);
    const kind = best.kind === "ads" ? "ads" : best.kind === "issue" ? "issue" : "campaign";
    return { move: legal.find((m) => m.kind === kind), why: { key: kind === "ads" ? "advertise" : kind === "issue" ? "issue_action" : "campaign", cp, value: r2(best.v) } };
  }

  campaign(legal) {
    const pd = this.v.pending, p = this.p;
    const here = this.v.pos[p], hereR = REG[here];
    const canMove = legal.some((m) => m.type === "move");
    if (canMove) {
      const stay = this.campaignValue(pd.cp, hereR);
      const go = this.campaignValue(pd.cp);
      if (go.r >= 0 && go.r !== hereR && go.v > stay.v + 0.05) {
        // the county in that region where the best operation is
        let bestK = -1, bestEv = -1e9;
        for (const k of INREG[go.r]) { const b = this.bestIn(p, k, { steal: this.lv >= 2 }); if (b && b.ev > bestEv) { bestEv = b.ev; bestK = k; } }
        const m = legal.find((x) => x.type === "move" && x.to === bestK) || legal.find((x) => x.type === "move" && REG[x.to] === go.r);
        if (m) return { move: m, why: { key: "move_region", region: REGIONS[go.r], county: COUNTIES[m.to][0], value: r2(go.v) } };
      }
    }
    let best = null;
    for (const m of legal) {
      if (m.type !== "fill" && m.type !== "cross" && m.type !== "steal") continue;
      if (this.lv === 1 && m.type === "steal") continue;
      const k = m.county, c = this.v.counties[k];
      let ops, pr;
      if (m.type === "fill") { ops = [["add", p, CAMP[p]]]; pr = this.pFill(p, k); }
      else if (m.type === "cross") { ops = [["add", p, OTHER(CAMP[p])]]; pr = this.pCross(p); }
      else { ops = [["rem", m.target, m.t]]; pr = this.share[p]; }
      const ev = this.ev(pr, this.rel(this.delta(k, ops)));
      if (!best || ev > best.ev) best = { m, ev, pr, c };
    }
    if (!best || best.ev <= 0.02) return { move: legal.find((m) => m.type === "done"), why: { key: "campaign_done", cp: pd.cp } };
    const m = best.m, name = COUNTIES[m.county][0];
    let key = m.type === "cross" ? "cross_fill" : m.type === "steal" ? "steal_cube" : "fill_open";
    if (m.type === "fill") {
      const c = best.c;
      const swing = p === CHEN ? c.v[CHEN] === 0 : Math.abs(c.v[SOONG] - c.v[LIEN]) <= 1;
      if (swing && this.lv >= 2) key = "fill_swing";
    }
    const why = { key, county: name, gain: r2(best.ev) };
    if (m.type === "steal") why.target = SEATS[m.target];
    return { move: m, why };
  }

  ads(legal) {
    const b = this.bestMedia();
    if (b && b.ev > 0) return { move: legal.find((m) => m.type === "ad"), why: { key: "ad_roll", cp: this.v.pending.cp } };
    return { move: legal.find((m) => m.type === "done"), why: { key: "ads_done" } };
  }

  mediaPick(legal, key = null) {
    let best = null;
    for (const m of legal) {
      const d = m.target == null ? this.mediaChange(m.region, this.p, 1) : this.mediaChange(m.region, m.target, -1);
      const ev = this.rel(d);
      if (!best || ev > best.ev) best = { m, ev };
    }
    const m = best.m;
    return { move: m, why: { key: key || (m.target == null ? "media_lead" : "media_cut"), region: REGIONS[m.region], gain: r2(best.ev) } };
  }

  issue(legal) {
    const pd = this.v.pending;
    const plan = this.issueValue(pd.cp, pd.placed);
    const done = legal.find((m) => m.type === "done");
    if (!plan.first) return { move: done, why: { key: "issue_done" } };
    const f = plan.first;
    const m = legal.find((x) => x.type === "issue" && x.issue === f.name && (f.target == null ? x.target == null : x.target === f.target));
    if (!m) return { move: done, why: { key: "issue_done" } };
    return { move: m, why: { key: f.tie ? "issue_tie" : "issue_lead", issue: f.name, gain: r2(plan.v) } };
  }

  // ----- event choices

  effect(legal) {
    const s = this.v.pending.fx.queue[0];
    const p = this.p;
    let best = null;
    for (const m of legal) {
      let ev;
      if (m.type === "fill" || m.type === "cross") {
        const t = m.type === "fill" ? CAMP[p] : OTHER(CAMP[p]);
        const pr = s.check ? (m.type === "cross" ? this.pCross(p) : this.pFill(p, m.county)) : 1;
        const undo = this.commit(m.county, [["add", p, t]]);
        let more = 0;
        if (s.then) for (const t2 of s.then) if (t2.op === "remove") more += this.rel(this.vRemove(p, t2.target, t2.left, { pool: [m.county] }));
        if (s.pick === "same" && s.left > 1) { const b = this.bestIn(p, m.county, { steal: false, cross: !s.own, check: s.check }); if (b) more += (s.left - 1) * Math.max(0, b.ev); }
        undo();
        ev = this.ev(pr, this.rel(this.delta(m.county, [["add", p, t]])) + more);
      } else if (m.type === "remove") {
        const pr = s.check ? this.share[p] : 1;
        const d = this.delta(m.county, [["rem", m.target, m.t]]);
        const undo = this.commit(m.county, [["rem", m.target, m.t]]);
        let more = 0;
        if (s.then) for (const t2 of s.then) if (t2.op === "place") { const b = this.bestIn(p, m.county, { steal: false, check: t2.check }); if (b) more += b.ev; }
        if (s.pick === "same" && s.left > 1) more += this.rel(this.vRemove(p, m.target, s.left - 1, { pool: [m.county] }));
        undo();
        ev = this.ev(pr, this.rel(d)) + (s.check ? this.share[p] : 1) * more;
        if (s.toBag) ev -= this.W[p][m.target] * BAGV;
      } else if (m.type === "convert") {
        ev = this.rel(this.delta(m.county, [["conv"]]));
      } else if (m.type === "media") {
        const d = m.target == null ? this.mediaChange(m.region, p, 1) : this.mediaChange(m.region, m.target, -1);
        ev = this.rel(d);
        if (s.pick === "same" && s.left > 1) ev *= 1.5;
      } else if (m.type === "pick") {
        ev = m.seat === p ? 10 : -this.W[p][m.seat];
      } else ev = 0;
      if (!best || ev > best.ev) best = { m, ev };
    }
    const m = best.m;
    const key = m.type === "remove" ? "effect_remove" : m.type === "convert" ? "effect_convert" : m.type === "media" ? "effect_media" : m.type === "pick" ? "effect_tvbs" : "effect_place";
    const why = { key, card: this.v.pending.fx.card, gain: r2(best.ev) };
    if (m.county != null) why.county = COUNTIES[m.county][0];
    if (m.region != null) why.region = REGIONS[m.region];
    if (m.type === "pick") why.seat = SEATS[m.seat];
    return { move: m, why };
  }

  // A free (or local-card) placement: fill / cross in one county.
  place(legal, key) {
    const p = this.p;
    const local = key === "local_place";
    let best = null;
    for (const m of legal) {
      const t = m.type === "fill" ? CAMP[p] : OTHER(CAMP[p]);
      const pr = local ? (m.type === "cross" ? this.pCross(p) : this.pFill(p, m.county)) : 1;
      const ev = this.ev(pr, this.rel(this.delta(m.county, [["add", p, t]])));
      if (!best || ev > best.ev) best = { m, ev };
    }
    return { move: best.m, why: { key, county: COUNTIES[best.m.county][0], gain: r2(best.ev) } };
  }

  // ----- momentum phase (§5.3)

  swap(legal) {
    if (this.lv === 1) return { move: legal.find((m) => m.type === "noswap"), why: { key: "no_swap" } };
    const base = this.rel(this.issueVec(this.v.issues));
    let best = { m: legal.find((m) => m.type === "noswap"), ev: base };
    for (const m of legal) {
      if (m.type !== "swap") continue;
      const is = this.v.issues.slice();
      [is[m.slot], is[m.slot + 1]] = [is[m.slot + 1], is[m.slot]];
      const ev = this.rel(this.issueVec(is));
      if (ev > best.ev + 1e-9) best = { m, ev };
    }
    const m = best.m;
    return { move: m, why: m.type === "swap" ? { key: "swap_issue", slot: m.slot + 1, gain: r2(best.ev - base) } : { key: "no_swap" } };
  }

  reward(legal) {
    let pick;
    if (this.lv === 1) pick = this.rng() < 0.5 ? "mom" : "endorse";
    else if (this.lv === 2) pick = this.v.mom[this.p] >= 2 ? "endorse" : "mom";
    else {
      // an endorsement: half of the grey blocks of a random region, if it is not taken again
      let g = 0;
      for (let r = 0; r < REGIONS.length; r++) for (const k of INREG[r]) g += Math.floor(this.v.counties[k].N / 2);
      const survive = this.v.turn >= 7 ? 0.85 : this.v.turn >= 4 ? 0.6 : 0.45;
      const endV = (g / REGIONS.length) * survive * 1.3;
      pick = endV > MOMV ? "endorse" : "mom";
    }
    return { move: legal.find((m) => m.pick === pick), why: { key: pick === "mom" ? "reward_momentum" : "reward_endorse" } };
  }

  // ----- saving

  save(legal) {
    if (legal.length === 1) return { move: legal[0], why: { key: "only_move" } };
    const v = this.v;
    if (this.lv === 1 || (this.lv === 2 && v.turn <= 5)) return { move: this.pickRandom(legal), why: { key: "save_random" } };
    let best = null;
    for (const m of legal) {
      const s = m.cards.reduce((a, id) => a + (v.turn <= 5 ? CARD[id].cp + (CARD[id].icon ? 0 : 0.2) : this.canvassScore(ci(CARD[id].county))), 0);
      if (!best || s > best.s) best = { m, s };
    }
    return { move: best.m, why: v.turn <= 5 ? { key: "save_high_cp", cp: best.m.cards.reduce((a, id) => a + CARD[id].cp, 0) } : { key: "save_county", county: CARD[best.m.cards[0]].county } };
  }

  // ----- the debate (turn 6)

  debate(legal) {
    const d = this.v.debate, p = this.p;
    const sums = (name) => d.placed[name].map((cards) => cards.reduce((s, id) => s + CARD[id].cp, 0));
    if (this.lv <= 2) {
      // highest CP first, on a live issue; a local card where it helps most
      let best = null;
      for (const m of legal) {
        const c = CARD[m.card];
        if (d.settled.includes(m.issue)) { const v = -10 - c.cp; if (!best || v > best.v) best = { m, v }; continue; }
        const S = sums(m.issue), mine = S[p] + c.cp, other = Math.max(...S.filter((_, q) => q !== p));
        const v = c.cp * 10 + (c.icon ? 0 : mine - other + (d.placed[m.issue][p].length === 1 ? 2 : 0));
        if (!best || v > best.v) best = { m, v };
      }
      return { move: best.m, why: { key: "debate_card", card: best.m.card, issue: best.m.issue } };
    }
    // 操盤手: settle what it can win, build where it cannot settle yet, dump on dead issues
    const award = 2 + d.settled.length;
    const prio = [0, 1, 2].map((i) => (Math.max(0, this.v.initiative) + i) % 3);
    const beats = (a, sa, b, sb) => sa > sb || (sa === sb && prio.indexOf(a) < prio.indexOf(b));
    const myLeft = this.v.savedDebate.length;
    let best = null;
    for (const m of legal) {
      const c = CARD[m.card];
      let v;
      if (d.settled.includes(m.issue)) v = -3 - 0.5 * c.cp; // a dead card: the lowest one
      else {
        const S = sums(m.issue), n = d.placed[m.issue].map((x) => x.length);
        const mine = S[p] + c.cp;
        let rival = -1;
        for (let q = 0; q < 3; q++) if (q !== p && (rival < 0 || beats(q, S[q], rival, S[rival]))) rival = q;
        const prize = (award + (myLeft > 2 ? 0.5 : 0)) * 0.95 + MOMV;
        const others = [0, 1, 2].filter((q) => q !== p && this.v.pileCounts[q] > 0).length;
        const open = Math.max(1, this.v.issues.length - d.settled.length);
        // chance another seat adds about 2.7 CP here this round
        const pAdd = Math.min(0.9, others / open * 0.6);
        if (n[p] + 1 >= 2) {
          const winNow = beats(p, mine, rival, S[rival]);
          const winAdd = beats(p, mine, rival, S[rival] + 2.7);
          const pw = winNow ? (winAdd ? 1 : 1 - pAdd * 0.6) : 0.05;
          v = pw * prize - (1 - pw) * prize * this.W[p][rival];
        } else {
          // one card down: whoever adds next settles it; a big card here is a threat
          const lead = mine - Math.max(...S.filter((_, q) => q !== p));
          v = 0.35 * lead + 0.15 * c.cp - (n.some((x, q) => q !== p && x >= 1) ? 0.2 : 0);
        }
        // spend low cards first when nothing is at stake
        v -= 0.05 * c.cp;
      }
      if (!best || v > best.v) best = { m, v };
    }
    return { move: best.m, why: { key: "debate_card", card: best.m.card, issue: best.m.issue, value: r2(best.v) } };
  }

  // ----- election day (turn 9)

  canvassCard(legal) {
    if (this.lv === 1) return { move: legal[0], why: { key: "canvass_card", card: legal[0].card } };
    let best = null;
    for (const m of legal) {
      const k = ci(CARD[m.card].county);
      const b = this.bestIn(this.p, k, { check: false, grey: true });
      const v = b ? b.ev : 0;
      if (!best || v > best.v) best = { m, v };
    }
    return { move: best.m, why: { key: "canvass_card", card: best.m.card, county: CARD[best.m.card].county } };
  }

  canvass(legal) {
    const p = this.p;
    let best = null;
    for (const m of legal) {
      let ops;
      if (m.type === "fill") ops = [["add", p, CAMP[p]]];
      else if (m.type === "cross") ops = [["add", p, OTHER(CAMP[p])]];
      else if (m.type === "grey") ops = [["add", p, "N"]];
      else ops = [["rem", m.target, m.t]];
      if (this.lv === 1 && m.type === "remove") continue;
      const ev = this.rel(this.delta(m.county, ops));
      if (!best || ev > best.ev) best = { m, ev, ops };
    }
    if (!best) best = { m: legal[0], ev: 0, ops: [] };
    const m = best.m;
    let key = m.type === "remove" ? "canvass_remove" : "canvass_place";
    if (this.lv >= 3 && (p !== CHEN || m.type === "remove")) {
      // does the move change where the county's empty blue blocks go?
      const c = this.v.counties[m.county];
      const flowTo = (v) => { const g = v[SOONG] - v[LIEN]; return Math.abs(g) >= 2 ? (g > 0 ? SOONG : LIEN) : -1; };
      const after = c.v.slice();
      for (const [kind, q] of best.ops) after[q] += kind === "add" ? 1 : -1;
      if (c.B > 0 && flowTo(after) !== flowTo(c.v)) key = "hold_gap";
    }
    const why = { key, county: COUNTIES[m.county][0], gain: r2(best.ev) };
    if (m.type === "remove") why.target = SEATS[m.target];
    return { move: m, why };
  }
}

// ------------------------------------------------------------------ event values (§14.3)
//
// Each card's event as a value vector [陳, 宋, 連] in projected votes, for the
// seat `by` resolving it; the choices inside follow the program in engine.js
// (the chooser places / removes as it would). Kept in the order of cards.js.
const placeAt = (b, q, name, n, o = {}) => b.vPlace(q, n, { pool: [ci(name)], pick: "same", ...o });
const sum = (...vs) => vs.reduce((a, x) => add3(a, x), [0, 0, 0]);
const freeTurn = (b, q, per) => { const V = [0, 0, 0]; V[q] = per * Math.max(0, b.playsLeft(q)); return V; };
const EV = {
  // 陳
  taiwan_son: (b) => b.vPlace(CHEN, 3, { pool: SOUTH }),
  new_middle: (b) => sum(b.vIssue(["cross", CHEN, 2]), [0.3, 0, 0]),
  alternation: (b) => b.vMom(CHEN, 2),
  sweep_black_gold: (b) => b.vIssue(["clean", CHEN, 2], ["clean", LIEN, -1]),
  future_resolution: (b) => {
    let best = [0, 0, 0], bv = 0;
    for (let k = 0; k < NC; k++) if (b.v.counties[k].N > 0) { const d = b.delta(k, [["conv"]]); const ev = b.rel(d, CHEN); if (ev > bv) { bv = ev; best = d; } }
    return sum(b.vIssue(["cross", CHEN, 1]), best);
  },
  lu_running_mate: (b) => placeAt(b, CHEN, "桃園縣", 2),
  lo_propaganda: (b) => b.vMedia(CHEN, 2),
  hsieh_kaohsiung: (b) => sum(placeAt(b, CHEN, "高雄市", 2), b.mediaChange(REGIONS.indexOf("高屏"), CHEN, 1)),
  dpp_counties: (b) => b.vPlace(CHEN, 3, { pool: DPP97, check: true }),
  three_three_three: (b) => sum(b.vIssue(["econ", CHEN, 2]), b.vPlace(CHEN, 1, { own: true, check: true })),
  no_nuke4: (b) => sum(b.vIssue(["econ", CHEN, 1], ["econ", LIEN, -1]), b.vMom(SOONG, 1)),
  lin_chairman: (b) => sum(b.vIssue(["clean", CHEN, 1]), b.vMom(CHEN, 1)),
  lee_yuan_tseh: (b) => sum(b.vMom(CHEN, 2), freeTurn(b, CHEN, 0.35)),
  advisory_group: (b) => sum(b.vIssue(["clean", CHEN, 1], ["econ", CHEN, 1]), b.vMedia(CHEN, 1, { pool: [REGIONS.indexOf("中彰投"), REGIONS.indexOf("北北基")] })),
  million_rally: (b) => sum(b.vPlace(CHEN, 3), b.vMom(CHEN, 1)),
  dump_lien_save_chen: (b) => b.vSwap(CHEN, LIEN),
  hsu_wen_long: (b) => sum(placeAt(b, CHEN, "台南縣", 1), placeAt(b, CHEN, "台南市", 1)),
  chang_yung_fa: (b) => sum(b.vMedia(CHEN, 1), b.vBag(CHEN, 2)),
  south_rally: (b) => b.vPlace(CHEN, 2, { pool: INREG[4] }),
  chang_chiu: (b) => sum(b.vBag(CHEN, 3), b.vMom(CHEN, 1)),
  // 宋
  diligent: (b) => b.vPlace(SOONG, 3),
  walk_everywhere: (b) => freeTurn(b, SOONG, 0.45),
  chang_running_mate: (b) => { const V = [0, 0, 0]; V[SOONG] = 0.4 * Math.min(2, b.playsLeft(SOONG)); return V; },
  poll_lead: (b) => b.vMom(SOONG, 2),
  million_signatures: (b) => sum(b.vBag(SOONG, 3), b.vMom(SOONG, 1)),
  hakka_vote: (b) => sum(placeAt(b, SOONG, "新竹縣", 1), placeAt(b, SOONG, "苗栗縣", 1)),
  east_coast: (b) => sum(placeAt(b, SOONG, "花蓮縣", 1), placeAt(b, SOONG, "台東縣", 1)),
  veterans_village: (b) => sum(b.vPlace(SOONG, 2, { check: true }), b.vRemove(SOONG, LIEN, 1)),
  quake_bond: (b) => sum(placeAt(b, SOONG, "南投縣", 1), placeAt(b, SOONG, "台中縣", 1)),
  li_ao_endorses: (b) => sum(b.vRemove(SOONG, LIEN, 1, { pool: [ci("台北市")] }), placeAt(b, SOONG, "台北市", 1), b.vRemove(SOONG, LIEN, 1, { pool: [ci("新竹市")] }), placeAt(b, SOONG, "新竹市", 1)),
  provincial_staff: (b) => sum(b.mediaChange(REGIONS.indexOf("中彰投"), SOONG, 1), [0, 0, -BAGV * Math.min(2, b.playsLeft(LIEN))]),
  lee_authorized: (b) => sum(b.vPlace(SOONG, Math.floor((b.yang || 4) / 2), { own: true, pick: "free", fromBag: true }), b.vIssue(["clean", SOONG, 1])),
  dump_lien_save_soong: (b) => b.vSwap(SOONG, LIEN),
  new_party_backs_soong: (b) => b.vPlace(SOONG, 2, { pool: INREG[0] }),
  chang_doctors: (b) => sum(b.vMedia(SOONG, 1), b.vBag(SOONG, 2)),
  soong_friends: (b) => sum(b.vMom(SOONG, 1), b.vPlace(SOONG, 1, { own: true })),
  kneel_for_votes: (b) => sum(b.vMom(SOONG, 2), b.vPlace(SOONG, 2, { check: true })),
  provincial_build: (b) => b.vIssue(["econ", SOONG, 2]),
  military_civil: (b) => sum(b.vPlace(SOONG, 2, { check: true }), b.vBag(SOONG, 1)),
  hsu_hsin_liang: (b) => sum(b.vRemove(SOONG, CHEN, 1), b.vMom(SOONG, 1)),
  // 連
  expel_soong: (b) => sum(b.vMedia(LIEN, 2, { target: SOONG }), b.vMom(SOONG, 1)),
  yang_exposes: (b) => {
    const V = b.vRemove(LIEN, SOONG, 4, { pick: "free", toBag: true });
    const clean = b.v.issues.find((i) => i.name === "clean").cubes[SOONG];
    return sum(V, b.vIssue(["clean", SOONG, -clean]), b.vMom(SOONG, -b.v.mom[SOONG]));
  },
  shifting_story: (b) => sum(b.vRemove(LIEN, SOONG, 2, { pick: "free", toBag: true }), b.vMom(LIEN, 1)),
  party_machine: (b) => b.vPlace(LIEN, 3),
  party_assets_ads: (b) => b.vMedia(LIEN, 2),
  lien_siew: (b) => b.vIssue(["econ", LIEN, 2]),
  hand_in_hand: (b) => sum(b.vMom(LIEN, 1), b.vIssue(["econ", LIEN, 1])),
  lee_campaigns: (b) => b.vPlace(LIEN, 2),
  lee_attacks_soong: (b) => sum(b.vRemove(LIEN, SOONG, 2, { pick: "same" }), b.vMom(SOONG, 1)),
  stability: (b) => b.vIssue(["cross", LIEN, 2]),
  local_factions: (b) => b.vBag(LIEN, 4),
  farmers_association: (b) => sum(placeAt(b, LIEN, "雲林縣", 1), placeAt(b, LIEN, "彰化縣", 1)),
  ma_campaigns: (b) => placeAt(b, LIEN, "台北市", 2, { check: true }),
  party_unity: (b) => b.vSwap(LIEN, SOONG),
  massive_ads: (b) => b.vMedia(LIEN, 3),
  ma_leaks_polls: (b) => sum(b.vPlace(LIEN, 2, { check: true }), b.vMom(SOONG, 1), b.vMom(CHEN, 1)),
  lee_alarm: (b) => b.vPlace(LIEN, 3, { check: true }),
  party_congress: (b) => sum(b.vBag(LIEN, 4), b.vMom(LIEN, 1)),
  members_return: (b) => b.vRemove(LIEN, SOONG, 2, { check: true }),
  econ_cabinet: (b) => sum(b.vIssue(["econ", LIEN, 1]), b.vBag(LIEN, 2)),
  kmt_anniversary: (b) => sum(b.vMom(LIEN, 1), b.vIssue(["cross", LIEN, 1])),
  // 外力
  poll_published: (b) => { const l = leaderOf(b.v.issues[0].cubes); return l >= 0 ? b.vMom(l, 1) : [0, 0, 0]; },
  strait_tension: (b) => sum(b.vIssue(...[0, 1, 2].filter((q) => !(q === CHEN && b.v.active.includes("new_middle"))).map((q) => ["cross", q, -1])), b.vMom(CHEN, 1)),
  white_paper: (b) => sum(b.vIssue(["cross", CHEN, 1]), b.vMom(CHEN, 1)),
  zhu_rongji: (b) => sum(b.vPlace(CHEN, 3), b.vMom(CHEN, 1)),
  us_congress: (b) => b.vIssue(["cross", CHEN, 1], ["cross", LIEN, 1]),
  stock_crash: (b) => sum(b.vIssue(["econ", LIEN, 1]), b.vMom(0, -1), b.vMom(1, -1), b.vMom(2, -1)),
  lee_secret_help: (b) => sum(b.vPlace(CHEN, 2), b.vMom(LIEN, -1)),
  tvbs_poll: (b, by) => { const min = Math.min(...b.v.mom); const lows = [0, 1, 2].filter((q) => b.v.mom[q] === min); const q = lows.includes(by) ? by : lows[0]; return b.vMom(q, 1); },
  pla_drill_rumor: (b) => sum(b.vIssue(["cross", LIEN, 1], ["cross", SOONG, 1]), b.vMom(CHEN, -1)),
};

// ------------------------------------------------------------------ entry

export function chooseMove(st, seat, level, rng) {
  const legal = E.legalMoves(st, seat);
  if (!legal.length) throw new Error(`bots: seat ${seat} has nothing to do in phase ${st.phase}`);
  if (legal.length === 1) return { move: legal[0], why: { key: "only_move" } };
  const bot = new Bot(st, seat, level === 1 || level === 2 ? level : 3, rng);
  if (st.flags && typeof st.flags.yangReturned === "number") bot.yang = st.flags.yangReturned; // public: 爆料's count
  const out = bot.decide(legal);
  if (!out || !out.move || !legal.includes(out.move)) throw new Error(`bots: no decision in phase ${st.phase} (${st.pending ? st.pending.stage : "-"})`);
  return out;
}
