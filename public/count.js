// Election night (#93): when a game ends on the page, the count is shown county by county on a map of Taiwan, as the
// invented channel 選戰新聞台's special report, before the end page. This file builds that screen once and updates it in
// place (nothing is rebuilt per county, so no picture is ever recreated); the pages (app.js for the solo table,
// roompage.js for a room) only decide when to show it. It reads a finished state or any seat's view of it, and plays
// out the result that was already computed: no rule, no number of its own.
//
//   facts(v)                      what the count shows, from a finished state or view (pure, node runs it)
//   mountCount({ T, lang, view, onClose })   the screen, appended to <body>; returns { close, stage }
//   addReplay(stage, T, onReplay) puts the "watch the count again" button on an end page that is drawn
//
// The screen is [data-count="open" | "tally" | "win"]; the hooks tools/count93.mjs reads are the data attributes below.
import { COUNTIES, SEATS } from "./shared/board.js";
import { bind } from "./table.js";
import { countMap, artSet } from "./map.js";

const KEYS = SEATS;
const NO = [5, 1, 2];
const SPEEDS = { normal: 600, fast: 200 };
const AUTO_MS = 3500, WIN_HOLD = 1300;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fill = (s, vars = {}) => s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
const lead = (a) => { const m = Math.max(...a); return m > 0 && a.filter((x) => x === m).length === 1 ? a.indexOf(m) : -1; };

// What the screen needs, from a finished state or view: the blocks of each county, who leads it, the running totals
// after each county, where the running leader changes alone (反超), and what 棄保 and 背書 gave each seat.
export function facts(v) {
  const blocks = v.counties.map((c) => [0, 1, 2].map((p) => c.blocks.filter((b) => b.o === p).length));
  const leads = blocks.map(lead), run = [];
  let acc = [0, 0, 0];
  for (const b of blocks) { acc = acc.map((x, p) => x + b[p]); run.push(acc.slice()); }
  const runLead = run.map(lead), prev = run.map(() => -1);
  for (let k = 1; k < run.length; k++) if (runLead[k - 1] >= 0 && runLead[k] >= 0 && runLead[k] !== runLead[k - 1]) prev[k] = runLead[k - 1];
  const gain = (t, f) => [0, 1, 2].map((p) => v.log.filter((e) => e.t === t).reduce((s, e) => s + (e[f] || []).filter((m) => m.seat === p).reduce((x, m) => x + m.n, 0), 0));
  const r = v.result;
  return { blocks, leads, run, runLead, prev, strategic: gain("strategic", "moved"), endorse: gain("endorse", "given"), votes: r.votes.slice(), winner: r.winner, led: r.leads.slice() };
}

const mm = (n) => { const m = 20 * 60 + n * 6; return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); };

export function mountCount({ T, lang, view, onClose, parent = document.body }) {
  const x = bind(lang), C = T.ui.count, en = lang === "en";
  const F = facts(view), W = F.winner, WK = KEYS[W];
  const vHTML = (n) => (en ? (n / 10).toFixed(1) : String(n * 10)) + `<small>${esc(C.unit)}</small>`;
  const vText = (n) => (en ? (n / 10).toFixed(1) : String(n * 10)) + C.unit;
  const scale = Math.max(1, ...F.votes);
  const gainText = (label, g, none) => {
    const parts = [0, 1, 2].filter((p) => g[p]).map((p) => fill(C.gain, { who: x.short(p), n: g[p], blocks: g[p] === 1 ? "block" : "blocks" }));
    return fill(C.sFull, { label, text: parts.length ? parts.join(en ? " · " : "　") : none });
  };
  const rows = [0, 1, 2].map((p) => `<div class="c-v s${p}"><img class="c-face" ${artSet("candidates", KEYS[p], [48, 128, 192])} alt="" width="48" height="64" decoding="async"><span class="c-vn"><b>${esc(x.short(p))}</b><em>${esc(fill(C.no, { n: NO[p] }))}</em></span><i class="c-bar"><b data-bar="${p}" style="width:0%"></b></i><b class="c-vv" data-count-votes="${KEYS[p]}" data-n="0">${vHTML(0)}</b></div>`).join("");
  const legRows = [0, 1, 2].map((p) => `<li class="s${p}"><i class="sw"></i><span>${esc(x.short(p))}</span><b data-count-led="${KEYS[p]}" data-n="0">0</b></li>`).join("");
  const root = document.createElement("div");
  root.className = "cnt";
  root.setAttribute("data-count", "open");
  root.setAttribute("data-w", String(W));
  root.setAttribute("lang", en ? "en" : "zh-Hant");
  root.innerHTML =
    `<header class="c-head"><span class="c-chn"><b class="c-tag">${esc(C.tagA)}</b><span class="c-ch">${esc(C.tagB)}</span></span><span class="c-sp">${esc(C.special)}</span><span class="c-live"><i></i>${esc(C.live)}</span><time class="c-clock">${mm(0)}</time></header>` +
    `<div class="c-left">` +
    `<section class="c-wall" data-st="open"><img src="art/news/wall.webp" alt="${esc(C.alt.wall)}" width="1280" height="800" decoding="async"><i class="c-shade" aria-hidden="true"></i><div class="c-wt"><span>${esc(C.year)}</span><b>${esc(C.special)}</b><i></i></div><div class="c-soon"><b>${esc(C.soonTag)}</b><span>${esc(C.soonLine)}</span></div></section>` +
    `<section class="c-studio" data-st="tally"><img src="art/news/studio.webp" alt="${esc(C.alt.studio)}" width="1280" height="720" decoding="async"><div class="c-card"><span class="c-ck"></span><b class="c-cn"></b><span class="c-cb"></span><span class="c-cc"></span></div></section>` +
    `<section class="c-hero" data-st="win"><div class="c-flash"><b>${esc(C.flash)}</b><span>${esc(C.flashLine)}</span></div><div class="c-hp"><img src="art/end/${WK}.webp" alt="${esc(fill(C.alt.end, { who: x.full(W) }))}" width="1024" height="1024" decoding="async"><span class="c-hl">${esc(C.live2)}</span></div><div class="c-scene"><b>${esc(C.live2)}</b><span>${esc(fill(C.scene, { who: x.full(W) }))}</span></div></section>` +
    `<div class="c-now" data-st="tally" data-count-now role="status"><b class="c-nl">${esc(C.latest)}</b><span class="c-nt"></span></div>` +
    `</div>` +
    `<div class="c-right">` +
    `<section class="c-title" data-st="win"><span class="c-wk">${esc(C.kicker)}</span><h2 class="c-wn"></h2><p class="c-wl"></p></section>` +
    `<section class="c-votes">${rows}</section>` +
    `<section class="c-settle" data-st="open"><h3>${esc(C.settleTitle)}</h3><p data-count-settle="strategic">${esc(gainText(C.strategic, F.strategic, C.noMove))}</p><p data-count-settle="endorse">${esc(gainText(C.endorse, F.endorse, C.noGift))}</p></section>` +
    `<div class="c-prog" data-st="tally" data-count-done data-n="0"><span class="c-pt"></span><i class="c-pb"><b style="width:0%"></b></i></div>` +
    `<section class="c-map" data-st="tally win"><div class="c-mapbox" data-cmap>${countMap({ label: C.mapTitle })}</div><div class="c-leg"><h3 class="c-lh"></h3><ul class="c-ll">${legRows}<li class="u"><i class="sw"></i><span>${esc(C.unopened)}</span><b data-un>24</b></li><li class="t"><i class="sw"></i><span>${esc(C.tied)}</span><b data-ti>0</b></li></ul><p class="c-note">${esc(C.cities)}</p><div class="c-rec" data-st="tally"><h4>${esc(C.justIn)}</h4><ol></ol><p class="c-nx"></p></div></div></section>` +
    `</div>` +
    `<div class="c-act"><button type="button" class="c-b go" data-st="open" data-count-start>${esc(C.start)}</button><button type="button" class="c-b" data-st="open tally" data-count-skip>${esc(C.skip)}</button><button type="button" class="c-b alt" data-st="tally" data-count-speed data-speed="normal"></button><button type="button" class="c-b go" data-st="win" data-count-next>${esc(C.next2)}</button></div>` +
    `<footer class="c-tick"><b class="c-tt">${esc(C.flash)}</b><div class="c-tw"><span class="c-ti"></span></div></footer>`;
  parent.appendChild(root);
  document.documentElement.classList.add("counting");

  const $ = (s) => root.querySelector(s), $$ = (s) => [...root.querySelectorAll(s)];
  const cells = $$("[data-cmap-k]").sort((a, b) => +a.dataset.cmapK - +b.dataset.cmapK);
  const rings = $$("[data-ring]");
  const votesEl = KEYS.map((k) => $(`[data-count-votes="${k}"]`)), barEl = [0, 1, 2].map((p) => $(`[data-bar="${p}"]`));
  const ledEl = KEYS.map((k) => $(`[data-count-led="${k}"]`));
  const doneEl = $("[data-count-done]"), nowEl = $("[data-count-now]"), speedEl = $("[data-count-speed]");
  const el = { nt: $(".c-nt"), pt: $(".c-pt"), pb: $(".c-pb b"), ck: $(".c-ck"), cn: $(".c-cn"), cb: $(".c-cb"), cc: $(".c-cc"), clock: $(".c-clock"), rec: $(".c-rec ol"), nx: $(".c-nx"), lh: $(".c-lh"), un: $("[data-un]"), ti: $("[data-ti]"), tick: $(".c-ti"), wn: $(".c-wn"), wl: $(".c-wl") };
  let stage = "open", done = 0, speed = "normal", timer = null, auto = null, closed = false, tick = null, left = 0;
  const startEl = $("[data-count-start]");

  const names = (k) => x.county(k);
  const blocksOf = (k) => F.blocks[k];
  const cube = (p, n) => `${x.short(p)} ${n}`;
  const nowText = (k) => {
    const l = F.leads[k], pv = F.prev[k], nl = F.runLead[k], sep = en ? " — " : "　";
    const head = l >= 0 ? fill(C.takes, { who: x.full(l), county: names(k) }) : fill(C.noLead, { county: names(k) });
    if (pv < 0) return head;
    return head + sep + fill(nl === l ? C.overtakesSame : C.overtakes, { who: x.full(nl), prev: x.full(pv) });
  };
  const setStage = (s) => { stage = s; root.setAttribute("data-count", s); };

  // The whole display for "n counties open": a pure function of n, so a skip and a step draw the same thing.
  const render = (n) => {
    done = n;
    const k = n - 1, tot = n ? F.run[k] : [0, 0, 0];
    doneEl.setAttribute("data-n", String(n));
    el.pt.textContent = fill(C.done, { n });
    el.pb.style.width = (n / 24) * 100 + "%";
    el.clock.textContent = mm(n);
    for (let p = 0; p < 3; p++) {
      const v = stage === "win" ? F.votes[p] : tot[p];
      votesEl[p].setAttribute("data-n", String(v)); votesEl[p].innerHTML = vHTML(v);
      barEl[p].style.width = Math.min(100, (v / scale) * 100) + "%";
    }
    let led = [0, 0, 0], ties = 0;
    cells.forEach((c, i) => {
      const open = i < n;
      c.setAttribute("data-lead", open ? String(F.leads[i]) : "");
      if (i === k && stage === "tally") c.setAttribute("data-now", ""); else c.removeAttribute("data-now");
      if (open) { if (F.leads[i] >= 0) led[F.leads[i]]++; else ties++; }
    });
    for (const g of rings) { if (+g.dataset.ring === k && stage === "tally") g.setAttribute("data-on", ""); else g.removeAttribute("data-on"); }
    for (let p = 0; p < 3; p++) { const v = stage === "win" ? F.led[p] : led[p]; ledEl[p].setAttribute("data-n", String(v)); ledEl[p].textContent = String(v); }
    el.un.textContent = String(24 - n); el.ti.textContent = String(ties);
    el.lh.textContent = stage === "win" ? C.mapWon : C.mapTitle;
    // the county just opened: the line, the card over the studio, the list beside the map, the ticker
    if (n) {
      nowEl.setAttribute("data-k", String(k));
      el.nt.textContent = nowText(k);
      el.ck.textContent = fill(C.nth, { n });
      el.cn.textContent = names(k);
      const b = blocksOf(k);
      el.cb.innerHTML = [0, 1, 2].map((p) => `<i class="sq s${p}"></i>`.repeat(b[p])).join("");
      el.cc.textContent = [0, 1, 2].map((p) => cube(p, b[p])).join(en ? " · " : "・");
      el.rec.innerHTML = [k, k - 1, k - 2].filter((i) => i >= 0).map((i) => `<li${i === k ? " class=\"now\"" : ""}><b>${esc(names(i))}</b><span>${[0, 1, 2].map((p) => `<i class="sq s${p}"></i>${blocksOf(i)[p]}`).join(" ")}</span></li>`).join("");
      el.nx.textContent = n < 24 ? fill(C.next, { county: names(n) }) : C.allIn;
    } else { nowEl.removeAttribute("data-k"); el.nt.textContent = ""; el.cn.textContent = ""; el.cb.innerHTML = ""; el.cc.textContent = ""; el.ck.textContent = ""; el.rec.innerHTML = ""; el.nx.textContent = ""; }
    // the ticker: the latest county, the next, what was settled before the count
    const items = [];
    if (stage === "win") items.push(fill(C.tResult, { text: [0, 1, 2].map((p) => fill(C.tVotes, { who: x.short(p), votes: en ? (F.votes[p] / 10).toFixed(1) : F.votes[p] * 10 })).join(en ? " · " : "・") }));
    else {
      if (n) items.push(fill(C.tCounty, { county: names(k), text: [0, 1, 2].map((p) => cube(p, blocksOf(k)[p])).join(en ? " · " : "・") }));
      if (n && n < 24) items.push(fill(C.tNext, { county: names(n) }));
      if (!n) items.push(C.tOpen);
    }
    items.push(gainText(C.strategic, F.strategic, C.noMove), gainText(C.endorse, F.endorse, C.noGift));
    el.tick.innerHTML = items.map((t) => `<span>${esc(t)}</span>`).join("<i></i>");
  };
  const speedText = () => fill(C.speed, { v: C.speeds[speed] });

  const clear = () => { clearTimeout(timer); clearTimeout(auto); timer = null; auto = null; clearInterval(tick); tick = null; };
  const win = () => {
    clear();
    setStage("win");
    el.wn.setAttribute("data-count-winner", WK);
    el.wn.textContent = fill(C.wins, { who: x.full(W) });
    el.wl.textContent = fill(C.line, { votes: en ? (F.votes[W] / 10).toFixed(1) : F.votes[W] * 10, n: F.led[W] });
    render(24);
    const nx = $("[data-count-next]"); if (nx) { try { nx.focus({ preventScroll: true }); } catch { /* old browser */ } }
  };
  const step = () => {
    timer = null;
    if (closed || stage !== "tally") return;
    render(done + 1);
    timer = setTimeout(done >= 24 ? win : step, done >= 24 ? WIN_HOLD : SPEEDS[speed]);
  };
  const startTally = () => {
    if (stage !== "open") return;
    clear();
    setStage("tally");
    render(1);
    timer = setTimeout(step, SPEEDS[speed]);
  };
  const skip = () => { if (stage === "win") return; clear(); setStage("tally"); render(24); win(); };

  speedEl.textContent = speedText();
  render(0);
  // the opening: starts by itself after a few seconds, with the seconds counted on the button's side
  left = Math.round(AUTO_MS / 1000);
  startEl.setAttribute("title", fill(C.auto, { n: left }));
  auto = setTimeout(startTally, AUTO_MS);
  root.addEventListener("click", (ev) => {
    const b = ev.target.closest("button");
    if (!b || !root.contains(b)) return;
    if (b.hasAttribute("data-count-start")) startTally();
    else if (b.hasAttribute("data-count-skip")) skip();
    else if (b.hasAttribute("data-count-speed")) {
      speed = speed === "normal" ? "fast" : "normal";
      speedEl.setAttribute("data-speed", speed); speedEl.textContent = speedText();
    } else if (b.hasAttribute("data-count-next")) close();
  });
  const onKey = (ev) => { if (ev.key === "Escape" && stage !== "win") skip(); };
  addEventListener("keydown", onKey);
  speedEl.setAttribute("data-speed", speed);
  try { startEl.focus({ preventScroll: true }); } catch { /* old browser */ }

  function close() {
    if (closed) return;
    closed = true; clear();
    removeEventListener("keydown", onKey);
    root.remove();
    document.documentElement.classList.remove("counting");
    if (onClose) onClose();
  }
  return { close, stage: () => stage, root };
}

// A finished game drawn on the page without the count (the page was opened on it): a small button over the end page's
// picture plays the count night again from its start. The page calls this after every redraw of the stage.
export function addReplay(stage, T, onReplay) {
  const hero = stage.querySelector(".e-hero");
  if (!hero || hero.querySelector("[data-count-replay]")) return;
  const b = document.createElement("button");
  b.type = "button"; b.className = "c-replay"; b.setAttribute("data-count-replay", "");
  b.textContent = "▶ " + T.ui.count.replay;
  b.addEventListener("click", (ev) => { ev.stopPropagation(); onReplay(); });
  hero.appendChild(b);
}
