// tests/driver.js — the orchestrator's helpers for driving the engine through
// its public contract: createGame / legalMoves / apply / mustAct / view and the
// state fields listed in issue #1. Orchestrator's file: a peer may run it and
// falsify against it, and does not edit it (TEAM.md).
//
// Nothing here computes an expected value. Expectations live in
// acceptance.test.js, copied by hand from the rulebook.
import * as E from "../public/shared/engine.js";
import * as B from "../public/shared/board.js";
import * as C from "../public/shared/cards.js";

export const CHEN = 0, SOONG = 1, LIEN = 2;

export function ci(name) {
  const i = B.COUNTIES.findIndex((c) => c[0] === name);
  if (i < 0) throw new Error("沒有這個縣市：" + name);
  return i;
}
export function ri(name) {
  const i = B.REGIONS.indexOf(name);
  if (i < 0) throw new Error("沒有這個區域：" + name);
  return i;
}
export const ALL_IDS = C.EVENTS.map((e) => e.id).concat(C.localCards().map((c) => c.id));

// A move-choosing RNG, separate from the engine's.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Does the engine resolve moves at all? Keyed on the Phase 0 refusal
// ("apply: not implemented (M1)"). Any other error means it exists and is
// broken: return true so the checks fail with their own messages.
export function ready() {
  try {
    const st = E.createGame(1);
    const seat = E.mustAct(st)[0];
    const m = E.legalMoves(st, seat)[0];
    E.apply(st, seat, m);
    return true;
  } catch (e) {
    return !/not implemented/i.test(String(e && e.message));
  }
}

// A move matches `want` when every key in `want` is equal. Two keys are
// special: without `target` in `want` the move must not carry one (target 0 is
// 陳, so "absent" is null/undefined, not falsy); without `block` in `want` the
// move must not block.
export function match(m, want) {
  for (const k of Object.keys(want)) if (JSON.stringify(m[k]) !== JSON.stringify(want[k])) return false;
  if (!("target" in want) && m.target != null) return false;
  if (!("block" in want) && m.block) return false;
  return true;
}
export const has = (st, seat, want) => E.legalMoves(st, seat).some((m) => match(m, want));
export function act(st, seat, want) {
  const moves = E.legalMoves(st, seat);
  const m = moves.find((x) => match(x, want));
  if (!m) {
    const show = JSON.stringify(moves.slice(0, 10)) + (moves.length > 10 ? `…（共 ${moves.length}）` : "");
    throw new Error(`沒有合法動作 ${JSON.stringify(want)}（seat ${seat}，phase ${st.phase}；合法：${show}）`);
  }
  return E.apply(st, seat, m);
}

// Apply pick(moves) for `seat` while it returns a move and the seat still has
// to act; returns the state and how many moves were applied.
export function repeat(st, seat, pick, cap = 60) {
  let n = 0;
  for (; n < cap; n++) {
    if (!E.mustAct(st).includes(seat)) break;
    const m = pick(E.legalMoves(st, seat));
    if (!m) break;
    st = E.apply(st, seat, m);
  }
  return { st, n };
}

// A chooser that leaves the board, media, issues and momentum alone wherever
// it can: play a card for CP without blocking, campaign, stop at once; decline
// triggers and swaps. Forced plays (外力 / 必觸發) still fire their events.
export function quiet(st, seat, moves) {
  const f = (p) => moves.find(p);
  return f((m) => m.type === "pass")
    || f((m) => m.type === "play" && m.mode === "cp" && !m.block)
    || f((m) => m.type === "play")
    || f((m) => m.type === "action" && m.kind === "campaign")
    || f((m) => m.type === "done")
    || f((m) => m.type === "noswap")
    || moves[0];
}
export const isPlayDecision = (moves) => moves.some((m) => m.type === "play" || m.type === "candidate");

// Choose moves (choose(st, seat, moves) or uniformly at random) until stop(st).
export function playUntil(st, stop, R, choose) {
  for (let n = 0; n < 6000; n++) {
    if (stop(st)) return st;
    const seats = E.mustAct(st);
    if (!seats.length) throw new Error(`卡住：phase ${st.phase} 沒有人要動`);
    const seat = seats[0];
    const moves = E.legalMoves(st, seat);
    if (!moves.length) throw new Error(`卡住：seat ${seat} 在 phase ${st.phase} 沒有合法動作`);
    const m = choose ? choose(st, seat, moves) : moves[Math.floor(R() * moves.length)];
    st = E.apply(st, seat, m);
  }
  throw new Error("6000 步還沒停");
}

// A state at turn start whose first actor is `seat`: the first seed where
// `seat` wins the initiative, with that seat choosing to go first.
const seedCache = new Map();
export function firstActor(seat, opts) {
  const key = seat + JSON.stringify(opts || {});
  const tryOne = (seed) => {
    const st = E.createGame(seed, opts);
    if (st.phase !== "order") throw new Error(`開局 phase 應為 "order"，實際 ${JSON.stringify(st.phase)}`);
    return st.initiative === seat ? act(st, seat, { type: "order", pos: 0 }) : null;
  };
  if (seedCache.has(key)) return tryOne(seedCache.get(key));
  for (let seed = 1; seed < 500; seed++) {
    const st = tryOne(seed);
    if (st) { seedCache.set(key, seed); return st; }
  }
  throw new Error(`500 個種子都沒有讓 seat ${seat} 拿到主動權`);
}

// Put card `id` into `seat`'s hand by swapping it with hand[slot] wherever it is
// (decks, discard, another hand, a saved pile), so every card is still in
// exactly one place. Give two cards to one seat with two different slots.
export function giveCard(st, seat, id, slot = 0) {
  const hand = st.hands[seat];
  if (hand.includes(id)) return st;
  const spots = [st.decks.early, st.decks.late, st.decks.discard, ...st.hands, ...st.savedDebate, ...st.savedElection];
  for (const arr of spots) {
    const k = arr.indexOf(id);
    if (k >= 0) { arr[k] = hand[slot]; hand[slot] = id; return st; }
  }
  throw new Error(`找不到牌 ${id}（移出遊戲的牌拿不回來）`);
}

export const cubes = (st, county, seat) => st.counties[county].blocks.filter((b) => b.o === seat).length;
export const empty = (st, county, t) => st.counties[county].blocks.filter((b) => b.o < 0 && b.t === t).length;
export const issue = (st, name) => {
  const i = st.issues.find((x) => x.name === name);
  if (!i) throw new Error("沒有議題 " + name);
  return i.cubes;
};
export const lastCheck = (st) => [...st.log].reverse().find((e) => e.t === "check");
export const checks = (st) => st.log.filter((e) => e.t === "check").length;

// Every card in exactly one place: decks, discard, removed, hands, saved piles, st.active (a
// 本回合 event stays on the table until the turn ends, #5), decks.earlyDiscard (the early discard
// pile set aside after turn 6) and st.debate.placed (cards revealed onto the debate board, #6).
export function conservation(st) {
  if (!Array.isArray(st.removed)) return "state 沒有 removed 陣列";
  const where = [st.decks.early, st.decks.late, st.decks.discard, st.removed, ...st.hands, ...st.savedDebate, ...st.savedElection, ...(Array.isArray(st.active) ? [st.active] : []),
    ...(Array.isArray(st.decks.earlyDiscard) ? [st.decks.earlyDiscard] : []),
    ...(st.debate && st.debate.placed ? Object.values(st.debate.placed).flat() : [])];
  const seen = new Map();
  for (const arr of where) for (const id of arr) seen.set(id, (seen.get(id) || 0) + 1);
  const dup = [...seen].filter(([, n]) => n > 1).map(([id]) => id);
  const missing = ALL_IDS.filter((id) => !seen.has(id));
  const known = new Set(ALL_IDS);
  const extra = [...seen.keys()].filter((id) => !known.has(id));
  if (dup.length || missing.length || extra.length) return `牌不守恆：重複 ${dup.join(",") || "無"}；不見 ${missing.join(",") || "無"}；多出 ${extra.join(",") || "無"}`;
  return true;
}

// Board / counter invariants that hold after every move.
export function invariants(st) {
  if (st.counties.length !== B.COUNTIES.length) return "縣市數變了";
  for (let i = 0; i < B.COUNTIES.length; i++) {
    const [name, , G, Bb, N] = B.COUNTIES[i];
    const bl = st.counties[i].blocks;
    if (bl.length !== G + Bb + N) return `${name} 票塊數變成 ${bl.length}`;
    const g = bl.filter((b) => b.t === "G").length, b = bl.filter((b) => b.t === "B").length, n = bl.filter((b) => b.t === "N").length;
    // 台灣前途決議文 may turn a grey block green; nothing else changes printed colours.
    if (b !== Bb || g < G || g + n !== G + N) return `${name} 票塊顏色變了：綠 ${g} 藍 ${b} 無色 ${n}`;
    if (bl.some((x) => ![-1, 0, 1, 2].includes(x.o))) return `${name} 有不合法的擁有者`;
  }
  const nat = (x) => Number.isInteger(x) && x >= 0;
  for (const [what, arr] of [["動能", st.mom], ["袋子", st.bag], ["休息區", st.rest], ["媒體", st.media.flat()], ["議題", st.issues.flatMap((i) => i.cubes)]]) {
    if (!arr.every(nat)) return `${what} 出現負數或非整數：${JSON.stringify(arr)}`;
  }
  if (!st.pos.every((p) => Number.isInteger(p) && p >= 0 && p < B.COUNTIES.length)) return "候選人位置不合法：" + st.pos.join();
  if (!st.endorse.every((p) => [-1, 0, 1, 2].includes(p))) return "背書標記不合法：" + st.endorse.join();
  return true;
}
