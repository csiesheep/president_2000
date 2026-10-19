// One Durable Object per client address (#101), named by its CF-Connecting-IP: the counts behind LIMITS.miss and
// LIMITS.create (src/limits.js, which decides; this object only keeps the lists). An address guesses a different room
// code every time, so the counts cannot live in the rooms; and they are in storage, not in memory, because an object
// left idle is evicted: someone guessing once every 30 s would otherwise meet a fresh, empty count every time.
// Only the Worker talks to it:
//   https://limits/join?exists=0|1   a join without a valid token, to a room that exists or not → { ok }
//                                    refused once the address has had LIMITS.miss.max misses within LIMITS.miss.per;
//                                    a miss (no such room) and a refused join each count as one more
//   https://limits/create            a room opened → { ok } (every call counts, as limiter does)
//   https://limits/refuse            (a WebSocket upgrade) the refused socket: { t: "error", code: "rate_limited" }, closed
// Once nothing it holds is inside a window any more, the alarm deletes it all.
import { LIMITS, count, step } from "./limits.js";

const KEEP = Math.max(LIMITS.miss.per, LIMITS.create.per);

export class Limits {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url), now = Date.now();
    let ok;
    if (url.pathname === "/join") {
      const exists = url.searchParams.get("exists") === "1";
      const misses = (await this.ctx.storage.get("miss")) || [];
      if (exists && count(misses, now, LIMITS.miss) < LIMITS.miss.max) {
        ok = true; // a join to a room that is there, while the address is not refused: nothing to count
      } else {
        const r = step(misses, now, LIMITS.miss);
        await this.ctx.storage.put("miss", r.times);
        ok = r.ok;
      }
    } else if (url.pathname === "/create") {
      const r = step((await this.ctx.storage.get("create")) || [], now, LIMITS.create);
      await this.ctx.storage.put("create", r.times);
      ok = r.ok;
    } else if (url.pathname === "/refuse" && request.headers.get("Upgrade") === "websocket") {
      // The refused socket itself, through the hibernation API as the Room's no_room is (a plain accept() + close in the
      // Worker logs "Network connection lost").
      const [client, server] = Object.values(new WebSocketPair());
      this.ctx.acceptWebSocket(server, ["refused"]);
      try { server.send(JSON.stringify({ t: "error", code: "rate_limited" })); server.close(1008, "rate limited"); } catch {}
      return new Response(null, { status: 101, webSocket: client });
    } else {
      return new Response("Not found", { status: 404 });
    }
    if ((await this.ctx.storage.getAlarm()) == null) await this.ctx.storage.setAlarm(now + KEEP + 1000);
    return Response.json({ ok });
  }

  webSocketMessage() {} // a refused socket has nothing to say
  webSocketClose(ws, code) { try { ws.close(code === 1005 || code === 1006 || !code ? 1000 : code, "bye"); } catch {} }
  webSocketError(ws) { this.webSocketClose(ws); }

  async alarm() {
    const all = [...((await this.ctx.storage.get("miss")) || []), ...((await this.ctx.storage.get("create")) || [])];
    const last = all.length ? Math.max(...all) : -Infinity;
    if (Date.now() - last >= KEEP) await this.ctx.storage.deleteAll();
    else await this.ctx.storage.setAlarm(last + KEEP + 1000);
  }
}
