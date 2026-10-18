// The page: the landing, the solo setup (?play) and the solo table. Every visible word comes from
// i18n/; the game itself lives in solo.js and table.js, which run in node as well. All the
// DOM wiring sits under the guard below so importing this file in node is harmless.
import en from "./i18n/en.js";
import zh from "./i18n/zh-Hant.js";
import * as Solo from "./solo.js";
import * as Tut from "./tutorial.js";
import * as Sound from "./sound.js";
import * as Replay from "./replay.js";
import * as E from "./shared/engine.js";
import { mount as mountRoom } from "./roompage.js";
import { drawInto, deskNow, narrowNow, watchNarrow, bindCounty, bindSeat, bindMenu, placeTutorial } from "./drawing.js";

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
    document.documentElement.classList.remove("boot");
  } else if (!soloPage) {
    document.title = T.title;
  } else {
    $("#land").hidden = true;
    $("#solo").hidden = false;
    document.documentElement.classList.remove("boot");
    document.title = S.land.solo + " · " + T.title;
    const stage = $("#stage");
    $("#gmenub").setAttribute("aria-label", S.menu.label);
    const menu = bindMenu($("#gmenu"));
    Sound.mountMenu($("#gmenu"), S.menu);
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
    let ui = { feed: deskNow() && !(session && session.tut), raise: false, sel: null, picks: [], help: null, moves: false, confirm: null, county: null, seat: null, narrow: narrowNow() };
    let timer = null;
    const save = () => store.set(KEY, session);
    // A line that shows for a moment and goes (#43: "went back one step").
    let noticeTimer = null;
    const notice = (text) => {
      let n = $("#notice");
      if (!n) { n = document.createElement("div"); n.id = "notice"; n.className = "notice"; n.setAttribute("role", "status"); document.body.appendChild(n); }
      n.textContent = text; n.hidden = false;
      clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { n.hidden = true; }, 1800);
    };

    // The sounds of whatever changed the game since the last draw (#42): read off the two engine states.
    // A rival's step is replayed (#47): its play / cube / hit / miss sounds belong to the replay's own timeline, so hear() leaves
    // them out (quiet) and makes only the turn sound itself.
    let heard = null, quiet = false;
    const hear = () => {
      if (!session || !session.st) { heard = null; return; }
      if (heard && heard.seed === session.seed && heard.st !== session.st) {
        if (quiet) { if (Sound.soundsOf(heard.st, session.st).includes("turn")) Sound.play("turn"); } else Sound.playStep(heard.st, session.st);
      }
      quiet = false;
      heard = { seed: session.seed, st: session.st };
    };
    // The rivals' moves shown big (#47). Not in the tutorial: it has its own steps for the rivals' turn and keeps the old way.
    const rep = Replay.createReplay({ labels: { hit: S.replay.hit, miss: S.replay.miss }, lang: code, rules: () => session && session.st && session.st.rules, onIdle: () => { if (!card && cardWanted()) pump(); else if (handWanted()) pump(); else if (autoWanted() && !autoTimer) pump(); else if (Sound.gap() == null && session && session.st && !Solo.botsToMove(session).length && stage.querySelector("[data-botnext]")) draw(); } });
    const stepOpt = () => (Sound.gap() == null && session.st && (Solo.botsToMove(session).length || rep.active()) ? { botnext: S.menu.next } : {});
    // The turn card (#44): each turn opens with it, once. It holds the rivals back, stays about 1.5 s and fades out; a tap
    // anywhere closes it (that is not the skip: the rivals only start after it has gone, one step at a time as before).
    // The turn it was shown for is kept in the session (cardSeen), so a reload does not bring it back.
    const CARD_HOLD = 1500, CARD_FADE = 260;
    let card = null; // { turn, t0, hold, gone, out } while it shows
    const cardWanted = () => !!(session && session.st && !session.tut && session.st.phase !== "end" && session.cardSeen !== session.st.turn && !rep.active());
    const dropCard = () => { if (card) { clearTimeout(card.hold); clearTimeout(card.gone); card = null; } };
    const closeCard = (tapped) => {
      if (!card || card.out) return;
      card.out = true; clearTimeout(card.hold);
      if (tapped) Sound.play("tap");
      const el = stage.querySelector("[data-turncard]");
      if (el) el.classList.add("out");
      card.gone = setTimeout(() => { card = null; pump(); }, CARD_FADE);
    };
    const openCard = () => {
      const turn = session.st.turn;
      // A step that began a new turn has already made the turn sound (hear): the card does not make it twice.
      const stepped = heard && heard.seed === session.seed && heard.st !== session.st && Sound.soundsOf(heard.st, session.st).includes("turn");
      session = { ...session, cardSeen: turn }; save();
      card = { turn, t0: performance.now(), out: false };
      card.hold = setTimeout(() => closeCard(false), CARD_HOLD);
      if (!stepped) Sound.play("turn");
    };
    // The handoff card (#73 乙): each time the turn passes to another seat, a small card over the map says whose turn it is, for about
    // a second. It comes after the turn card and after the replay of the step before it, holds the rivals back like the turn card does,
    // and a tap closes it (that is not the skip). handSeen is the seat the last card was for: the same seat acting again brings none.
    const HAND_HOLD = 600, HAND_FADE = 150;
    let hoff = null, handSeen = null; // hoff: { seat, t0, hold, gone, out } while it shows
    const turnOf = () => { if (!session || !session.st || session.tut || session.st.phase === "end") return null; const m = E.mustAct(session.st); return m.length === 1 ? m[0] : null; };
    const handDue = () => { const a = turnOf(); return !hoff && !card && a != null && a !== handSeen; };
    const handWanted = () => handDue() && !rep.active();
    const dropHand = () => { if (hoff) { clearTimeout(hoff.hold); clearTimeout(hoff.gone); hoff = null; } };
    const closeHand = (tapped) => {
      if (!hoff || hoff.out) return;
      hoff.out = true; clearTimeout(hoff.hold);
      if (tapped) Sound.play("tap");
      const el = stage.querySelector("[data-handoff]");
      if (el) el.classList.add("out");
      hoff.gone = setTimeout(() => { hoff = null; pump(); }, HAND_FADE);
    };
    const openHand = () => {
      const seat = turnOf();
      handSeen = seat;
      hoff = { seat, t0: performance.now(), out: false };
      // (the hold is counted from the end of the draw that shows it: a cold draw can take 200 ms, which must not be taken off the hold)
    };
    const draw = () => {
      syncUrl();
      hear();
      // The tutorial's "player board" step is about the hand and the bag: on a phone that board shows them while it is on.
      const boardStep = !!(session.tut && Tut.step(session, code).id === "board");
      drawInto(stage, Solo.screen(session, code, { feedOpen: ui.feed, raise: ui.raise, sel: ui.sel, picks: ui.picks, help: ui.help, moves: ui.moves, confirm: ui.confirm, county: ui.county == null ? undefined : ui.county, narrow: ui.narrow, turnCard: !!card && !card.out, cardAge: card ? performance.now() - card.t0 : 0, handoff: hoff && !hoff.out ? hoff.seat : undefined, handoffAge: hoff ? performance.now() - hoff.t0 : 0, ...stepOpt() }), { seat: boardStep ? session.seat : ui.seat, menu: menu.isOpen() });
      $("#solo").classList.add("intable");
      $("#quit").hidden = false;
      placeTutorial(stage);
      if (hoff && !hoff.hold && !hoff.out) hoff.hold = setTimeout(() => closeHand(false), HAND_HOLD);
    };
    // #70: a decision with one option only is made by the page itself, one beat (about 0.7 s) after it is the player's turn:
    // the turn card is gone, the rivals' replay is over, nobody is to move. Never in the tutorial (Solo.autoChoice says null).
    const AUTO_WAIT = 700;
    let autoTimer = null;
    const autoWanted = () => !!(session && session.st && !session.tut && !card && !hoff && !rep.active() && !Solo.botsToMove(session).length && Solo.autoChoice(session, code));
    const autoMake = () => {
      autoTimer = null;
      if (!autoWanted()) return;
      const m = Solo.autoChoice(session, code), label = Solo.choices(session, code)[0].label;
      session = Solo.act(session, m, { auto: true, label });
      ui.sel = null; ui.raise = false; ui.picks = []; ui.moves = false; ui.confirm = null; ui.county = null;
      save(); pump();
    };
    const pump = () => {
      clearTimeout(autoTimer); autoTimer = null;
      if (!card && cardWanted()) openCard();
      if (!card && handWanted()) openHand();
      draw();
      if (card || hoff) return; // the rivals wait for the cards
      if (handDue()) return; // a seat change waits for the replay on show to end (onIdle calls this again), then its handoff card
      if (autoWanted()) { autoTimer = setTimeout(autoMake, AUTO_WAIT); return; }
      const wait = Sound.gap(); // the rivals' speed (#42); null = step by step, they wait for 下一步
      if (timer || wait == null || !Solo.botsToMove(session).length) return;
      timer = setTimeout(() => { timer = null; step(); }, wait + rep.blockMs());
    };
    // One rival step, and its replay: the beats are read off the log and the record the step added.
    const step = () => {
      const before = session;
      session = Solo.stepBot(session); save();
      if (!session.tut) startReplay(before, session);
      else quiet = false;
      pump();
    };
    const startReplay = (before, after) => {
      const me = after.seat, seen = new Set(before.feed);
      const beats = Replay.beatsOf(after.st.log, before.st.log.length, me);
      const names = Sound.soundsOf(before.st, after.st);
      const cubes = after.feed.filter((e) => !seen.has(e) && ["fill", "cross", "grey", "steal"].includes(e.k) && e.ok && e.county != null).map((e) => ({ county: e.county, seat: e.seat }));
      const cubeNames = names.filter((n) => n === "cube" || n === "uncube");
      if (!beats.length) beats.push({ id: null, seat: Solo.botsToMove(before)[0], kind: "move", checks: [], cubes: [], sounds: [] });
      const last = beats[beats.length - 1];
      last.cubes = cubes; last.sounds = cubeNames;
      // whatever else the step sounds like and no beat plays by itself
      const rest = Replay.leftover(names, beats);
      rest.forEach((n, i) => Sound.play(n, i, Math.min(i * 0.12, 0.5)));
      quiet = true;
      rep.push(beats);
    };
    // Two quick taps: the rest of the rivals' turn at once (its remaining sounds as one burst, as before #47).
    const skipAll = () => {
      if (!session || !session.st) return;
      rep.skipAll();
      if (timer) { clearTimeout(timer); timer = null; }
      heard = { seed: session.seed, st: session.st };
      session = Solo.advance(session); save(); pump();
    };
    // One tap: the step being shown goes to its result; the next one follows after the usual gap.
    const skipStep = () => {
      rep.skipStep();
      if (timer) { clearTimeout(timer); timer = null; pump(); }
    };
    // (in the tutorial a tap still skips the rivals' whole turn, as it always did)
    let swallow = false;
    Replay.bindTaps({ active: () => !!session && !!session.st && (!!timer || (!session.tut && rep.active())),
      onStep: () => { swallow = !!timer; setTimeout(() => { swallow = false; }, 0); if (session.tut) skipAll(); else skipStep(); }, onAll: () => { swallow = !!timer; setTimeout(() => { swallow = false; }, 0); skipAll(); },
      ignore: "[data-menu], [data-menu-top], #gmenu, .mset, [data-botnext], [data-feed-toggle], [data-turncard], [data-handoff], [data-rp-next], a, input, textarea" });
    // (in the tutorial the bubble decides what scrolls)
    // (#66: the table is one screen that never scrolls, so a tapped card or a question does not scroll to the decision any more)

    const setup = () => {
      syncUrl();
      $("#solo").classList.remove("intable");
      $("#quit").hidden = true;
      const pick = store.get(SETUP) || { seat: 0, level: 0 };
      const seatOrder = [1, 2, 0], keys = ["chen", "soong", "lien"], no = [5, 1, 2];
      const cards = seatOrder.map((p) => {
        const c = S.cand[keys[p]], on = pick.seat === p;
        return `<button type="button" class="cand s${p}${on ? " on" : ""}" data-seat="${p}" aria-pressed="${on}"><span class="pic"><img src="art/candidates/${keys[p]}.webp" alt="" width="480" height="640" loading="lazy" decoding="async"><b class="no">${no[p]}</b></span>` +
          `<span class="cb"><span class="nm">${esc(c.name)}</span><span class="bl">${esc(c.blurb)}</span></span><span class="tag">${esc(on ? S.setup.picked : S.setup.pick)}</span></button>`;
      }).join("");
      const levels = [0, 1, 2, 3].map((n) => `<button type="button" class="lv${pick.level === n ? " on" : ""}" data-level="${n}" aria-pressed="${pick.level === n}">${esc(T.bots[n])}</button>`).join("");
      drawInto(stage, `<section class="setup"><p class="kicker">${esc(S.setup.kicker)}</p><h1 class="st">${esc(S.setup.title)}</h1><p class="sub">${esc(S.setup.sub)}</p>` +
        `<div class="cands">${cards}</div><h2 class="lh">${esc(S.setup.level)}</h2><div class="lvs">${levels}</div><p class="sub">${esc(S.setup.levelNote[pick.level])}</p>` +
        `<button type="button" class="big go" data-start="1">${esc(S.setup.start)}</button><p class="note">${esc(S.setup.note)}</p>` +
        `<p class="note"><a class="tutlink" href="?tutorial${code === "en" ? "&amp;lang=en" : ""}">${esc(T.ui.tutorial.setupLink)}</a></p></section>`);
    };

    // The turn card: a tap anywhere on it closes it, and does nothing else.
    stage.addEventListener("click", (ev) => {
      if (!ev.target.closest("[data-turncard]")) return;
      ev.stopImmediatePropagation(); ev.stopPropagation();
      closeCard(true);
    });
    stage.addEventListener("click", (ev) => {
      if (!ev.target.closest("[data-handoff]")) return;
      ev.stopImmediatePropagation(); ev.stopPropagation();
      closeHand(true);
    });
    addEventListener("keydown", (ev) => { if (ev.key === "Escape" && card && !card.out) closeCard(true); else if (ev.key === "Escape" && hoff && !hoff.out) closeHand(true); });
    // A hand card or a county tapped makes its small sound (a tap that only skips the animation does not).
    stage.addEventListener("click", (ev) => {
      if (timer || rep.active()) return;
      const c = ev.target.closest("[data-sel], [data-county]");
      if (c && (c.dataset.county != null || c.dataset.sel)) Sound.play("tap");
    });
    // Step by step: one rival move per tap on 下一步.
    stage.addEventListener("click", (ev) => {
      if (!ev.target.closest("[data-botnext]") || !session || !session.st) return;
      rep.skipStep();
      if (!Solo.botsToMove(session).length) { draw(); return; }
      step();
    });
    let stepping = Sound.gap() == null;
    addEventListener("p2000:settings", () => {
      const now = Sound.gap() == null;
      if (now === stepping || !session || !session.st) return;
      stepping = now;
      if (now && timer) { clearTimeout(timer); timer = null; }
      if (!now) rep.skipStep();
      pump();
    });
    stage.addEventListener("click", (ev) => {
      const t = ev.target.closest("button, a");
      if (swallow) { swallow = false; if (t && t.tagName !== "A") return; } // a tap that skipped the rivals does nothing else
      if (!t) return;
      const d = t.dataset;
      if (d.tut) {
        // The tutorial's bubble: next, or out of the tutorial (what is left is a normal game).
        session = d.tut === "skip" ? Tut.skip(session) : Tut.next(session);
        ui = { ...ui, raise: false, sel: null, picks: [], confirm: null, county: null, seat: null };
        save(); pump(); // the bubble scrolls the next target into view itself
      } else if (d.seat != null) { const p = store.get(SETUP) || { seat: 0, level: 0 }; store.set(SETUP, { ...p, seat: +d.seat }); setup(); }
      else if (d.level != null) { const p = store.get(SETUP) || { seat: 0, level: 0 }; store.set(SETUP, { ...p, level: +d.level }); setup(); }
      else if (d.start) {
        const p = store.get(SETUP) || { seat: 0, level: 0 };
        const seed = crypto.getRandomValues(new Uint32Array(1))[0];
        session = Solo.setAdvisor(Solo.advance(Solo.newSolo({ seat: p.seat, level: p.level, seed })), store.get(ADV) === true);
        ui = { feed: deskNow(), raise: false, sel: null, picks: [], help: null, moves: false, confirm: null, county: null, seat: null, narrow: narrowNow() };
        dropHand(); handSeen = null;
        save(); pump(); window.scrollTo(0, 0);
      } else if (d.advisor != null) {
        session = Solo.setAdvisor(session, d.advisor === "on"); store.set(ADV, session.advisor);
        save(); draw();
      } else if (d.confirm && d.move) {
        // The candidate card is once a game: ask first (the table draws the question).
        ui.confirm = d.move; ui.sel = null; ui.county = null; draw(); // (the county's box closes while the question is asked, #69)
      } else if (d.undo) {
        if (!session.tut && Solo.canUndo(session)) {
          session = Solo.undo(session);
          ui = { ...ui, raise: false, sel: null, picks: [], moves: false, confirm: null, county: null };
          handSeen = turnOf(); // (going back is not the turn passing)
          save(); pump(); window.scrollTo({ top: 0 }); notice(S.undo.done);
        }
      } else if (d.move) {
        const m = JSON.parse(d.move);
        session = session.tut ? Tut.act(session, m) : Solo.act(session, m);
        ui.sel = null; ui.raise = false; ui.picks = []; ui.moves = false; ui.confirm = null; ui.county = null;
        save(); pump(); if (d.pop == null) window.scrollTo({ top: 0 }); // from the county box, stay on the map
      } else if (d.cancel) { ui.confirm = null; draw();
      } else if (d.help != null) { ui.help = d.help && ui.help !== d.help ? d.help : null; draw();
      } else if (d.toggle === "moves") { ui.moves = !ui.moves; draw();
      } else if (d.sel != null) { ui.sel = d.sel && d.sel !== ui.sel ? d.sel : null; if (ui.sel) ui.confirm = null; else ui.raise = false; draw();
      } else if (d.handToggle != null) { ui.raise = !(ui.raise || !!ui.sel); if (!ui.raise) ui.sel = null; draw();
      } else if (d.feedToggle != null) { ui.feed = !ui.feed; draw(); }
      else if (d.pick != null) {
        ui.picks = ui.picks.includes(d.pick) ? ui.picks.filter((x) => x !== d.pick) : [...ui.picks, d.pick];
        draw();
      } else if (d.act === "again") { dropHand(); handSeen = null; store.del(KEY); session = null; setup(); window.scrollTo(0, 0); }
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
      rep.skipAll();
      dropCard(); dropHand(); handSeen = null; store.del(KEY); session = null; setup();
    });

    if (session && session.st) { if (turnOf() === session.seat) handSeen = session.seat; pump(); } else setup();
  }
}
