// The room page's wiring (M4, #15): the host and join forms, the WebSocket with its reconnecting, and
// the clicks. What the screen shows and what a click sends come from roomclient.js (which node runs
// against the real room core); this file only moves bytes between the socket, that client and the DOM.
// Importing it in node is harmless: nothing runs until mount() is called.
//
// sessionStorage keys (all JSON):
//   p2000.room.<CODE>   { token, name }   what a reload needs to sit down again in the same seat
//   p2000.room.name     the last name typed, to prefill the forms
//   p2000.room.level    the bot level the host last picked
import * as RC from "./roomclient.js";
import { COUNTIES } from "./shared/board.js";
import { esc } from "./table.js";

const NAME_KEY = "p2000.room.name", LEVEL_KEY = "p2000.room.level", roomKey = (code) => "p2000.room." + code;
const BACKOFF_MAX = 30; // seconds: 1, 2, 4, 8, 16, 30, 30, …

export function mount({ T, lang, qs, store, $ }) {
  const U = T.ui.room, F = U.form, C = U.conn;
  const en = lang === "en";
  const stage = $("#rstage"), banner = $("#rbanner"), leave = $("#rleave");
  const q = (extra) => { const p = new URLSearchParams(extra); if (en) p.set("lang", "en"); const s = p.toString(); return s ? "?" + s : "./"; };
  $("#land").hidden = true;
  $("#room").hidden = false;
  $("#rhome").href = "./" + (en ? "?lang=en" : "");
  $("#rhome").textContent = T.ui.solo.setup.home;
  const other = new URLSearchParams(location.search);
  if (en) other.delete("lang"); else other.set("lang", "en");
  $("#rlang").href = "?" + other.toString();
  $("#rlang").textContent = T.nav.lang;
  leave.textContent = C.leave;
  const title = (s) => { document.title = s + " · " + T.title; };

  // ---- the two forms
  const form = (kind, code) => {
    const host = kind === "host";
    title(host ? F.hostKicker : F.joinKicker);
    const name = store.get(NAME_KEY) || "";
    stage.innerHTML = `<form class="rform setup" data-kind="${kind}" novalidate><p class="kicker">${esc(host ? F.hostKicker : F.joinKicker)}</p>` +
      `<h1 class="st">${esc(host ? F.hostTitle : F.joinTitle)}</h1><p class="sub">${esc(host ? F.hostSub : F.joinSub)}</p>` +
      (host ? "" : `<label class="fl" for="fcode">${esc(F.code)}</label><input id="fcode" class="fi code" name="code" maxlength="4" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="${esc(F.codePh)}" value="${esc(code || "")}">`) +
      `<label class="fl" for="fname">${esc(F.name)}</label><input id="fname" class="fi" name="name" maxlength="24" autocomplete="nickname" placeholder="${esc(F.namePh)}" value="${esc(name)}">` +
      `<p class="rerr" role="alert" id="ferr" hidden></p><button type="submit" class="big go">${esc(host ? F.hostGo : F.joinGo)}</button></form>`;
    const first = host || code ? $("#fname") : $("#fcode");
    if (first) first.focus();
  };
  stage.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const f = ev.target, name = f.elements.name.value.trim(), err = $("#ferr");
    const fail = (msg) => { err.textContent = msg; err.hidden = false; };
    if (!name) return fail(F.needName);
    store.set(NAME_KEY, name);
    if (f.dataset.kind === "host") return run({ create: true, name });
    const code = f.elements.code.value.trim().toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(code)) return fail(F.badCode);
    location.href = q({ room: code });
  });

  // ---- the room
  let roomCode = null, name = "", client = RC.newClient(), sock = null, attempts = 0, retry = null, tick = null, terminal = false, gone = false;
  let ui = { open: null, sel: null, picks: [], level: [1, 2, 3].includes(store.get(LEVEL_KEY)) ? store.get(LEVEL_KEY) : 2 };

  const say = (text) => { banner.textContent = text || ""; banner.hidden = !text; };
  const draw = () => {
    if (gone) {
      stage.innerHTML = `<section class="lobby setup"><p class="rerr" role="alert">${esc(T.errors.no_room)}</p><a class="big go" href="${esc(q({ join: "1" }))}">${esc(F.joinGo)}</a></section>`;
      return;
    }
    stage.innerHTML = RC.screen(client, lang, { level: ui.level, open: ui.open || undefined, sel: ui.sel, picks: ui.picks });
  };
  const url = () => {
    const u = new URL("ws", location.href);
    u.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    if (roomCode) u.searchParams.set("room", roomCode); else u.searchParams.set("create", "1");
    u.searchParams.set("name", name);
    if (client.token) u.searchParams.set("token", client.token);
    return u.toString();
  };
  const connect = () => {
    clearTimeout(retry); clearInterval(tick);
    const s = new WebSocket(url());
    sock = s;
    s.onmessage = (ev) => {
      if (s !== sock) return;
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.t === "hello") { attempts = 0; say(""); }
      client = RC.receive(client, msg);
      if (msg.t === "room" && !roomCode) {
        roomCode = msg.code;
        history.replaceState(null, "", q({ room: roomCode }));
        $("#rlang").href = "?" + (en ? "room=" + roomCode : "room=" + roomCode + "&lang=en");
        leave.hidden = false;
      }
      if (roomCode && client.token) store.set(roomKey(roomCode), { token: client.token, name });
      if (msg.t === "error" && msg.code === "no_room") { terminal = gone = true; store.del(roomKey(roomCode)); s.close(); }
      draw();
    };
    s.onclose = () => {
      if (s !== sock || terminal) return;
      const wait = Math.min(BACKOFF_MAX, 2 ** attempts);
      attempts++;
      let left = wait;
      say(C.retry.replace("{n}", left));
      tick = setInterval(() => { left--; if (left > 0) say(C.retry.replace("{n}", left)); }, 1000);
      retry = setTimeout(() => { clearInterval(tick); say(C.retrying); connect(); }, wait * 1000);
    };
  };
  const send = (msg) => {
    client = { ...client, error: null };
    if (sock && sock.readyState === 1) sock.send(JSON.stringify(msg));
    draw();
  };
  function run({ create, code, name: n }) {
    name = n;
    title(U.lobby.kicker);
    if (!create) {
      roomCode = code;
      const rec = store.get(roomKey(code));
      if (rec && rec.token) client = { ...client, token: rec.token };
      leave.hidden = false;
    }
    draw();
    connect();
  }
  // Come back at once when the tab wakes or the network returns, instead of waiting out the backoff.
  const wake = () => { if (!terminal && sock && sock.readyState > 1) { attempts = 0; clearTimeout(retry); clearInterval(tick); say(C.retrying); connect(); } };
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") wake(); });
  addEventListener("online", wake);

  leave.addEventListener("click", () => {
    if (client.room && client.room.started && !confirm(C.leaveConfirm)) return;
    terminal = true;
    if (sock) sock.close();
    if (roomCode) store.del(roomKey(roomCode));
    location.href = "./" + (en ? "?lang=en" : "");
  });

  const toAct = () => { const a = $("#act"); if (a && a.scrollIntoView) a.scrollIntoView({ block: "start", behavior: "smooth" }); };
  stage.addEventListener("click", (ev) => {
    const t = ev.target.closest("button, a, [data-region]");
    if (!t) return;
    const d = t.dataset;
    if (d.msg) { const m = JSON.parse(d.msg); ui.sel = null; ui.picks = []; send(m); if (m.t === "move") window.scrollTo({ top: 0 }); }
    else if (d.move) { ui.sel = null; ui.picks = []; send({ t: "move", move: JSON.parse(d.move) }); window.scrollTo({ top: 0 }); }
    else if (d.level != null) { ui.level = +d.level; store.set(LEVEL_KEY, ui.level); draw(); }
    else if (d.copy) {
      const link = location.origin + location.pathname + "?room=" + roomCode;
      const done = () => { t.textContent = U.lobby.copied; setTimeout(() => { t.textContent = U.lobby.copy; }, 1500); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(done, () => {});
    }
    else if (d.sel != null) { ui.sel = d.sel || null; draw(); if (ui.sel) toAct(); }
    else if (d.pick != null) { ui.picks = ui.picks.includes(d.pick) ? ui.picks.filter((x) => x !== d.pick) : [...ui.picks, d.pick]; draw(); }
    else if (d.region != null) {
      const open = ui.open || [client.state ? COUNTIES[client.state.view.pos[client.state.view.seat]][1] : 0];
      const r = +d.region;
      ui.open = open.includes(r) ? open.filter((x) => x !== r) : [...open, r];
      draw();
    }
  });

  // ---- which page is this
  if (qs.has("host")) form("host");
  else if (qs.has("join")) form("join");
  else {
    const code = (qs.get("room") || "").toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(code)) { form("join"); return; }
    const rec = store.get(roomKey(code));
    const n = (rec && rec.name) || store.get(NAME_KEY);
    if (n || (rec && rec.token)) run({ code, name: n || "" });
    else form("join", code);
  }
}
