// The solo controller: one human against two bots, as plain functions over a JSON session.
// Nothing here touches the DOM, so node runs it (tests/solo.test.js) and the page wires it up
// in app.js. A session is { v, seat, level, seed, rng, st, feed, logSeen, rec, mine }: st is the
// engine state, rng the bots' own generator state (a number, so a stored session replays the same),
// feed the record the table shows, rec what happened since the human last decided (the "just now"
// block) and mine the outcome of the human's own last move ({ checks, lines }, for the result line).
// Every function returns a new session; none mutates its input.
import * as E from "./shared/engine.js";
import { chooseMove, advise } from "./shared/bots.js";
import { COUNTIES } from "./shared/board.js";
import { tableHTML, labelMove, orderChoices, recentLines, resultLine, resultBlock, changedCounties, bind } from "./table.js";
import { decorate } from "./tutorial.js"; // the tutorial (#27) is a layer on this controller; it only acts while session.tut is set

const FEED_MAX = 60;

export function newSolo({ seat, level, seed }) {
  const s = seed >>> 0;
  const st = E.createGame(s);
  const session = { v: 1, seat, level, seed: s, rng: (s ^ 0x9e3779b9) >>> 0, st, feed: [], logSeen: 0, rec: [], mine: null };
  const first = fromLog(st, 0);
  return { ...session, feed: first, rec: first, logSeen: st.log.length };
}

const cnt = (st, k, p) => st.counties[k].blocks.filter((b) => b.o === p).length;

// What one move did, in the words the record needs. The engine's log does not keep campaign
// placements, ad results or issue cubes, so they are read off the two states.
function describe(b, seat, m, a) {
  const pd = b.pending;
  switch (m.type) {
    case "order": return [{ k: "order", seat, pos: m.pos, election: b.phase === "election" }];
    case "candidate": return [{ k: "cand", seat }];
    case "play": return [{ k: "play", seat, card: m.card, mode: m.mode, block: !!m.block }];
    case "trigger": return [{ k: "trigger", seat, card: pd.card }];
    case "move": return [{ k: "move", seat, to: m.to }];
    case "fill": case "cross": case "grey":
      return [{ k: m.type, seat, county: m.county, ok: cnt(a, m.county, seat) > cnt(b, m.county, seat) }];
    case "steal": case "remove":
      return [{ k: m.type, seat, county: m.county, target: m.target, ok: cnt(a, m.county, m.target) < cnt(b, m.county, m.target) }];
    case "ad": return [{ k: "ad", seat, ok: !!(a.pending && a.pending.stage === "media") }];
    case "media": return [{ k: "media", seat, target: m.target ?? null }]; // v0.4 (#34): the national box
    case "issue": return [{ k: "issue", seat, issue: m.issue, target: m.target ?? null }];
    case "swap": return [{ k: "swap", seat }];
    case "reward": return m.pick === "mom" ? [{ k: "reward", seat, pick: "mom" }] : [];
    case "save": return [{ k: "save", seat, n: m.cards.length }];
    case "reveal": return [{ k: "pick", seat }];
    case "canvass": return [{ k: "canvass", seat, county: COUNTIES.findIndex((c) => c[0] === b.cards[m.card].county) }];
    case "pick": return [{ k: "pickMom", seat: m.seat }];
  }
  return [];
}

const perSeat = (list) => { const per = [0, 0, 0]; for (const x of list) per[x.seat] += x.n; return per; };

// The engine's own log entries the record keeps: the turn, endorsements, the debate and election day.
export function fromLog(st, from) {
  const out = [];
  for (const e of st.log.slice(from)) {
    if (e.t === "turn") out.push({ k: "turn", turn: e.turn, initiative: e.initiative });
    else if (e.t === "momentum" && e.step === "endorse") out.push({ k: "endorseOne", seat: e.seat, region: e.region });
    else if (e.t === "debate" && e.step === "reveal") for (const c of e.cards) out.push({ k: c.dead ? "dead" : "reveal", seat: c.seat, card: c.card, issue: c.issue });
    else if (e.t === "debate" && e.step === "settle") out.push({ k: "settle", issue: e.issue, seat: e.seat, cubes: e.cubes });
    else if (e.t === "convert") out.push({ k: "convert" });
    else if (e.t === "strategic") out.push({ k: "strategic", half: e.half, per: perSeat(e.moved) });
    else if (e.t === "endorse") out.push({ k: "endorse", per: perSeat(e.given) });
    else if (e.t === "result") out.push({ k: "result" });
  }
  return out;
}

// What a bot said about its move (#14): the key and the parameters a sentence may use, never the bot's own scores.
const SAY_PARAMS = ["card", "county", "region", "issue", "target", "seat", "cp", "slot"];
const sayOf = (why) => (why && why.key ? Object.fromEntries([["key", why.key], ...SAY_PARAMS.filter((k) => why[k] != null).map((k) => [k, why[k]])]) : null);

// The unique leader of an issue's cubes, or -1 (the engine's own rule).
function leaderOf(arr) {
  let best = -1, max = 0, tie = false;
  for (let p = 0; p < 3; p++) {
    if (arr[p] > max) { max = arr[p]; best = p; tie = false; } else if (arr[p] === max && max > 0) tie = true;
  }
  return tie ? -1 : best;
}

// The end-of-turn settlement (§5.3) in the words the table needs. The engine logs only the momentum
// after each step, so the "before" comes from the caller: momBefore [3] and issues [{ name, cubes }]
// as they stood before this slice of the log. Shared by the solo record and the room client.
export function settleEntries(momBefore, issues, slice) {
  const out = [];
  const dec = slice.find((e) => e.t === "momentum" && e.step === "decay");
  if (dec && momBefore) out.push({ k: "decay", per: dec.mom.map((after, p) => [momBefore[p], after]) });
  // v0.4 (#34): the media leader's +1 right after the halving
  const bonus = slice.find((e) => e.t === "momentum" && e.step === "media");
  if (bonus) out.push({ k: "mediaBonus", seat: bonus.seat });
  const done = slice.find((e) => e.t === "momentum" && e.step === "done");
  if (done && issues) {
    const iss = issues.map((i) => ({ name: i.name, cubes: i.cubes }));
    const sw = slice.find((e) => e.t === "momentum" && e.step === "swap");
    if (sw) [iss[sw.slot], iss[sw.slot + 1]] = [iss[sw.slot + 1], iss[sw.slot]];
    const l0 = leaderOf(iss[0].cubes), l2 = leaderOf(iss[2].cubes);
    if (l0 >= 0) out.push({ k: "slot", slot: 1, seat: l0, issue: iss[0].name });
    if (l2 >= 0) out.push({ k: "slot", slot: 3, seat: l2, issue: iss[2].name });
    if (iss.some((i) => leaderOf(i.cubes) >= 0)) out.push({ k: "issueDecay" });
    out.push({ k: "momNow", mom: done.mom.slice() });
  }
  return out;
}

function move(session, seat, m, why) {
  const b = session.st, a = E.apply(b, seat, m);
  // The bot's line goes on the first line the move wrote, or stands alone when the move wrote none.
  const said = sayOf(why);
  const lines = describe(b, seat, m, a);
  if (said) { if (lines.length) lines[0] = { ...lines[0], why: said }; else lines.push({ k: "say", seat, why: said }); }
  const slice = a.log.slice(b.log.length);
  const settle = settleEntries(b.mom, b.issues, slice);
  const logged = fromLog(a, session.logSeen);
  // The move itself comes first, then the settlement it set off (the decay is logged by the move that
  // ends the action phase, the slot rewards by the one that ends the momentum phase), then the log.
  const entries = [...lines, ...settle, ...logged];
  const feed = session.feed.concat(entries).slice(-FEED_MAX);
  // "Just now" is everything since the human last decided. A human move empties it; what the move
  // itself set off (the settlement, the next turn) is the first thing in it again.
  // (Declining to trigger a card is not a decision to forget what the others did: it stays.)
  const human = seat === session.seat, reset = human && m.type !== "pass";
  const after = [...settle, ...logged];
  const rec = reset ? after : (session.rec || []).concat(human ? after : entries).slice(-FEED_MAX);
  const mine = human
    ? { checks: slice.filter((e) => e.t === "check" && e.seat === seat).map((e) => ({ ok: e.ok, drew: e.drew })), lines: lines.filter((l) => l.k !== "say") }
    : session.mine || null;
  return { ...session, st: a, feed, rec, mine, logSeen: a.log.length };
}

// Does a bot still have to move? (The page steps them one at a time; advance() runs them all.)
export function botsToMove(session) {
  if (session.st.phase === "end") return [];
  return E.mustAct(session.st).filter((p) => p !== session.seat);
}

export function stepBot(session) {
  const todo = botsToMove(session);
  if (!todo.length) return session;
  const r = E.makeRng(0); r.state = session.rng;
  const { move: m, why } = chooseMove(session.st, todo[0], session.level, () => r.next());
  // A bot has moved: what the human did before it is final (#43).
  return { ...move(session, todo[0], m, why), rng: r.state, undo: [], drew: false };
}

export function advance(session) {
  let s = session;
  for (let n = 0; n < 5000 && botsToMove(s).length; n++) s = stepBot(s);
  return s;
}

// 軍師 (#18): the switch lives in the session, so a reload keeps it. The advice is bots.advise on
// what this seat sees and may do, nothing more.
export function setAdvisor(session, on) {
  return { ...session, advisor: !!on };
}

// → { choices, why }: the labelled legal moves in the order the table shows them (#23: a county's
// options together, the ones that need no check first, moving last); with the advisor on, the one
// it picked is marked advised.
function decide(session, lang) {
  const { st, seat } = session;
  const v = E.view(st, seat), legal = E.legalMoves(st, seat);
  // Does a placement need no support check? Ask the engine itself: play it on a copy and read the log.
  const free = (m) => !E.apply(st, seat, m).log.slice(st.log.length).some((e) => e.t === "check");
  const list = orderChoices(v, legal.map((m) => ({ move: m, label: labelMove(v, m, lang) })), free);
  if (!session.advisor || !list.length || session.st.phase === "end") return { choices: list, why: null };
  const { move: pick, why } = advise(v, legal);
  const key = JSON.stringify(pick), at = list.findIndex((c) => JSON.stringify(c.move) === key);
  if (at >= 0) list[at] = { ...list[at], advised: true };
  return { choices: list, why };
}

export function choices(session, lang) {
  return decide(session, lang).choices;
}

export function act(session, m) {
  const next = move(session, session.seat, m);
  if (session.tut) return next;
  // 悔一步 (#43): the session as it stood before this move is kept (without its own history), in the human's
  // current action only. A move that drew something random (the engine's rng moved) can't be taken back:
  // the history is dropped and `drew` remembers it, so the panel can say why. A bot moving clears both.
  if (next.st.rng !== session.st.rng) return { ...next, undo: [], drew: true };
  const { undo, ...prev } = session;
  return { ...next, undo: (undo || []).concat([prev]).slice(-UNDO_MAX) };
}

const UNDO_MAX = 8;

export function canUndo(session) {
  return !session.tut && !!(session.undo && session.undo.length);
}

export function undo(session) {
  if (!canUndo(session)) return session;
  const rest = session.undo.slice(0, -1), prev = session.undo[session.undo.length - 1];
  return { ...prev, advisor: session.advisor, undo: rest, drew: session.drew };
}

// The region the human's pawn stands in: the one the map opens first.
export function openRegion(session) {
  return COUNTIES[session.st.pos[session.seat]][1];
}

// What happened since the human last decided, one line per opponent action (the "just now" block).
export function recent(session, lang) {
  return recentLines(session.rec || [], E.view(session.st, session.seat), bind(lang)).map((l) => l.text);
}

// The outcome of the human's own last move when it made a support check, else null.
export function lastResult(session, lang) {
  return resultLine(session.mine, bind(lang));
}

export function screen(session, lang, opts = {}) {
  const v = E.view(session.st, session.seat);
  const d = decide(session, lang), x = bind(lang), rec = session.rec || [];
  const changed = [...changedCounties(rec), ...changedCounties((session.mine && session.mine.lines) || [], true)];
  const html = tableHTML(v, d.choices, lang, {
    feed: session.feed, wait: botsToMove(session), advisor: { on: !!session.advisor, why: d.why },
    undo: session.tut ? null : canUndo(session) ? "on" : session.drew ? "off" : null,
    recent: recentLines(rec, v, x), result: resultBlock(session.mine, x), changed, ...opts,
  });
  return session.tut ? decorate(html, session, lang, opts) : html;
}
