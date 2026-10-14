// The engine: pure, seeded, runs in the browser (solo) and in the Durable
// Object (rooms). Phase 0 holds the thinnest slice that makes the product's
// verb exist: a game can be set up, and every seat has a legal move at the
// first action phase. Everything from resolving a card onward is M1.
//
// Phase 0: written by the kickoff session, not independently verified.
import { COUNTIES, REGIONS, START_COUNTY, START_MOMENTUM, START_MEDIA, BAG_SEED, ISSUES, TURNS, SEATS, CAMP, countyIndex } from "./board.js";
import { EVENTS, localCards, HAND, CANDIDATE_CARDS } from "./cards.js";

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

// Every card gets a county for election-day canvassing (§14.2): events by
// block-weighted draw, locals their printed county.
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

export function createGame(seed) {
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
    seed, rng: rng.state, turn: 0, phase: "setup", step: 0,
    counties,
    pos: SEATS.map((s) => countyIndex(START_COUNTY[s])),
    mom: START_MOMENTUM.slice(),
    bag: [BAG_SEED, BAG_SEED, BAG_SEED],
    rest: [0, 0, 0],
    media: START_MEDIA.map((m) => m.slice()),
    issues: shuffle(rng, ISSUES.slice()).map((name) => ({ name, cubes: [0, 0, 0] })),
    endorse: REGIONS.map(() => -1),
    endorseDeck: shuffle(rng, [0, 1, 2, 3, 4, 5, 6, 0, 1, 2, 3, 4, 5, 6]),
    decks: {
      early: shuffle(rng, cards.filter((c) => c.deck === "early").map((c) => c.id)),
      late: shuffle(rng, cards.filter((c) => c.deck === "late").map((c) => c.id)),
      discard: [],
    },
    cards: byId,
    hands: [[], [], []],
    savedDebate: [[], [], []],
    savedElection: [[], [], []],
    candidateUsed: [false, false, false],
    flags: { played: {} },
    order: [0, 1, 2],
    initiative: -1,
    log: [],
  };
  st.rng = rng.state;
  return beginTurn(st);
}

// Turn 1 opening: deal to 7, initiative check from the bag, the first action
// phase. M1 fills in the rest of the turn.
export function beginTurn(st) {
  const rng = makeRng(0); rng.state = st.rng;
  st.turn += 1;
  const deckName = st.turn <= 5 ? "early" : "late";
  for (let p = 0; p < 3; p++) {
    while (st.hands[p].length < HAND.deal) {
      const deck = st.decks[deckName];
      if (!deck.length) { if (!st.decks.discard.length) break; deck.push(...shuffle(rng, st.decks.discard.splice(0))); }
      st.hands[p].push(deck.pop());
    }
  }
  st.initiative = initiativeCheck(st, rng);
  st.order = [st.initiative, (st.initiative + 1) % 3, (st.initiative + 2) % 3];
  st.phase = "action"; st.step = 0; st.actor = st.order[0];
  st.rng = rng.state;
  st.log.push({ t: "turn", turn: st.turn, initiative: st.initiative });
  return st;
}

// Draw until one colour shows twice; cubes go back into the bag (§5.1).
export function initiativeCheck(st, rng) {
  const seen = [0, 0, 0];
  for (let k = 0; k < 200; k++) {
    const total = st.bag[0] + st.bag[1] + st.bag[2];
    if (!total) for (let p = 0; p < 3; p++) st.bag[p] += BAG_SEED;
    let r = rng.next() * (st.bag[0] + st.bag[1] + st.bag[2]);
    let col = 0; for (; col < 2; col++) { r -= st.bag[col]; if (r < 0) break; }
    if (++seen[col] === 2) return col;
  }
  return 0;
}

export function mustAct(st) { return st.phase === "action" ? [st.actor] : []; }

// Legal moves for a seat at an action phase: each hand card as CP, as an
// event when the seat may (own / 外力 / 地方, conditions met), and the candidate
// card once per game. A 必觸發 card in hand is the only legal play that turn.
export function legalMoves(st, seat) {
  if (st.phase !== "action" || st.actor !== seat) return [];
  const hand = st.hands[seat];
  const must = hand.find((id) => st.cards[id].must && !st.flags.played[id]);
  const out = [];
  for (const id of must ? [must] : hand) {
    const c = st.cards[id];
    out.push({ type: "play", card: id, mode: "cp" });
    if (eventPlayable(st, seat, c)) out.push({ type: "play", card: id, mode: "event" });
  }
  if (!must && !st.candidateUsed[seat]) out.push({ type: "candidate", cp: CANDIDATE_CARDS[SEATS[seat]].cp });
  return out;
}

export function eventPlayable(st, seat, c) {
  if (c.owner === "local" || c.owner === "ext") return true;
  if (c.owner !== SEATS[seat]) return false;
  if (c.turnMax && st.turn > c.turnMax) return false;
  if (c.lawful && st.turn !== 8) return false;
  if (c.cond && !st.flags.played[c.cond]) return false;
  return true;
}

// Resolving a play is M1. Phase 0 refuses rather than pretending.
export function apply(st, action) {
  throw new Error("apply: not implemented (M1): " + JSON.stringify(action));
}

// Per-seat projection: other seats' hands and saved piles stay hidden, decks
// are counts, the bag is counts (it is public information at the table).
export function view(st, seat) {
  const v = clone(st);
  delete v.rng;
  v.hands = st.hands.map((h, p) => (p === seat ? h.slice() : h.length));
  v.savedDebate = st.savedDebate.map((h, p) => (p === seat ? h.slice() : h.length));
  v.savedElection = st.savedElection.map((h, p) => (p === seat ? h.slice() : h.length));
  v.decks = { early: st.decks.early.length, late: st.decks.late.length, discard: st.decks.discard.length };
  delete v.endorseDeck;
  v.seat = seat;
  return v;
}

export { TURNS, SEATS };
