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
import { exactP, tableHTML, labelMove, orderChoices, recentLines, resultLine, resultBlock, changedCounties, bind, checkRate, luckNow } from "./table.js";
import { EVENTS } from "./shared/cards.js";
import { decorate, boxCounty } from "./tutorial.js"; // the tutorial (#27) is a layer on this controller; it only acts while session.tut is set

const FEED_MAX = 60;

export function newSolo({ seat, level, seed }) {
  const s = seed >>> 0;
  const st = E.createGame(s, { rules: "v0.7", issueLuck: "lead", momentum: "none", trigger: "always", moraleCards: "full", luck: [50, 50, 50] }); // #82: new games are v0.8 (no momentum, a rival's CP play always triggers, morale on the cards, 50/50/50); #60: v0.7 丙 (50/50/60) before; a v0.6, v0.5 or v0.4 save keeps its own rules
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
    case "issue": { // a card's 「任一議題」 (v0.5) may move more than one cube: one entry per cube
      const i = b.issues.findIndex((x) => x.name === m.issue), p = m.target ?? seat;
      const n = Math.max(1, Math.abs(a.issues[i].cubes[p] - b.issues[i].cubes[p]));
      return Array.from({ length: n }, () => ({ k: "issue", seat, issue: m.issue, target: m.target ?? null }));
    }
    case "swap": return [{ k: "swap", seat }];
    case "reward": return m.pick === "mom" ? [{ k: "reward", seat, pick: "mom" }] : [];
    case "save": return [{ k: "save", seat, n: m.cards.length }];
    case "reveal": return [{ k: "pick", seat }];
    case "canvass": return [{ k: "canvass", seat, county: COUNTIES.findIndex((c) => c[0] === b.cards[m.card].county) }];
    case "pick": return [{ k: b.momentum === "none" ? "pickMorale" : "pickMom", seat: m.seat }]; // v0.8 (#82): TVBS 民調 gives morale
  }
  return [];
}

const perSeat = (list) => { const per = [0, 0, 0]; for (const x of list) per[x.seat] += x.n; return per; };

// The engine's own log entries the record keeps: the turn, endorsements, the debate and election day.
export function fromLog(st, from) {
  const out = [];
  for (const e of st.log.slice(from)) {
    if (e.t === "turn") out.push({ k: "turn", turn: e.turn, initiative: e.initiative, ...(e.order ? { order: e.order.slice() } : {}) }); // v0.6: the turn's order, fewest votes first
    else if (e.t === "momentum" && e.step === "shuffle") out.push({ k: "shuffle", issues: e.issues.slice() }); // v0.6: the issue slots drawn again
    else if (e.t === "momentum" && e.step === "endorse") out.push({ k: "endorseOne", seat: e.seat, region: e.region });
    else if (e.t === "debate" && e.step === "reveal") for (const c of e.cards) out.push({ k: c.dead ? "dead" : "reveal", seat: c.seat, card: c.card, issue: c.issue });
    else if (e.t === "debate" && e.step === "settle") out.push({ k: "settle", issue: e.issue, seat: e.seat, cubes: e.cubes });
    else if (e.t === "convert") out.push(e.mom ? { k: "convert", mom: e.mom.slice(), ...(e.leads ? { leads: e.leads.slice() } : {}) } : { k: "convert" }); // v0.7: the momentum (and with 丙 the issues led) the canvassing luck is made of
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
export function settleEntries(momBefore, issues, slice, none = false) {
  const out = [];
  if (none) { // v0.8 (#82): no momentum to halve, to add or to show; the headline and the second story each draw an endorsement, the third nothing
    const done0 = slice.find((e) => e.t === "momentum" && e.step === "done");
    if (done0 && issues) {
      for (const [slot, i] of [[1, 0], [2, 1]]) { const l = leaderOf(issues[i].cubes); if (l >= 0) out.push({ k: "slotM", slot, seat: l, issue: issues[i].name }); }
      if (issues.some((i) => leaderOf(i.cubes) >= 0)) out.push({ k: "issueDecay" });
    }
    return out;
  }
  const dec = slice.find((e) => e.t === "momentum" && e.step === "decay");
  if (dec && momBefore) out.push({ k: "decay", per: dec.mom.map((after, p) => [momBefore[p], after]) });
  // v0.4 (#34): the media leader's +1 right after the halving
  const bonus = slice.find((e) => e.t === "momentum" && e.step === "media");
  if (bonus) out.push({ k: "mediaBonus", seat: bonus.seat });
  // v0.5 (#49): the issue leader's +1 (logged step "lead") takes its place
  const lead = slice.find((e) => e.t === "momentum" && e.step === "lead");
  if (lead) out.push({ k: "leadBonus", seat: lead.seat });
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
  const settle = settleEntries(b.mom, b.issues, slice, b.momentum === "none");
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
    ? { checks: slice.filter((e) => e.t === "check" && e.seat === seat).map((e) => ({ ok: e.ok, drew: e.drew, p: exactP(a, e) })), lines: lines.filter((l) => l.k !== "say") }
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
  const { move: m, why } = chooseMove(session.st, todo[0], session.level, () => r.next(), { humans: [session.seat] });
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

// #70: a decision with one option only is made by the page itself. autoChoice gives that move (never in the tutorial,
// where every step is the player's own tap), else null.
export function autoChoice(session, lang) {
  if (session.tut || session.st.phase === "end") return null;
  const ch = choices(session, lang);
  return ch.length === 1 ? ch[0].move : null;
}

// act(session, m, { auto: true, label }): the step the page made by itself. It plays like any other, but undo goes back
// past it (the snapshot taken before it is flagged `auto`), and the note "only one option, done" (autoNote, the step's
// words in `label`) stays until the human next decides on their own.
export function act(session, m, opts = {}) {
  const next = move(session, session.seat, m);
  if (session.tut) return next;
  const note = opts.auto ? { text: opts.label || "" } : null;
  // 悔一步 (#43): the session as it stood before this move is kept (without its own history), in the human's
  // current action only. A move that drew something random (the engine's rng moved) can't be taken back:
  // the history is dropped and `drew` remembers it, so the panel can say why. A bot moving clears both.
  if (next.st.rng !== session.st.rng) return { ...next, undo: [], drew: true, autoNote: note };
  const { undo, autoNote, ...prev } = session;
  return { ...next, autoNote: note, undo: (undo || []).concat([opts.auto ? { ...prev, auto: true } : prev]).slice(-UNDO_MAX) };
}

const UNDO_MAX = 8;

// The last snapshot that is the human's own (not one taken before a step the page made by itself).
const ownAt = (session) => { const u = session.undo || []; for (let i = u.length - 1; i >= 0; i--) if (!u[i].auto) return i; return -1; };

export function canUndo(session) {
  // Undo is only for your own action: once a bot is to move the action is over (#48).
  return !session.tut && ownAt(session) >= 0 && !botsToMove(session).length;
}

export function undo(session) {
  if (!canUndo(session)) return session;
  const at = ownAt(session), { auto, autoNote, ...prev } = session.undo[at];
  return { ...prev, advisor: session.advisor, undo: session.undo.slice(0, at), drew: session.drew, autoNote: null };
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

// #96: the first game teaches as it goes. Seven new things, in this order; each has a moment, and the box for the first one
// whose moment it is and that this device has not seen yet is drawn on the human's decision. seen is the list of ids seen,
// "off" in it for no boxes at all. -> { id, n, ... what the words of that box need } or null. Never in the tutorial.
export const TIP_IDS = ["trigger", "steal", "save", "debate", "canvass", "strategic", "endorse"];
const EVENT_OWNER = Object.fromEntries(EVENTS.map((e) => [e.id, e.owner]));
const SIGNED = (n) => (n > 0 ? "+" : "−") + Math.abs(n);
export function tipFor(session, choices, lang, seen) {
  if (!Array.isArray(seen) || seen.includes("off") || session.tut || !session.st || session.st.phase === "end" || !choices.length) return null;
  const st = session.st, me = session.seat, log = st.log, v = E.view(st, me);
  const held = [];
  const ti = log.map((e) => e.t).lastIndexOf("trigger"), tr = log[ti], fx = st.pending && st.pending.fx;
  if (tr && tr.seat === me && EVENT_OWNER[tr.card] === ["chen", "soong", "lien"][me] && fx && fx.card === tr.card && !log.slice(ti + 1).some((e) => e.t === "play")) {
    const pl = [...log.slice(0, ti)].reverse().find((e) => e.t === "play");
    if (pl && pl.seat !== me && pl.card === tr.card) {
      const mine = E.moraleOf(tr.card).find((e) => e[0] === me);
      held.push({ id: "trigger", card: tr.card, by: pl.seat, morale: mine ? SIGNED(mine[1]) : null });
    }
  }
  const steals = choices.filter((c) => (c.move.type === "steal" || c.move.type === "remove") && c.move.target != null && c.move.target !== me);
  const rate = steals.map((c) => ({ c, p: Math.round(checkRate(v, me, c.move)) })).find((r) => Number.isFinite(r.p));
  if (rate) held.push({ id: "steal", p: rate.p, target: rate.c.move.target });
  if (st.phase === "save" && choices.length > 1) held.push({ id: "save", forum: st.turn <= 5 });
  if (st.phase === "debate" && choices.some((c) => c.move.type === "reveal")) held.push({ id: "debate" });
  if (st.phase === "election" && choices.some((c) => c.move.type === "canvass")) { const p = Math.round(luckNow(v, me)); held.push({ id: "canvass", p: Number.isFinite(p) ? p : null }); }
  if (st.phase === "election") held.push({ id: "strategic" });
  const r = (st.endorse || []).findIndex((h) => h === me);
  if (r >= 0) held.push({ id: "endorse", region: r });
  const t = held.find((h) => !seen.includes(h.id));
  return t ? { ...t, n: TIP_IDS.indexOf(t.id) + 1 } : null;
}

export function screen(session, lang, opts = {}) {
  const v = E.view(session.st, session.seat);
  const d = decide(session, lang), x = bind(lang), rec = session.rec || [];
  const changed = [...changedCounties(rec), ...changedCounties((session.mine && session.mine.lines) || [], true)];
  const html = tableHTML(v, d.choices, lang, {
    feed: session.feed, wait: botsToMove(session), advisor: { on: !!session.advisor, why: d.why },
    undo: session.tut || botsToMove(session).length ? null : canUndo(session) ? "on" : session.drew ? "off" : null,
    recent: recentLines(rec, v, x), rec, mineActs: (session.mine && session.mine.lines) || [], result: resultBlock(session.mine, x), autoNote: session.autoNote || null, changed, ...opts, ...(session.tut && opts.county == null && boxCounty(session) != null ? { county: boxCounty(session) } : {}), turnCard: session.tut ? false : opts.turnCard, tip: tipFor(session, d.choices, lang, opts.tipsSeen),
  });
  return session.tut ? decorate(html, session, lang, opts) : html;
}
