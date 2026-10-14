// The solo controller: one human against two bots, as plain functions over a JSON session.
// Nothing here touches the DOM, so node runs it (tests/solo.test.js) and the page wires it up
// in app.js. A session is { v, seat, level, seed, rng, st, feed, logSeen }: st is the engine
// state, rng the bots' own generator state (a number, so a stored session replays the same),
// feed the record the table shows. Every function returns a new session; none mutates its input.
import * as E from "./shared/engine.js";
import { chooseMove } from "./shared/bots.js";
import { COUNTIES } from "./shared/board.js";
import { tableHTML, labelMove } from "./table.js";

const FEED_MAX = 60;

export function newSolo({ seat, level, seed }) {
  const s = seed >>> 0;
  const st = E.createGame(s);
  const session = { v: 1, seat, level, seed: s, rng: (s ^ 0x9e3779b9) >>> 0, st, feed: [], logSeen: 0 };
  return { ...session, feed: fromLog(st, 0), logSeen: st.log.length };
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
    case "media": return [{ k: "media", seat, region: m.region, target: m.target ?? null }];
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

function move(session, seat, m, why) {
  const b = session.st, a = E.apply(b, seat, m);
  // The bot's line goes on the first line the move wrote, or stands alone when the move wrote none.
  const said = sayOf(why);
  const lines = describe(b, seat, m, a);
  if (said) { if (lines.length) lines[0] = { ...lines[0], why: said }; else lines.push({ k: "say", seat, why: said }); }
  const feed = session.feed.concat(lines, fromLog(a, session.logSeen)).slice(-FEED_MAX);
  return { ...session, st: a, feed, logSeen: a.log.length };
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
  return { ...move(session, todo[0], m, why), rng: r.state };
}

export function advance(session) {
  let s = session;
  for (let n = 0; n < 5000 && botsToMove(s).length; n++) s = stepBot(s);
  return s;
}

export function choices(session, lang) {
  const { st, seat } = session;
  const v = E.view(st, seat);
  return E.legalMoves(st, seat).map((m) => ({ move: m, label: labelMove(v, m, lang) }));
}

export function act(session, m) {
  return move(session, session.seat, m);
}

// The region the human's pawn stands in: the one the map opens first.
export function openRegion(session) {
  return COUNTIES[session.st.pos[session.seat]][1];
}

export function screen(session, lang, opts = {}) {
  const v = E.view(session.st, session.seat);
  return tableHTML(v, choices(session, lang), lang, { feed: session.feed, wait: botsToMove(session), ...opts });
}
