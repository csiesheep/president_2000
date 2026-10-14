// The page: the landing, the solo setup (?play) and the solo table. Every visible word comes from
// i18n/; the game itself lives in solo.js and table.js, which run in node as well. All the
// DOM wiring sits under the guard below so importing this file in node is harmless.
import en from "./i18n/en.js";
import zh from "./i18n/zh-Hant.js";
import * as Solo from "./solo.js";

if (typeof document !== "undefined") {
  const qs = new URLSearchParams(location.search);
  const code = qs.get("lang") === "en" ? "en" : "zh-Hant";
  const T = code === "en" ? en : zh, S = T.ui.solo;
  const KEY = "p2000.solo.session", SETUP = "p2000.solo.setup";
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
    const v = path(T, el.dataset.i18n);
    if (typeof v === "string") el.textContent = v;
  }
  const langLink = $("#lang"), gLang = $("#glang");
  langLink.textContent = T.nav.lang; gLang.textContent = T.nav.lang;
  langLink.href = other ? "?lang=en" : "./";
  $("#rules").href = "rules" + (code === "en" ? "?lang=en" : "");
  $("#play").href = "?play" + (code === "en" ? "&lang=en" : "");
  $("#home").href = "./" + (code === "en" ? "?lang=en" : "");
  $("#home").textContent = S.setup.home;
  $("#quit").textContent = S.menu.quit;

  if (!qs.has("play")) {
    document.title = T.title;
  } else {
    $("#land").hidden = true;
    $("#solo").hidden = false;
    document.title = S.land.solo + " · " + T.title;
    gLang.href = "?" + (other ? "play&lang=en" : "play");
    const stage = $("#stage");
    let session = store.get(KEY);
    let ui = { open: null, sel: null, picks: [] };
    let timer = null;
    const save = () => store.set(KEY, session);

    const draw = () => {
      stage.innerHTML = Solo.screen(session, code, { open: ui.open || undefined, sel: ui.sel, picks: ui.picks });
      $("#quit").hidden = false;
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
    const toAct = () => { const a = $("#act"); if (a && a.scrollIntoView) a.scrollIntoView({ block: "start", behavior: "smooth" }); };

    const setup = () => {
      $("#quit").hidden = true;
      const pick = store.get(SETUP) || { seat: 0, level: 2 };
      const seatOrder = [1, 2, 0], keys = ["chen", "soong", "lien"], no = [5, 1, 2];
      const cards = seatOrder.map((p) => {
        const c = S.cand[keys[p]], on = pick.seat === p;
        return `<button type="button" class="cand s${p}${on ? " on" : ""}" data-seat="${p}" aria-pressed="${on}"><b class="no">${no[p]}</b>` +
          `<span class="cb"><span class="nm">${esc(c.name)}</span><span class="bl">${esc(c.blurb)}</span></span><span class="tag">${esc(on ? S.setup.picked : S.setup.pick)}</span></button>`;
      }).join("");
      const levels = [1, 2, 3].map((n) => `<button type="button" class="lv${pick.level === n ? " on" : ""}" data-level="${n}" aria-pressed="${pick.level === n}">${esc(T.bots[n])}</button>`).join("");
      stage.innerHTML = `<section class="setup"><p class="kicker">${esc(S.setup.kicker)}</p><h1 class="st">${esc(S.setup.title)}</h1><p class="sub">${esc(S.setup.sub)}</p>` +
        `<div class="cands">${cards}</div><h2 class="lh">${esc(S.setup.level)}</h2><div class="lvs">${levels}</div><p class="sub">${esc(S.setup.levelNote[pick.level])}</p>` +
        `<button type="button" class="big go" data-start="1">${esc(S.setup.start)}</button><p class="note">${esc(S.setup.note)}</p></section>`;
    };

    stage.addEventListener("click", (ev) => {
      const t = ev.target.closest("button, a, [data-region]");
      if (timer) { skip(); if (t && t.tagName !== "A") return; }
      if (!t) return;
      const d = t.dataset;
      if (d.seat != null) { const p = store.get(SETUP) || { seat: 0, level: 2 }; store.set(SETUP, { ...p, seat: +d.seat }); setup(); }
      else if (d.level != null) { const p = store.get(SETUP) || { seat: 0, level: 2 }; store.set(SETUP, { ...p, level: +d.level }); setup(); }
      else if (d.start) {
        const p = store.get(SETUP) || { seat: 0, level: 2 };
        const seed = crypto.getRandomValues(new Uint32Array(1))[0];
        session = Solo.advance(Solo.newSolo({ seat: p.seat, level: p.level, seed }));
        ui = { open: null, sel: null, picks: [] };
        save(); pump(); window.scrollTo(0, 0);
      } else if (d.move) {
        session = Solo.act(session, JSON.parse(d.move));
        ui.sel = null; ui.picks = [];
        save(); pump(); window.scrollTo({ top: 0 });
      } else if (d.sel != null) { ui.sel = d.sel || null; draw(); if (ui.sel) toAct(); }
      else if (d.pick != null) {
        ui.picks = ui.picks.includes(d.pick) ? ui.picks.filter((x) => x !== d.pick) : [...ui.picks, d.pick];
        draw();
      } else if (d.region != null) {
        const open = ui.open || [Solo.openRegion(session)];
        const r = +d.region;
        ui.open = open.includes(r) ? open.filter((x) => x !== r) : [...open, r];
        draw();
      } else if (d.act === "again") { store.del(KEY); session = null; setup(); window.scrollTo(0, 0); }
    });
    $("#quit").addEventListener("click", () => {
      if (!confirm(S.menu.confirm)) return;
      if (timer) { clearTimeout(timer); timer = null; }
      store.del(KEY); session = null; setup();
    });

    if (session && session.st) pump(); else setup();
  }
}
