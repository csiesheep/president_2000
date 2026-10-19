// Cloudflare Worker: path-prefix router in front of the static assets, plus the
// WebSocket entry point for multiplayer rooms (one Durable Object per room).
//
// `run_worker_first: true` (wrangler.jsonc) sends every request here before
// asset matching, so we can strip the prefix and still serve from
// the bare *.workers.dev root (or `wrangler dev`) while testing.
//
// The public path segment is independent of the repo / Worker name — change
// PREFIX alone to move the site to a different path.
export { Room } from "./room.js";
export { Limits } from "./address.js";
import { addressKey } from "./limits.js";

const PREFIX = "/president_2000";
const CANONICAL = "https://games.csiesheep.com" + PREFIX + "/";
// Prefix-scoped sitemap. Game modes are query strings on the one page and
// carry a canonical back to it, so the page and the rules are all there is.
const SITEMAP_XML = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  "  <url>",
  "    <loc>" + CANONICAL + "</loc>",
  "  </url>",
  "  <url>",
  "    <loc>" + CANONICAL + "rules</loc>",
  "  </url>",
  "</urlset>",
  "",
].join(String.fromCharCode(10));
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function newCode() {
  let c = "";
  for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return c;
}

// A socket that gets { t: "error", code: "rate_limited" } and is closed (#101), made by the address's Limits object.
const refuse = (limits, request) => limits.fetch(new Request("https://limits/refuse", request));
async function askLimits(limits, path) {
  const res = await limits.fetch("https://limits" + path);
  return !!(await res.json()).ok;
}

// /president_2000/ws?create=1&name=Alice&lang=en    opens a fresh room
// /president_2000/ws?room=ABCD&name=Bob&token=…     joins (or reconnects to) a room
// Per client address (#101; src/limits.js LIMITS, counted by the Limits object of that address): opening rooms, and joins
// without a valid token once the address has guessed too many codes that are not there. The address is CF-Connecting-IP
// only (Cloudflare sets it; X-Forwarded-For and the like are the client's to write); an IPv6 address counts as its /64
// (addressKey, orchestrator's ruling in #101).
async function connectRoom(request, env, url) {
  if (request.headers.get("Upgrade") !== "websocket") {
    return new Response("Expected a WebSocket", { status: 426 });
  }
  const ip = addressKey(request.headers.get("CF-Connecting-IP") || "unknown"); // IPv6 by its /64 (#101)
  const limits = env.LIMITS.get(env.LIMITS.idFromName(ip));
  let code = (url.searchParams.get("room") || "").toUpperCase();
  if (url.searchParams.get("create") === "1") {
    if (!(await askLimits(limits, "/create"))) return refuse(limits, request);
    // Pick a code nobody holds. Rooms are named by their code, so ask the
    // object whether it already has state.
    for (let i = 0; i < 20; i++) {
      code = newCode();
      const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
      const res = await stub.fetch("https://room/status");
      if (!(await res.json()).exists) break;
    }
    url.searchParams.set("room", code);
  } else if (!/^[A-Z0-9]{4}$/.test(code)) {
    return new Response("Bad room code", { status: 400 });
  } else {
    // A player with a token of this room always gets back in (many people share one address: a school, an office, a
    // phone carrier). Everyone else is refused once the address is, whether the room is there or not: refusing only the
    // misses would still tell which codes are open.
    const token = url.searchParams.get("token");
    const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
    const status = await (await stub.fetch("https://room/status" + (token ? "?token=" + encodeURIComponent(token) : ""))).json();
    if (!status.member && !(await askLimits(limits, "/join?exists=" + (status.exists ? "1" : "0")))) return refuse(limits, request);
  }
  const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
  return stub.fetch(new Request(url.toString(), request));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === PREFIX) {
      url.pathname = PREFIX + "/";
      return Response.redirect(url.toString(), 301);
    }

    if (!url.pathname.startsWith(PREFIX + "/")) {
      return new Response("Not found", { status: 404 });
    }

    const sub = url.pathname.slice(PREFIX.length);
    if (sub === "/ws") return connectRoom(request, env, url);
    if (sub === "/sitemap.xml") {
      return new Response(SITEMAP_XML, { headers: { "content-type": "application/xml; charset=utf-8" } });
    }

    url.pathname = sub;
    const response = await env.ASSETS.fetch(new Request(url, request));

    // The static-asset handler builds Location from the url we just stripped
    // the prefix off, so a same-origin redirect would escape this Worker and
    // 404 on the hub. Put the prefix back on.
    const location = response.headers.get("location");
    if (location) {
      const target = new URL(location, url);
      if (
        target.origin === url.origin &&
        target.pathname !== PREFIX &&
        !target.pathname.startsWith(PREFIX + "/")
      ) {
        target.pathname = PREFIX + target.pathname;
        const headers = new Headers(response.headers);
        headers.set("location", target.toString());
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      }
    }
    return response;
  },
};
