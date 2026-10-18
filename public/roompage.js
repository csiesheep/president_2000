// The room page's wiring (M4, #15): the host and join forms, the WebSocket with its reconnecting, and
// the clicks. What the screen shows and what a click sends come from roomclient.js (which node runs
// against the real room core); this file only moves bytes between the socket, that client and the DOM.
// Importing it in node is harmless: nothing runs until mount() is called.
//
// sessionStorage keys (all JSON):
//   p2000.room.<CODE>   { token, name }   what a reload needs to sit down again in the same seat
//   p2000.room.name     the last name typed, to prefill the forms
//   p2000.room.level    the bot level the host last picked
//   p2000.advisor       whether the advisor switch is on (shared with the solo page)
import * as RC from "./roomclient.js";
import * as Sound from "./sound.js";
import * as Replay from "./replay.js";
import { esc, turnSeat } from "./table.js";
import { drawInto, deskNow, narrowNow, watchNarrow, bindCounty, bindSeat, bindMenu } from "./drawing.js";

const ADV_KEY = "p2000.advisor", NAME_KEY = "p2000.room.name", LEVEL_KEY = "p2000.room.level", roomKey = (code) => "p2000.room." + code;
const BACKOFF_MAX = 30; // seconds: 1, 2, 4, 8, 16, 30, 30, …

export function mount({ T, lang, qs, store, $ }) {
  const U = T.ui.room, F = U.form, C = U.conn;
  const en = lang === "en";
  const stage = $("#rstage"), banner = $("#rbanner"), leave = $("#rleave");
  const q = (extra) => { const p = new URLSearchParams(extra); if (en) p.set("lang", "en"); const s = p.toString(); return s ? "?" + s : "./"; };
  $("#land").hidden = true;
  $("#room").hidden = false;
  $("#rmenub").setAttribute("aria-label", T.ui.solo.menu.label);
  const menu = bindMenu($("#rmenu"));
  Sound.mountMenu($("#rmenu"), T.ui.solo.menu);
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
    if (ev.target.id === "chatf") {
      const text = ev.target.elements.text.value.trim();
      ui.draft = "";
      if (text) send({ t: "chat", text }); else draw();
      return;
    }
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
  let roomCode = null, name = "", client = RC.setAdvisor(RC.newClient(), store.get(ADV_KEY) === true), sock = null, attempts = 0, retry = null, tick = null, terminal = false, gone = false;
  let ui = { feed: deskNow(), raise: false, county: null, seat: null, narrow: narrowNow(), sel: null, picks: [], help: null, moves: false, confirm: null, draft: "", level: [1, 2, 3].includes(store.get(LEVEL_KEY)) ? store.get(LEVEL_KEY) : 2 };

  const say = (text) => { banner.textContent = text || ""; banner.hidden = !text; };
  // The turn card (#44): every player's own screen opens each turn with it, once (the turn it was shown for is kept in this
  // tab, per room). It only covers the table: the move clock keeps running underneath.
  const CARD_HOLD = 1500, CARD_FADE = 260, cardKey = () => "p2000.room.card." + roomCode;
  let card = null; // { turn, t0, hold, gone, out }
  const seenCard = () => store.get(cardKey());
  const cardView = () => (client.state && client.state.view && client.state.view.phase !== "end" ? client.state.view : null);
  const closeCard = (tapped) => {
    if (!card || card.out) return;
    card.out = true; clearTimeout(card.hold);
    if (tapped) Sound.play("tap");
    const el = stage.querySelector("[data-turncard]");
    if (el) el.classList.add("out");
    card.gone = setTimeout(() => { card = null; draw(); }, CARD_FADE);
  };
  // The rivals' moves shown big (#47): the server runs the computer in one go, so the cards and stamps come from the log entries
  // a state adds. The map is already the last picture; the stamps sit beside the card. A decision the player makes skips the rest.
  // The handoff card (#73 乙): when the seat the game waits for changes (the server has already run the computer), a small card over
  // the map names it for about a second. It holds nothing back: the move clock keeps running. A tap closes it.
  const HAND_HOLD = 520, HAND_FADE = 150;
  let hoff = null, handSeen = null;
  const handView = () => { const v = client.state && client.state.view; return v && v.phase !== "end" ? v : null; };
  const closeHand = (tapped) => {
    if (!hoff || hoff.out) return;
    hoff.out = true; clearTimeout(hoff.hold);
    if (tapped) Sound.play("tap");
    const el = stage.querySelector("[data-handoff]");
    if (el) el.classList.add("out");
    hoff.gone = setTimeout(() => { hoff = null; draw(); }, HAND_FADE);
  };
  const rep = Replay.createReplay({ labels: { hit: T.ui.solo.replay.hit, miss: T.ui.solo.replay.miss, next: T.ui.solo.menu.next }, lang, rules: () => client && client.state && client.state.view && client.state.view.rules, onIdle: () => draw(), ready: () => !card });
  // The sounds of a state (#42): plays, cubes put on / taken off (read off the two views), hit / miss. The turn sound is the turn card's.
  const hearState = (before, view, from) => {
    const beats = Replay.beatsOf(view.log, from, view.seat), names = (before ? Sound.soundsOf(before, view) : []).filter((n) => n !== "turn");
    const cubes = names.filter((n) => n === "cube" || n === "uncube");
    if (cubes.length) {
      if (beats.length) beats[beats.length - 1].sounds = cubes;
      else beats.push({ id: null, seat: view.seat, kind: "move", checks: [], cubes: [], sounds: cubes });
    }
    Replay.leftover(names, beats).forEach((n, i) => Sound.play(n, i, Math.min(i * 0.12, 0.5)));
    rep.push(beats);
  };
  Replay.bindTaps({ active: () => rep.active(), onStep: () => { rep.skipStep(); }, onAll: () => { rep.skipAll(); draw(); },
    ignore: "[data-menu], [data-menu-top], #rmenu, .mset, [data-turncard], [data-handoff], [data-rp-next], a, input, textarea, form, .t-chat" });
  addEventListener("p2000:settings", () => { if (Sound.getSpeed() !== "step") rep.skipStep(); });
  const draw = () => {
    if (gone) {
      $("#room").classList.remove("intable");
      stage.innerHTML = `<section class="lobby setup"><p class="rerr" role="alert">${esc(T.errors.no_room)}</p><a class="big go" href="${esc(q({ join: "1" }))}">${esc(F.joinGo)}</a></section>`;
      return;
    }
    const cv = cardView();
    if (card && cv && cv.turn !== card.turn) { card.turn = cv.turn; store.set(cardKey(), cv.turn); }
    if (!card && cv && roomCode && seenCard() !== cv.turn && !rep.running()) {
      store.set(cardKey(), cv.turn);
      card = { turn: cv.turn, t0: performance.now(), out: false };
      card.hold = setTimeout(() => closeCard(false), CARD_HOLD);
      Sound.play("turn");
    }
    const hv = handView(), ha = hv ? turnSeat(hv) : null;
    if (!hoff && !card && ha != null && ha !== handSeen && !rep.running()) {
      handSeen = ha;
      hoff = { seat: ha, t0: performance.now(), out: false };
      // (the hold is counted from the end of the draw that shows it: a cold draw can take 200 ms, which must not be taken off the hold)
    }
    // A redraw replaces the chat box: keep what is typed, and the caret if the box had focus.
    const box = $("#chatin"), had = box && document.activeElement === box, caret = had ? [box.selectionStart, box.selectionEnd] : null;
    const log = stage.querySelector(".chatlog"), pinned = !log || log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    drawInto(stage, RC.screen(client, lang, { feedOpen: ui.feed, raise: ui.raise, level: ui.level, county: ui.county == null ? undefined : ui.county, narrow: ui.narrow, sel: ui.sel, picks: ui.picks, draft: ui.draft, help: ui.help, moves: ui.moves, confirm: ui.confirm, turnCard: !!card && !card.out && !!cv, cardAge: card ? performance.now() - card.t0 : 0, handoff: hoff && !hoff.out && !!hv ? hoff.seat : undefined, handoffAge: hoff ? performance.now() - hoff.t0 : 0 }), { seat: ui.seat, menu: menu.isOpen() });
    // At the table the top row has its own menu button, so the page's top bar steps aside.
    $("#room").classList.toggle("intable", !!stage.querySelector(".tbl"));
    const nb = $("#chatin");
    if (nb && had) { nb.focus({ preventScroll: true }); try { nb.setSelectionRange(caret[0], caret[1]); } catch { /* not a text field */ } }
    const nl = stage.querySelector(".chatlog");
    if (nl && pinned) nl.scrollTop = nl.scrollHeight;
    if (hoff && !hoff.hold && !hoff.out) hoff.hold = setTimeout(() => closeHand(false), HAND_HOLD);
    autoCheck();
  };
  // #70: a decision with one option only is sent by the page itself, one beat (about 0.7 s) after it is this seat's turn: the
  // turn card is gone, the replay is over, nothing of ours is in flight. A state that was already tried is not tried again
  // (a refused move leaves the table as it was and the player decides).
  let autoTimer = null, autoFor = null;
  const autoCheck = () => {
    const m = !gone && !terminal && !card && !rep.active() && client.state && !client.sentMove ? RC.autoMove(client, lang) : null;
    if (!m) { clearTimeout(autoTimer); autoTimer = null; autoFor = null; return; }
    if (autoTimer && autoFor === client.state) return;
    clearTimeout(autoTimer); autoFor = client.state;
    autoTimer = setTimeout(() => {
      autoTimer = null;
      const k = !card && !rep.active() && !client.sentMove && autoFor === client.state ? RC.autoMove(client, lang) : null;
      if (!k) return;
      ui.sel = null; ui.raise = false; ui.picks = []; ui.moves = false; ui.confirm = null; ui.county = null;
      send({ t: "move", move: k.move }, { auto: k.label });
    }, 700);
  };
  // The move clock: rewrite the seconds in place once a second, without redrawing the page.
  const clockTick = () => {
    for (const el of stage.querySelectorAll(".clock[data-deadline]")) {
      const left = Math.max(0, Math.ceil((+el.dataset.deadline - Date.now()) / 1000));
      el.dataset.left = String(left);
      el.textContent = U.game.left.replace("{n}", left);
      el.classList.toggle("low", left <= 10);
    }
  };
  setInterval(clockTick, 1000);
  stage.addEventListener("input", (ev) => { if (ev.target.id === "chatin") ui.draft = ev.target.value; });
  const url = () => {
    const u = new URL("ws", location.href);
    u.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    if (roomCode) u.searchParams.set("room", roomCode); else u.searchParams.set("create", "1");
    u.searchParams.set("name", name);
    if (client.token) u.searchParams.set("token", client.token);
    return u.toString();
  };
  let sawLobby = false; // this page saw the room before the game began (a reload in mid-game has not: it replays nothing)
  const connect = () => {
    clearTimeout(retry); clearInterval(tick);
    const s = new WebSocket(url());
    sock = s;
    s.onmessage = (ev) => {
      if (s !== sock) return;
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.t === "hello") { attempts = 0; say(""); }
      const pv = client.state && client.state.view, pl = client.snap ? client.snap.logLen : null;
      client = RC.receive(client, msg);
      if (msg.t === "state" && msg.view && Array.isArray(msg.view.log)) {
        if (pv && Array.isArray(pv.log) && pl != null && msg.view.log.length >= pl) hearState(pv, msg.view, pl);
        else if (!pv && sawLobby) { draw(); hearState(null, msg.view, 0); } // the game just started: what the computer did before this seat's first turn
        sawLobby = false;
      }
      if (msg.t === "room" && !msg.started) sawLobby = true;
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
  const send = (msg, opts = {}) => {
    if (msg.t === "move") rep.skipAll(); // a decision skips the rest of the replay
    client = RC.sent({ ...client, error: null }, msg.t === "move" ? msg.move : null);
    if (msg.t === "move") client = { ...client, autoNote: opts.auto != null ? { text: opts.auto } : null }; // #70: the note stays until the player next decides
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

  stage.addEventListener("click", (ev) => { // the turn card: a tap anywhere on it closes it and does nothing else
    if (!ev.target.closest("[data-turncard]")) return;
    ev.stopImmediatePropagation(); ev.stopPropagation();
    closeCard(true);
  });
  stage.addEventListener("click", (ev) => { // the handoff card: the same
    if (!ev.target.closest("[data-handoff]")) return;
    ev.stopImmediatePropagation(); ev.stopPropagation();
    closeHand(true);
  });
  addEventListener("keydown", (ev) => { if (ev.key === "Escape" && card && !card.out) closeCard(true); else if (ev.key === "Escape" && hoff && !hoff.out) closeHand(true); });
  // (#66: the table is one screen that never scrolls, so a tapped card or a question no longer scrolls to the decision)
  stage.addEventListener("click", (ev) => {
    const t = ev.target.closest("button, a");
    if (!t) return;
    const d = t.dataset;
    if (d.msg) { const m = JSON.parse(d.msg); ui.sel = null; ui.raise = false; ui.picks = []; send(m); if (m.t === "move") window.scrollTo({ top: 0 }); }
    else if (d.confirm && d.move) { ui.confirm = d.move; ui.sel = null; ui.county = null; draw(); }
    else if (d.move) { ui.sel = null; ui.raise = false; ui.picks = []; ui.moves = false; ui.confirm = null; ui.county = null; send({ t: "move", move: JSON.parse(d.move) }); if (d.pop == null) window.scrollTo({ top: 0 }); }
    else if (d.cancel) { ui.confirm = null; draw(); }
    else if (d.help != null) { ui.help = d.help && ui.help !== d.help ? d.help : null; draw(); }
    else if (d.toggle === "moves") { ui.moves = !ui.moves; draw(); }
    else if (d.advisor != null) { client = RC.setAdvisor(client, d.advisor === "on"); store.set(ADV_KEY, client.advisor); draw(); }
    else if (d.level != null) { ui.level = +d.level; store.set(LEVEL_KEY, ui.level); draw(); }
    else if (d.copy) {
      const link = location.origin + location.pathname + "?room=" + roomCode;
      const done = () => { t.textContent = U.lobby.copied; setTimeout(() => { t.textContent = U.lobby.copy; }, 1500); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(done, () => {});
    }
    else if (d.sel != null) { ui.sel = d.sel && d.sel !== ui.sel ? d.sel : null; if (ui.sel) ui.confirm = null; else ui.raise = false; draw(); }
    else if (d.handToggle != null) { ui.raise = !(ui.raise || !!ui.sel); if (!ui.raise) ui.sel = null; draw(); }
    else if (d.feedToggle != null) { ui.feed = !ui.feed; draw(); }
    else if (d.pick != null) { ui.picks = ui.picks.includes(d.pick) ? ui.picks.filter((x) => x !== d.pick) : [...ui.picks, d.pick]; draw(); }
  });
  stage.addEventListener("click", (ev) => { // a hand card or a county tapped (#42)
    const c = ev.target.closest("[data-sel], [data-county]");
    if (c && (c.dataset.county != null || c.dataset.sel)) Sound.play("tap");
  });
  bindCounty(stage, { get: () => ui.county, set: (k) => { ui.county = k; }, redraw: () => draw() });
  bindSeat(stage, { get: () => ui.seat, set: (p) => { ui.seat = p; }, redraw: () => draw() });
  watchNarrow((n) => { ui.narrow = n; draw(); });

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
