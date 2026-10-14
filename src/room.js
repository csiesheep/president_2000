// One Durable Object per multiplayer room, named by its four-letter code.
// M0 placeholder: the room exists so the Worker deploys; rooms are built in M4
// (WebSocket Hibernation API, per-seat view(state, seat), bots fill seats).
export class Room {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/status") {
      return new Response(JSON.stringify({ exists: false }), { headers: { "content-type": "application/json" } });
    }
    return new Response("Rooms open in M4.", { status: 501 });
  }
}
