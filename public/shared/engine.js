// The engine: pure, seeded, runs in the browser (solo) and in the Durable
// Object (rooms). Rules follow rulebook v0.2 as excerpted in issue #1 and the
// v0.3 changes in #2 (hand 5/4/1/0 and 6/4/2/0, 75-card early deck), plus the
// orchestrator's rulings there (cited as "裁決 N").
//
// Contract (issue #1 §五): createGame / legalMoves / apply / mustAct /
// effectImplemented / view / clone / makeRng. `apply` never mutates its input;
// every random draw comes from st.rng; derived values (bosses, media and issue
// leaders) are recomputed from the state fields on every use, never cached.
//
// M1 scope (#1): the ordinary turn (turns 1–5, 7–8) from initiative to saving,
// 16 choice-free event effects and local cards as events; #4 adds 46 more
// (5 choice-free, 41 that need a choice); #5 the last 8 (興票案 and the
// 本回合 flags, with st.active), so all 70 exist. #6 adds the debate (turn 6,
// phase "debate") with the first strategic vote and the early set-aside.
// #8 adds election day (turn 9, phase "election"): conversion, the canvassing
// order, canvassing, the second strategic vote, endorsements and the count;
// the game ends in phase "end" with st.result.
import { COUNTIES, REGIONS, REGION_EDGES, START_COUNTY, START_MOMENTUM, START_MEDIA, BAG_SEED, BOSS_THRESHOLD, ISSUES, TURNS, SEATS, CAMP, countyIndex } from "./board.js";
import { EVENTS, localCards, HAND, CANDIDATE_CARDS, REST_CUBES } from "./cards.js";

const CHEN = 0, SOONG = 1, LIEN = 2;

// mulberry32: the state carries the RNG so games replay from seed + actions.
export function makeRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, int: (n) => Math.floor(next() * n), get state() { return a; }, set state(v) { a = v >>> 0; } };
}
export const clone = (x) => JSON.parse(JSON.stringify(x));

function shuffle(rng, arr) {
  for (let i = arr.length - 1; i > 0; i--) { const j = rng.int(i + 1); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}
// Run fn with an RNG resumed from st.rng and write its state back.
function withRng(st, fn) {
  const rng = makeRng(0); rng.state = st.rng;
  const out = fn(rng);
  st.rng = rng.state;
  return out;
}

// Every card has a county for election-day canvassing (§14.2). Since #7 all
// 70 events and the locals carry a printed county in cards.js (24 counties,
// every one at least once; group 0 guards it), so this loop skips them all.
// The block-weighted draw stays only as a fallback for a card without one;
// the RNG calls are unchanged (it draws nothing when every card has a county).
function assignCounties(rng, cards) {
  const total = COUNTIES.reduce((s, c) => s + c[2] + c[3] + c[4], 0);
  for (const card of cards) {
    if (card.county) continue;
    let r = rng.next() * total;
    for (const c of COUNTIES) { r -= c[2] + c[3] + c[4]; if (r < 0) { card.county = c[0]; break; } }
    if (!card.county) card.county = COUNTIES[COUNTIES.length - 1][0];
  }
  return cards;
}

export function allCards() { return EVENTS.map((e) => ({ ...e })).concat(localCards()); }
const CARD = Object.fromEntries(allCards().map((c) => [c.id, c]));

// ------------------------------------------------------------------ setup

const START_TURNS = [1, 2, 3, 4, 5, 7, 8];

// opts.startTurn (裁決 16): the same opening board, starting at that turn
// (7 and 8 deal from the late deck; the saved piles are empty). An entry for
// tests and M2, not a rule.
export function createGame(seed, opts = {}) {
  const startTurn = opts.startTurn ?? 1;
  if (!START_TURNS.includes(startTurn)) throw new Error("createGame: startTurn must be one of " + START_TURNS.join("/"));
  const rng = makeRng(seed);
  const counties = COUNTIES.map(([name, region, G, B, N, init]) => {
    const blocks = [];
    for (let k = 0; k < G; k++) blocks.push({ t: "G", o: -1 });
    for (let k = 0; k < B; k++) blocks.push({ t: "B", o: -1 });
    for (let k = 0; k < N; k++) blocks.push({ t: "N", o: -1 });
    for (let p = 0; p < 3; p++) {
      let n = init[p];
      for (const b of blocks) { if (!n) break; if (b.o < 0 && b.t === CAMP[p]) { b.o = p; n--; } }
    }
    return { name, region, blocks };
  });
  const cards = assignCounties(rng, allCards());
  const byId = Object.fromEntries(cards.map((c) => [c.id, c]));
  const st = {
    seed, rng: 0, turn: startTurn - 1, phase: "setup", step: 0, idx: 0,
    counties,
    pos: SEATS.map((s) => countyIndex(START_COUNTY[s])),
    mom: START_MOMENTUM.slice(),
    bag: [BAG_SEED, BAG_SEED, BAG_SEED],
    rest: [0, 0, 0],
    media: START_MEDIA.map((m) => m.slice()),
    issues: shuffle(rng, ISSUES.slice()).map((name) => ({ name, cubes: [0, 0, 0] })),
    endorse: REGIONS.map(() => -1),
    endorseDeck: shuffle(rng, [0, 1, 2, 3, 4, 5, 6, 0, 1, 2, 3, 4, 5, 6]),
    endorseDiscard: [],
    decks: {
      early: shuffle(rng, cards.filter((c) => c.deck === "early").map((c) => c.id)),
      late: shuffle(rng, cards.filter((c) => c.deck === "late").map((c) => c.id)),
      discard: [],
      earlyDiscard: [], // #6: the early discard pile, set aside at the end of turn 6
    },
    removed: [],
    debate: null, // #6: the debate board while turn 6 is on (startDebate)
    election: null, // #8: election day (startElection): pre-conversion momentum, the card being canvassed
    result: null, // #8: { votes, leads, momentum, winner } once phase is "end"
    active: [], // #5: 本回合 cards still in effect this turn
    cards: byId,
    hands: [[], [], []],
    savedDebate: [[], [], []],
    savedElection: [[], [], []],
    saved: [false, false, false],
    candidateUsed: [false, false, false],
    // played: events resolved so far (cond); crossFree: 張昭雄搭檔's waivers
    // left this turn; yangReturned: cubes 楊吉雄爆料 sent to the bag (#5)
    flags: { played: {}, crossFree: [0, 0, 0], yangReturned: 0 },
    order: [0, 1, 2],
    initiative: -1,
    actor: -1,
    pending: null,
    mstep: null,
    log: [],
  };
  st.rng = rng.state;
  return beginTurn(st);
}

// §5.1, §10 (v0.3): deal to 5 (turns 1–5) or 6 (turns 7–8) from the current
// deck, then the initiative check; the holder then picks a position (phase
// "order"). The early deck holds 75 = 5 turns x 3 seats x 5 and the late deck
// 36 = 2 x 3 x 6, so the normal flow never reshuffles; the reshuffle of the
// discard pile (§14.1) stays as the safety net.
//
// #6 (§14.1, 裁決 11): in turns 7–8 a dry late deck takes, in this order, the
// late discard pile, then the early discard pile set aside after turn 6
// (decks.earlyDiscard), then whatever is left of the early deck. Only when all
// of those are empty does a hand stay short.
function beginTurn(st) {
  st.turn += 1;
  const deckName = st.turn <= 5 ? "early" : "late";
  const deal = st.turn <= 5 ? HAND.dealEarly : HAND.dealLate;
  withRng(st, (rng) => {
    for (let p = 0; p < 3; p++) {
      while (st.hands[p].length < deal) {
        const deck = st.decks[deckName];
        if (!deck.length) {
          if (st.decks.discard.length) {
            st.log.push({ t: "reshuffle", deck: deckName, n: st.decks.discard.length });
            deck.push(...shuffle(rng, st.decks.discard.splice(0)));
          } else if (deckName === "late" && st.decks.earlyDiscard.length) {
            st.log.push({ t: "reshuffle", deck: deckName, from: "earlyDiscard", n: st.decks.earlyDiscard.length });
            deck.push(...shuffle(rng, st.decks.earlyDiscard.splice(0)));
          } else if (deckName === "late" && st.decks.early.length) {
            st.hands[p].push(st.decks.early.pop());
            continue;
          } else break;
        }
        st.hands[p].push(deck.pop());
      }
    }
    st.initiative = initiativeCheck(st, rng);
  });
  st.phase = "order"; st.step = 0; st.idx = 0; st.actor = -1; st.pending = null; st.mstep = null;
  st.saved = [false, false, false];
  st.log.push({ t: "turn", turn: st.turn, initiative: st.initiative });
  return st;
}

// §5.1 (2) with 裁決 1: draw one cube at a time and set it aside until some
// colour shows for the second time; then every drawn cube goes back. If the
// bag runs dry on the way, each player puts 12 in (§8.2) and the draw goes on.
function initiativeCheck(st, rng) {
  const aside = [0, 0, 0];
  let winner = -1;
  for (let k = 0; k < 100 && winner < 0; k++) {
    if (st.bag[0] + st.bag[1] + st.bag[2] === 0) refill(st);
    const col = drawColour(st.bag, rng);
    st.bag[col]--; aside[col]++;
    if (aside[col] === 2) winner = col;
  }
  for (let p = 0; p < 3; p++) st.bag[p] += aside[p];
  st.log.push({ t: "initiative", seat: winner });
  return winner;
}

function drawColour(bag, rng) {
  let r = rng.next() * (bag[0] + bag[1] + bag[2]);
  for (let col = 0; col < 3; col++) { r -= bag[col]; if (r < 0 && bag[col] > 0) return col; }
  return bag[2] > 0 ? 2 : bag[1] > 0 ? 1 : 0;
}

function refill(st) {
  for (let p = 0; p < 3; p++) st.bag[p] += BAG_SEED;
  st.log.push({ t: "refill" });
}

// §8: draw one cube. Own colour: success, the cube goes back. Another colour:
// failure, that cube goes back to its owner's supply (out of the bag).
function supportCheck(st, seat) {
  return withRng(st, (rng) => {
    if (st.bag[0] + st.bag[1] + st.bag[2] === 0) refill(st);
    const drew = drawColour(st.bag, rng);
    const ok = drew === seat;
    if (!ok) st.bag[drew]--;
    st.log.push({ t: "check", seat, drew, ok });
    return ok;
  });
}

// ------------------------------------------------------------------ derived values (never cached)

// The unique maximum, or -1 on a tie or when nobody has any (§3.4).
function leader(arr) {
  let best = -1, max = 0, tie = false;
  for (let p = 0; p < 3; p++) {
    if (arr[p] > max) { max = arr[p]; best = p; tie = false; } else if (arr[p] === max && max > 0) tie = true;
  }
  return tie ? -1 : best;
}
const cubesIn = (st, k, p) => st.counties[k].blocks.filter((b) => b.o === p).length;
const regionOf = (k) => COUNTIES[k][1];
const regionMediaLeader = (st, r) => leader(st.media[r]);
const nationalMediaLeader = (st) => leader([0, 1, 2].map((p) => st.media.reduce((s, m) => s + m[p], 0)));
// 裁決 5: every seat with ≥ 4 cubes in the county is a boss there.
const bosses = (st, k) => [0, 1, 2].filter((p) => cubesIn(st, k, p) >= BOSS_THRESHOLD);
const otherCamp = (seat) => (CAMP[seat] === "G" ? "B" : "G");
const emptyOf = (st, k, t) => st.counties[k].blocks.some((b) => b.o < 0 && b.t === t);

// §8.1: does placing on a block of `seat`'s own camp in county k need a check?
// (Cross-camp fills and steals always do.) Regional media advantage waives
// the boss and opposing-candidate checks.
function fillNeedsCheck(st, seat, k) {
  if (ownCampFree(st, seat)) return false; // #5: 李遠哲挺扁 / 走透透 this turn
  if (regionMediaLeader(st, regionOf(k)) === seat) return false;
  if (bosses(st, k).some((p) => p !== seat)) return true;
  if ([0, 1, 2].some((p) => p !== seat && st.pos[p] === k)) return true;
  return false;
}

function regionDistance(a, b) {
  if (a === b) return 0;
  const dist = REGIONS.map(() => -1); dist[a] = 0;
  const q = [a];
  while (q.length) {
    const x = q.shift();
    for (const [u, v] of REGION_EDGES) {
      const y = u === x ? v : v === x ? u : -1;
      if (y >= 0 && dist[y] < 0) { dist[y] = dist[x] + 1; q.push(y); }
    }
  }
  return dist[b];
}
// §7.1, §13: 1 CP per region boundary crossed; 宋 pays a flat 1 to leave his region.
function moveCost(seat, from, to) {
  const d = regionDistance(regionOf(from), regionOf(to));
  return seat === SOONG ? Math.min(d, 1) : d;
}

// §6.4: 連 rests one more per card, except in a turn of 省府舊部 (#5 裁決 10).
function restFor(st, seat, cp) { return REST_CUBES[cp] + (seat === LIEN && !activeHas(st, "provincial_staff") ? 1 : 0); }

// ------------------------------------------------------------------ events

const issueCubes = (st, name) => st.issues.find((i) => i.name === name).cubes;
const addIssue = (st, name, p, n) => { const c = issueCubes(st, name); c[p] = Math.max(0, c[p] + n); };
const addMom = (st, p, n) => { st.mom[p] = Math.max(0, st.mom[p] + n); };

// §14.3: the 16 effects that need no choice (#1 §三). `−1` never goes below 0.
const EFFECTS = {
  alternation: (st) => addMom(st, CHEN, 2),
  sweep_black_gold: (st) => { addIssue(st, "clean", CHEN, 2); addIssue(st, "clean", LIEN, -1); },
  no_nuke4: (st) => { addIssue(st, "econ", CHEN, 1); addIssue(st, "econ", LIEN, -1); addMom(st, SOONG, 1); },
  lin_chairman: (st) => { addIssue(st, "clean", CHEN, 1); addMom(st, CHEN, 1); },
  poll_lead: (st) => addMom(st, SOONG, 2),
  million_signatures: (st) => { st.bag[SOONG] += 3; addMom(st, SOONG, 1); },
  lien_siew: (st) => addIssue(st, "econ", LIEN, 2),
  hand_in_hand: (st) => { addMom(st, LIEN, 1); addIssue(st, "econ", LIEN, 1); },
  stability: (st) => addIssue(st, "cross", LIEN, 2),
  local_factions: (st) => { st.bag[LIEN] += 4; },
  party_congress: (st) => { st.bag[LIEN] += 4; addMom(st, LIEN, 1); },
  poll_published: (st) => { const p = leader(st.issues[0].cubes); if (p >= 0) addMom(st, p, 1); },
  // 外力: 新中間路線 shields 陳's cubes this turn (#5 裁決 7); the momentum still moves.
  strait_tension: (st) => { for (let p = 0; p < 3; p++) if (!extShielded(st, p)) addIssue(st, "cross", p, -1); addMom(st, CHEN, 1); },
  white_paper: (st) => { addIssue(st, "cross", CHEN, 1); addMom(st, CHEN, 1); },
  us_congress: (st) => { addIssue(st, "cross", CHEN, 1); addIssue(st, "cross", LIEN, 1); },
  stock_crash: (st) => { addIssue(st, "econ", LIEN, 1); for (let p = 0; p < 3; p++) addMom(st, p, -1); },
  // v0.3 (#4): the five new cards that need no choice
  chang_chiu: (st) => { st.bag[CHEN] += 3; addMom(st, CHEN, 1); },
  provincial_build: (st) => addIssue(st, "econ", SOONG, 2),
  econ_cabinet: (st) => { addIssue(st, "econ", LIEN, 1); st.bag[LIEN] += 2; },
  kmt_anniversary: (st) => { addMom(st, LIEN, 1); addIssue(st, "cross", LIEN, 1); },
  pla_drill_rumor: (st) => { addIssue(st, "cross", LIEN, 1); addIssue(st, "cross", SOONG, 1); addMom(st, CHEN, -1); },
  // #5: the 本回合 cards. Their lasting part is a flag read from st.active
  // (THIS_TURN below); what resolves now is here.
  new_middle: (st) => addIssue(st, "cross", CHEN, 2),
  lee_yuan_tseh: (st) => addMom(st, CHEN, 2),
  walk_everywhere: () => {},
  chang_running_mate: (st) => { st.flags.crossFree[SOONG] = 2; }, // #5 裁決 9: the first 2
  provincial_staff: (st) => { st.media[REGIONS.indexOf("中彰投")][SOONG]++; },
};

// ------------------------------------------------------------------ 本回合 flags (#5)
//
// A 本回合 card stays in st.active from its resolution until the turn ends
// (#5 裁決 6: after saving, before the next deal), then goes to removed. The
// flag belongs to the card's owner, who is also its beneficiary, however it
// was resolved (played or triggered, 裁決 11). The flags are derived from
// st.active on every use; only 張昭雄搭檔's count of 2 is a counter
// (st.flags.crossFree), reset with the turn.
const THIS_TURN = new Set(["new_middle", "lee_yuan_tseh", "walk_everywhere", "chang_running_mate", "provincial_staff"]);
const activeHas = (st, id) => st.active.includes(id);
// 新中間路線: 外力 events remove none of 陳's cubes (裁決 7).
const extShielded = (st, p) => p === CHEN && activeHas(st, "new_middle");
// 李遠哲挺扁 / 走透透: every own-camp placement is free of checks (裁決 8, Q6 default A).
const ownCampFree = (st, seat) => (seat === CHEN && activeHas(st, "lee_yuan_tseh")) || (seat === SOONG && activeHas(st, "walk_everywhere"));
// 張昭雄搭檔: a cross-camp placement that would be checked uses one of the 2
// waivers instead (裁決 9). Returns true when the waiver was used.
function useCrossWaiver(st, seat) {
  if (st.flags.crossFree[seat] > 0) { st.flags.crossFree[seat]--; st.log.push({ t: "waive", seat, card: "chang_running_mate" }); return true; }
  return false;
}
// A cross-camp placement by `seat` that needs a check: waived, or checked.
const crossCheck = (st, seat) => useCrossWaiver(st, seat) || supportCheck(st, seat);

// The turn is over: the 本回合 cards leave the game and their flags end.
function endTurnFlags(st) {
  if (st.active.length) st.log.push({ t: "expire", cards: st.active.slice() });
  st.removed.push(...st.active.splice(0));
  st.flags.crossFree = [0, 0, 0];
}

// ------------------------------------------------------------------ events that need a choice (#4)
//
// An effect is a program: a queue of steps run in the order of the card text
// (#4 裁決 1). Automatic steps (momentum, issue, bag, a named region's media)
// resolve at once; a choice step asks its `seat` (#4 裁決 4: the card's owner,
// or for 外力 cubes the seat whose cubes they are; TVBS 民調's tie goes to the
// player) until it has made `left` picks or has no legal pick left, which skips
// it (#4 裁決 3, 8). The queue lives in st.pending.fx, so it is plain data.
//
// Choice steps (op): place (an empty floating block, own camp `fill` or the
// other camp `cross`; never grey — 裁決 5), remove (a target's cube, back to
// supply), convert (an empty grey block becomes an empty green one — 裁決 9),
// media (own media cube; `target` removes one of the target's), tvbs.
// `pool` limits the counties (or regions) offered; `pick` is "distinct" (a
// county or region picked once is used, success or not — 裁決 2), "same"
// (every pick in the first one's county or region — 裁決 7, 14) or "free".
// `check`: place — §8.1 (cross always, own camp on bosses / opposing candidate
// unless the region's media leader); remove — one support check per cube (#4
// 裁決 6, Q5 default). `then`: steps run in the picked county right after each
// pick. `fallback`: steps run instead when the step had no pick at all.
// Event cubes ignore the candidate's position and media cubes never check
// (裁決 5, 7). #5 adds: remove `toBag` (the cube goes into its owner's bag,
// §8.2, not the supply) with `tally` (a st.flags counter of cubes removed);
// place `fromBag` (each cube comes out of the seat's bag; none left, the step
// is over). Automatic `momTo` / `issueTo` set a value.
const countiesIn = (...regions) => COUNTIES.map((c, k) => k).filter((k) => regions.includes(REGIONS[regionOf(k)]));
const ks = (...names) => names.map((n) => { const k = countyIndex(n); if (k < 0) throw new Error("engine: no county " + n); return k; });
const rs = (...names) => names.map((n) => REGIONS.indexOf(n));
const step = (op, seat, left, o = {}) => ({ op, seat, left, pool: o.pool ?? null, pick: o.pick ?? "distinct", check: !!o.check, own: !!o.own, target: o.target ?? -1, then: o.then ?? null, fallback: o.fallback ?? null, toBag: !!o.toBag, fromBag: !!o.fromBag, tally: o.tally ?? null, used: [], picked: 0 });
const place = (seat, n, o) => step("place", seat, n, o);
const placeAt = (seat, county, n, o = {}) => step("place", seat, n, { ...o, pool: ks(county), pick: "same" });
const removeFrom = (seat, target, n, o = {}) => step("remove", seat, n, { ...o, target });
const media = (seat, n, o) => step("media", seat, n, o);
const mom = (p, n) => ({ op: "mom", p, n });
const iss = (name, p, n) => ({ op: "issue", name, p, n });
const bag = (p, n) => ({ op: "bag", p, n });
const mediaAt = (region, p, n) => ({ op: "mediaAt", r: REGIONS.indexOf(region), p, n });

// §14.3 text → program. `by` is the seat resolving the event.
const PROGRAMS = {
  // 陳
  taiwan_son: () => [place(CHEN, 3, { pool: countiesIn("雲嘉南", "高屏") })],
  future_resolution: () => [iss("cross", CHEN, 1), step("convert", CHEN, 1)],
  lu_running_mate: () => [placeAt(CHEN, "桃園縣", 2)],
  lo_propaganda: () => [media(CHEN, 2, { pick: "same" })],
  hsieh_kaohsiung: () => [placeAt(CHEN, "高雄市", 2), mediaAt("高屏", CHEN, 1)],
  dpp_counties: () => [place(CHEN, 3, { check: true, pool: ks("台北縣", "桃園縣", "新竹縣", "台中縣", "台中市", "台南縣", "台南市", "高雄縣", "屏東縣", "宜蘭縣", "嘉義市") })],
  three_three_three: () => [iss("econ", CHEN, 2), place(CHEN, 1, { own: true, check: true })], // 裁決 10
  advisory_group: () => [iss("clean", CHEN, 1), iss("econ", CHEN, 1), media(CHEN, 1, { pool: rs("中彰投", "北北基") })],
  million_rally: () => [place(CHEN, 3), mom(CHEN, 1)],
  dump_lien_save_chen: () => swap(CHEN, LIEN),
  hsu_wen_long: () => [placeAt(CHEN, "台南縣", 1), placeAt(CHEN, "台南市", 1)],
  chang_yung_fa: () => [media(CHEN, 1), bag(CHEN, 2)],
  south_rally: () => [place(CHEN, 2, { pool: countiesIn("高屏") })],
  // 宋
  diligent: () => [place(SOONG, 3)],
  hakka_vote: () => [placeAt(SOONG, "新竹縣", 1), placeAt(SOONG, "苗栗縣", 1)],
  east_coast: () => [placeAt(SOONG, "花蓮縣", 1), placeAt(SOONG, "台東縣", 1)],
  veterans_village: () => [place(SOONG, 2, { check: true, then: [removeFrom(SOONG, LIEN, 1)] })], // 裁決 11
  quake_bond: () => [placeAt(SOONG, "南投縣", 1), placeAt(SOONG, "台中縣", 1)],
  li_ao_endorses: () => ["台北市", "新竹市"].flatMap((n) => [removeFrom(SOONG, LIEN, 1, { pool: ks(n) }), placeAt(SOONG, n, 1)]),
  dump_lien_save_soong: () => swap(SOONG, LIEN),
  new_party_backs_soong: () => [place(SOONG, 2, { pool: countiesIn("北北基") })],
  chang_doctors: () => [media(SOONG, 1), bag(SOONG, 2)],
  soong_friends: () => [mom(SOONG, 1), place(SOONG, 1, { own: true })],
  kneel_for_votes: () => [mom(SOONG, 2), place(SOONG, 2, { check: true })],
  military_civil: () => [place(SOONG, 2, { check: true }), bag(SOONG, 1)],
  hsu_hsin_liang: () => [removeFrom(SOONG, CHEN, 1), mom(SOONG, 1)],
  // 連
  expel_soong: () => [media(LIEN, 2, { target: SOONG }), mom(SOONG, 1)], // 裁決 15
  party_machine: () => [place(LIEN, 3)],
  party_assets_ads: () => [media(LIEN, 2)],
  lee_campaigns: () => [place(LIEN, 2)],
  lee_attacks_soong: () => [removeFrom(LIEN, SOONG, 2, { pick: "same" }), mom(SOONG, 1)], // 裁決 14
  farmers_association: () => [placeAt(LIEN, "雲林縣", 1), placeAt(LIEN, "彰化縣", 1)],
  ma_campaigns: () => [placeAt(LIEN, "台北市", 2, { check: true })],
  party_unity: () => swap(LIEN, SOONG),
  massive_ads: () => [media(LIEN, 3)],
  ma_leaks_polls: () => [place(LIEN, 2, { check: true }), mom(SOONG, 1), mom(CHEN, 1)],
  lee_alarm: () => [place(LIEN, 3, { check: true })],
  members_return: () => [removeFrom(LIEN, SOONG, 2, { check: true })],
  // 外力 (裁決 4: 陳's cubes are placed by 陳, whoever played the card)
  zhu_rongji: () => [place(CHEN, 3), mom(CHEN, 1)],
  lee_secret_help: () => [place(CHEN, 2), mom(LIEN, -1)],
  tvbs_poll: (by) => [step("tvbs", by, 1)],
  // 興票案 (#5 裁決 2–4): 連 picks the returned cubes, whoever resolves the
  // card; a county may be picked again; the cubes go into the bag (§8.2).
  yang_exposes: () => [removeFrom(LIEN, SOONG, 4, { pick: "free", toBag: true, tally: "yangReturned" }), { op: "issueTo", name: "clean", p: SOONG, v: 0 }, { op: "momTo", p: SOONG, v: 0 }],
  // half of what 爆料 actually returned, rounded down, from the bag onto empty
  // blue floating blocks (no check); stops when the bag or the blocks run out.
  lee_authorized: (by, st) => [place(SOONG, Math.floor(st.flags.yangReturned / 2), { own: true, pick: "free", fromBag: true }), iss("clean", SOONG, 1)],
  shifting_story: () => [removeFrom(LIEN, SOONG, 2, { pick: "free", toBag: true }), mom(LIEN, 1)],
};

// 棄連保扁、棄連保宋、黨內整合: in one county, the target −1 (checked, Q5
// default) and then the player +1 (§8.1). With no target cube anywhere the
// −1 does nothing and the +1 goes to any county.
function swap(seat, target) {
  return [removeFrom(seat, target, 1, { check: true, then: [place(seat, 1, { check: true })], fallback: [place(seat, 1, { check: true })] })];
}

// The picks step s offers now.
function stepMoves(st, s) {
  const out = [];
  const open = (key) => !(s.pick === "distinct" && s.used.includes(key)) && (!s.pool || s.pool.includes(key));
  if (s.fromBag && st.bag[s.seat] <= 0) return out;
  if (s.op === "place" || s.op === "remove" || s.op === "convert") {
    for (let k = 0; k < COUNTIES.length; k++) {
      if (!open(k)) continue;
      if (s.op === "place") {
        if (emptyOf(st, k, CAMP[s.seat])) out.push({ type: "fill", county: k });
        if (!s.own && emptyOf(st, k, otherCamp(s.seat))) out.push({ type: "cross", county: k });
      } else if (s.op === "remove") {
        for (const t of ["G", "B", "N"]) if (st.counties[k].blocks.some((b) => b.o === s.target && b.t === t)) out.push({ type: "remove", county: k, target: s.target, t });
      } else if (emptyOf(st, k, "N")) out.push({ type: "convert", county: k });
    }
  } else if (s.op === "media") {
    for (let r = 0; r < REGIONS.length; r++) {
      if (!open(r)) continue;
      if (s.target < 0) out.push({ type: "media", region: r });
      else if (st.media[r][s.target] > 0) out.push({ type: "media", region: r, target: s.target });
    }
  } else if (s.op === "tvbs") {
    const min = Math.min(...st.mom);
    for (let p = 0; p < 3; p++) if (st.mom[p] === min) out.push({ type: "pick", seat: p });
  }
  return out;
}

// Start card id's program for `by`. Returns true when a choice is now pending
// (st.pending.stage "effect"); `after` says how the play goes on when the
// program is done: "kind" (外力 / 必觸發: the CP action) or "finish".
function startProgram(st, id, by, after) {
  st.pending.fx = { card: id, by, after, queue: PROGRAMS[id](by, st) };
  st.pending.stage = "effect";
  return runProgram(st);
}

// Resolve automatic steps and skip choice steps with nothing to pick, up to
// the next real choice. Returns true when one is pending; otherwise the
// program is gone from the state and the caller continues the play.
function runProgram(st) {
  const fx = st.pending.fx, q = fx.queue;
  while (q.length) {
    const s = q[0];
    if (s.op === "mom") { addMom(st, s.p, s.n); q.shift(); continue; }
    if (s.op === "issue") { addIssue(st, s.name, s.p, s.n); q.shift(); continue; }
    if (s.op === "bag") { st.bag[s.p] += s.n; q.shift(); continue; }
    if (s.op === "mediaAt") { st.media[s.r][s.p] = Math.max(0, st.media[s.r][s.p] + s.n); q.shift(); continue; }
    if (s.op === "momTo") { st.mom[s.p] = s.v; q.shift(); continue; }
    if (s.op === "issueTo") { issueCubes(st, s.name)[s.p] = s.v; q.shift(); continue; }
    if (s.left <= 0) { q.shift(); continue; }
    const ms = stepMoves(st, s);
    if (s.op === "tvbs" && ms.length === 1) { addMom(st, ms[0].seat, 1); q.shift(); continue; }
    if (!ms.length) { q.shift(); if (!s.picked && s.fallback) q.unshift(...s.fallback); continue; }
    return true;
  }
  delete st.pending.fx;
  return false;
}

function effectMoves(st) { return stepMoves(st, st.pending.fx.queue[0]); }

function applyEffect(st, seat, m) {
  const pd = st.pending, q = pd.fx.queue, s = q[0];
  let key;
  if (s.op === "place") {
    key = m.county;
    let ok = true;
    if (s.check) ok = m.type === "cross" ? crossCheck(st, seat) : !fillNeedsCheck(st, seat, key) || supportCheck(st, seat);
    if (s.fromBag) st.bag[seat]--;
    if (ok) putCube(st,seat, key, m.type === "fill" ? CAMP[seat] : otherCamp(seat));
  } else if (s.op === "remove") {
    key = m.county;
    if (!s.check || supportCheck(st, seat)) {
      st.counties[key].blocks.find((b) => b.o === m.target && b.t === m.t).o = -1;
      if (s.toBag) st.bag[m.target]++;
      if (s.tally) st.flags[s.tally]++;
    }
  } else if (s.op === "convert") {
    key = m.county;
    st.counties[key].blocks.find((b) => b.o < 0 && b.t === "N").t = "G";
  } else if (s.op === "media") {
    key = m.region;
    if (m.target == null) st.media[key][seat]++; else st.media[key][m.target]--;
  } else if (s.op === "tvbs") {
    addMom(st, m.seat, 1);
  }
  st.log.push({ t: "fx", card: pd.fx.card, seat, move: m });
  s.left--; s.picked++;
  if (s.pick === "distinct") s.used.push(key);
  else if (s.pick === "same") s.pool = [key];
  if (s.left <= 0) q.shift();
  if (s.then) q.unshift(...s.then.map((t) => ({ ...clone(t), pool: [key] })));
  const after = pd.fx.after;
  if (!runProgram(st)) afterProgram(st, after);
}

// The program is done: the CP action for 外力 / 必觸發, otherwise the play ends.
function afterProgram(st, after) {
  if (after === "kind") { st.pending.stage = "kind"; return; }
  finishPlay(st);
}

export function effectImplemented(id) {
  const c = CARD[id];
  if (!c) return false;
  return c.owner === "local" || Object.prototype.hasOwnProperty.call(EFFECTS, id) || Object.prototype.hasOwnProperty.call(PROGRAMS, id);
}

// May `seat` resolve card c's event text as its own (own card, conditions met)?
function ownEventAllowed(st, seat, c) {
  if (c.owner !== SEATS[seat]) return false;
  if (!effectImplemented(c.id)) return false; // 裁決 4: no pretending
  if (c.turnMax && st.turn > c.turnMax) return false;
  if (c.lawful && st.turn !== 8) return false;
  if (c.cond && !st.flags.played[c.cond]) return false;
  return true;
}

// Resolve card id's event for `by`. Returns true when the effect now waits on
// a choice (pending stage "effect"); the play then goes on with `after`.
function resolveEffect(st, id, by, after) {
  st.flags.played[id] = true;
  if (EFFECTS[id]) { EFFECTS[id](st); st.log.push({ t: "effect", card: id, by }); return false; }
  if (PROGRAMS[id]) { st.log.push({ t: "effect", card: id, by }); return startProgram(st, id, by, after); }
  st.log.push({ t: "effect", card: id, by, unimplemented: true });
  return false;
}

// ------------------------------------------------------------------ queries

export function mustAct(st) {
  if (st.phase === "order") return [st.initiative];
  if (st.phase === "action") {
    const pd = st.pending;
    if (!pd) return [st.actor];
    if (pd.stage === "effect") return [pd.fx.queue[0].seat]; // #4 裁決 4: whoever makes this choice
    return [pd.stage === "trigger" ? ownerSeat(pd.card) : pd.seat];
  }
  if (st.phase === "momentum") return st.pending ? [st.pending.seat] : [];
  if (st.phase === "save") return [0, 1, 2].filter((p) => !st.saved[p]);
  if (st.phase === "debate") return debateMustAct(st);
  if (st.phase === "election") return electionMustAct(st);
  return [];
}

const ownerSeat = (id) => SEATS.indexOf(CARD[id] ? CARD[id].owner : "");

export function legalMoves(st, seat) {
  if (!mustAct(st).includes(seat)) return [];
  if (st.phase === "order") return [0, 1, 2].map((pos) => ({ type: "order", pos }));
  if (st.phase === "save") return saveMoves(st, seat);
  if (st.phase === "debate") return debateMoves(st, seat);
  if (st.phase === "election") return electionMoves(st, seat);
  if (st.phase === "momentum") {
    const pd = st.pending;
    if (pd.stage === "swap") return [{ type: "swap", slot: 0 }, { type: "swap", slot: 1 }, { type: "noswap" }];
    if (pd.stage === "reward") return [{ type: "reward", pick: "mom" }, { type: "reward", pick: "endorse" }];
    return [];
  }
  // phase "action"
  const pd = st.pending;
  if (!pd) return playMoves(st, seat);
  switch (pd.stage) {
    case "trigger": return [{ type: "trigger" }, { type: "pass" }];
    case "effect": return effectMoves(st);
    case "local": return localMoves(st, seat, CARD[pd.card]);
    case "kind": return ["campaign", "ads", "issue"].map((kind) => ({ type: "action", kind }));
    case "campaign": return campaignMoves(st, seat, pd);
    case "ads": return [{ type: "ad" }, { type: "done" }];
    case "media": return mediaMoves(st, seat);
    case "issue": return issueMoves(st, seat, pd);
  }
  return [];
}

// §6, 裁決 13: the 必觸發 card may be played in any action phase of the turn it
// was drawn; at the seat's fourth play, if it is still in hand, it is the only
// legal play (no candidate card either).
function playMoves(st, seat) {
  const hand = st.hands[seat];
  const must = hand.find((id) => CARD[id].must);
  const forced = must && st.step === 3;
  const out = [];
  for (const id of forced ? [must] : hand) {
    const c = CARD[id];
    if (c.must || c.owner === "ext") { out.push({ type: "play", card: id, mode: "event" }); continue; }
    if (c.owner === "local") { out.push({ type: "play", card: id, mode: "cp" }, { type: "play", card: id, mode: "event" }); continue; }
    if (c.owner === SEATS[seat]) {
      out.push({ type: "play", card: id, mode: "cp" });
      if (ownEventAllowed(st, seat, c)) out.push({ type: "play", card: id, mode: "event" });
      continue;
    }
    // an opponent's card: CP only, optionally blocking for 2 momentum (§6.2)
    out.push({ type: "play", card: id, mode: "cp", block: false });
    if (st.mom[seat] >= 2) out.push({ type: "play", card: id, mode: "cp", block: true });
  }
  if (!forced && !st.candidateUsed[seat]) out.push({ type: "candidate" });
  return out;
}

// 裁決 9: a local card as an event must place on its county if it can: an
// empty own-camp or cross-camp floating block (never grey), the player's pick.
function localMoves(st, seat, c) {
  const k = countyIndex(c.county), out = [];
  if (emptyOf(st, k, CAMP[seat])) out.push({ type: "fill", county: k });
  if (emptyOf(st, k, otherCamp(seat))) out.push({ type: "cross", county: k });
  return out;
}

// §7.1, 裁決 6, 8.
function campaignMoves(st, seat, pd) {
  const out = [];
  const here = st.pos[seat];
  if (!pd.moved && !pd.ops) {
    for (let k = 0; k < COUNTIES.length; k++) {
      if (k !== here && moveCost(seat, here, k) <= pd.cp) out.push({ type: "move", to: k });
    }
  }
  const r = regionOf(here);
  for (let k = 0; k < COUNTIES.length; k++) {
    if (regionOf(k) !== r) continue;
    if (emptyOf(st, k, CAMP[seat])) out.push({ type: "fill", county: k });
    if (emptyOf(st, k, otherCamp(seat))) out.push({ type: "cross", county: k });
    for (let target = 0; target < 3; target++) {
      if (target === seat) continue;
      for (const t of ["G", "B", "N"]) {
        if (st.counties[k].blocks.some((b) => b.o === target && b.t === t)) out.push({ type: "steal", county: k, target, t });
      }
    }
  }
  out.push({ type: "done" });
  return out;
}

// §7.2, 裁決 7: after a successful ad the player must place one of their own
// media cubes in any region or remove one opponent's cube from a region.
function mediaMoves(st, seat) {
  const out = [];
  for (let r = 0; r < REGIONS.length; r++) out.push({ type: "media", region: r });
  for (let r = 0; r < REGIONS.length; r++) {
    for (let target = 0; target < 3; target++) if (target !== seat && st.media[r][target] > 0) out.push({ type: "media", region: r, target });
  }
  return out;
}

// §7.3, 裁決 14: the first cube of the action costs 1 CP, every later one 2;
// placing and removing cost the same; cubes may go on different issues.
function issueMoves(st, seat, pd) {
  const out = [];
  const cost = pd.placed ? 2 : 1;
  if (cost <= pd.cp) {
    for (const i of st.issues) out.push({ type: "issue", issue: i.name });
    for (const i of st.issues) {
      for (let target = 0; target < 3; target++) if (target !== seat && i.cubes[target] > 0) out.push({ type: "issue", issue: i.name, target });
    }
  }
  out.push({ type: "done" });
  return out;
}

// §5.4, §10: keep 1 (turns 1–5) or 2 (turns 7–8) of the cards left in hand;
// a hand at or under that keeps everything. Only a turn with a candidate card
// leaves one card over, and it goes to the discard pile (applySave). owner
// 裁決(#2, comment 6163533701): "出過候選人牌的那一回合少出一張手牌，留牌後
// 多剩 1 張：那一張進棄牌堆（§5.4、§6.3）。"
function saveMoves(st, seat) {
  const h = st.hands[seat];
  const n = st.turn <= 5 ? HAND.saveEarly : HAND.saveLate;
  if (h.length <= n) return [{ type: "save", cards: h.slice() }];
  if (n === 1) return h.map((id) => ({ type: "save", cards: [id] }));
  const out = [];
  for (let i = 0; i < h.length; i++) for (let j = i + 1; j < h.length; j++) out.push({ type: "save", cards: [h[i], h[j]] });
  return out;
}

// ------------------------------------------------------------------ apply

// A move matches a legal one when they agree on every field, with `block:
// false` the same as no `block`, an absent `target` the same as null, and the
// cards of a save as a set.
function canon(m) {
  const o = {};
  for (const k of Object.keys(m).sort()) {
    const v = m[k];
    if (v === undefined || v === null) continue;
    if (k === "block" && v === false) continue;
    if (k === "cards" && Array.isArray(v)) { o[k] = v.slice().sort(); continue; } // a save names a set
    o[k] = v;
  }
  return JSON.stringify(o);
}

export function apply(st0, seat, move) {
  if (!move || typeof move !== "object") throw new Error("apply: no move");
  const key = canon(move);
  const legal = legalMoves(st0, seat).find((m) => canon(m) === key);
  if (!legal) throw new Error(`apply: illegal move for seat ${seat} in phase ${st0.phase}: ${JSON.stringify(move)}`);
  const st = clone(st0);
  const m = clone(legal);
  switch (st.phase) {
    case "order": applyOrder(st, m); break;
    case "action": applyAction(st, seat, m); break;
    case "momentum": applyMomentum(st, seat, m); break;
    case "save": applySave(st, seat, m); break;
    case "debate": applyDebate(st, seat, m); break;
    case "election": applyElection(st, seat, m); break;
    default: throw new Error("apply: nothing to do in phase " + st.phase);
  }
  return st;
}

// §5.1 (3), 裁決 2: the holder p takes position k; order[i] = (p − k + i) mod 3.
function applyOrder(st, m) {
  const p = st.initiative;
  st.order = [0, 1, 2].map((i) => (p - m.pos + i + 3) % 3);
  st.log.push({ t: "order", seat: p, pos: m.pos, order: st.order.slice() });
  st.phase = "action"; st.step = 0; st.idx = 0; st.pending = null;
  nextActor(st);
}

// §5.2: the seat whose play it is, rotating one seat per action phase. #6
// 裁決 12 (§14.1): a seat with no card in hand and its candidate card spent
// has nothing to play, so its turn in that action phase is skipped.
function nextActor(st) {
  for (;;) {
    if (st.step === HAND.play) return startMomentum(st);
    const a = st.order[(st.step + st.idx) % 3];
    if (st.hands[a].length || !st.candidateUsed[a]) { st.actor = a; return; }
    st.log.push({ t: "skip", seat: a, step: st.step });
    st.idx++;
    if (st.idx === 3) { st.idx = 0; st.step++; }
  }
}

function applyAction(st, seat, m) {
  const pd = st.pending;
  if (!pd) return applyPlay(st, seat, m);
  switch (pd.stage) {
    case "trigger": return applyTrigger(st, m);
    case "effect": return applyEffect(st, seat, m);
    case "local": return applyLocal(st, seat, m);
    case "kind": pd.stage = m.kind; pd.ops = 0; pd.moved = false; pd.placed = 0; return;
    case "campaign": return applyCampaign(st, seat, pd, m);
    case "ads": return applyAds(st, seat, pd, m);
    case "media": return applyMedia(st, seat, pd, m);
    case "issue": return applyIssue(st, seat, pd, m);
  }
  throw new Error("apply: bad pending stage " + pd.stage);
}

function applyPlay(st, seat, m) {
  if (m.type === "candidate") {
    const cc = CANDIDATE_CARDS[SEATS[seat]];
    st.candidateUsed[seat] = true;
    st.rest[seat] += cc.rest; // 裁決 15: 連's candidate card rests 2, no +1
    st.log.push({ t: "play", seat, card: "candidate", mode: "cp" });
    st.pending = { seat, card: "candidate", mode: "cp", blocked: false, stage: "kind", cp: cc.cp };
    return;
  }
  const id = m.card, c = CARD[id];
  st.hands[seat].splice(st.hands[seat].indexOf(id), 1);
  st.rest[seat] += restFor(st, seat, c.cp); // §6.4: to the rest area now, into the bag at saving
  if (m.block) { st.mom[seat] -= 2; st.log.push({ t: "block", seat, card: id }); }
  st.log.push({ t: "play", seat, card: id, mode: m.mode });
  st.pending = { seat, card: id, mode: m.mode, blocked: !!m.block, stage: "kind", cp: c.cp };
  if (m.mode === "cp") return;
  // as an event
  if (c.owner === "local") {
    st.flags.played[id] = true;
    if (localMoves(st, seat, c).length) { st.pending.stage = "local"; return; }
    st.log.push({ t: "effect", card: id, by: seat, none: true });
    return finishPlay(st);
  }
  // 必觸發 (#5 裁決 1): the CP action first; the event resolves at endAction,
  // at the time a trigger would (§6.2).
  if (c.must) return;
  const cpAfter = c.owner === "ext"; // 裁決 3: effect first, then the CP action
  if (resolveEffect(st, id, seat, cpAfter ? "kind" : "finish")) return;
  afterProgram(st, cpAfter ? "kind" : "finish"); // own event: no CP action
}

function applyLocal(st, seat, m) {
  const k = m.county;
  const ok = m.type === "cross" ? crossCheck(st, seat) : !fillNeedsCheck(st, seat, k) || supportCheck(st, seat);
  if (ok) putCube(st,seat, k, m.type === "fill" ? CAMP[seat] : otherCamp(seat));
  finishPlay(st);
}

function putCube(st,seat, k, t) {
  const b = st.counties[k].blocks.find((x) => x.o < 0 && x.t === t);
  b.o = seat;
}

function spend(st, pd, n) {
  pd.cp -= n;
  if (pd.cp <= 0) endAction(st);
}

function applyCampaign(st, seat, pd, m) {
  if (m.type === "done") return endAction(st);
  if (m.type === "move") {
    const cost = moveCost(seat, st.pos[seat], m.to);
    st.pos[seat] = m.to; pd.moved = true;
    return spend(st, pd, cost);
  }
  const k = m.county;
  pd.ops++;
  st.pos[seat] = k; // the piece stops at the county of the last operation
  if (m.type === "fill") {
    if (!fillNeedsCheck(st, seat, k) || supportCheck(st, seat)) putCube(st,seat, k, CAMP[seat]);
  } else if (m.type === "cross") {
    if (crossCheck(st, seat)) putCube(st,seat, k, otherCamp(seat));
  } else if (m.type === "steal") {
    if (supportCheck(st, seat)) {
      // 裁決 8 / §4: the block returns to its printed colour
      st.counties[k].blocks.find((b) => b.o === m.target && b.t === m.t).o = -1;
    }
  }
  spend(st, pd, 1);
}

function applyAds(st, seat, pd, m) {
  if (m.type === "done") return endAction(st);
  pd.cp -= 1;
  if (supportCheck(st, seat)) { pd.stage = "media"; return; }
  if (pd.cp <= 0) endAction(st);
}

function applyMedia(st, seat, pd, m) {
  if (m.target == null) st.media[m.region][seat]++;
  else st.media[m.region][m.target]--;
  pd.stage = "ads";
  if (pd.cp <= 0) endAction(st);
}

function applyIssue(st, seat, pd, m) {
  if (m.type === "done") return endAction(st);
  const cost = pd.placed ? 2 : 1;
  pd.placed++;
  const cubes = issueCubes(st, m.issue);
  if (m.target == null) cubes[seat]++;
  else cubes[m.target]--;
  spend(st, pd, cost);
}

// The CP action is over. An opponent's event played for CP opens a trigger
// window (§6.2) unless it was blocked, its owner has no momentum, its effect
// is not implemented (裁決 4), or its owner could not play it as an event now
// (裁決 11).
function endAction(st) {
  const pd = st.pending;
  // 必觸發 (§6.1, #5 裁決 1–2): after the CP action the event resolves for its
  // owner (who makes the choices), whoever played it; no momentum, no block.
  if (pd.mode === "event" && CARD[pd.card] && CARD[pd.card].must) {
    if (resolveEffect(st, pd.card, ownerSeat(pd.card), "finish")) return;
    return finishPlay(st);
  }
  if (pd.mode === "cp" && pd.card !== "candidate" && !pd.blocked) {
    const c = CARD[pd.card], q = ownerSeat(pd.card);
    if (q >= 0 && q !== pd.seat && !c.must && st.mom[q] >= 1 && ownEventAllowed(st, q, c)) {
      pd.stage = "trigger";
      return;
    }
  }
  finishPlay(st);
}

function applyTrigger(st, m) {
  const pd = st.pending, q = ownerSeat(pd.card);
  if (m.type === "trigger") {
    st.mom[q] -= 1;
    st.log.push({ t: "trigger", seat: q, card: pd.card });
    pd.triggered = true; // 裁決 10: a triggered card leaves the game
    if (resolveEffect(st, pd.card, q, "finish")) return; // §6.2: the owner makes the choices
  }
  finishPlay(st);
}

// The play is resolved: put the card where it goes and pass to the next seat.
function finishPlay(st) {
  const pd = st.pending;
  if (pd.card !== "candidate") {
    // §6.1: an event leaves the game, a 本回合 one at the end of the turn (#5 裁決 6)
    if (pd.mode === "event" || pd.triggered) (THIS_TURN.has(pd.card) ? st.active : st.removed).push(pd.card);
    else st.decks.discard.push(pd.card);
  }
  st.pending = null;
  st.idx++;
  if (st.idx === 3) { st.idx = 0; st.step++; }
  nextActor(st);
}

// ------------------------------------------------------------------ momentum (§5.3)

function startMomentum(st) {
  st.phase = "momentum"; st.actor = -1; st.pending = null;
  // (1) decay: 宋、連 halve rounding down, 陳 rounding up
  st.mom = st.mom.map((x, p) => (p === CHEN ? Math.ceil(x / 2) : Math.floor(x / 2)));
  st.log.push({ t: "momentum", step: "decay", mom: st.mom.slice() });
  // (2) the national media leader may swap two adjacent slots
  const nat = nationalMediaLeader(st);
  if (nat >= 0) { st.mstep = "swap"; st.pending = { stage: "swap", seat: nat }; return; }
  momentumRewards(st);
}

// (3) slot 2's leader picks first, then slot 1, then slot 3; (4) issue decay.
function momentumRewards(st) {
  const second = leader(st.issues[1].cubes);
  if (second >= 0) { st.mstep = "reward"; st.pending = { stage: "reward", seat: second }; return; }
  momentumFinish(st);
}

function momentumFinish(st) {
  const first = leader(st.issues[0].cubes);
  if (first >= 0) { st.mom[first] += 1; endorse(st, first); }
  const third = leader(st.issues[2].cubes);
  if (third >= 0) st.mom[third] += 1;
  for (const i of st.issues) { const p = leader(i.cubes); if (p >= 0) i.cubes[p] -= 1; }
  st.log.push({ t: "momentum", step: "done", mom: st.mom.slice() });
  st.pending = null; st.mstep = null;
  st.phase = "save";
  // #6 裁決 12: a seat with no card left has nothing to keep and is skipped.
  st.saved = st.hands.map((h) => h.length === 0);
  for (let p = 0; p < 3; p++) if (st.saved[p]) st.log.push({ t: "save", seat: p, n: 0, skipped: true });
  if (st.saved.every(Boolean)) endSave(st);
}

function applyMomentum(st, seat, m) {
  if (m.type === "swap") {
    const s = m.slot;
    [st.issues[s], st.issues[s + 1]] = [st.issues[s + 1], st.issues[s]];
    st.log.push({ t: "momentum", step: "swap", seat, slot: s });
    st.pending = null;
    return momentumRewards(st);
  }
  if (m.type === "noswap") { st.pending = null; return momentumRewards(st); }
  if (m.type === "reward") {
    if (m.pick === "mom") st.mom[seat] += 1; else endorse(st, seat);
    st.log.push({ t: "momentum", step: "reward", seat, pick: m.pick });
    st.pending = null;
    return momentumFinish(st);
  }
}

// Draw an endorsement card and put the seat's marker on its region, replacing
// anyone else's; an empty deck is refilled by shuffling the discards (§5.3).
function endorse(st, seat) {
  if (!st.endorseDeck.length) {
    if (!st.endorseDiscard.length) return;
    withRng(st, (rng) => { st.endorseDeck = shuffle(rng, st.endorseDiscard.splice(0)); });
  }
  const r = st.endorseDeck.pop();
  st.endorseDiscard.push(r);
  st.endorse[r] = seat;
  st.log.push({ t: "momentum", step: "endorse", seat, region: r });
}

// ------------------------------------------------------------------ saving (§5.4, §10)

function applySave(st, seat, m) {
  const pile = st.turn <= 5 ? st.savedDebate : st.savedElection;
  pile[seat].push(...m.cards);
  const rest = st.hands[seat].filter((id) => !m.cards.includes(id));
  st.decks.discard.push(...rest);
  st.hands[seat] = [];
  st.saved[seat] = true;
  st.log.push({ t: "save", seat, n: m.cards.length }); // no card ids: saved face down
  if (st.saved.every(Boolean)) endSave(st);
}

// Everyone has saved: the rest area goes into the bag and the turn ends.
function endSave(st) {
  for (let p = 0; p < 3; p++) { st.bag[p] += st.rest[p]; st.rest[p] = 0; }
  endTurnFlags(st); // #5 裁決 6: after saving, before the next deal
  if (st.turn === 5) return startDebate(st);
  if (st.turn === 8) return startElection(st);
  beginTurn(st);
}

// ------------------------------------------------------------------ the debate (turn 6, §九, #6)
//
// No deal and no action phase. The initiative is checked as in §5.1 but its
// holder picks no position (裁決 2): it only breaks ties, the holder first and
// then clockwise (陳 → 宋 → 連 → 陳). Each round every seat whose debate pile
// still has a card picks one face down (裁決 3; the pick stays in savedDebate
// and the other seats' views see only that a pick was made); once all have
// picked, the cards are revealed together onto st.debate.placed[issue][seat].
// A card with an icon goes to its issue; a local card to an unsettled issue of
// the player's choice; a card on a settled issue does nothing and is discarded
// (裁決 5). Then every unsettled issue where some seat has 2 cards is settled,
// in track order (裁決 4); its winner (highest CP total, ties by the priority
// above) gets +1 momentum and places 2 / 3 / 4 cubes free of checks on empty
// floating blocks anywhere (裁決 6), one move at a time. When every issue is
// settled or every pile is empty, the unsettled issues where somebody played a
// card are settled in track order (裁決 8); an issue nobody played on (0/0/0) is
// not settled (owner 裁決 Q7 = B, #21). The issues go back to the track: the
// unsettled ones in the upper slots in their original track order, then the
// settled ones, the first settled in slot 3 (裁決 7); every debate card goes to the
// discard pile, the first strategic vote moves half (§十一, 裁決 9), the early
// discard pile is set aside (裁決 10) and turn 7 begins.
//
// Nothing is copied out of the state at the start: the piles, st.issues (its
// order is the original track order until the debate ends), st.initiative and
// the board are read when they are used (contract, #6 §五).

function startDebate(st) {
  st.turn = 6;
  st.phase = "debate"; st.step = 0; st.idx = 0; st.actor = -1; st.pending = null; st.mstep = null;
  st.saved = [false, false, false];
  st.debate = { picks: [null, null, null], placed: Object.fromEntries(ISSUES.map((n) => [n, [[], [], []]])), settled: [], queue: [], award: null };
  withRng(st, (rng) => { st.initiative = initiativeCheck(st, rng); });
  st.log.push({ t: "turn", turn: st.turn, initiative: st.initiative });
  if (st.savedDebate.every((pile) => !pile.length)) advanceDebate(st); // nothing to reveal at all
  return st;
}

const tiePriority = (st) => { const h = st.initiative >= 0 ? st.initiative : 0; return [0, 1, 2].map((i) => (h + i) % 3); };
const unsettled = (st) => st.issues.map((i) => i.name).filter((n) => !st.debate.settled.includes(n));

function debateMustAct(st) {
  const d = st.debate;
  if (!d) return [];
  if (d.award) return [d.award.seat];
  return [0, 1, 2].filter((p) => st.savedDebate[p].length && !d.picks[p]);
}

function debateMoves(st, seat) {
  const d = st.debate;
  if (d.award) return awardMoves(st, seat);
  const open = unsettled(st), out = [];
  for (const id of st.savedDebate[seat]) {
    const c = CARD[id];
    if (c.icon) out.push({ type: "reveal", card: id, issue: c.icon });
    else for (const name of open) out.push({ type: "reveal", card: id, issue: name });
  }
  return out;
}

// 裁決 6: any empty floating block, own camp (fill) or the other camp (cross); never grey.
function awardMoves(st, seat) {
  const out = [];
  for (let k = 0; k < COUNTIES.length; k++) {
    if (emptyOf(st, k, CAMP[seat])) out.push({ type: "fill", county: k });
    if (emptyOf(st, k, otherCamp(seat))) out.push({ type: "cross", county: k });
  }
  return out;
}

function applyDebate(st, seat, m) {
  const d = st.debate;
  if (d.award) {
    putCube(st, seat, m.county, m.type === "fill" ? CAMP[seat] : otherCamp(seat));
    st.log.push({ t: "debate", step: "place", seat, move: m });
    d.award.left--;
    if (d.award.left <= 0 || !awardMoves(st, seat).length) d.award = null;
    return advanceDebate(st);
  }
  d.picks[seat] = { card: m.card, issue: m.issue };
  st.log.push({ t: "debate", step: "pick", seat }); // no card: picked face down
  if (debateMustAct(st).length) return;
  // everyone has picked: reveal together
  const shown = [];
  for (let p = 0; p < 3; p++) {
    const pk = d.picks[p];
    if (!pk) continue;
    const pile = st.savedDebate[p];
    pile.splice(pile.indexOf(pk.card), 1);
    const dead = d.settled.includes(pk.issue);
    if (dead) st.decks.discard.push(pk.card); // 裁決 5: no effect
    else d.placed[pk.issue][p].push(pk.card);
    shown.push({ seat: p, card: pk.card, issue: pk.issue, dead });
  }
  d.picks = [null, null, null];
  st.log.push({ t: "debate", step: "reveal", cards: shown });
  // 裁決 4: every issue now at 2 cards for someone, in track order
  d.queue = unsettled(st).filter((n) => d.placed[n].some((cards) => cards.length >= 2));
  advanceDebate(st);
}

// Settle what is queued, one award at a time; then end the debate or open the next round.
function advanceDebate(st) {
  const d = st.debate;
  while (!d.award) {
    if (d.queue.length) { settleIssue(st, d.queue.shift()); continue; }
    const open = unsettled(st);
    if (!open.length) return endDebate(st);
    if (st.savedDebate.every((pile) => !pile.length)) {
      // 裁決 8; owner 裁決 Q7 = B (#21): an issue nobody played on is not settled.
      // A settled issue leaves `open`, so once these are settled the filter comes
      // back empty and the debate ends (no loop).
      d.queue = open.filter((n) => d.placed[n].some((cards) => cards.length));
      if (!d.queue.length) return endDebate(st);
      continue;
    }
    return; // next round
  }
}

function settleIssue(st, name) {
  const d = st.debate;
  const sums = [0, 1, 2].map((p) => d.placed[name][p].reduce((s, id) => s + CARD[id].cp, 0));
  let win = -1;
  for (const p of tiePriority(st)) if (win < 0 || sums[p] > sums[win]) win = p;
  const n = 2 + d.settled.length; // §九 5: 2, 3, 4 by the order of settling
  d.settled.push(name);
  addMom(st, win, 1);
  for (const cards of d.placed[name]) st.decks.discard.push(...cards.splice(0));
  st.log.push({ t: "debate", step: "settle", issue: name, cp: sums, seat: win, cubes: n });
  if (awardMoves(st, win).length) d.award = { seat: win, left: n, issue: name };
}

function endDebate(st) {
  const d = st.debate;
  // owner 裁決 Q7 = B (#21): the unsettled issues take the upper slots in their
  // original track order (st.issues is still that order here); 裁決 7: the first
  // settled goes back to the lowest slot.
  const byName = Object.fromEntries(st.issues.map((i) => [i.name, i]));
  st.issues = [...unsettled(st), ...d.settled.slice().reverse()].map((n) => byName[n]);
  // 裁決 10: what is left of the piles goes to the (early) discard pile
  for (const pile of st.savedDebate) st.decks.discard.push(...pile.splice(0));
  for (const name of Object.keys(d.placed)) for (const cards of d.placed[name]) st.decks.discard.push(...cards.splice(0));
  st.debate = null;
  st.log.push({ t: "debate", step: "end", issues: st.issues.map((i) => i.name) });
  strategicVote(st, true); // §九 7: the first strategic vote, half
  // §14.1, 裁決 10: the early discard pile is set aside; turn 7 starts a late one
  st.decks.earlyDiscard.push(...st.decks.discard.splice(0));
  endTurnFlags(st);
  beginTurn(st);
}

// §十一: in every county, the empty blue floating blocks go to whichever of
// 宋 / 連 leads there by 2 or more cubes; the empty green ones go to 陳 if he
// has a cube there. `half` (turn 6, 裁決 9): only half of each colour's empty
// blocks move, rounded down. Grey blocks never move.
function strategicVote(st, half) {
  const moved = [];
  for (let k = 0; k < COUNTIES.length; k++) {
    const blocks = st.counties[k].blocks;
    const s = cubesIn(st, k, SOONG), l = cubesIn(st, k, LIEN), c = cubesIn(st, k, CHEN);
    const flow = (t, to) => {
      const free = blocks.filter((b) => b.o < 0 && b.t === t);
      const n = half ? Math.floor(free.length / 2) : free.length;
      for (const b of free.slice(0, n)) b.o = to;
      if (n) moved.push({ county: k, seat: to, n });
    };
    if (Math.abs(s - l) >= 2) flow("B", s > l ? SOONG : LIEN);
    if (c >= 1) flow("G", CHEN);
  }
  st.log.push({ t: "strategic", half, moved });
}

// ------------------------------------------------------------------ election day (turn 9, §十二, #8)
//
// No deal and no action phase. (1) Conversion, at once (裁決 1): every media
// cube becomes 1 cube of its owner's in the bag, every issue cube likewise,
// every momentum 2; media, issues and momentum go to 0. The momentum before the
// conversion is kept in st.election.mom for the count's tie-break. (2) The
// initiative check (§5.1, 裁決 2); the holder picks a position, the others
// follow clockwise, as in an ordinary turn. (3) Canvassing (裁決 3): in that
// order, each seat goes through its whole election pile, one card at a time
// (`canvass`), three support checks in the card's county, one by one; each
// success asks for one thing in that county — an empty own-camp (fill) or
// other-camp (cross) floating block, an empty grey block (grey), or an
// opponent's cube (remove, back to the supply). With nothing to do there the
// success is wasted. A used card goes to the discard pile; an empty pile is
// skipped. (4) No election-day event. (5) The second strategic vote, all of it
// (裁決 4). (6) Endorsements, after the vote (裁決 5): in each region with a
// holder, half (rounded down) of each county's empty grey blocks become the
// holder's. (7) The count (裁決 6, 7): votes, then counties led, then the
// momentum before the conversion, then the election-day initiative order
// (the holder, then clockwise); phase "end" with st.result.
//
// Nothing is copied out at the start (contract, #8 §四): the board,
// st.endorse, st.bag, st.savedElection and st.initiative are read when used.

function startElection(st) {
  st.turn = 9;
  st.phase = "election"; st.step = 0; st.idx = 0; st.actor = -1; st.pending = null; st.mstep = null;
  st.saved = [false, false, false];
  const mom = st.mom.slice();
  const add = [0, 1, 2].map((p) => st.media.reduce((s, m) => s + m[p], 0) + st.issues.reduce((s, i) => s + i.cubes[p], 0) + 2 * st.mom[p]);
  for (let p = 0; p < 3; p++) st.bag[p] += add[p];
  st.media = st.media.map(() => [0, 0, 0]);
  for (const i of st.issues) i.cubes = [0, 0, 0];
  st.mom = [0, 0, 0];
  st.log.push({ t: "convert", bag: add, mom });
  st.election = { mom, stage: "order", card: null, county: -1, left: 0, choose: false };
  withRng(st, (rng) => { st.initiative = initiativeCheck(st, rng); });
  st.log.push({ t: "turn", turn: st.turn, initiative: st.initiative });
  return st;
}

function electionMustAct(st) {
  const e = st.election;
  if (!e) return [];
  if (e.stage === "order") return [st.initiative];
  return st.actor >= 0 ? [st.actor] : [];
}

function electionMoves(st, seat) {
  const e = st.election;
  if (e.stage === "order") return [0, 1, 2].map((pos) => ({ type: "order", pos }));
  if (e.choose) return canvassChoices(st, seat, e.county);
  return st.savedElection[seat].map((card) => ({ type: "canvass", card }));
}

// 裁決 3: what one success may do in county k.
function canvassChoices(st, seat, k) {
  const out = [];
  if (emptyOf(st, k, CAMP[seat])) out.push({ type: "fill", county: k });
  if (emptyOf(st, k, otherCamp(seat))) out.push({ type: "cross", county: k });
  if (emptyOf(st, k, "N")) out.push({ type: "grey", county: k });
  for (let target = 0; target < 3; target++) {
    if (target === seat) continue;
    for (const t of ["G", "B", "N"]) if (st.counties[k].blocks.some((b) => b.o === target && b.t === t)) out.push({ type: "remove", county: k, target, t });
  }
  return out;
}

function applyElection(st, seat, m) {
  const e = st.election;
  if (m.type === "order") {
    const p = st.initiative;
    st.order = [0, 1, 2].map((i) => (p - m.pos + i + 3) % 3);
    st.log.push({ t: "order", seat: p, pos: m.pos, order: st.order.slice() });
    e.stage = "canvass"; st.idx = 0;
    return nextCanvasser(st);
  }
  if (m.type === "canvass") {
    const pile = st.savedElection[seat];
    pile.splice(pile.indexOf(m.card), 1);
    e.card = m.card; e.county = countyIndex(st.cards[m.card].county); e.left = 3;
    st.log.push({ t: "canvass", seat, card: m.card, county: e.county });
    return runCanvass(st);
  }
  const k = m.county;
  if (m.type === "fill") putCube(st, seat, k, CAMP[seat]);
  else if (m.type === "cross") putCube(st, seat, k, otherCamp(seat));
  else if (m.type === "grey") putCube(st, seat, k, "N");
  else if (m.type === "remove") st.counties[k].blocks.find((b) => b.o === m.target && b.t === m.t).o = -1;
  st.log.push({ t: "canvass", step: "place", seat, move: m });
  e.choose = false;
  runCanvass(st);
}

// The card's checks, one at a time, until a success with something to do.
function runCanvass(st) {
  const e = st.election, seat = st.actor;
  while (e.left > 0) {
    e.left--;
    if (!supportCheck(st, seat)) continue;
    if (canvassChoices(st, seat, e.county).length) { e.choose = true; return; }
    st.log.push({ t: "canvass", step: "wasted", seat, county: e.county });
  }
  st.decks.discard.push(e.card);
  e.card = null; e.county = -1;
  nextCanvasser(st);
}

// The current seat goes on while its pile has cards; then the next in order.
function nextCanvasser(st) {
  while (st.idx < 3) {
    const a = st.order[st.idx];
    if (st.savedElection[a].length) { st.actor = a; return; }
    if (st.actor !== a) st.log.push({ t: "skip", seat: a, step: "canvass" });
    st.idx++;
  }
  st.actor = -1;
  finishElection(st);
}

function finishElection(st) {
  strategicVote(st, false); // 裁決 4: all of it
  // 裁決 5: endorsements after the vote
  const given = [];
  for (let r = 0; r < REGIONS.length; r++) {
    const h = st.endorse[r];
    if (h < 0) continue;
    for (let k = 0; k < COUNTIES.length; k++) {
      if (regionOf(k) !== r) continue;
      const free = st.counties[k].blocks.filter((b) => b.o < 0 && b.t === "N");
      const n = Math.floor(free.length / 2);
      for (const b of free.slice(0, n)) b.o = h;
      if (n) given.push({ county: k, seat: h, n });
    }
  }
  st.log.push({ t: "endorse", given });
  // 裁決 6, 7: the count
  const votes = [0, 1, 2].map((p) => st.counties.reduce((s, c) => s + c.blocks.filter((b) => b.o === p).length, 0));
  const leads = [0, 0, 0];
  for (let k = 0; k < COUNTIES.length; k++) { const p = leader([0, 1, 2].map((q) => cubesIn(st, k, q))); if (p >= 0) leads[p]++; }
  const momentum = st.election.mom.slice();
  const better = (a, b) => votes[a] !== votes[b] ? votes[a] > votes[b] : leads[a] !== leads[b] ? leads[a] > leads[b] : momentum[a] > momentum[b];
  let winner = -1;
  for (const p of tiePriority(st)) if (winner < 0 || better(p, winner)) winner = p;
  st.result = { votes, leads, momentum, winner };
  st.election.stage = "end";
  st.phase = "end";
  st.log.push({ t: "result", ...st.result });
}

// ------------------------------------------------------------------ view

// Per-seat projection: other seats' hands and saved piles are counts, decks
// are counts, the endorsement deck, the RNG and the seed (which would replay
// every shuffle) are gone. The log never carries a saved card's id.
export function view(st, seat) {
  const v = clone(st);
  delete v.rng;
  delete v.seed;
  v.hands = st.hands.map((h, p) => (p === seat ? h.slice() : h.length));
  v.savedDebate = st.savedDebate.map((h, p) => (p === seat ? h.slice() : h.length));
  v.savedElection = st.savedElection.map((h, p) => (p === seat ? h.slice() : h.length));
  v.decks = { early: st.decks.early.length, late: st.decks.late.length, discard: st.decks.discard.length, earlyDiscard: st.decks.earlyDiscard.length };
  // #6 裁決 3: a debate pick is face down until all have picked; others see only that it was made.
  if (st.debate) v.debate.picks = st.debate.picks.map((pk, p) => (p === seat ? pk : pk ? true : null));
  delete v.endorseDeck;
  v.seat = seat;
  return v;
}

export { TURNS, SEATS };
