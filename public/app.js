// The page: the landing, the solo setup (?play) and the solo table. Every visible word comes from
// i18n/; the game itself lives in solo.js and table.js, which run in node as well. All the
// DOM wiring sits under the guard below so importing this file in node is harmless.
import en from "./i18n/en.js";
import zh from "./i18n/zh-Hant.js";
import * as Solo from "./solo.js";
import * as Tut from "./tutorial.js";
import { mount as mountRoom } from "./roompage.js";
import { drawInto, narrowNow, watchNarrow, bindCounty, bindSeat, bindMenu, placeTutorial } from "./drawing.js";

if (typeof document !== "undefined") {
  const qs = new URLSearchParams(location.search);
  const code = qs.get("lang") === "en" ? "en" : "zh-Hant";
  const T = code === "en" ? en : zh, S = T.ui.solo;
  const KEY = "p2000.solo.session", SETUP = "p2000.solo.setup", ADV = "p2000.advisor";
  const $ = (sel) => document.querySelector(sel);
  const store = {
    get(k) { try { return JSON.parse(sessionStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode: play on without saving */ } },
    del(k) { try { sessionStorage.removeItem(k); } catch { /* nothing to remove */ } },
  };
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const path = (o, p) => p.split(".").reduce((x, k) => (x == null ? x : x[k]), o);
  const other = code === "en" ? "" : "en"; // the language the switch button leads to

  document.documentElement.lang = T.lang;
  for (const el of document.querySelectorAll("[data-i18n]")) {
    let v = path(T, el.dataset.i18n);
    // The big "2000" above is its own element: the name line keeps only what follows it.
    if (el.dataset.i18n === "title" && typeof v === "string") v = v.replace(/^2000\s*[：:]\s*/, "");
    if (typeof v === "string") el.textContent = v;
  }
  const langLink = $("#lang"), gLang = $("#glang");
  langLink.textContent = T.nav.lang; gLang.textContent = T.nav.lang;
  langLink.href = other ? "?lang=en" : "./";
  $("#rules").href = "rules" + (code === "en" ? "?lang=en" : "");
  $("#play").href = "?play" + (code === "en" ? "&lang=en" : "");
  $("#tutorial").href = "?tutorial" +(code === "en" ? "&lang=en" : "");
  $("#host").href = "?host" + (code === "en" ? "&lang=en" : "");
  $("#join").href = "?join" + (code === "en" ? "&lang=en" : "");
  $("#home").href = "./" + (code === "en" ? "?lang=en" : "");
  $("#home").textContent = S.setup.home;
  $("#quit").textContent = S.menu.quit;

  const soloPage = qs.has("play") || qs.has("tutorial");
  if (!soloPage && (qs.has("host") || qs.has("join") || qs.has("room"))) {
    mountRoom({ T, lang: code, qs, store, $ });
  } else if (!soloPage) {
    document.title = T.title;
  } else {
    $("#land").hidden = true;
    $("#solo").hidden = false;
    document.title = S.land.solo + " · " + T.title;
    const stage = $("#stage");
    $("#gmenub").setAttribute("aria-label", S.menu.label);
    const menu = bindMenu($("#gmenu"));
    let session = store.get(KEY);
    // ?tutorial (#27): a tutorial in progress is picked up again (a reload comes back to the same step);
    // otherwise it starts the fixed game. The address turns into plain ?play once the tutorial is over.
    let tutorialUrl = qs.has("tutorial") && !qs.has("play");
    if (tutorialUrl && !(session && session.st && session.tut)) { session = Tut.newTutorial(); store.set(KEY, session); }
    const syncUrl = () => {
      if (tutorialUrl && !(session && session.tut)) {
        tutorialUrl = false;
        try { history.replaceState(null, "", "?play" + (code === "en" ? "&lang=en" : "")); } catch { /* no history: keep the address */ }
      }
      gLang.href = "?" + (tutorialUrl ? "tutorial" : "play") + (other ? "&lang=en" : "");
    };
    syncUrl();
    let ui = { sel: null, picks: [], help: null, moves: false, confirm: null, county: null, seat: null, narrow: narrowNow() };
    let timer = null;
    const save = () => store.set(KEY, session);

    const draw = () => {
      syncUrl();
      // The tutorial's "player board" step is about the hand and the bag: on a phone that board shows them while it is on.
      const boardStep = !!(session.tut && Tut.step(session, code).id === "board");
      drawInto(stage, Solo.screen(session, code, { sel: ui.sel, picks: ui.picks, help: ui.help, moves: ui.moves, confirm: ui.confirm, county: ui.county == null ? undefined : ui.county, narrow: ui.narrow }), { seat: boardStep ? session.seat : ui.seat, menu: menu.isOpen() });
      $("#solo").classList.add("intable");
      $("#quit").hidden = false;
      placeTutorial(stage);
    };
    const pump = () => {
      draw();
      if (timer || !Solo.botsToMove(session).length) return;
      timer = setTimeout(() => { timer = null; session = Solo.stepBot(session); save(); pump(); }, 400);
    };
    const skip = () => {
      if (!timer) return;
      clearTimeout(timer); timer = null;
      session = Solo.advance(session); save(); draw();
    };
    // (in the tutorial the bubble decides what scrolls)
    const toAct = () => { if (session && session.tut) return; const a = $("#act"); if (a && a.scrollIntoView) a.scrollIntoView({ block: "start", behavior: "smooth" }); };

    const setup = () => {
      syncUrl();
      $("#solo").classList.remove("intable");
      $("#quit").hidden = true;
      const pick = store.get(SETUP) || { seat: 0, level: 2 };
      const seatOrder = [1, 2, 0], keys = ["chen", "soong", "lien"], no = [5, 1, 2];
      const cards = seatOrder.map((p) => {
        const c = S.cand[keys[p]], on = pick.seat === p;
        return `<button type="button" class="cand s${p}${on ? " on" : ""}" data-seat="${p}" aria-pressed="${on}"><span class="pic"><img src="art/candidates/${keys[p]}.webp" alt="" width="480" height="640" loading="lazy" decoding="async"><b class="no">${no[p]}</b></span>` +
          `<span class="cb"><span class="nm">${esc(c.name)}</span><span class="bl">${esc(c.blurb)}</span></span><span class="tag">${esc(on ? S.setup.picked : S.setup.pick)}</span></button>`;
      }).join("");
      const levels = [1, 2, 3].map((n) => `<button type="button" class="lv${pick.level === n ? " on" : ""}" data-level="${n}" aria-pressed="${pick.level === n}">${esc(T.bots[n])}</button>`).join("");
      drawInto(stage, `<section class="setup"><p class="kicker">${esc(S.setup.kicker)}</p><h1 class="st">${esc(S.setup.title)}</h1><p class="sub">${esc(S.setup.sub)}</p>` +
        `<div class="cands">${cards}</div><h2 class="lh">${esc(S.setup.level)}</h2><div class="lvs">${levels}</div><p class="sub">${esc(S.setup.levelNote[pick.level])}</p>` +
        `<button type="button" class="big go" data-start="1">${esc(S.setup.start)}</button><p class="note">${esc(S.setup.note)}</p>` +
        `<p class="note"><a class="tutlink" href="?tutorial${code === "en" ? "&amp;lang=en" : ""}">${esc(T.ui.tutorial.setupLink)}</a></p></section>`);
    };

    stage.addEventListener("click", (ev) => {
      const t = ev.target.closest("button, a");
      if (timer) { skip(); if (t && t.tagName !== "A") return; }
      if (!t) return;
      const d = t.dataset;
      if (d.tut) {
        // The tutorial's bubble: next, or out of the tutorial (what is left is a normal game).
        session = d.tut === "skip" ? Tut.skip(session) : Tut.next(session);
        ui = { ...ui, sel: null, picks: [], confirm: null, county: null, seat: null };
        save(); pump(); // the bubble scrolls the next target into view itself
      } else if (d.seat != null) { const p = store.get(SETUP) || { seat: 0, level: 2 }; store.set(SETUP, { ...p, seat: +d.seat }); setup(); }
      else if (d.level != null) { const p = store.get(SETUP) || { seat: 0, level: 2 }; store.set(SETUP, { ...p, level: +d.level }); setup(); }
      else if (d.start) {
        const p = store.get(SETUP) || { seat: 0, level: 2 };
        const seed = crypto.getRandomValues(new Uint32Array(1))[0];
        session = Solo.setAdvisor(Solo.advance(Solo.newSolo({ seat: p.seat, level: p.level, seed })), store.get(ADV) === true);
        ui = { sel: null, picks: [], help: null, moves: false, confirm: null, county: null, seat: null, narrow: narrowNow() };
        save(); pump(); window.scrollTo(0, 0);
      } else if (d.advisor != null) {
        session = Solo.setAdvisor(session, d.advisor === "on"); store.set(ADV, session.advisor);
        save(); draw();
      } else if (d.confirm && d.move) {
        // The candidate card is once a game: ask first (the table draws the question).
        ui.confirm = d.move; ui.sel = null; draw(); toAct();
      } else if (d.move) {
        const m = JSON.parse(d.move);
        session = session.tut ? Tut.act(session, m) : Solo.act(session, m);
        ui.sel = null; ui.picks = []; ui.moves = false; ui.confirm = null; ui.county = null;
        save(); pump(); if (d.pop == null) window.scrollTo({ top: 0 }); // from the county box, stay on the map
      } else if (d.cancel) { ui.confirm = null; draw();
      } else if (d.help != null) { ui.help = d.help && ui.help !== d.help ? d.help : null; draw();
      } else if (d.toggle === "moves") { ui.moves = !ui.moves; draw();
      } else if (d.sel != null) { ui.sel = d.sel || null; if (ui.sel) ui.confirm = null; draw(); if (ui.sel) toAct(); }
      else if (d.pick != null) {
        ui.picks = ui.picks.includes(d.pick) ? ui.picks.filter((x) => x !== d.pick) : [...ui.picks, d.pick];
        draw();
      } else if (d.act === "again") { store.del(KEY); session = null; setup(); window.scrollTo(0, 0); }
    });
    // The map: a county opens its box; the phone and the desktop board are different drawings.
    bindCounty(stage, { get: () => ui.county, set: (k) => {
      ui.county = k;
      // Tapping the county the tutorial asked for is its step.
      if (k != null && session && session.tut) { const n = Tut.openCounty(session, k); if (n !== session) { session = n; save(); } }
    }, redraw: () => { if (session && session.st) draw(); } });
    bindSeat(stage, { get: () => ui.seat, set: (p) => { ui.seat = p; }, redraw: () => { if (session && session.st) draw(); } });
    watchNarrow((n) => { ui.narrow = n; if (session && session.st) draw(); });
    $("#quit").addEventListener("click", () => {
      if (!confirm(S.menu.confirm)) return;
      if (timer) { clearTimeout(timer); timer = null; }
      store.del(KEY); session = null; setup();
    });

    if (session && session.st) pump(); else setup();
  }
}
