// What both table pages (solo, room) do to the DOM when they redraw. A redraw replaces the whole stage,
// so the hand strip would jump back to the left each time; this keeps where it was and, when the
// advisor has a new pick, scrolls the strip to that card so it is not off the edge of the screen (#23).
// Importing it in node is harmless: nothing runs until drawInto() is called.
let lastAdvised = null;

export function drawInto(root, html) {
  const old = root.querySelector(".hs"), left = old ? old.scrollLeft : 0;
  root.innerHTML = html;
  const hs = root.querySelector(".hs");
  if (!hs) { lastAdvised = null; return; }
  const adv = hs.querySelector(".hc.adv");
  const key = adv ? (adv.querySelector(".hn") || adv).textContent : null;
  if (adv && key !== lastAdvised) {
    const at = adv.getBoundingClientRect().left - hs.getBoundingClientRect().left + hs.scrollLeft;
    hs.scrollLeft = Math.max(0, at - (hs.clientWidth - adv.offsetWidth) / 2);
  } else hs.scrollLeft = left;
  lastAdvised = key;
}

// ---------------------------------------------------------------- the county box (#25)
// Both table pages keep the open county in their own state (ui.county) and redraw; this is the part they
// share: which screen size the map is drawn for, and the clicks and keys that open and close the box.

const NARROW = "(max-width: 767px)";
export const narrowNow = () => typeof matchMedia === "function" && matchMedia(NARROW).matches;
// Calls fn(isNarrow) when the window crosses the phone breakpoint (the map is drawn differently on each side).
export function watchNarrow(fn) {
  if (typeof matchMedia !== "function") return;
  const q = matchMedia(NARROW), h = () => fn(q.matches);
  if (q.addEventListener) q.addEventListener("change", h); else q.addListener(h);
}

// Open county k (or close it when k is null or already open). From the keyboard, focus follows: into the box
// when it opens, back onto the county when it closes. `api.redraw` must be synchronous.
export function setCounty(root, api, k, byKey) {
  const prev = api.get();
  api.set(k == null || k === prev ? null : k);
  api.redraw();
  const pop = root.querySelector(".pop");
  if (pop) {
    if (byKey) (pop.querySelector(".pop-opt") || pop).focus({ preventScroll: true });
    if (pop.scrollIntoView) pop.scrollIntoView({ block: "nearest", behavior: "smooth" });
  } else if (byKey && prev != null) {
    const g = root.querySelector(`[data-county="${prev}"]`);
    if (g) g.focus({ preventScroll: true });
  }
}

// Wire a table page's counties: click or Enter / Space opens the box; Esc, the cross, a click outside or the
// same county again closes it. api = { get(): open county or null, set(k), redraw() }.
export function bindCounty(root, api) {
  root.addEventListener("click", (ev) => {
    const g = ev.target.closest("[data-county]");
    if (g) return setCounty(root, api, +g.dataset.county, false);
    if (ev.target.closest("[data-pop-close]")) setCounty(root, api, null, true);
  });
  root.addEventListener("keydown", (ev) => {
    const g = ev.target.closest && ev.target.closest("[data-county]");
    if (g && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); setCounty(root, api, +g.dataset.county, true); }
    else if (ev.key === "Escape" && api.get() != null) { ev.preventDefault(); setCounty(root, api, null, true); }
  });
  document.addEventListener("click", (ev) => {
    if (api.get() == null || !ev.target.isConnected) return;
    if (!ev.target.closest(".pop, [data-county]")) { api.set(null); api.redraw(); }
  });
}

// ---------------------------------------------------------------- the tutorial's bubble (#27)
// solo.js puts the bubble (.tut) at the end of the table and lights the target (data-tut-focus); this places
// it. On a phone it sits at the bottom of the screen, just above the hand. On a wide screen it goes next to
// the target (right, left, below, above: the first side with room), and falls back to the same place as the
// phone. Either way the target is scrolled into the free part of the screen and the bubble never covers it.
let lastTut = null, tutRoot = null, tutRaf = 0;
const shown = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
const hits = (a, b, pad = 0) => a.left < b.right + pad && a.right > b.left - pad && a.top < b.bottom + pad && a.bottom > b.top - pad;

function layoutTutorial(root, doScroll) {
  const b = root.querySelector(".tut");
  if (!b) return;
  const vw = document.documentElement.clientWidth, vh = window.innerHeight, narrow = vw < 768;
  const hand = root.querySelector(".t-hand"), floor = hand ? Math.min(vh, hand.getBoundingClientRect().top) : vh;
  const list = [...root.querySelectorAll("[data-tut-focus]")].filter(shown);
  const t = list.find((e) => e.closest(".pop")) || list[0] || null;
  const inHand = !!(t && hand && hand.contains(t));
  const dock = () => {
    const w = narrow ? vw - 16 : Math.min(560, vw - 16);
    b.style.width = w + "px"; b.style.left = Math.round((vw - w) / 2) + "px"; b.style.top = "auto"; b.style.bottom = Math.max(8, Math.round(vh - floor + 6)) + "px";
  };
  b.style.top = b.style.bottom = b.style.left = b.style.width = "";
  dock();
  const top = b.getBoundingClientRect().top;
  if (doScroll && inHand) {
    // The hand is a strip that scrolls sideways: bring the lit card to its middle.
    const hs = hand.querySelector(".hs"), r = t.getBoundingClientRect();
    if (hs && (r.left < 8 || r.right > vw - 8)) hs.scrollLeft += r.left + r.width / 2 - vw / 2;
  }
  if (doScroll && t && !inHand) {
    const r = t.getBoundingClientRect(), area = narrow ? top : floor;
    if (r.top < 8 || r.bottom > area - 8) window.scrollBy(0, r.height > area - 16 ? r.top - 8 : r.top + r.height / 2 - area / 2);
  }
  if (narrow || !t) return;
  const r = t.getBoundingClientRect(), pop = root.querySelector(".pop"), pr = pop ? pop.getBoundingClientRect() : null;
  b.style.width = "340px"; b.style.left = "0px"; b.style.top = "0px"; b.style.bottom = "auto";
  const w = b.offsetWidth, h = b.offsetHeight, G = 14, clampX = (x) => Math.max(8, Math.min(vw - w - 8, x)), clampY = (y) => Math.max(8, Math.min(floor - h - 8, y));
  const tries = [
    [r.right + G, clampY(r.top + r.height / 2 - h / 2)], [r.left - G - w, clampY(r.top + r.height / 2 - h / 2)],
    [clampX(r.left + r.width / 2 - w / 2), r.bottom + G], [clampX(r.left + r.width / 2 - w / 2), r.top - G - h],
  ];
  for (const [x, y] of tries) {
    const box = { left: x, top: y, right: x + w, bottom: y + h };
    if (x < 8 || x + w > vw - 8 || y < 8 || y + h > floor - 8) continue;
    if (hits(box, r, 6) || (pr && hits(box, pr, 6))) continue;
    b.style.left = Math.round(x) + "px"; b.style.top = Math.round(y) + "px";
    return;
  }
  dock();
  const t2 = b.getBoundingClientRect().top;
  if (!inHand && r.bottom > t2 - 6) window.scrollBy(0, r.bottom - (t2 - 10));
}

export function placeTutorial(root) {
  const b = root.querySelector(".tut");
  if (!b) { lastTut = null; return; }
  tutRoot = root;
  const t = root.querySelector("[data-tut-focus]");
  const id = b.dataset.tutorial + "|" + (t ? (t.getAttribute("data-move") || t.getAttribute("data-sel") || t.getAttribute("data-county") || t.className) : "");
  const fresh = id !== lastTut;
  lastTut = id;
  layoutTutorial(root, fresh);
  // The county box scrolls itself into view a moment later (smooth): look again once it has settled.
  if (fresh) setTimeout(() => { if (lastTut === id && root.querySelector(".tut")) layoutTutorial(root, true); }, 500);
}

if (typeof window !== "undefined") {
  const again = () => {
    if (tutRaf || !tutRoot) return;
    tutRaf = requestAnimationFrame(() => { tutRaf = 0; if (tutRoot.querySelector(".tut")) layoutTutorial(tutRoot, false); });
  };
  window.addEventListener("scroll", again, { passive: true });
  window.addEventListener("resize", again);
}
