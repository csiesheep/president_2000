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
// A client is { v, token, seat, room, state, error, feed, snap }: state is { seat, view, legal } as the
// server sent it, feed the record the table shows, snap a few counts of the last view to diff against.
import * as E from "./shared/engine.js";
import { SEATS } from "./shared/board.js";
import { tableHTML, labelMove, esc } from "./table.js";
import { fromLog } from "./solo.js";
import en from "./i18n/en.js";
import zh from "./i18n/zh-Hant.js";

const FEED_MAX = 60;
const NO = [5, 1, 2];
const SHOW_ORDER = [1, 2, 0]; // ballot-number order, as the table and the mockups
const dict = (lang) => (lang === "en" ? en : zh);
const fill = (s, vars = {}) => s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? vars[k] : "{" + k + "}"));

export function newClient() {
  return { v: 1, token: null, seat: null, room: null, state: null, error: null, feed: [], snap: null };
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
    media: view.media.map((m) => m.slice()),
    issues: Object.fromEntries(view.issues.map((i) => [i.name, i.cubes.slice()])),
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
  next.media.forEach((m, r) => {
    const { gain, loss } = deltas(prev.media[r] || [0, 0, 0], m);
    for (const g of gain) out.push({ k: "media", seat: g.p, region: r, target: null });
    if (!gain.length && who != null) for (const l of loss) if (l.p !== who) out.push({ k: "media", seat: who, region: r, target: l.p });
  });
  for (const [name, cubes] of Object.entries(next.issues)) {
    const { gain, loss } = deltas(prev.issues[name] || [0, 0, 0], cubes);
    for (const g of gain) out.push({ k: "issue", seat: g.p, issue: name, target: null });
    if (!gain.length && who != null) for (const l of loss) if (l.p !== who) out.push({ k: "issue", seat: who, issue: name, target: l.p });
  }
  return out;
}

function nextFeed(client, view) {
  const prev = client.snap;
  if (!prev || view.log.length < prev.logLen) return roomLog(view.log, 0).slice(-FEED_MAX);
  const slice = view.log.slice(prev.logLen);
  return client.feed.concat(roomLog(view.log, prev.logLen), diffFeed(prev, view, slice)).slice(-FEED_MAX);
}

// ------------------------------------------------------------------ messages in

export function receive(client, msg) {
  if (!msg || typeof msg !== "object") return client;
  switch (msg.t) {
    case "hello": return { ...client, token: msg.token, seat: msg.seat, error: null };
    case "room": return { ...client, room: { code: msg.code, host: msg.host, started: msg.started, seats: msg.seats }, error: null };
    case "state": {
      const feed = nextFeed(client, msg.view);
      return { ...client, seat: msg.seat, state: { seat: msg.seat, view: msg.view, legal: msg.legal }, feed, snap: snapOf(msg.view), error: null };
    }
    case "error": return { ...client, error: String(msg.code) };
  }
  return client;
}

// ------------------------------------------------------------------ what can be clicked

export function actions(client, lang) {
  const T = dict(lang), U = T.ui.room;
  if (client.state) {
    const v = client.state.view;
    return client.state.legal.map((m) => ({ label: labelMove(v, m, lang), data: { t: "move", move: m } }));
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
    if (sit) right = `<button type="button" class="btn sit" data-msg="${esc(JSON.stringify(sit.data))}">${esc(sit.label)}</button>`;
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
    `<p class="note">${esc(L.rules)}</p></section>`;
}

function waitingHTML(text) {
  return `<section class="lobby setup"><p class="sub wait">${esc(text)}</p></section>`;
}

export function screen(client, lang, opts = {}) {
  const T = dict(lang), U = T.ui.room;
  if (client.state) {
    const { view, legal } = client.state;
    const choices = legal.map((m) => ({ move: m, label: labelMove(view, m, lang) }));
    const names = [0, 1, 2].map((p) => { const s = client.room && client.room.seats[p]; return s && s.kind === "human" ? s.name : ""; });
    const wait = acting(view).filter((p) => p !== view.seat);
    const body = tableHTML(view, choices, lang, {
      feed: client.feed, wait: wait.length ? wait : [0, 1, 2].filter((p) => p !== view.seat),
      names, waitLabel: U.game.wait, waitHint: U.game.hint, noAgain: true,
      open: opts.open, sel: opts.sel, picks: opts.picks,
    });
    return errorHTML(client, T) + body;
  }
  if (!client.room) return errorHTML(client, T) + waitingHTML(U.conn.connecting);
  if (client.room.started) return errorHTML(client, T) + waitingHTML(U.game.noSeat);
  return lobbyHTML(client, lang, opts, T);
}

