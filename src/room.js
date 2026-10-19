// One Durable Object per multiplayer room, named by its four-letter code (M4, #13).
// Wiring only: every rule lives in roomcore.js, a pure function this object
// feeds with WebSocket events and alarms. Here: the WebSocket Hibernation API
// (each socket tagged with its conn id), the room in storage under "room", the
// one alarm at room.alarmAt, and deleting everything once room.dead.
//
// Joining (#105). The socket's URL names the room (room=CODE, or create=1 with the code the Worker picked) and nothing
// else; the name and the seat token come in the socket's first message, { t: "join", name, token }, because the Worker's
// request logs keep URLs (and headers). Until that message the socket is nobody: no seat, nothing sent to it, not one
// of the core's connections. The join counts in LIMITS.msg like every message; a first message that is not a join is
// answered bad_message and the socket closed.
// #101 moves here with it: a join whose token is one this room handed out always gets in; any other join is first put
// to the Limits object of the client's address (the Worker passes its key in ADDRESS_HEADER), as the Worker did before:
// refused → rate_limited, no such room → no_room. A create join opens the room (the Worker counted the create).
// The URL's name= and token=, if any, are not read (orchestrator's ruling on #105: the old way in is gone; a tab opened
// before it reloads once). A socket whose join has not come JOIN_MS after it opened is closed (same ruling): the one
// alarm is the earlier of the room's alarmAt and the first such deadline, and alarm() runs the core only once alarmAt
// is due.
import { newRoom, handle } from "./roomcore.js";
import { LIMITS, step } from "./limits.js";

const MSG_MAX = 16 * 1024; // a move is a few hundred bytes
// A socket's join must come within JOIN_MS of its opening (orchestrator's ruling on #105: 10 s; the page sends the join
// the moment the socket opens, about one round trip, and a bad phone network with lost packets needs room). On timing
// out the socket gets { t: "error", code: "bad_message" } at once; in wrangler dev the close of a socket that never sent
// a frame reaches the client about 10 s later still (measured on #105: 10.0–10.1 s, every time).
export const JOIN_MS = 10_000;
export const ADDRESS_HEADER = "x-p2000-address"; // set by the Worker (src/index.js) from CF-Connecting-IP, never the client's

export class Room {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.room = undefined; // undefined = not loaded yet, null = no room here
    this.joinTimers = new Map(); // conn → the timer that closes it if its join has not come by then
  }

  async load() {
    if (this.room === undefined) this.room = (await this.ctx.storage.get("room")) || null;
    return this.room;
  }

  // Run one event through the core, store the result, send what it says, set the alarm.
  async run(ev) {
    const room = await this.load();
    if (!room) return;
    const { room: next, out } = handle(room, ev, Date.now());
    for (const { to, msg } of out) {
      const json = JSON.stringify(msg);
      for (const ws of this.ctx.getWebSockets(to)) { try { ws.send(json); } catch {} }
    }
    if (next.dead) {
      this.room = null;
      for (const ws of this.ctx.getWebSockets()) { try { ws.close(1000, "room closed"); } catch {} }
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.deleteAll();
      return;
    }
    this.room = next;
    await this.ctx.storage.put("room", next);
    await this.syncAlarm();
    // A socket the core no longer knows (its token reconnected elsewhere) is closed. A socket that has not joined yet is
    // not one the core knows to begin with (connOf is null for it).
    for (const ws of this.ctx.getWebSockets()) {
      const conn = this.connOf(ws);
      if (conn && !(conn in next.conns) && !this.closing(ws)) { try { ws.close(4000, "replaced"); } catch {} }
    }
  }
  attOf(ws) { try { return ws.deserializeAttachment() || {}; } catch { return {}; } }
  // the conn of a socket that has joined (null before its join, and for a refused one)
  connOf(ws) { const a = this.attOf(ws); return a.conn && !a.pending ? a.conn : null; }
  closing(ws) { return ws.readyState !== undefined && ws.readyState >= 2; }

  // The refused socket: one error, then closed; it is nobody's (conn null) from here on.
  shut(ws, code, why = code.replace("_", " ")) {
    try { ws.serializeAttachment({ conn: null }); } catch {}
    try { ws.send(JSON.stringify({ t: "error", code })); ws.close(1008, why); } catch {}
  }

  // The join (#105): the name and token of a socket that has not joined. Every way in goes through here.
  async admit(ws, name, token) {
    const att = this.attOf(ws);
    if (!att.conn || att.pending !== true) return;
    ws.serializeAttachment({ ...att, pending: "joining" }); // a second message while this one waits is not a second join
    clearTimeout(this.joinTimers.get(att.conn)); this.joinTimers.delete(att.conn);
    name = typeof name === "string" ? name : "";
    token = typeof token === "string" && token ? token : null;
    const isMember = (room) => !!(room && token && Object.prototype.hasOwnProperty.call(room.players, token));
    let room = await this.load();
    if (att.create) {
      // The Worker picked a code nobody held and counted the create. Taken since (another create, in between): close
      // without a word; the page opens a fresh create.
      if (room) { try { ws.serializeAttachment({ conn: null }); ws.close(1013, "try again"); } catch {} return; }
    } else if (!isMember(room)) {
      // A player with a token of this room always gets back in (many people share one address: a school, an office, a
      // phone carrier). Everyone else is refused once the address is, whether the room is there or not: refusing only
      // the misses would still tell which codes are open.
      const limits = this.env.LIMITS.get(this.env.LIMITS.idFromName(att.addr || "unknown"));
      let ok;
      try { ok = !!(await (await limits.fetch("https://limits/join?exists=" + (room ? "1" : "0"))).json()).ok; }
      catch { try { ws.serializeAttachment({ conn: null }); ws.close(1011, "try again"); } catch {} return; } // the page tries again
      if (this.closing(ws)) return; // it left while we asked
      if (!ok) return this.shut(ws, "rate_limited");
      room = await this.load(); // the room may have changed (or ended) meanwhile
      if (!room) return this.shut(ws, "no_room");
    }
    if (this.closing(ws)) return;
    if (!room) {
      const seed = crypto.getRandomValues(new Uint32Array(4)).join("-");
      this.room = newRoom({ code: att.code || "", seed, now: Date.now() });
    }
    ws.serializeAttachment({ ...this.attOf(ws), pending: false });
    await this.run({ type: "open", conn: att.conn, name, token });
  }

  async fetch(request) {
    const url = new URL(request.url);
    const room = await this.load();
    if (url.pathname.endsWith("/status")) return Response.json({ exists: !!room }); // the Worker's create picks a free code
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected a WebSocket", { status: 426 });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    // Through the hibernation API from the start (a plain accept() + close logs "Network connection lost" in wrangler dev).
    const conn = crypto.randomUUID();
    this.ctx.acceptWebSocket(server, [conn]);
    server.serializeAttachment({
      conn, pending: true, until: Date.now() + JOIN_MS,
      create: url.searchParams.get("create") === "1",
      code: (url.searchParams.get("room") || "").toUpperCase(),
      addr: request.headers.get(ADDRESS_HEADER) || "unknown",
    });
    this.joinTimers.set(conn, setTimeout(() => { this.joinTimers.delete(conn); this.expireJoins(); }, JOIN_MS + 20));
    await this.syncAlarm(); // its join deadline, in case the object is evicted before the timer
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    const att = this.attOf(ws);
    if (!att.conn) return;
    // #101: at most LIMITS.msg per connection, before the core sees it; every message counts, the ones it cannot read
    // too (a room that only counted what it understood could be flooded with nonsense), and the join too (#105). The
    // count rides on the socket's attachment, so it outlives the object being evicted (hibernation).
    const r = step(att.msgs, Date.now(), LIMITS.msg);
    ws.serializeAttachment({ ...att, msgs: r.times });
    if (!r.ok) { try { ws.send(JSON.stringify({ t: "error", code: "rate_limited" })); } catch {} return; }
    let data = null;
    if (typeof raw === "string" && raw.length <= MSG_MAX) { try { data = JSON.parse(raw); } catch {} }
    if (att.pending === true) {
      if (data && typeof data === "object" && data.t === "join") return this.admit(ws, data.name, data.token);
      return this.shut(ws, "bad_message"); // the first message must be the join
    }
    if (att.pending) return; // its join is still being decided
    await this.run({ type: "msg", conn: att.conn, data });
  }

  async webSocketClose(ws, code, reason) {
    // Finish the closing handshake, or the client waits for our close frame.
    try { ws.close(code === 1005 || code === 1006 || !code ? 1000 : code, "bye"); } catch {}
    const conn = this.connOf(ws);
    if (conn) await this.run({ type: "close", conn });
  }
  async webSocketError(ws) { await this.webSocketClose(ws); }

  // The one alarm: the room's own (room.alarmAt) or the first deadline of a socket still waiting for its join.
  joinDeadline() {
    let t = null;
    for (const ws of this.ctx.getWebSockets()) {
      const a = this.attOf(ws);
      if (a.conn && a.pending === true && Number.isFinite(a.until) && !this.closing(ws)) t = t == null ? a.until : Math.min(t, a.until);
    }
    return t;
  }
  async syncAlarm() {
    const at = [this.room ? this.room.alarmAt : null, this.joinDeadline()].filter((x) => x != null);
    if (at.length) await this.ctx.storage.setAlarm(Math.min(...at));
    else await this.ctx.storage.deleteAlarm();
  }

  // Close every socket whose join deadline has passed. Run by a timer set when the socket opens (it keeps the object
  // awake for those seconds; a close sent from an alarm that woke a hibernated object reached the client 10 s late in
  // wrangler dev), and by the alarm, for an object evicted in between.
  expireJoins(now = Date.now()) {
    for (const ws of this.ctx.getWebSockets()) {
      const a = this.attOf(ws);
      if (a.conn && a.pending === true && Number.isFinite(a.until) && a.until <= now) this.shut(ws, "bad_message", "no join");
    }
  }

  async alarm() {
    const now = Date.now();
    this.expireJoins(now);
    const room = await this.load();
    if (room && room.alarmAt != null && room.alarmAt <= now) await this.run({ type: "alarm" });
    else await this.syncAlarm();
  }
}
