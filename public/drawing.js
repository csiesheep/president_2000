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
