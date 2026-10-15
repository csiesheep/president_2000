// Interface sounds and the rivals' speed (#42, P1 ⑤ ⑭). Every sound is synthesised in the browser: no audio file.
// The recipes are the ones on the design page's sound board (P1 設計稿 ⑤).
//
// play(name) — name is tap | play | cube | uncube | hit | miss | turn. Every call fires a window event
// "p2000:sound" with detail { name, muted }. Nothing is heard (and no AudioContext is made) before the page's
// first real tap or key, or while the sound is off. A browser without the audio API plays on in silence.
// Settings live in localStorage: "p2000.sound" = {"on":true,"vol":0.7}, "p2000.speed" = slow|normal|fast|step.
// Importing this file in node is harmless: nothing touches the DOM until mountMenu() is called.

const SOUND_KEY = "p2000.sound", SPEED_KEY = "p2000.speed";
const NAMES = ["tap", "play", "cube", "uncube", "hit", "miss", "turn"];
const SPEEDS = ["slow", "normal", "fast", "step"];
const GAP = { slow: 640, normal: 400, fast: 160 }; // ms between the rivals' steps
const MAX_PER_STEP = 3, MAX_VOICES = 3, STAGGER = 0.12; // one name at most 3 times a step; at most 3 sounds at once

const has = typeof window !== "undefined";
const read = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode: it lasts until the page closes */ } };

export function getSound() {
  const s = read(SOUND_KEY) || {};
  const vol = typeof s.vol === "number" && s.vol >= 0 && s.vol <= 1 ? s.vol : 0.7;
  return { on: s.on !== false, vol };
}
export function setSound(patch) {
  const s = { ...getSound(), ...patch };
  write(SOUND_KEY, { on: s.on, vol: Math.round(s.vol * 100) / 100 });
  if (master) master.gain.value = s.vol;
  if (s.on) ensure();
  changed();
}
// The speed is stored as the bare word (slow | normal | fast | step), not as JSON.
export function getSpeed() {
  let v = null;
  try { v = localStorage.getItem(SPEED_KEY); } catch { /* no storage */ }
  return SPEEDS.includes(v) ? v : "normal";
}
export function setSpeed(v) {
  if (!SPEEDS.includes(v)) return;
  try { localStorage.setItem(SPEED_KEY, v); } catch { /* private mode */ }
  changed();
}
// The wait before the rivals' next step, in ms; null in "step" mode (they wait for a tap).
export const gap = () => GAP[getSpeed()] ?? null;
const changed = () => { if (has) window.dispatchEvent(new Event("p2000:settings")); };

// ---------------------------------------------------------------- the audio
let ctx = null, master = null, gestured = false, busy = [];
if (has) {
  try { if (navigator.audioSession) navigator.audioSession.type = "ambient"; } catch { /* not supported */ } // iPhone: the silent switch counts
  const first = (ev) => {
    if (!ev.isTrusted) return;
    gestured = true;
    if (getSound().on) ensure();
  };
  for (const t of ["pointerdown", "keydown", "touchend", "click"]) window.addEventListener(t, first, { capture: true, passive: true });
}
function ensure() {
  if (!has || !gestured) return null;
  if (!ctx) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    try { ctx = new C(); master = ctx.createGain(); master.connect(ctx.destination); } catch { ctx = null; return null; }
  }
  try { if (ctx.state === "suspended") ctx.resume(); } catch { /* nothing to resume */ }
  return ctx;
}

// name → how long it rings (s), for the voice limit.
const LEN = { tap: 0.08, play: 0.12, cube: 0.05, uncube: 0.07, hit: 0.22, miss: 0.16, turn: 0.4 };

function synth(ac, out, name, n, at0) {
  const t = ac.currentTime + 0.01 + (at0 || 0);
  const env = (g, at, peak, dur) => { g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(peak, at + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, at + dur); };
  const tone = (type, f0, f1, dur, peak, delay) => {
    const o = ac.createOscillator(), g = ac.createGain(), at = t + (delay || 0);
    o.type = type; o.frequency.setValueAtTime(f0, at); o.frequency.exponentialRampToValueAtTime(f1, at + dur);
    env(g, at, peak, dur); o.connect(g); g.connect(out); o.start(at); o.stop(at + dur + 0.03);
  };
  const hiss = (ftype, f0, f1, q, dur, peak, delay) => {
    const len = Math.ceil(ac.sampleRate * dur), b = ac.createBuffer(1, len, ac.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const s = ac.createBufferSource(), bq = ac.createBiquadFilter(), g = ac.createGain(), at = t + (delay || 0);
    s.buffer = b; bq.type = ftype; bq.frequency.setValueAtTime(f0, at); bq.frequency.exponentialRampToValueAtTime(f1, at + dur); bq.Q.value = q;
    env(g, at, peak, dur); s.connect(bq); bq.connect(g); g.connect(out); s.start(at); s.stop(at + dur + 0.03);
  };
  if (name === "tap") hiss("bandpass", 3200, 2800, 0.9, 0.08, 0.35);
  if (name === "play") { hiss("lowpass", 1400, 900, 0.7, 0.12, 0.5); tone("sine", 150, 55, 0.12, 0.6); }
  if (name === "cube") { const k = n || 0; tone("triangle", 820 + k * 90, 700 + k * 90, 0.05, 0.35); hiss("bandpass", 2200 + k * 180, 2200 + k * 180, 6, 0.04, 0.25); }
  if (name === "uncube") { tone("triangle", 640, 420, 0.07, 0.3); hiss("bandpass", 1500, 1200, 6, 0.04, 0.2); }
  if (name === "hit") { tone("sine", 190, 80, 0.14, 0.6); tone("triangle", 660, 990, 0.16, 0.2, 0.06); }
  if (name === "miss") tone("sine", 220, 130, 0.16, 0.35);
  if (name === "turn") { hiss("bandpass", 900, 2600, 0.8, 0.18, 0.35, 0); hiss("bandpass", 1600, 3800, 0.8, 0.24, 0.3, 0.16); }
}

// n picks the pitch of a cube in a run (0, 1, 2…); after is a delay in seconds.
export function play(name, n = 0, after = 0) {
  if (!NAMES.includes(name)) return;
  const s = getSound(), muted = !s.on;
  try { if (has) window.dispatchEvent(new CustomEvent("p2000:sound", { detail: { name, muted } })); } catch { /* no events */ }
  if (muted || !gestured) return;
  try {
    const ac = ensure();
    if (!ac) return;
    const start = ac.currentTime + after, end = start + LEN[name];
    busy = busy.filter((e) => e > start);
    if (busy.length >= MAX_VOICES) return; // never a pile-up
    busy.push(end);
    master.gain.value = s.vol;
    synth(ac, master, name, n, after);
  } catch { /* the sound is a nicety: a failure is silence */ }
}

// ---------------------------------------------------------------- what a step sounds like
// The sounds of one step, from the engine states before and after it: the log's plays, checks and turns, and cubes
// put on / taken off (the log does not keep them, so they are read off the two states, per owner).
const cubesOf = (st) => {
  const per = [0, 0, 0];
  for (const c of st.counties || []) for (const b of c.blocks || []) if (b.o >= 0 && b.o < 3) per[b.o]++;
  for (const i of st.issues || []) for (let p = 0; p < 3; p++) per[p] += i.cubes[p] || 0;
  return per;
};
export function soundsOf(before, after) {
  if (!before || !after || !before.log || !after.log || after.log.length < before.log.length) return [];
  const out = [];
  for (const e of after.log.slice(before.log.length)) {
    if (e.t === "play") out.push("play");
    else if (e.t === "check") out.push(e.ok ? "hit" : "miss");
    else if (e.t === "turn") out.push("turn");
  }
  const a = cubesOf(before), b = cubesOf(after);
  let up = 0, down = 0;
  for (let p = 0; p < 3; p++) { if (b[p] > a[p]) up += b[p] - a[p]; else down += a[p] - b[p]; }
  for (let i = 0; i < up; i++) out.push("cube");
  for (let i = 0; i < down; i++) out.push("uncube");
  const seen = {};
  return out.filter((n) => (seen[n] = (seen[n] || 0) + 1) <= MAX_PER_STEP);
}
export function playStep(before, after) {
  const names = soundsOf(before, after), k = {};
  names.forEach((n, i) => { const j = k[n] = (k[n] ?? -1) + 1; play(n, j, Math.min(i * STAGGER, 0.5)); });
}

// ---------------------------------------------------------------- the menu part
// Fills the page's menu with the speed buttons, the sound switch and the volume, above what is there. M is
// T.ui.solo.menu. Changes are applied and saved at once. Returns nothing; the page listens to "p2000:settings".
export function mountMenu(menu, M) {
  if (!menu || menu.querySelector(".mset")) return;
  const el = document.createElement("div");
  el.className = "mset";
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  el.innerHTML = `<div class="ms-blk"><b>${esc(M.speed)}</b><div class="ms-seg" role="group" aria-label="${esc(M.speed)}">` +
    SPEEDS.map((k) => `<button type="button" data-speed="${k}" aria-pressed="false">${esc(M[k])}</button>`).join("") +
    `</div><span class="ms-note">${esc(M.stepNote)}</span></div><hr>` +
    `<div class="ms-row"><b>${esc(M.sound)}</b><button type="button" class="ms-sw" role="switch" data-sound aria-checked="true" aria-label="${esc(M.sound)}"><i></i></button></div>` +
    `<div class="ms-row"><label>${esc(M.volume)}<input type="range" min="0" max="100" step="1" data-volume aria-label="${esc(M.volume)}"></label></div><hr>`;
  menu.insertBefore(el, menu.firstChild);
  const vol = el.querySelector("[data-volume]"), sw = el.querySelector("[data-sound]");
  const sync = () => {
    const sp = getSpeed(), s = getSound();
    for (const b of el.querySelectorAll("[data-speed]")) b.setAttribute("aria-pressed", String(b.dataset.speed === sp));
    sw.setAttribute("aria-checked", String(s.on));
    if (document.activeElement !== vol) vol.value = String(Math.round(s.vol * 100));
  };
  el.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-speed], [data-sound]");
    if (!b) return;
    if (b.dataset.speed) setSpeed(b.dataset.speed); else setSound({ on: !getSound().on });
    sync();
    play("tap");
  });
  vol.addEventListener("input", () => { setSound({ vol: +vol.value / 100 }); });
  vol.addEventListener("change", () => { setSound({ vol: +vol.value / 100 }); play("tap"); });
  window.addEventListener("p2000:settings", sync);
  sync();
}
