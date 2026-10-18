// The room's logic (M4, #13): three seats, a host, bots, the 60-second clock,
// the 15-second takeover and the 30-minute end. Pure: nothing here touches
// Cloudflare, the clock or Math.random, so node runs it as it is and the same
// events at the same times always send the same messages. src/room.js (the
// Durable Object) only turns WebSocket events into `ev`s, stores the room and
// sets the alarm.
//
//   newRoom({ code, seed, now }) → room            plain JSON (it goes to DO storage)
//   handle(room, ev, now) → { room, out }          now in ms; `room` is not mutated
//     ev:  { type: "open", conn, name, token }     token null (or unknown) → a new player
//          { type: "close", conn }
//          { type: "msg", conn, data }            data: { t: "sit", seat } | { t: "start", level } | { t: "move", move }
//                                                       | { t: "chat", text } | { t: "rematch" }   (#16)
//          { type: "alarm" }                      delivered at or after room.alarmAt
//     out: [{ to: conn, msg }]
//          { t: "hello", token, seat }            to an opened conn; again to a conn that sits (seat null until then)
//          { t: "room", code, host, started, seats }   host: the host's seat (null while unseated)
//          { t: "state", seat, view, legal, botMoves, deadline }
//                                                 view = E.view(st, seat); legal = legalMoves, [] if seat need not act;
//                                                 botMoves = [{ seat, move, why }]: every move a bot made in this
//                                                 handle, in order (bot seats, taken-over seats, timed-out moves),
//                                                 the same in every seat's message; why = chooseMove's { key, …params };
//                                                 deadline = the earliest wait + TURN_MS of a connected human who
//                                                 must act, null if none (and once the game has ended)
//          { t: "chat", lines: [{ seat, name, text, at }] }   a new line, to every conn; to an opened conn,
//                                                 the room's last CHAT_KEEP lines (possibly none) as one message
//          { t: "error", code }                   to the sender only; the room is returned unchanged
//
// Chat (#16): the text loses its control characters (and lone surrogates), is
// trimmed and cut to CHAT_MAX characters; empty → empty_chat, not a string →
// bad_message. seat is the sender's seat or null; at is `now`. The room keeps
// the last CHAT_KEEP lines, across rematches.
// Rematch (#16): the host, once st.phase is "end", starts a new game with the
// same seats and level; game n's engine seed is derived from "engine n" (game 0
// from "engine"). Not started → not_started; before the end → not_ended;
// anyone but the host → not_host.
//
// Times (plan; orchestrator rulings in #13 §三):
//   · a connected human who must decide has 60 s per decision; at the alarm
//     after that the bot makes that one move and the seat stays human;
//   · a seated human gone 15 s, while another seated human is connected, is
//     played by the bot until they come back with their token;
//   · with no seated human connected the game pauses (no takeover, no clock);
//     30 min after the last connection closed the room is dead.
// Bots move inside the same handle until a human must act or the game ends.
//
// Tokens come from the room's seed through SHA-256 (seed, code, counter), so
// they replay, and one player's token says nothing about another's or about
// the engine's seed. The engine and bot seeds are derived the same way.
import * as E from "../public/shared/engine.js";
import { chooseMove } from "../public/shared/bots.js";

export const TURN_MS = 60_000;
export const GRACE_MS = 15_000;
export const IDLE_MS = 30 * 60_000;
const NAME_MAX = 24;
const BOT_CAP = 20_000; // bot moves in one handle; a game is a few hundred decisions
export const CHAT_MAX = 200; // characters (code points) in one line
export const CHAT_KEEP = 50; // lines the room keeps

// ------------------------------------------------------------------ hashing

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
// SHA-256 of a string's UTF-8 bytes, as 8 words.
function sha256(str) {
  const bytes = new TextEncoder().encode(str);
  const len = bytes.length, nBlocks = ((len + 9 + 63) >> 6);
  const m = new Uint8Array(nBlocks * 64);
  m.set(bytes); m[len] = 0x80;
  const bits = len * 8;
  m[m.length - 4] = bits >>> 24; m[m.length - 3] = bits >>> 16; m[m.length - 2] = bits >>> 8; m[m.length - 1] = bits;
  m[m.length - 8] = Math.floor(bits / 2 ** 32) >>> 24; m[m.length - 7] = Math.floor(bits / 2 ** 32) >>> 16;
  m[m.length - 6] = Math.floor(bits / 2 ** 32) >>> 8; m[m.length - 5] = Math.floor(bits / 2 ** 32);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rot = (x, n) => (x >>> n) | (x << (32 - n));
  for (let b = 0; b < nBlocks; b++) {
    for (let i = 0; i < 16; i++) {
      const o = b * 64 + i * 4;
      w[i] = (m[o] << 24) | (m[o + 1] << 16) | (m[o + 2] << 8) | m[o + 3];
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rot(w[i - 15], 7) ^ rot(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rot(w[i - 2], 17) ^ rot(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = w[i - 16] + s0 + w[i - 7] + s1;
    }
    let [a, bb, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rot(e, 6) ^ rot(e, 11) ^ rot(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const t2 = ((rot(a, 2) ^ rot(a, 13) ^ rot(a, 22)) + ((a & bb) ^ (a & c) ^ (bb & c))) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = bb; bb = a; a = (t1 + t2) >>> 0;
    }
    h[0] += a; h[1] += bb; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }
  return Array.from(h);
}
const hex = (words) => words.map((x) => (x >>> 0).toString(16).padStart(8, "0")).join("");
const derive = (room, what) => sha256(`${room.seed}|${room.code}|${what}`);

// ------------------------------------------------------------------ the room

export function newRoom({ code, seed, now }) {
  const room = {
    code: String(code), seed: String(seed),
    tokens: 0,            // tokens handed out so far (the counter in the token hash)
    botRng: 0,            // the bots' mulberry32 state (E.makeRng)
    host: null,           // the host's token
    players: {},          // token → { name, conn, seat, goneAt }
    conns: {},            // conn → token
    seats: [0, 1, 2].map(() => ({ kind: "empty", token: null })),
    started: false, level: null, st: null,
    games: 0,             // games started before the current one (rematches)
    chat: [],             // the last CHAT_KEEP lines: { seat, name, text, at }
    wait: [null, null, null], // when each connected human's current decision began
    emptySince: now,      // when the last connection closed (null while anyone is here)
    alarmAt: null, dead: false,
  };
  room.botRng = derive(room, "bots")[0];
  room.alarmAt = nextAlarm(room, now);
  return room;
}

const err = (room0, conn, code) => ({ room: room0, out: [{ to: conn, msg: { t: "error", code } }] });

export function handle(room0, ev, now) {
  const room = E.clone(room0);
  room.chat ??= []; room.games ??= 0; // rooms stored before #16
  const bots = []; // the bot moves of this handle, in order
  let chatLine = null;
  const before = { room: roomMsg(room), st: room.st ? JSON.stringify(room.st) : null };
  const direct = {}; // conn → messages that go first (hello)
  let opened = null;

  if (ev.type === "open") {
    opened = ev.conn;
    let token = typeof ev.token === "string" && room.players[ev.token] ? ev.token : null;
    if (token) {
      const p = room.players[token];
      if (p.conn != null && p.conn !== ev.conn) delete room.conns[p.conn]; // the old tab is replaced
      p.conn = ev.conn; p.goneAt = null;
      if (ev.name) p.name = cleanName(ev.name, p.name);
    } else {
      token = hex(derive(room, `token ${room.tokens++}`)).slice(0, 24);
      room.players[token] = { name: cleanName(ev.name, ""), conn: ev.conn, seat: null, goneAt: null };
      if (room.host == null) room.host = token;
    }
    room.conns[ev.conn] = token;
    room.emptySince = null;
    (direct[ev.conn] ??= []).push({ t: "hello", token, seat: room.players[token].seat });
  } else if (ev.type === "close") {
    const token = room.conns[ev.conn];
    if (token === undefined) return { room: room0, out: [] };
    delete room.conns[ev.conn];
    const p = room.players[token];
    if (p.conn === ev.conn) { p.conn = null; p.goneAt = now; }
    if (!Object.keys(room.conns).length) room.emptySince = now;
  } else if (ev.type === "msg") {
    const token = room.conns[ev.conn];
    if (token === undefined) return { room: room0, out: [] };
    const p = room.players[token], d = ev.data;
    if (!d || typeof d !== "object") return err(room0, ev.conn, "bad_message");
    if (d.t === "sit") {
      if (room.started) return err(room0, ev.conn, "started");
      if (![0, 1, 2].includes(d.seat)) return err(room0, ev.conn, "bad_seat");
      if (p.seat === d.seat) return { room: room0, out: [] };
      if (room.seats[d.seat].kind !== "empty") return err(room0, ev.conn, "seat_taken");
      if (p.seat != null) room.seats[p.seat] = { kind: "empty", token: null };
      room.seats[d.seat] = { kind: "human", token };
      p.seat = d.seat;
      (direct[ev.conn] ??= []).push({ t: "hello", token, seat: d.seat });
    } else if (d.t === "start") {
      if (room.started) return err(room0, ev.conn, "started");
      if (token !== room.host) return err(room0, ev.conn, "not_host");
      if (p.seat == null) return err(room0, ev.conn, "not_seated");
      if (![1, 2, 3].includes(d.level)) return err(room0, ev.conn, "bad_level");
      room.started = true; room.level = d.level;
      for (let s = 0; s < 3; s++) if (room.seats[s].kind === "empty") room.seats[s] = { kind: "bot", token: null };
      room.st = E.createGame(derive(room, "engine")[0], { rules: "v0.7", issueLuck: "lead", momentum: "none", trigger: "always", moraleCards: "full", luck: [50, 50, 50] });
    } else if (d.t === "move") {
      if (p.seat == null) return err(room0, ev.conn, "not_seated");
      if (!room.started) return err(room0, ev.conn, "not_started");
      const seat = p.seat;
      if (!E.mustAct(room.st).includes(seat)) return err(room0, ev.conn, "not_your_turn");
      // The server decides: the engine's apply accepts only a move legalMoves lists.
      let st;
      try { st = E.apply(room.st, seat, d.move); } catch (e) {
        return err(room0, ev.conn, /illegal move|no move/.test(String(e && e.message)) ? "illegal_move" : "engine_error");
      }
      room.st = st; room.wait[seat] = null;
    } else if (d.t === "chat") {
      if (typeof d.text !== "string") return err(room0, ev.conn, "bad_message");
      const text = cleanChat(d.text);
      if (!text) return err(room0, ev.conn, "empty_chat");
      chatLine = { seat: p.seat, name: p.name, text, at: now };
      room.chat = [...room.chat, chatLine].slice(-CHAT_KEEP);
    } else if (d.t === "rematch") {
      if (!room.started) return err(room0, ev.conn, "not_started");
      if (room.st.phase !== "end") return err(room0, ev.conn, "not_ended");
      if (token !== room.host) return err(room0, ev.conn, "not_host");
      room.games++;
      room.st = E.createGame(derive(room, `engine ${room.games}`)[0], { rules: "v0.7", issueLuck: "lead", momentum: "none", trigger: "always", moraleCards: "full", luck: [50, 50, 50] });
      room.wait = [null, null, null];
    } else {
      return err(room0, ev.conn, "bad_message");
    }
  } else if (ev.type === "alarm") {
    // A connected human's clock ran out: the bot makes that one move.
    if (room.started && online(room)) {
      for (let s = 0; s < 3; s++) {
        if (room.wait[s] != null && now - room.wait[s] >= TURN_MS && E.mustAct(room.st).includes(s) && connected(room, s)) {
          botMove(room, s, bots);
        }
      }
    }
    if (room.emptySince != null && now - room.emptySince >= IDLE_MS) room.dead = true;
  }

  advance(room, now, bots);
  refreshWait(room, now);
  room.alarmAt = room.dead ? null : nextAlarm(room, now);

  // Messages: hello first, then the room if it changed (always to the one who
  // just opened), then each seated, connected human's state if the game moved
  // (always to the one who just opened). At most one of each per conn.
  const out = [];
  const conns = Object.keys(room.conns).sort();
  const rm = roomMsg(room), roomChanged = JSON.stringify(rm) !== JSON.stringify(before.room);
  const stChanged = room.st ? JSON.stringify(room.st) !== before.st : false;
  const deadline = deadlineOf(room);
  for (const conn of conns) {
    for (const msg of direct[conn] || []) out.push({ to: conn, msg });
    if (roomChanged || conn === opened) out.push({ to: conn, msg: rm });
    const seat = room.players[room.conns[conn]].seat;
    if (room.started && seat != null && (stChanged || conn === opened)) out.push({ to: conn, msg: stateMsg(room, seat, bots, deadline) });
    if (conn === opened) out.push({ to: conn, msg: { t: "chat", lines: room.chat } });
    else if (chatLine) out.push({ to: conn, msg: { t: "chat", lines: [chatLine] } });
  }
  return { room, out };
}

// ------------------------------------------------------------------ helpers

// Control characters (Cc) and lone surrogates (Cs: under /u a pair is one code point) go,
// then the ends are trimmed and the text is cut to CHAT_MAX code points.
function cleanChat(text) {
  return Array.from(text.replace(/[\p{Cc}\p{Cs}]/gu, "").trim()).slice(0, CHAT_MAX).join("").trim();
}
function cleanName(name, fallback) {
  const s = String(name ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, NAME_MAX);
  return s || fallback;
}
function connected(room, s) {
  const seat = room.seats[s];
  return seat.kind === "human" && room.players[seat.token].conn != null;
}
const online = (room) => [0, 1, 2].some((s) => connected(room, s));
// A seat the bot plays now: a bot's, or a human's gone GRACE_MS while someone else is here.
function botPlays(room, s, now) {
  const seat = room.seats[s];
  if (seat.kind === "bot") return true;
  if (seat.kind !== "human" || connected(room, s)) return false;
  const p = room.players[seat.token];
  return p.goneAt != null && now - p.goneAt >= GRACE_MS && online(room);
}
// The bot moves for seat s; the move goes on `bots` with its why. If chooseMove throws,
// the first legal move is played (a room never hangs on a bot) and reported as only_move.
function botMove(room, s, bots) {
  const rng = E.makeRng(0); rng.state = room.botRng;
  let move, why;
  try { ({ move, why } = chooseMove(room.st, s, room.level, rng.next)); } catch { move = E.legalMoves(room.st, s)[0]; why = { key: "only_move" }; }
  room.botRng = rng.state;
  bots.push({ seat: s, move: E.clone(move), why: { ...why } });
  room.st = E.apply(room.st, s, move);
  room.wait[s] = null;
}
function advance(room, now, bots) {
  if (!room.started) return;
  for (let n = 0; n < BOT_CAP && room.st.phase !== "end"; n++) {
    const s = E.mustAct(room.st).find((x) => botPlays(room, x, now));
    if (s === undefined) return;
    botMove(room, s, bots);
  }
}
function refreshWait(room, now) {
  const must = room.started ? E.mustAct(room.st) : [];
  for (let s = 0; s < 3; s++) {
    if (must.includes(s) && connected(room, s)) { if (room.wait[s] == null) room.wait[s] = now; }
    else room.wait[s] = null;
  }
}
function nextAlarm(room, now) {
  const at = [];
  if (room.emptySince != null) at.push(room.emptySince + IDLE_MS);
  if (room.started && room.st.phase !== "end" && online(room)) {
    for (let s = 0; s < 3; s++) {
      if (room.wait[s] != null) at.push(room.wait[s] + TURN_MS);
      const seat = room.seats[s];
      if (seat.kind === "human" && !connected(room, s)) {
        const gone = room.players[seat.token].goneAt;
        if (gone != null && gone + GRACE_MS > now) at.push(gone + GRACE_MS);
      }
    }
  }
  return at.length ? Math.min(...at) : null;
}
function roomMsg(room) {
  const hostSeat = room.host != null ? room.players[room.host].seat : null;
  return {
    t: "room", code: room.code, host: hostSeat, started: room.started,
    seats: room.seats.map((seat, s) => seat.kind === "human"
      ? { kind: "human", name: room.players[seat.token].name, connected: connected(room, s) }
      : { kind: seat.kind, name: null, connected: seat.kind === "bot" }),
  };
}
// When the first connected human's pending decision times out (what the alarm acts on), or null.
function deadlineOf(room) {
  if (!room.started || room.st.phase === "end") return null;
  const at = room.wait.filter((w) => w != null).map((w) => w + TURN_MS);
  return at.length ? Math.min(...at) : null;
}
function stateMsg(room, seat, bots, deadline) {
  const must = E.mustAct(room.st).includes(seat);
  return { t: "state", seat, view: E.view(room.st, seat), legal: must ? E.legalMoves(room.st, seat) : [], botMoves: bots, deadline };
}
