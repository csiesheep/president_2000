// The room client (M4, #15): what the page does with the room server's messages, as plain
// functions over a JSON client. No DOM and no socket here, so node runs it against the real room core
// (tests/roomclient.test.js); roompage.js wires it to a WebSocket and the DOM.
//
//   newClient() → client
//   receive(client, msg) → client            msg: hello | room | state | error (src/roomcore.js)
//   actions(client, lang) → [{ label, data }]  what can be clicked now; data is the message to send:
//                                              { t: "sit", seat } | { t: "start", level } | { t: "move", move }
//   screen(client, lang, opts) → string      the HTML of the room page now (opts: level, open, sel, picks)
//
// The client never works out what is allowed: it offers the seats the room says are empty, the start
// button to the seat the room says is host, and exactly the moves the server put in `legal`.
// A client is { v, token, seat, room, state, error, feed, snap, rec, mine, sentMove }: state is { seat, view, legal } as the
// server sent it, feed the record the table shows, snap a few counts of the last view to diff against, rec what
// happened since this seat last decided ("just now"), mine the outcome of its own last move (the result line)
// and sentMove the move this page just sent (set by sent(), so a failed check can say where).
import * as E from "./shared/engine.js";
import { SEATS } from "./shared/board.js";
import { exactP, tableHTML, labelMove, esc, bind, sayLine, orderChoices, recentLines, resultBlock, changedCounties } from "./table.js";
import { fromLog, settleEntries } from "./solo.js";
import { advise } from "./shared/bots.js";
import en from "./i18n/en.js";
import zh from "./i18n/zh-Hant.js";

const FEED_MAX = 60, TAPE_MAX = 60, CHAT_MAX = 200;
const ACTION_START = new Set(["play", "candidate", "trigger", "canvass", "order"]);
const NO = [5, 1, 2];
const SHOW_ORDER = [1, 2, 0]; // ballot-number order, as the table and the mockups
const dict = (lang) => (lang === "en" ? en : zh);
const fill = (s, vars = {}) => s.replace(/\{(\w+)(?:#([^|}]*)\|([^}]*))?\}/g, (m, k, one, many) => (!(k in vars) ? m : one === undefined ? vars[k] : Number(vars[k]) === 1 ? one : many)); // "{n#block|blocks}": the singular at 1 (#30)

export function newClient() {
  return { v: 1, token: null, seat: null, room: null, state: null, error: null, feed: [], snap: null, advisor: false,
    tape: [], chatFresh: false, deadline: null, rec: [], mine: null, sentMove: null };
}

// ------------------------------------------------------------------ the record
// The server sends the view, not the moves, so the record is read off the log (which has the plays,
// the order, the debate and election day) and off what changed between two views (cubes, pawns,
// media, issues), the way the solo record reads a move off the states before and after it.

function roomLog(log, from) {
  const out = [], conv = log.map((e) => e.t).lastIndexOf("convert");
  let block = false;
  for (let i = from; i < log.length; i++) {
    const e = log[i];
    switch (e.t) {
      case "order": out.push({ k: "order", seat: e.seat, pos: e.pos, election: conv >= 0 && i > conv }); break;
      case "block": block = true; break;
      case "play":
        out.push(e.card === "candidate" ? { k: "cand", seat: e.seat } : { k: "play", seat: e.seat, card: e.card, mode: e.mode, block });
        block = false; break;
      case "trigger": out.push({ k: "trigger", seat: e.seat, card: e.card }); break;
      case "momentum":
        if (e.step === "reward" && e.pick === "mom") out.push({ k: "reward", seat: e.seat, pick: "mom" });
        else if (e.step === "swap") out.push({ k: "swap", seat: e.seat });
        else out.push(...fromLog({ log: [e] }, 0));
        break;
      case "save": if (e.n > 0) out.push({ k: "save", seat: e.seat, n: e.n }); break;
      case "debate": if (e.step === "pick") out.push({ k: "pick", seat: e.seat }); else out.push(...fromLog({ log: [e] }, 0)); break;
      case "canvass": if (e.card) out.push({ k: "canvass", seat: e.seat, county: e.county }); break;
      default: out.push(...fromLog({ log: [e] }, 0));
    }
  }
  return out;
}

// Who must act, as far as the engine can tell from a seat's view; [] if it cannot.
function acting(view) {
  try { return E.mustAct(view); } catch { return []; }
}

function snapOf(view) {
  return {
    logLen: view.log.length,
    cnt: view.counties.map((c) => [0, 1, 2].map((p) => c.blocks.filter((b) => b.o === p).length)),
    pos: view.pos.slice(),
    media: Array.isArray(view.media) ? view.media.slice() : null, // v0.5: none
    issues: Object.fromEntries(view.issues.map((i) => [i.name, i.cubes.slice()])),
    slots: view.issues.map((i) => ({ name: i.name, cubes: i.cubes.slice() })),
    mom: view.mom.slice(),
    actor: acting(view)[0] ?? null,
  };
}

// Gains and losses between two count arrays: [{ p, n }] for each seat that gained, and who lost.
function deltas(a, b) {
  const gain = [], loss = [];
  for (let p = 0; p < 3; p++) { const d = (b[p] || 0) - (a[p] || 0); if (d > 0) gain.push({ p, n: d }); else if (d < 0) loss.push({ p, n: -d }); }
  return { gain, loss };
}

const BULK = new Set(["convert", "strategic", "endorse", "result", "debate", "reshuffle"]);

function diffFeed(prev, view, slice) {
  const out = [], next = snapOf(view);
  if (slice.some((e) => BULK.has(e.t))) return out;
  const who = prev.actor;
  view.counties.forEach((_, k) => {
    const { gain, loss } = deltas(prev.cnt[k], next.cnt[k]);
    for (const g of gain) for (let i = 0; i < g.n; i++) {
      const l = loss.find((x) => x.p !== g.p);
      out.push(l ? { k: "steal", seat: g.p, county: k, target: l.p, ok: true } : { k: "fill", seat: g.p, county: k, ok: true });
    }
    if (!gain.length && who != null) for (const l of loss) if (l.p !== who) for (let i = 0; i < l.n; i++) out.push({ k: "remove", seat: who, county: k, target: l.p, ok: true });
  });
  for (let p = 0; p < 3; p++) if (next.pos[p] !== prev.pos[p]) out.push({ k: "move", seat: p, to: next.pos[p] });
  // v0.4 (#34): one national media box; one entry per cube put in, or per cube of another seat taken out.
  if (next.media) {
    const { gain, loss } = deltas(Array.isArray(prev.media) && typeof prev.media[0] === "number" ? prev.media : [0, 0, 0], next.media);
    for (const g of gain) for (let i = 0; i < g.n; i++) out.push({ k: "media", seat: g.p, target: null });
    if (!gain.length && who != null) for (const l of loss) if (l.p !== who) for (let i = 0; i < l.n; i++) out.push({ k: "media", seat: who, target: l.p });
  }
  // The end-of-turn settlement takes a cube off each issue's leader: that is not anyone's move.
  const settled = slice.some((e) => e.t === "momentum" && e.step === "done");
  for (const [name, cubes] of settled ? [] : Object.entries(next.issues)) {
    const { gain, loss } = deltas(prev.issues[name] || [0, 0, 0], cubes);
    for (const g of gain) for (let i = 0; i < g.n; i++) out.push({ k: "issue", seat: g.p, issue: name, target: null });
    if (!gain.length && who != null) for (const l of loss) if (l.p !== who) for (let i = 0; i < l.n; i++) out.push({ k: "issue", seat: who, issue: name, target: l.p });
  }
  return out;
}

// → { feed, added, fresh }: the whole record, the entries this state added to it, and whether it
// started over (first state, or a new game).
function nextFeed(client, view) {
  const prev = client.snap;
  if (!prev || view.log.length < prev.logLen) { const all = roomLog(view.log, 0).slice(-FEED_MAX); return { feed: all, added: all, fresh: true }; }
  const slice = view.log.slice(prev.logLen);
  const settle = settleEntries(prev.mom, prev.slots, slice);
  const added = [...roomLog(view.log, prev.logLen), ...diffFeed(prev, view, slice), ...settle];
  return { feed: client.feed.concat(added).slice(-FEED_MAX), added, fresh: false, slice };
}

// "Just now" and "your result" for this state. A decision of this seat is one it sent (sentMove) or one
// the record shows (an entry with its seat, a support check of its own); then "just now" starts over
// with what the others did, and the result is read off its own checks. Otherwise "just now" grows.
function justNow(client, next, view) {
  if (next.fresh) return { rec: next.added, mine: null };
  const me = view.seat, slice = next.slice || [];
  const checks = slice.filter((e) => e.t === "check" && e.seat === me).map((e) => ({ ok: e.ok, drew: e.drew, p: exactP(view, e) }));
  const own = next.added.filter((e) => e.seat === me && !["turn", "slot", "endorseOne", "mediaBonus", "leadBonus"].includes(e.k));
  const declined = client.sentMove && client.sentMove.type === "pass";
  if ((!client.sentMove || declined) && !checks.length && !own.length) return { rec: (client.rec || []).concat(next.added).slice(-FEED_MAX), mine: client.mine };
  const tried = client.sentMove && ["fill", "cross", "steal", "grey", "remove"].includes(client.sentMove.type) && client.sentMove.county != null && !own.some((e) => e.county === client.sentMove.county)
    ? [{ k: client.sentMove.type, seat: me, county: client.sentMove.county, target: client.sentMove.target, ok: false }] : [];
  return { rec: next.added.filter((e) => !own.includes(e)).slice(-FEED_MAX), mine: { checks, lines: [...own, ...tried] } };
}

// The page tells the client which move it just sent, so a failed check can name its county.
export function sent(client, move) {
  return { ...client, sentMove: move || null };
}

// ------------------------------------------------------------------ messages in

export function receive(client, msg) {
  if (!msg || typeof msg !== "object") return client;
  switch (msg.t) {
    // The first chat message after a hello is the whole record and replaces; later ones append.
    case "hello": return { ...client, token: msg.token, seat: msg.seat, error: null, chatFresh: true };
    case "chat": {
      const lines = (Array.isArray(msg.lines) ? msg.lines : []).map((l) => ({ k: "chat", seat: l.seat, name: l.name, text: String(l.text) }));
      const tape = client.chatFresh ? lines.concat(client.tape.filter((e) => e.k !== "chat")) : client.tape.concat(lines);
      return { ...client, tape: tape.slice(-TAPE_MAX), chatFresh: false };
    }
    case "room": return { ...client, room: { code: msg.code, host: msg.host, started: msg.started, seats: msg.seats }, error: null };
    case "state": {
      const next = nextFeed(client, msg.view), now = justNow(client, next, msg.view);
      // What the bots said about this state's moves goes on the table-talk tape: one sentence per action, the first
      // one of that action (#23 P2.8, ruling carried to #30), as on the solo record. An action starts at a card, a
      // candidate card, a trigger, a canvass, an order pick, or when the seat changes; only_move is not worth saying.
      const said = [];
      let lastSeat = null, spoke = true;
      for (const b of Array.isArray(msg.botMoves) ? msg.botMoves : []) {
        if (!b || !b.move) continue;
        if (b.seat !== lastSeat || ACTION_START.has(b.move.type)) spoke = false;
        lastSeat = b.seat;
        if (!spoke && b.why && b.why.key !== "only_move") { said.push({ k: "bot", seat: b.seat, why: b.why }); spoke = true; }
      }
      const tape = said.length ? client.tape.concat(said).slice(-TAPE_MAX) : client.tape;
      return { ...client, seat: msg.seat, state: { seat: msg.seat, view: msg.view, legal: msg.legal }, feed: next.feed, rec: now.rec, mine: now.mine, sentMove: null, snap: snapOf(msg.view), error: null, tape, deadline: typeof msg.deadline === "number" ? msg.deadline : null };
    }
    case "error": return { ...client, error: String(msg.code), sentMove: null };
  }
  return client;
}

// The room's chat as the page shows it.
export function chatLines(client) {
  return client.tape.filter((e) => e.k === "chat").map((e) => ({ seat: e.seat, name: e.name, text: e.text }));
}

// ------------------------------------------------------------------ what can be clicked

// 軍師 (#18): the switch is the client's own (the server never hears of it). The advice is
// bots.advise on the view and the legal moves the server sent, so it knows nothing a seat does not see.
export function setAdvisor(client, on) {
  return { ...client, advisor: !!on };
}

// → { choices, why } for the seat's current decision; the advised one is marked when the switch is on.
function decide(client, lang) {
  const { view, legal } = client.state;
  const list = orderChoices(view, legal.map((m) => ({ move: m, label: labelMove(view, m, lang) })));
  if (!client.advisor || !list.length || view.phase === "end") return { choices: list, why: null };
  const { move: pick, why } = advise(view, legal);
  const key = JSON.stringify(pick), at = list.findIndex((c) => JSON.stringify(c.move) === key);
  if (at >= 0) list[at] = { ...list[at], advised: true };
  return { choices: list, why };
}

export function actions(client, lang) {
  const T = dict(lang), U = T.ui.room;
  if (client.state) {
    const out = decide(client, lang).choices.map((c) => ({ label: c.label, data: { t: "move", move: c.move }, ...(c.advised ? { advised: true } : {}) }));
    if (client.state.view.phase === "end" && client.room && client.seat != null && client.room.host === client.seat) out.push({ label: T.ui.solo.end.again, data: { t: "rematch" } });
    return out;
  }
  const room = client.room;
  if (!room || room.started) return [];
  const out = [];
  room.seats.forEach((s, seat) => {
    if (s.kind === "empty") out.push({ label: fill(client.seat == null ? U.lobby.sit : U.lobby.moveTo, { who: T.ui.solo.cand[SEATS[seat]].short }), data: { t: "sit", seat } });
  });
  if (client.seat != null && room.host === client.seat) {
    for (const level of [1, 2, 3]) out.push({ label: fill(U.lobby.start, { bot: T.bots[level] }), data: { t: "start", level } });
  }
  return out;
}

// ------------------------------------------------------------------ the screen

function errorHTML(client, T) {
  if (!client.error) return "";
  const U = T.ui.room;
  return `<p class="rerr" role="alert">${esc((T.errors && T.errors[client.error]) || U.conn.unknownError)}</p>`;
}

// 桌邊 · TABLE TALK: what the players typed and what the bots' teams say, in one column.
function chatHTML(client, lang, opts, T) {
  const C = T.ui.room.chat, x = bind(lang);
  const rows = client.tape.map((e) => {
    if (e.k === "chat") return `<li class="c${e.seat != null && e.seat >= 0 ? " s" + e.seat : ""}${e.seat != null && e.seat === client.seat ? " me" : ""}"><b>${esc(e.name || T.ui.room.lobby.guest)}</b> ${esc(e.text)}</li>`;
    const say = sayLine(e.why, e.seat, x);
    return say ? `<li class="bt${e.seat != null ? " s" + e.seat : ""}"><span class="say">${esc(say)}</span></li>` : "";
  }).join("");
  return `<section class="t-chat" aria-label="${esc(C.title)}"><h3 class="t-h">${esc(C.title)}</h3>` +
    `<ol class="chatlog" tabindex="0">${rows || `<li class="none">${esc(C.none)}</li>`}</ol>` +
    `<form class="chatf" id="chatf" novalidate><label class="sr" for="chatin">${esc(C.label)}</label>` +
    `<input id="chatin" class="fi" name="text" maxlength="${CHAT_MAX}" autocomplete="off" placeholder="${esc(C.ph)}" value="${esc(opts.draft || "")}">` +
    `<button type="submit" class="btn send">${esc(C.send)}</button></form></section>`;
}

// The clock for the header: whole seconds left, counted against opts.now (default: the wall clock).
function clockOf(client, opts, T) {
  if (client.deadline == null) return null;
  const now = typeof opts.now === "number" ? opts.now : Date.now();
  return { left: Math.max(0, Math.ceil((client.deadline - now) / 1000)), deadline: client.deadline, tpl: T.ui.room.game.left };
}

function lobbyHTML(client, lang, opts, T) {
  const U = T.ui.room, L = U.lobby, room = client.room, S = T.ui.solo;
  const acts = actions(client, lang);
  const sitFor = (seat) => acts.find((a) => a.data.t === "sit" && a.data.seat === seat);
  const rows = SHOW_ORDER.map((p) => {
    const s = room.seats[p], c = S.cand[SEATS[p]];
    const me = client.seat === p;
    let line, right = "";
    if (s.kind === "human") {
      const tags = [room.host === p ? L.host : "", s.connected ? "" : L.offline].filter(Boolean);
      line = `${esc(s.name || L.guest)}${tags.length ? ` · <span class="tg${s.connected ? "" : " off"}">${esc(tags.join(" · "))}</span>` : ""}`;
    } else if (s.kind === "bot") line = esc(L.bot);
    else line = esc(L.empty);
    const sit = sitFor(p);
    if (sit) right = `<button type="button" class="btn sit" aria-label="${esc(fill(client.seat == null ? L.sitAria : L.moveAria, { who: c.name }))}" data-msg="${esc(JSON.stringify(sit.data))}">${esc(sit.label)}</button>`;
    else if (s.kind === "human" && me) right = `<span class="mine">${esc(L.you)}</span>`;
    return `<div class="seat s${p}${s.kind === "empty" ? " empty" : ""}${me ? " me" : ""}" data-seat="${p}"><b class="no">${NO[p]}</b>` +
      `<span class="sb"><span class="sc">${esc(c.name)}</span><span class="sw">${line}</span></span>${right}</div>`;
  }).join("");
  const isHost = client.seat != null && room.host === client.seat;
  let foot;
  if (isHost) {
    const level = [1, 2, 3].includes(opts.level) ? opts.level : 2;
    const lv = [1, 2, 3].map((n) => `<button type="button" class="lv${level === n ? " on" : ""}" data-level="${n}" aria-pressed="${level === n}">${esc(T.bots[n])}</button>`).join("");
    const go = acts.find((a) => a.data.t === "start" && a.data.level === level);
    foot = `<h2 class="lh">${esc(S.setup.level)}</h2><div class="lvs">${lv}</div><p class="sub">${esc(S.setup.levelNote[level])}</p>` +
      `<button type="button" class="big go" data-msg="${esc(JSON.stringify(go.data))}">${esc(L.startBig)}</button>`;
  } else {
    foot = `<p class="sub wait">${esc(client.seat == null ? L.pickSeat : room.host == null ? L.hostUnseated : L.waitHost)}</p>`;
  }
  return `<section class="lobby setup"><p class="kicker">${esc(L.kicker)}</p>` +
    `<div class="roomcode"><div><span class="rl">${esc(L.code)}</span><span class="rc">${esc(room.code)}</span></div>` +
    `<button type="button" class="btn copy" data-copy="1">${esc(L.copy)}</button></div>` +
    `<p class="sub">${esc(L.share)}</p><div class="seats">${rows}</div>${errorHTML(client, T)}${foot}` +
    `<p class="note">${esc(L.rules)}</p></section>` + chatHTML(client, lang, opts, T);
}

function waitingHTML(text) {
  return `<section class="lobby setup"><p class="sub wait">${esc(text)}</p></section>`;
}

export function screen(client, lang, opts = {}) {
  const T = dict(lang), U = T.ui.room;
  if (client.state) {
    const { view } = client.state;
    const d = decide(client, lang), choices = d.choices, acts = actions(client, lang);
    const names = [0, 1, 2].map((p) => { const s = client.room && client.room.seats[p]; return s && s.kind === "human" ? s.name : ""; });
    const wait = acting(view).filter((p) => p !== view.seat);
    const xb = bind(lang), rec = client.rec || [];
    const body = tableHTML(view, choices, lang, {
      recent: recentLines(rec, view, xb), result: resultBlock(client.mine, xb),
      changed: [...changedCounties(rec), ...changedCounties((client.mine && client.mine.lines) || [], true)],
      help: opts.help, moves: opts.moves, confirm: opts.confirm,
      feed: client.feed, wait: wait.length ? wait : [0, 1, 2].filter((p) => p !== view.seat),
      names, waitLabel: U.game.wait, waitHint: U.game.hint, noAgain: true,
      advisor: { on: !!client.advisor, why: d.why },
      clock: clockOf(client, opts, T),
      again: view.phase === "end" ? (acts.find((a) => a.data.t === "rematch") || null) : null, againWait: U.game.waitAgain,
      open: opts.open, sel: opts.sel, picks: opts.picks, county: opts.county, narrow: opts.narrow, turnCard: opts.turnCard, cardAge: opts.cardAge,
    });
    return errorHTML(client, T) + body + chatHTML(client, lang, opts, T);
  }
  if (!client.room) return errorHTML(client, T) + waitingHTML(U.conn.connecting);
  if (client.room.started) return errorHTML(client, T) + waitingHTML(U.game.noSeat);
  return lobbyHTML(client, lang, opts, T);
}

