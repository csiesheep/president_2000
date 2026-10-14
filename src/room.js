// One Durable Object per multiplayer room, named by its four-letter code (M4, #13).
// Wiring only: every rule lives in roomcore.js, a pure function this object
// feeds with WebSocket events and alarms. Here: the WebSocket Hibernation API
// (each socket tagged with its conn id), the room in storage under "room", the
// one alarm at room.alarmAt, and deleting everything once room.dead.
import { newRoom, handle } from "./roomcore.js";

const MSG_MAX = 16 * 1024; // a move is a few hundred bytes

export class Room {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.room = undefined; // undefined = not loaded yet, null = no room here
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
    if (next.alarmAt != null) await this.ctx.storage.setAlarm(next.alarmAt);
    else await this.ctx.storage.deleteAlarm();
    // A socket the core no longer knows (its token reconnected elsewhere) is closed.
    for (const ws of this.ctx.getWebSockets()) {
      const conn = this.connOf(ws);
      if (conn && !(conn in next.conns) && !this.closing(ws)) { try { ws.close(4000, "replaced"); } catch {} }
    }
  }
  connOf(ws) { try { return ws.deserializeAttachment()?.conn || null; } catch { return null; } }
  closing(ws) { return ws.readyState !== undefined && ws.readyState >= 2; }

  async fetch(request) {
    const url = new URL(request.url);
    const room = await this.load();
    if (url.pathname.endsWith("/status")) return Response.json({ exists: !!room });
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected a WebSocket", { status: 426 });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    if (!room) {
      if (url.searchParams.get("create") !== "1") {
        // Through the hibernation API too: a plain accept() + close logs "Network
        // connection lost" in wrangler dev. The error arrives at once; the close
        // frame can take a few seconds there.
        this.ctx.acceptWebSocket(server, ["rejected"]);
        server.serializeAttachment({ conn: null });
        try { server.send(JSON.stringify({ t: "error", code: "no_room" })); server.close(1008, "no room"); } catch {}
        return new Response(null, { status: 101, webSocket: client });
      }
      const seed = crypto.getRandomValues(new Uint32Array(4)).join("-");
      this.room = newRoom({ code: (url.searchParams.get("room") || "").toUpperCase(), seed, now: Date.now() });
    }
    const conn = crypto.randomUUID();
    this.ctx.acceptWebSocket(server, [conn]);
    server.serializeAttachment({ conn });
    await this.run({ type: "open", conn, name: url.searchParams.get("name") || "", token: url.searchParams.get("token") || null });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    const conn = this.connOf(ws);
    if (!conn) return;
    let data = null;
    if (typeof raw === "string" && raw.length <= MSG_MAX) { try { data = JSON.parse(raw); } catch {} }
    await this.run({ type: "msg", conn, data });
  }

  async webSocketClose(ws, code, reason) {
    // Finish the closing handshake, or the client waits for our close frame.
    try { ws.close(code === 1005 || code === 1006 || !code ? 1000 : code, "bye"); } catch {}
    const conn = this.connOf(ws);
    if (conn) await this.run({ type: "close", conn });
  }
  async webSocketError(ws) { await this.webSocketClose(ws); }

  async alarm() { await this.run({ type: "alarm" }); }
}
