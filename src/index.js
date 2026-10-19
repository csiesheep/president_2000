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
import { ADDRESS_HEADER } from "./room.js";
export { Limits } from "./address.js";
import { addressKey } from "./limits.js";

import { SITEMAP_XML, pageOf, langOf, rewriteHead } from "./head.js";

const PREFIX = "/president_2000";
// Prefix-scoped sitemap (src/head.js): the home page and the rules, each in both
// languages. Game modes are query strings on the one page and carry a canonical
// back to it.
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

// /president_2000/ws?create=1&lang=en    opens a fresh room
// /president_2000/ws?room=ABCD             joins (or reconnects to) a room
// The name and the seat token are not in the URL (#105: the request logs keep URLs): they come in the socket's first
// message, which the Room object reads (src/room.js). Per client address (#101; src/limits.js LIMITS, counted by the
// Limits object of that address): opening rooms is counted here; joins without a valid token are put to the Limits
// object by the Room, once it has the join, and the Worker hands it the address's key in ADDRESS_HEADER (overwriting
// anything the client sent under that name). The address is CF-Connecting-IP only (Cloudflare sets it;
// X-Forwarded-For and the like are the client's to write); an IPv6 address counts as its /64 (addressKey,
// orchestrator's ruling in #101).
async function connectRoom(request, env, url) {
  if (request.headers.get("Upgrade") !== "websocket") {
    return new Response("Expected a WebSocket", { status: 426 });
  }
  const ip = addressKey(request.headers.get("CF-Connecting-IP") || "unknown"); // IPv6 by its /64 (#101)
  let code = (url.searchParams.get("room") || "").toUpperCase();
  if (url.searchParams.get("create") === "1") {
    const limits = env.LIMITS.get(env.LIMITS.idFromName(ip));
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
  }
  const headers = new Headers(request.headers);
  headers.set(ADDRESS_HEADER, ip);
  const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
  return stub.fetch(new Request(url.toString(), { method: request.method, headers }));
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
    // The two pages get their head written per language (#104). Their stored file is the same for both languages and
    // the head changes with the Worker, so a conditional request must not get a 304 for the file: drop the validators.
    const page = pageOf(sub);
    let assetRequest = new Request(url, request);
    if (page) {
      const headers = new Headers(request.headers);
      headers.delete("if-none-match");
      headers.delete("if-modified-since");
      assetRequest = new Request(url, { method: request.method, headers, redirect: "manual" });
    }
    const response = await env.ASSETS.fetch(assetRequest);
    if (page && response.status === 200 && (response.headers.get("content-type") || "").startsWith("text/html")) {
      return rewriteHead(response, page, langOf(url.searchParams));
    }

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
