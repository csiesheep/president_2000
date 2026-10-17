// What both table pages (solo, room) do to the DOM when they redraw. A redraw replaces the whole stage,
// so the hand strip would jump back to the left each time; this keeps where it was and, when the
// advisor has a new pick, scrolls the strip to that card so it is not off the edge of the screen (#23).
// Importing it in node is harmless: nothing runs until drawInto() is called.
let lastAdvised = null;

// A redraw swaps the whole stage, which would make every picture a brand-new <img> that blinks while it
// decodes (#28). So the <img> elements that were on the stage keep their place: after the swap, a new <img>
// whose markup is identical to one that was just removed is replaced by that very element.
// The candidates standing on the map are HTML <img data-pawn-pic> laid over the map (#31; as SVG <image> they blinked on
// iPhone Safari). A candidate that walks to another county is the same picture in a new place, so such an <img> is
// matched by its seat and file and only its position (style, data-of) is moved; everything else is matched by its
// whole markup.
const imgKey = new WeakMap();
const sigOf = (im) => (im.hasAttribute("data-pawn-pic") ? "pawn|" + im.getAttribute("data-pawn-pic") + "|" + (im.getAttribute("src") || "") : im.outerHTML);
const keyOf = (im) => imgKey.get(im) || sigOf(im);
function keepImages(root, html) {
  const pool = new Map();
  for (const im of root.querySelectorAll("img")) {
    const k = keyOf(im);
    if (!pool.has(k)) pool.set(k, []);
    pool.get(k).push(im);
  }
  root.innerHTML = html;
  for (const im of root.querySelectorAll("img")) {
    const k = sigOf(im), list = pool.get(k);
    if (list && list.length) {
      const was = list.shift();
      if (im.hasAttribute("data-pawn-pic")) for (const at of ["style", "data-of"]) was.setAttribute(at, im.getAttribute(at));
      im.replaceWith(was); imgKey.set(was, k);
    } else imgKey.set(im, k);
  }
}

// What the player has open that is not part of the view (#29): on a phone, which candidate's board shows its
// hand, bag and momentum under the row; whether the menu is open. Applied to the DOM after each redraw, so the
// table's HTML stays a pure function of the view and the room client does not need to know about it.
function applyState(root, state) {
  for (const a of root.querySelectorAll(".pl")) {
    const on = state.seat != null && a.classList.contains("s" + state.seat);
    a.classList.toggle("open", on);
    const b = a.querySelector(".pl-tap");
    if (b) b.setAttribute("aria-expanded", String(on));
  }
  const m = root.querySelector("[data-menu]");
  if (m) m.setAttribute("aria-expanded", String(!!state.menu));
}

export function drawInto(root, html, state = {}) {
  const old = root.querySelector(".hs"), left = old ? old.scrollLeft : 0;
  // A folded note the player opened (the end page's election-day record, #33) stays open across a redraw.
  const opened = new Set([...root.querySelectorAll("details[data-keep][open]")].map((d) => d.dataset.keep));
  keepImages(root, html);
  for (const d of root.querySelectorAll("details[data-keep]")) if (opened.has(d.dataset.keep)) d.open = true;
  applyState(root, state);
  fitPop(root);
  keepToast(root);
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

// The table does not scroll (#66), so the county's box must stay inside the free part of the screen, between the top row and the hand:
// after each draw it is moved up or down (translate) by whatever it sticks out. The arrow keeps pointing at the county's column.
// The rivals' line over the map shows for about four seconds and fades (CSS); a redraw must not bring it back, so it is told how long it has been there
// (a new line starts it again).
let toastSig = null, toastAt = 0;
function keepToast(root) {
  const el = root.querySelector("[data-act-toast]");
  if (!el) { toastSig = null; return; }
  const sig = el.textContent, now = performance.now();
  if (sig !== toastSig) { toastSig = sig; toastAt = now; }
  el.style.animationDelay = `-${Math.round(now - toastAt)}ms`;
}
export function fitPop(root) {
  const pop = root.querySelector(".tbl:not(.end) .pop");
  if (!pop) return;
  pop.style.translate = "";
  const hand = root.querySelector(".t-hand"), top = 48, bottom = (hand ? hand.getBoundingClientRect().top : window.innerHeight) - 6;
  const r = pop.getBoundingClientRect();
  let dy = 0;
  if (r.bottom > bottom) dy = bottom - r.bottom;
  if (r.top + dy < top) dy = top - r.top;
  if (dy) pop.style.translate = `0 ${Math.round(dy)}px`;
}
if (typeof window !== "undefined") window.addEventListener("resize", () => fitPop(document));

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
    // (#66: the table never scrolls; fitPop keeps the box inside the free part of the screen instead)
    if (pop.scrollIntoView && !root.querySelector(".tbl:not(.end)")) pop.scrollIntoView({ block: "nearest", behavior: "smooth" });
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

// ---------------------------------------------------------------- the menu and the candidate boards (#29)

// A candidate board is one button (data-detail): on a phone a tap shows that candidate's hand, bag and momentum
// under the row, a second tap hides it. api = { get(): seat or null, set(seat), redraw() }.
export function bindSeat(root, api) {
  root.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-detail]");
    if (!b) return;
    const p = +b.dataset.detail;
    api.set(api.get() === p ? null : p);
    api.redraw();
  });
}

// The page's menu (quit or leave, language): `menu` is a static element holding those controls, hidden until a
// menu button (the one in the table's top row, [data-menu], or the one in the static top bar, [data-menu-top])
// is pressed. It opens under the button, on top of everything, and closes with Esc, a click elsewhere or a choice
// in it. Returns { isOpen(), close() }; the page passes isOpen() to drawInto so a redraw keeps the button right.
export function bindMenu(menu) {
  let open = false, from = null;
  const sync = () => {
    menu.hidden = !open;
    for (const b of document.querySelectorAll("[data-menu], [data-menu-top]")) b.setAttribute("aria-expanded", String(open && b === from));
  };
  const set = (on, btn) => {
    open = on; if (btn) from = btn;
    if (open && from) {
      const r = from.getBoundingClientRect();
      menu.style.top = Math.round(r.bottom + window.scrollY + 6) + "px";
      menu.style.right = Math.max(4, Math.round(document.documentElement.clientWidth - r.right)) + "px";
    }
    sync();
  };
  document.addEventListener("click", (ev) => {
    const b = ev.target.closest && ev.target.closest("[data-menu], [data-menu-top]");
    if (b) { set(!open, b); return; }
    if (open && !menu.contains(ev.target)) set(false);
    else if (open && ev.target.closest("button:not([data-speed]):not([data-sound]), a")) setTimeout(() => set(false), 0);
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape" || !open) return;
    const b = from;
    set(false);
    if (b && b.isConnected) b.focus({ preventScroll: true });
  });
  return { isOpen: () => open, close: () => set(false) };
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
  const hand = root.querySelector(".t-hand"), act = root.querySelector(".t-act");
  let floor = hand ? Math.min(vh, hand.getBoundingClientRect().top) : vh;
  // (#66: a county stage's sheet is a bar where the hand was: the bubble sits above it)
  if (narrow && act && act.getBoundingClientRect().bottom >= vh - 1) floor = Math.min(floor, act.getBoundingClientRect().top);
  const list = [...root.querySelectorAll("[data-tut-focus]")].filter(shown);
  const t = list.find((e) => e.closest(".pop")) || list[0] || null;
  const inHand = !!(t && hand && hand.contains(t));
  const dock = () => {
    const w = narrow ? vw - 16 : Math.min(560, vw - 16);
    b.style.width = w + "px"; b.style.left = Math.round((vw - w) / 2) + "px"; b.style.top = "auto"; b.style.bottom = Math.max(8, Math.round(vh - floor + 6)) + "px";
  };
  b.style.top = b.style.bottom = b.style.left = b.style.width = "";
  dock();
  // (#66: the table does not scroll) a bubble that would cover what it points at goes to the top of the screen instead
  const covers = () => list.some((e) => hits(b.getBoundingClientRect(), e.getBoundingClientRect(), 4));
  if (narrow && list.length && !inHand && covers()) { b.style.top = "50px"; b.style.bottom = "auto"; if (covers()) dock(); }
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
