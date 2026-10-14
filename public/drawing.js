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
