// The rivals' moves replayed (#47, P1 ②). A card a rival plays or triggers is shown big over the table, the blocks fly to
// their counties, each support check stamps a 命中 / 沒中, then the card shrinks back into the 「剛剛」 line. The timings are
// the design page's (P1 設計稿 ② 重播的規格), scaled by the rivals' speed (#42):
//   slow ×1.6 · normal ×1 · fast: only a flash of the card (≤ 0.45 s) · step: the card stays until 下一步 or a tap.
// A "beat" is one thing to show: { id, seat, kind, checks: [ok…], cubes: [{ county, seat }…], sounds: ["cube"…] }, id null when a
// step had no card (a move, a fill): then only the blocks fly and the stamps show.
// The DOM lives in one element of its own (div.rp on <body>), never inside the table the pages redraw, so nothing the table
// shows is rebuilt by a replay; the pictures inside [data-replay] are new ones.
// beatsOf() and leftover() are pure: node can run them.
import { replayFace } from "./table.js";
import * as Sound from "./sound.js";

const MULT = { slow: 1.6, normal: 1, fast: 0.4, step: 1 };

// The beats the log holds from entry `from` on, for everyone but seat `me`: a "play" with a card, or a "trigger", opens one;
// the "check"s of that seat after it belong to it (the checks made with no card in front are a beat of their own).
export function beatsOf(log, from, me) {
  const out = [];
  let cur = null;
  for (const e of (log || []).slice(from)) {
    if ((e.t === "play" && e.card) || e.t === "trigger") {
      // your own plays and triggers are your decisions, not shown back; but a rival's CP play that triggers your event for you by
      // itself (v0.8, e.auto) is not your decision: it is shown like any other card, before the choice it hands you (#82)
      if (e.seat === me && !(e.t === "trigger" && e.auto)) { cur = null; continue; }
      cur = { id: e.card === "candidate" ? "candidate" : e.card, seat: e.seat, kind: e.t, checks: [], cubes: [], sounds: [] };
      out.push(cur);
    } else if (e.t === "check" && e.seat !== me) {
      if (!cur || cur.seat !== e.seat) { cur = { id: null, seat: e.seat, kind: "check", checks: [], cubes: [], sounds: [] }; out.push(cur); }
      cur.checks.push(!!e.ok);
    }
  }
  return out;
}

// The sounds a step makes that no beat will make by itself: names (Sound.soundsOf) minus the plays and the hit / miss
// the beats play on their own timeline and the cube sounds they carry.
export function leftover(names, beats) {
  const left = names.slice(), take = (n) => { const i = left.indexOf(n); if (i >= 0) left.splice(i, 1); };
  for (const b of beats) {
    if (b.kind === "play") take("play");
    for (const ok of b.checks) take(ok ? "hit" : "miss");
    for (const n of b.sounds) take(n);
  }
  return left.filter((n) => n !== "turn");
}

export function createReplay({ labels, lang, onIdle, ready, rules } = {}) { // rules: () => the game's rules ("v0.7": no rest cubes on the big card)
  let root = null, queue = [], cur = null, gapTimer = null, waiting = false;
  const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const ensureRoot = () => {
    if (!root) { root = document.createElement("div"); root.className = "rp"; root.setAttribute("aria-hidden", "true"); document.body.appendChild(root); }
    return root;
  };

  // The times of one beat, in ms from its start.
  function plan(b) {
    const sp = Sound.getSpeed(), m = MULT[sp] ?? 1, fast = sp === "fast", n = b.checks.length, nc = b.cubes.length, p = { sp, m, fast, step: sp === "step", n };
    if (b.id) {
      if (fast) Object.assign(p, { inn: 70, stamp0: 70, slot: 40, end: 250, out: 80, total: 330, fly: 0 });
      else {
        p.inn = 300 * m; p.stamp0 = p.inn + 800 * m;
        p.slot = n ? Math.min(250, 400 / n) * m : 0;
        p.fly = 250 * m;
        p.end = p.stamp0 + Math.min(450 * m, Math.max(n * p.slot, nc ? p.fly + (nc - 1) * 110 * m : 0));
        p.out = 300 * m; p.total = p.end + p.out;
      }
      p.block = p.total;
    } else {
      p.inn = 0; p.stamp0 = 0; p.fly = fast ? 0 : 250 * m;
      p.slot = fast ? 40 : Math.min(250, 400 / Math.max(n, 1)) * m;
      p.out = fast ? 100 : 200 * m;
      p.end = Math.max(n ? n * p.slot + (fast ? 140 : 450 * m) : 0, nc && !fast ? p.fly + (nc - 1) * 110 * m + 120 : 0);
      p.total = p.end;
      p.block = n ? n * p.slot + (fast ? 40 : 200 * m) : 0; // the next step does not wait for the blocks, only for the stamps
    }
    return p;
  }

  const center = (el) => {
    if (!el || !el.getBoundingClientRect) return null;
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return null;
    return { x: Math.min(Math.max(r.left + r.width / 2, 8), innerWidth - 8), y: Math.min(Math.max(r.top + r.height / 2, 8), innerHeight - 8) };
  };

  function start(b) {
    const p = plan(b), host = ensureRoot(), noMove = reduced();
    const c = { b, p, timers: [], els: [], t0: Date.now(), atEnd: false, leaving: false };
    cur = c;
    const at = (ms, fn) => { c.timers.push(setTimeout(fn, Math.max(0, ms))); };
    const box = document.createElement("div");
    box.className = "rp-box" + (b.id ? "" : " nocard");
    host.appendChild(box); c.els.push(box);
    let card = null, tray = null;
    const addStamp = (ok) => {
      if (!tray) { tray = document.createElement("div"); tray.className = "rp-tray"; box.appendChild(tray); }
      const s = document.createElement("span");
      s.className = "rp-stamp in " + (ok ? "hit" : "miss");
      s.setAttribute("data-stamp", ok ? "hit" : "miss");
      s.style.setProperty("--rot", ((tray.children.length % 2 ? 1 : -1) * (5 + (tray.children.length * 3) % 7)) + "deg");
      s.textContent = ok ? labels.hit : labels.miss;
      tray.appendChild(s);
      void s.offsetWidth;
      s.classList.remove("in");
    };
    const stampAt = (i) => { const ok = b.checks[i]; addStamp(ok); Sound.play(ok ? "hit" : "miss"); };
    const fly = (k, t, q) => {
      if (noMove || p.fast) return;
      const t1 = t + k * 110 * p.m;
      const cube = document.createElement("i");
      cube.className = `b o${q.seat} rp-cube`;
      cube.style.opacity = "0";
      host.appendChild(cube); c.els.push(cube);
      at(t1, () => {
        const to = center(document.querySelector(`[data-county="${q.county}"]`));
        const from = (card ? center(card) : center(document.querySelector(`.pl.s${b.seat}`))) || { x: innerWidth / 2, y: 0 };
        if (!to) { cube.remove(); return; }
        cube.style.transform = `translate(${from.x - 7}px, ${from.y - 7}px) scale(1.3)`;
        void cube.offsetWidth;
        cube.style.transition = `transform ${p.fly}ms ease-in, opacity 90ms`;
        cube.style.opacity = "1";
        cube.style.transform = `translate(${to.x - 7}px, ${to.y - 7}px) scale(1)`;
      });
      at(t1 + p.fly, () => { cube.style.transition = "opacity 90ms"; cube.style.opacity = "0"; });
    };
    // the results: blocks fly, the stamps come down, the cube sounds ring
    const results = (t) => {
      b.cubes.forEach((q, k) => fly(k, t, q));
      b.sounds.forEach((n, j) => at(t + (p.fast ? 0 : j * 110 * p.m), () => Sound.play(n, j)));
      for (let i = 0; i < b.checks.length; i++) at(t + i * p.slot, () => stampAt(i));
    };

    if (b.id) {
      card = document.createElement("div");
      card.className = "rp-card";
      card.setAttribute("data-replay", b.id);
      card.innerHTML = replayFace(b.id, b.seat, lang, rules ? rules() : undefined);
      card.style.transform = noMove ? "none" : "translate(0, -22vh) scale(.3) rotate(-9deg)";
      box.insertBefore(card, box.firstChild);
      void card.offsetWidth;
      card.style.transition = `opacity ${p.inn}ms ease-out, transform ${p.inn}ms cubic-bezier(.2,.8,.25,1)`;
      card.style.opacity = "1";
      card.style.transform = noMove ? "none" : "rotate(-2deg)";
      if (b.kind === "play") Sound.play("play");
      if (p.step && labels.next) {
        const nb = document.createElement("button");
        nb.type = "button"; nb.className = "rp-next"; nb.setAttribute("data-rp-next", "1"); nb.textContent = labels.next + " ›";
        nb.addEventListener("click", (ev) => { ev.stopPropagation(); skipStep(); });
        box.appendChild(nb);
      }
      results(p.stamp0);
      at(p.end, () => { c.atEnd = true; if (!p.step) leave(c); });
    } else {
      results(0);
      at(p.end, () => finish(c));
      if (b.checks.length) at(p.end - p.out, () => { if (tray) { tray.style.transition = `opacity ${p.out}ms`; tray.style.opacity = "0"; } });
    }

    c.leave = () => {
      if (c.leaving || !card) return;
      c.leaving = true;
      const li = document.querySelector("[data-feed-toggle]"); // (#66: the card leaves into the record button in the top row; it was the last line of 「剛剛」)
      if (p.fast || noMove) card.style.transition = `opacity ${p.out}ms ease-in`;
      else {
        const a = center(card), z = center(li) || { x: a.x, y: 0 };
        card.style.transition = `transform ${p.out}ms ease-in, opacity ${p.out}ms ease-in`;
        card.style.transform = `translate(${z.x - a.x}px, ${z.y - a.y}px) scale(.12) rotate(-2deg)`;
      }
      card.style.opacity = "0";
      if (tray) { tray.style.transition = `opacity ${p.out * 0.6}ms`; tray.style.opacity = "0"; }
      const nb = box.querySelector(".rp-next"); if (nb) nb.remove();
      if (li && !p.fast) at(p.out * 0.8, () => { li.classList.add("rp-flash"); });
      at(p.out, () => finish(c));
    };
  }

  function leave(c) { if (c === cur && c.leave) c.leave(); }

  function clearCur(c, fade) {
    for (const t of c.timers) clearTimeout(t);
    c.timers = [];
    const els = c.els;
    if (fade) {
      for (const e of els) { e.style.transition = "opacity 100ms"; e.style.opacity = "0"; }
      setTimeout(() => { for (const e of els) e.remove(); }, 130);
    } else for (const e of els) e.remove();
  }

  function finish(c) {
    if (c !== cur) return;
    clearCur(c, false);
    cur = null;
    next(Math.round(120 * c.p.m));
  }

  function next(wait) {
    clearTimeout(gapTimer); gapTimer = null; waiting = false;
    if (cur) return;
    if (!queue.length) { if (onIdle) onIdle(); return; }
    // (ready(): the page may hold the next beat back, e.g. while the turn card is up; it is asked again every 100 ms)
    if (ready && !ready()) { waiting = true; gapTimer = setTimeout(() => { gapTimer = null; waiting = false; next(0); }, 100); return; }
    const go = () => { gapTimer = null; if (cur) return; const b = queue.shift(); if (b) start(b); };
    if (wait > 0) gapTimer = setTimeout(go, wait); else go();
  }

  function skipStep() {
    if (!cur) return false;
    const c = cur; cur = null;
    clearCur(c, true);
    next(c.b.id ? 120 : 0);
    return true;
  }

  return {
    // Beats to show after those already waiting. Beats that have nothing to show (no card, no check, no block) are dropped.
    push(beats) {
      for (const b of beats) if (b.id || b.checks.length || b.cubes.length || b.sounds.length) queue.push(b);
      if (!cur && !gapTimer) next(0);
    },
    active: () => !!cur || queue.length > 0 || !!gapTimer,
    // a beat is showing, or one starts in a moment (not: waiting for the page's go-ahead)
    running: () => !!cur || (!!gapTimer && !waiting),
    // ms the rivals' next step has to wait for what is showing and queued
    blockMs() {
      let ms = 0;
      if (cur) ms += Math.max(0, cur.t0 + cur.p.block - Date.now());
      for (const b of queue) ms += plan(b).block;
      return ms;
    },
    skipStep,
    skipAll() {
      queue = []; clearTimeout(gapTimer); gapTimer = null; waiting = false;
      const had = !!cur;
      if (cur) { const c = cur; cur = null; clearCur(c, true); }
      return had;
    },
  };
}

// Taps on the table while the rivals' moves show: one tap jumps the step being shown to its result, two quick taps skip the
// rest (the rivals' turn). `active()` says whether anything is going on; `ignore` is a selector for what is not "the table".
// A tap the replay uses belongs to the replay alone: one that lands on the big card or the stamps' plate (they take clicks), and the
// second of two quick taps (even when the card has gone by then), are stopped here and reach nothing under them. A tap on a
// decision or anything else visible outside the card still goes through (and skips what is left).
const TAP_GAP = 450;
export function bindTaps({ active, onStep, onAll, ignore }) {
  let last = -1e9;
  document.addEventListener("click", (ev) => {
    const t = ev.target, onCard = !!(t && t.closest && t.closest(".rp-card, .rp-tray"));
    if (!onCard && t && t.closest && t.closest(ignore)) return;
    const now = performance.now(), quick = now - last <= TAP_GAP;
    if (!onCard && !active() && !quick) return;
    if (quick) { last = -1e9; ev.stopPropagation(); ev.preventDefault(); onAll(); return; }
    last = now;
    if (onCard) { ev.stopPropagation(); ev.preventDefault(); }
    onStep();
  }, true);
}
