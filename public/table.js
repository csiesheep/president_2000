// The table: tableHTML(view, choices, lang, opts) is a pure function of what one seat may see
// (E.view) and what it may do (the legal moves with labels). It never touches the DOM or the
// engine's state, so the solo controller and the room client (#13, which only gets { view, legal })
// draw the same table. labelMove(view, move, lang) writes the words of one legal move.
// Every visible string comes from i18n `ui.solo`, `ui`, `counties`, `regions`, `cards`.
import en from "./i18n/en.js";
import zh from "./i18n/zh-Hant.js";
import { COUNTIES, REGIONS, REGION_EDGES, SEATS, BOSS_THRESHOLD, ISSUES } from "./shared/board.js";
import { EVENTS, localCards, CANDIDATE_CARDS } from "./shared/cards.js";

const CARD = Object.fromEntries(EVENTS.concat(localCards()).map((c) => [c.id, c]));
const NO = [5, 1, 2]; // the ballot numbers on the 1999 flags: 陳 5, 宋 1, 連 2
const SHOW_ORDER = [1, 2, 0]; // 宋, 連, 陳: ballot-number order, as in the mockups
const REGION_OF = COUNTIES.map((c) => c[1]);

export const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const fill = (s, vars = {}) => s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? vars[k] : "{" + k + "}"));
const dict = (lang) => (lang === "en" ? en : zh);

// A small translator bound to one language. `tr("p.play", {n: 1})` reads ui.solo.p.play and
// throws on a missing key, so a typo is found by playing, not by a player.
export function bind(lang) {
  const d = dict(lang), S = d.ui.solo;
  const get = (path) => path.split(".").reduce((o, k) => (o == null ? o : o[k]), S);
  const tr = (path, vars) => {
    const s = get(path);
    if (typeof s !== "string") throw new Error("i18n: ui.solo." + path + " missing in " + d.lang);
    return vars ? fill(s, vars) : s;
  };
  const county = (k) => (lang === "en" ? d.counties[COUNTIES[k][0]] : COUNTIES[k][0]);
  const region = (r) => (lang === "en" ? d.regions[REGIONS[r]] : REGIONS[r]);
  const issue = (n) => d.ui.issues[n].name;
  const short = (p) => S.cand[SEATS[p]].short;
  const full = (p) => S.cand[SEATS[p]].name;
  const card = (id) => {
    const c = CARD[id];
    if (!c) return id;
    if (c.owner === "local") return lang === "en" ? d.cards.local.name.replace("{county}", d.counties[c.county]) : c.name;
    return lang === "en" ? d.cards[id].name : c.name;
  };
  const cardText = (id) => {
    const c = CARD[id];
    if (c.owner === "local") return lang === "en" ? d.cards.local.text : c.text;
    return lang === "en" ? d.cards[id].text : c.text;
  };
  return { d, S, tr, county, region, issue, short, full, card, cardText, lang };
}

// ---------------------------------------------------------------- facts read from a view

const cubesIn = (v, k, p) => v.counties[k].blocks.filter((b) => b.o === p).length;
function leader(arr) {
  let best = -1, max = 0, tie = false;
  for (let p = 0; p < 3; p++) {
    if (arr[p] > max) { max = arr[p]; best = p; tie = false; } else if (arr[p] === max && max > 0) tie = true;
  }
  return tie ? -1 : best;
}
function regionDistance(a, b) {
  if (a === b) return 0;
  const dist = REGIONS.map(() => -1); dist[a] = 0;
  const q = [a];
  while (q.length) {
    const x = q.shift();
    for (const [u, w] of REGION_EDGES) {
      const y = u === x ? w : w === x ? u : -1;
      if (y >= 0 && dist[y] < 0) { dist[y] = dist[x] + 1; q.push(y); }
    }
  }
  return dist[b];
}
const moveCost = (seat, from, to) => { const d = regionDistance(REGION_OF[from], REGION_OF[to]); return seat === 1 ? Math.min(d, 1) : d; };

// §8.1: does a same-camp fill of county k need a support check? (Read from the rules page, "支持檢定".)
function fillNeedsCheck(v, seat, k) {
  if ((seat === 0 && v.active.includes("lee_yuan_tseh")) || (seat === 1 && v.active.includes("walk_everywhere"))) return false;
  if (leader(v.media[REGION_OF[k]]) === seat) return false;
  if ([0, 1, 2].some((p) => p !== seat && cubesIn(v, k, p) >= BOSS_THRESHOLD)) return true;
  if ([0, 1, 2].some((p) => p !== seat && v.pos[p] === k)) return true;
  return false;
}
const crossNeedsCheck = (v, seat) => !(v.flags.crossFree[seat] > 0);

// "check" | "none" | null (not sure: then the label says nothing about it).
function checkKind(v, seat, m) {
  if (v.phase !== "action" || !v.pending) return null;
  const pd = v.pending;
  const place = () => (m.type === "fill" ? (fillNeedsCheck(v, seat, m.county) ? "check" : "none") : m.type === "cross" ? (crossNeedsCheck(v, seat) ? "check" : "none") : null);
  if (pd.stage === "campaign" || pd.stage === "local") {
    if (m.type === "steal") return "check";
    return place();
  }
  if (pd.stage === "ads" && m.type === "ad") return "check";
  if (pd.stage === "effect" && pd.fx && pd.fx.queue.length) {
    const s = pd.fx.queue[0];
    if (s.op === "place") return s.check ? place() : "none";
    if (s.op === "remove") return s.check ? "check" : "none";
    return "none";
  }
  return null;
}
// The bag is public: a check succeeds with your cubes / all cubes in the bag.
const bagRate = (v, seat) => { const t = v.bag[0] + v.bag[1] + v.bag[2]; return t > 0 ? Math.round((100 * v.bag[seat]) / t) : null; };

// ---------------------------------------------------------------- the words of one legal move

export function labelMove(v, m, lang) {
  const x = bind(lang), seat = v.seat, tr = x.tr;
  const rate = bagRate(v, seat);
  const ck = checkKind(v, seat, m);
  const suffix = ck === "none" ? tr("o.noCheck") : ck === "check" && rate != null ? tr("o.check", { p: rate }) : "";
  const cpOf = (id) => CARD[id].cp;
  switch (m.type) {
    case "order": return tr(v.phase === "election" ? "o.orderElection" : "o.order", { n: m.pos + 1 });
    case "candidate": return tr("o.candidate", { cp: CANDIDATE_CARDS[SEATS[seat]].cp });
    case "play": {
      const name = x.card(m.card);
      if (m.mode === "event") return tr("o.playEvent", { card: name });
      return tr(m.block ? "o.playBlock" : "o.playCp", { card: name, cp: cpOf(m.card) });
    }
    case "trigger": return tr("o.trigger");
    case "pass": return tr("o.pass");
    case "action": return m.kind === "ads" ? (rate != null ? tr("o.kind.ads", { p: rate }) : tr("o.kind.adsNoRate")) : tr("o.kind." + m.kind);
    case "move": return tr("o.move", { county: x.county(m.to), cost: moveCost(seat, v.pos[seat], m.to) });
    case "fill": return tr("o.fill", { county: x.county(m.county) }) + suffix;
    case "cross": return tr("o.cross", { county: x.county(m.county) }) + suffix;
    case "steal": return tr("o.steal", { county: x.county(m.county), who: x.short(m.target), kind: tr("o.block." + m.t) }) + suffix;
    case "done": return tr("o.done");
    case "ad": return tr("o.ad") + suffix;
    case "media": return m.target == null ? tr("o.mediaPlace", { region: x.region(m.region) }) : tr("o.mediaRemove", { region: x.region(m.region), who: x.short(m.target) });
    case "issue": {
      const cost = v.pending && v.pending.placed ? 2 : 1;
      return m.target == null ? tr("o.issuePlace", { issue: x.issue(m.issue), cost }) : tr("o.issueRemove", { issue: x.issue(m.issue), who: x.short(m.target), cost });
    }
    case "swap": return tr("o.swap", { a: m.slot + 1, b: m.slot + 2 });
    case "noswap": return tr("o.noswap");
    case "reward": return m.pick === "mom" ? tr("o.rewardMom") : tr("o.rewardEndorse");
    case "save": return tr("o.save", { cards: m.cards.map((id) => x.card(id)).join(lang === "en" ? ", " : "、") || "—" });
    case "reveal": return tr("o.reveal", { card: x.card(m.card), issue: x.issue(m.issue) });
    case "canvass": return tr("o.canvass", { card: x.card(m.card), county: x.county(COUNTIES.findIndex((c) => c[0] === v.cards[m.card].county)) });
    case "grey": return tr("o.grey", { county: x.county(m.county) });
    case "remove": return tr("o.remove", { county: x.county(m.county), who: x.short(m.target), kind: tr("o.block." + m.t) }) + suffix;
    case "convert": return tr("o.convert", { county: x.county(m.county) });
    case "pick": return tr("o.pick", { who: x.short(m.seat) });
  }
  return tr("o.unknown");
}

// ---------------------------------------------------------------- pieces

const sq = (cls) => `<i class="b ${cls}"></i>`;
const cubesRow = (arr) => arr.map((n, p) => sq("o" + p).repeat(n)).join("");

function cardFace(id, x) {
  const c = CARD[id], u = x.d.ui;
  const isLocal = c.owner === "local";
  const flags = c.must ? `<span class="flag">${esc(u.must)}</span>` : c.cond ? `<span class="flag alt">${esc(u.conditional)}</span>` : "";
  const band = isLocal ? "local" : c.owner;
  const issue = c.icon ? u.issues[c.icon] : null;
  const rest = ({ 2: 2, 3: 1, 4: 0 })[c.cp] ?? 0;
  return `<article class="card ${band}${c.must ? " must" : ""}">` +
    `<div class="band"><span>${esc(u.owner[c.owner])}</span><span class="r">${flags}${esc(isLocal ? x.S.card.local : u.kind.event)} · ${esc(u.deck[c.deck])}</span></div>` +
    `<div class="cp">${c.cp}</div>` +
    (issue ? `<div class="iss" title="${esc(issue.name)}">${esc(issue.short)}</div>` : `<div class="iss none" title="${esc(u.noIssue)}">—</div>`) +
    `<h4 class="ttl">${esc(x.card(id))}</h4><p class="txt">${esc(x.cardText(id))}</p>` +
    `<div class="foot"><span>${esc(x.d.terms.canvass)} ${esc(x.county(COUNTIES.findIndex((k) => k[0] === c.county)))}</span><span>${esc(fill(u.restCubes, { n: rest }))}</span></div></article>`;
}

// 軍師 (#18): the one option the advisor picked wears a star (choices[i].advised, set by solo.js / roomclient.js).
function starHTML(x) { return `<i class="star-adv" role="img" aria-label="${esc(x.d.ui.advisor.starLabel)}">★</i>`; }

function miniCard(id, x, cls, attr, star = false) {
  const c = CARD[id], u = x.d.ui;
  const band = c.owner === "local" ? "local" : c.owner;
  const who = c.owner === "local" ? x.S.card.local : c.owner === "ext" ? u.owner.ext : x.S.cand[c.owner].short;
  const iss = c.icon ? u.issues[c.icon].short : "—";
  return `<button type="button" class="hc ${band}${cls ? " " + cls : ""}${star ? " adv" : ""}" ${attr}>` +
    (star ? starHTML(x) : "") + `<span class="hn">${esc(x.card(id))}</span>` +
    `<span class="hm">${esc(c.owner === "local" ? who : u.kind.event + " · " + who)}${c.must ? ` <em>${esc(u.must)}</em>` : ""}</span>` +
    `<span class="hf"><b>${c.cp} ${esc(u.cpUnit)}</b><span class="hi">${esc(iss)}</span></span></button>`;
}

const btn = (c, cls = "", x = null) => {
  const adv = !!c.advised && x;
  return `<button type="button" class="opt${cls ? " " + cls : ""}${adv ? " adv" : ""}" data-move="${esc(JSON.stringify(c.move))}">${adv ? starHTML(x) : ""}${esc(c.label)}</button>`;
};

// ---------------------------------------------------------------- the board

function mapHTML(v, x, open) {
  const seatsHere = (k) => [0, 1, 2].filter((p) => v.pos[p] === k);
  const flag = (p, k) => `<svg class="flag-svg" width="14" height="16" viewBox="0 0 16 18" role="img" aria-label="${esc(x.tr("map.here", { who: x.full(p) }))}"><path d="M2 1v16" stroke="#1a1a1a" stroke-width="2"/><path d="M3 2h12l-4 4 4 4H3z" class="f${p}"/></svg>`;
  const out = [];
  for (let r = 0; r < REGIONS.length; r++) {
    const ks = COUNTIES.map((_, k) => k).filter((k) => REGION_OF[k] === r);
    const total = ks.reduce((s, k) => s + v.counties[k].blocks.length, 0);
    const per = [0, 1, 2].map((p) => ks.reduce((s, k) => s + cubesIn(v, k, p), 0));
    const empty = total - per[0] - per[1] - per[2];
    const isOpen = open.includes(r);
    const med = v.media[r], medTxt = SHOW_ORDER.filter((p) => med[p] > 0).map((p) => `${x.short(p)} ${med[p]}`).join(" · ");
    const endorse = v.endorse[r] >= 0 ? `${x.tr("map.endorse")} ${x.short(v.endorse[r])}` : "";
    const extra = [medTxt ? `${x.tr("map.media")} ${medTxt}` : "", endorse].filter(Boolean).join(" · ");
    const flags = ks.flatMap((k) => seatsHere(k)).map((p) => flag(p)).join("");
    out.push(`<div class="reg${isOpen ? " open" : ""}"><button type="button" class="rh" data-region="${r}" aria-expanded="${isOpen}">` +
      `<span class="rn">${esc(x.region(r))} · ${esc(x.tr("map.blocks", { n: total }))} ${flags}</span>` +
      `<span class="rs">${SHOW_ORDER.map((p) => `<span class="rc s${p}">${esc(x.short(p))} ${per[p]}</span>`).join("")}<span class="rc">${esc(x.tr("map.empty", { n: empty }))}</span></span>` +
      (extra ? `<span class="rx">${esc(extra)}</span>` : "") + `</button>`);
    if (isOpen) {
      out.push(`<div class="rb">` + ks.map((k) => {
        const blocks = v.counties[k].blocks.slice().sort((a, b) => key(a) - key(b));
        const bosses = [0, 1, 2].filter((p) => cubesIn(v, k, p) >= BOSS_THRESHOLD);
        const sub = bosses.length ? `<span class="boss">${esc(x.tr("map.boss", { who: bosses.map((p) => x.short(p)).join("/") }))}</span>` : "";
        return `<div class="cty${bosses.length ? " hot" : ""}"><span class="cn">${esc(x.county(k))}<small>${esc(x.tr("map.blocks", { n: blocks.length }))}</small>${sub}</span>` +
          `<span class="bs">${blocks.map((b) => sq(b.o >= 0 ? "o" + b.o : "e" + b.t)).join("")}</span>` +
          `<span class="pw">${seatsHere(k).map((p) => flag(p)).join("")}</span></div>`;
      }).join("") + `</div>`);
    }
    out.push(`</div>`);
  }
  return `<section class="t-map" aria-label="${esc(x.tr("map.title"))}"><h3 class="t-h">${esc(x.tr("map.title"))}</h3>${out.join("")}` +
    `<p class="legend"><span>${sq("e G")}${sq("e B")} ${esc(x.tr("map.legendEmpty"))}</span><span>${sq("e N")} ${esc(x.tr("map.legendGrey"))}</span></p></section>`;
}
const key = (b) => (b.o >= 0 ? b.o : 3 + (b.t === "G" ? 0 : b.t === "B" ? 1 : 2));

// The room's move clock (o.clock = { left, deadline, tpl }): the page rewrites it every second.
function clockHTML(c) {
  if (!c) return "";
  return ` <span class="clock${c.left <= 10 ? " low" : ""}" data-left="${c.left}" data-deadline="${c.deadline}">${esc(fill(c.tpl, { n: c.left }))}</span>`;
}

function headerHTML(v, ch, x, o) {
  const me = v.seat, S = x.S;
  const nm = (p) => x.short(p) + (o.names && o.names[p] ? ` (${o.names[p]})` : "");
  const waitNames = (o.wait || []).map(nm).join(x.lang === "en" ? ", " : "、");
  let phase;
  if (v.phase === "action") phase = x.tr("hdr.phase.action", { n: Math.min(v.step + 1, 4) });
  else phase = x.tr("hdr.phase." + v.phase);
  let status = "";
  if (v.phase === "end") status = "";
  else if (ch.length) status = `<span class="yrow"><span class="you">${esc(x.tr("hdr.yourTurn"))}</span>${clockHTML(o.clock)}</span>`;
  else status = `<span class="wait">${esc(o.waitLabel ? fill(o.waitLabel, { who: waitNames || "…" }) : x.tr("hdr.busy", { who: waitNames || "…" }))}${clockHTML(o.clock)}</span>`;
  const init = v.initiative >= 0 && v.phase !== "end" ? ` · ${x.tr("hdr.initiative", { who: x.short(v.initiative) })}` : "";
  const chips = SHOW_ORDER.map((p) => `<span class="chip s${p}${p === me ? " me" : ""}" title="${esc(x.full(p))}">${esc(x.short(p))}<b>${v.mom[p]}</b>${v.initiative === p && v.phase !== "end" ? `<i class="star" aria-label="${esc(x.tr("hdr.star"))}">★</i>` : ""}</span>`).join("");
  return `<header class="t-top"><div class="t-ttl"><span class="t-turn">${esc(x.tr("hdr.turn", { n: v.turn }))}${esc(init)}</span>` +
    `<b class="t-phase">${esc(phase)}</b>${status}</div><div class="t-mom" aria-label="${esc(x.tr("hdr.mom"))}">${chips}</div></header>`;
}

function trackHTML(v, x) {
  const slots = v.issues.map((iss, i) => `<div class="slot"><span class="sl">${esc(x.tr("hdr.slot." + (i + 1)))}</span><b>${esc(x.issue(iss.name))}</b>` +
    `<span class="cb">${cubesRow(iss.cubes) || `<em>—</em>`}</span></div>`).join("");
  const bag = `<div class="bag"><span class="sl">${esc(x.tr("hdr.bag"))}</span>${SHOW_ORDER.map((p) => `<span class="s${p}">${esc(x.short(p))} ${v.bag[p]}</span>`).join("")}</div>`;
  return `<section class="t-track">${slots}${bag}</section>`;
}

function oppHTML(v, x) {
  const inHand = (p) => (Array.isArray(v.hands[p]) ? v.hands[p].length : v.hands[p]);
  const kept = (p) => { const a = v.turn <= 5 ? v.savedDebate[p] : v.savedElection[p]; return Array.isArray(a) ? a.length : a; };
  const rows = SHOW_ORDER.filter((p) => p !== v.seat).map((p) => `<span class="s${p}">${esc(x.tr("hdr.opp", { who: x.short(p), n: inHand(p), k: kept(p) }))}</span>`);
  return `<p class="t-opp">${rows.join("")}</p>`;
}

// ---------------------------------------------------------------- the action panel

function groupedList(v, ch, x) {
  const done = ch.filter((c) => c.move.type === "done" || c.move.type === "pass" || c.move.type === "noswap");
  const rest = ch.filter((c) => !done.includes(c));
  const cty = (c) => (c.move.county != null ? c.move.county : c.move.to != null ? c.move.to : null);
  const plain = rest.filter((c) => cty(c) == null);
  const withCty = rest.filter((c) => cty(c) != null);
  const moves = withCty.filter((c) => c.move.type === "move");
  const here = withCty.filter((c) => c.move.type !== "move");
  const out = [];
  if (plain.length) out.push(`<div class="opts">${plain.map((c) => btn(c, "", x)).join("")}</div>`);
  const byRegion = (list) => {
    let s = "";
    for (let r = 0; r < REGIONS.length; r++) {
      const items = list.filter((c) => REGION_OF[cty(c)] === r).sort((a, b) => cty(a) - cty(b));
      if (items.length) s += `<h4 class="t-gh">${esc(x.region(r))}</h4><div class="opts">${items.map((c) => btn(c, "", x)).join("")}</div>`;
    }
    return s;
  };
  if (here.length) out.push(byRegion(here));
  if (moves.length) out.push(`<h4 class="t-gh mv">${esc(x.tr("p.moveHead"))}</h4>` + byRegion(moves));
  if (done.length) out.push(`<div class="opts">${done.map((c) => btn(c, "ghost", x)).join("")}</div>`);
  return out.join("");
}

function fxPrompt(v, x) {
  const pd = v.pending, s = pd.fx.queue[0];
  const left = s.left ?? 1;
  const cardName = x.card(pd.fx.card);
  let line;
  if (s.op === "place") line = x.tr("p.fxPlace", { left });
  else if (s.op === "remove") line = x.tr("p.fxRemove", { left, who: x.short(s.target) });
  else if (s.op === "media") line = s.target < 0 ? x.tr("p.fxMedia", { left }) : x.tr("p.fxMediaRemove", { left, who: x.short(s.target) });
  else if (s.op === "convert") line = x.tr("p.fxConvert", { left });
  else line = x.tr("p.fxTvbs");
  return `<p class="pr"><b>${esc(cardName)}</b> · ${esc(line)}</p><p class="ct">${esc(x.cardText(pd.fx.card))}</p>`;
}

function prompt(v, ch, x) {
  const me = v.seat, pd = v.pending, t = (k, vars) => esc(x.tr(k, vars));
  const types = new Set(ch.map((c) => c.move.type));
  if (v.phase === "order") return `<p class="pr">${t("p.order")}</p>`;
  if (v.phase === "momentum") return `<p class="pr">${t(pd.stage === "swap" ? "p.swap" : "p.reward")}</p>`;
  if (v.phase === "save") return "";
  if (v.phase === "debate") {
    if (v.debate && v.debate.award) return `<p class="pr">${t("p.award", { issue: x.issue(v.debate.award.issue), left: v.debate.award.left })}</p>`;
    return `<p class="pr">${t("p.debate")}</p>`;
  }
  if (v.phase === "election") {
    const e = v.election;
    if (e.stage === "order") return `<p class="pr">${t("p.orderElection")}</p>`;
    if (e.choose) {
      const k = e.county, r = bagRate(v, me);
      return `<p class="pr"><b>${esc(x.card(e.card))}</b> · ${t("p.canvassPlace", { county: x.county(k), left: e.left })}${r != null ? " " + t("p.canvassRate", { p: r }) : ""}</p>`;
    }
    return `<p class="pr">${t("p.canvass")}</p>`;
  }
  // action
  if (!pd) return `<p class="pr">${t("p.play", { n: Math.min(v.step + 1, 4) })}</p>`;
  const cardHead = pd.card === "candidate" ? x.tr("card.cand") : x.card(pd.card);
  switch (pd.stage) {
    case "trigger": return `<p class="pr">${t("p.trigger", { card: cardHead })}</p><div class="sheet">${CARD[pd.card] ? cardFace(pd.card, x) : ""}</div>`;
    case "effect": return fxPrompt(v, x);
    case "local": return `<p class="pr"><b>${esc(cardHead)}</b> · ${t("p.local", { county: x.county(COUNTIES.findIndex((c) => c[0] === CARD[pd.card].county)) })}</p>`;
    case "kind": return `<p class="pr"><b>${esc(cardHead)}</b> · ${t("p.kind", { cp: pd.cp })}</p>`;
    case "campaign": return `<p class="pr"><b>${esc(cardHead)}</b> · ${t("p.campaign", { cp: pd.cp })}</p>`;
    case "ads": return `<p class="pr"><b>${esc(cardHead)}</b> · ${t("p.ads", { cp: pd.cp })}</p>`;
    case "media": return `<p class="pr">${t("p.media")}</p>`;
    case "issue": return `<p class="pr"><b>${esc(cardHead)}</b> · ${t("p.issue", { cp: pd.cp })}</p>`;
  }
  void types;
  return "";
}

// The cards the player may pick from now: the hand, or the debate / election pile.
function sourceCards(v) {
  const me = v.seat;
  if (v.phase === "debate") return Array.isArray(v.savedDebate[me]) ? v.savedDebate[me] : [];
  if (v.phase === "election") return Array.isArray(v.savedElection[me]) ? v.savedElection[me] : [];
  return Array.isArray(v.hands[me]) ? v.hands[me] : [];
}

function savePanel(v, ch, x, o) {
  const n = v.turn <= 5 ? 1 : 2, hand = sourceCards(v);
  const dest = x.tr(v.turn <= 5 ? "p.destDebate" : "p.destElection");
  if (ch.length === 1) return `<p class="pr">${esc(x.tr("p.saveAll", { n, dest }))}</p><div class="opts">${btn(ch[0], "", x)}</div>`;
  const picks = (o.picks || []).filter((id) => hand.includes(id));
  const want = (ch[0].move.cards || []).length;
  const match = ch.find((c) => c.move.cards.length === picks.length && c.move.cards.every((id) => picks.includes(id)));
  const names = picks.map((id) => x.card(id)).join(x.lang === "en" ? ", " : "、");
  return `<p class="pr">${esc(x.tr("p.save", { n: want, dest }))}</p>` +
    `<p class="ct">${esc(x.tr("p.saveRest"))}</p>` +
    `<p class="pick">${esc(names || x.tr("p.saveNone"))}</p>` +
    `<div class="opts">${match ? btn({ move: match.move, label: x.tr("p.saveGo"), advised: match.advised }, "", x) : `<button type="button" class="opt" disabled>${esc(x.tr("p.saveGo"))}</button>`}</div>`;
}

function panelHTML(v, ch, x, o) {
  const hand = sourceCards(v);
  if (!ch.length) {
    const sel = o.sel && hand.includes(o.sel) ? o.sel : null;
    return sel ? sheetHTML(v, ch, x, sel) : `<p class="pr dim">${esc(o.waitHint || x.tr("hdr.waitHint"))}</p>`;
  }
  if (v.phase === "save") return savePanel(v, ch, x, o);
  const cardMoves = ch.filter((c) => c.move.card && (c.move.type === "play" || c.move.type === "reveal" || c.move.type === "canvass"));
  if (cardMoves.length || ch.some((c) => c.move.type === "candidate")) {
    const cards = [...new Set(cardMoves.map((c) => c.move.card))];
    let sel = o.sel && (hand.includes(o.sel) || cards.includes(o.sel)) ? o.sel : null;
    if (!sel && cards.length === 1 && !ch.some((c) => c.move.type === "candidate")) sel = cards[0];
    const cand = ch.filter((c) => c.move.type === "candidate");
    if (sel) return sheetHTML(v, ch, x, sel);
    return prompt(v, ch, x) + (cand.length ? `<div class="opts">${cand.map((c) => btn(c, "", x)).join("")}</div>` : "") +
      `<p class="ct">${esc(x.tr(v.phase === "debate" ? "p.pickCardDebate" : v.phase === "election" ? "p.pickCardElection" : "p.pickCard"))}</p>`;
  }
  return prompt(v, ch, x) + groupedList(v, ch, x);
}

function sheetHTML(v, ch, x, sel) {
  const moves = ch.filter((c) => c.move.card === sel);
  return `<div class="sheet"><button type="button" class="back" data-sel="">${esc(x.tr("p.back"))}</button>${cardFace(sel, x)}` +
    (moves.length ? `<div class="opts">${moves.map((c) => btn(c, "", x)).join("")}</div>` : `<p class="ct">${esc(x.tr("p.notNow"))}</p>`) + `</div>`;
}

// ---------------------------------------------------------------- hand bar

function handHTML(v, ch, x, o) {
  const me = v.seat, hand = sourceCards(v);
  const savePhase = v.phase === "save" && ch.length > 1;
  const picks = o.picks || [];
  const adv = ch.find((c) => c.advised), advCards = adv ? new Set(adv.move.cards || (adv.move.card ? [adv.move.card] : [])) : new Set();
  const playable = new Set(ch.filter((c) => c.move.card).map((c) => c.move.card));
  const kept = v.turn <= 5 ? v.savedDebate[me] : v.savedElection[me];
  const keptN = Array.isArray(kept) ? kept.length : kept;
  const title = v.phase === "debate" ? x.tr("hand.titleDebate", { n: hand.length }) : v.phase === "election" ? x.tr("hand.titleElection", { n: hand.length }) : x.tr("hand.title", { n: hand.length }) + (keptN && v.phase !== "end" ? " · " + x.tr("hand.kept", { n: keptN, dest: x.tr(v.turn <= 5 ? "p.destDebate" : "p.destElection") }) : "");
  const cards = hand.map((id) => {
    if (savePhase) return miniCard(id, x, picks.includes(id) ? "sel" : "", `data-pick="${esc(id)}" aria-pressed="${picks.includes(id)}"`, advCards.has(id));
    const cls = (o.sel === id ? "sel " : "") + (ch.length && !playable.has(id) ? "dis" : "");
    return miniCard(id, x, cls.trim(), `data-sel="${esc(id)}"`, advCards.has(id));
  }).join("");
  return `<footer class="t-hand"><div class="hh"><span>${esc(title)}</span><a href="rules${x.lang === "en" ? "?lang=en" : ""}" target="_blank" rel="noopener">${esc(x.d.nav.rules)}</a></div>` +
    `<div class="hs">${cards || `<span class="none">${esc(x.tr("hand.none"))}</span>`}</div></footer>`;
}

// ---------------------------------------------------------------- the debate board

function debateHTML(v, x) {
  const d = v.debate;
  if (!d) return "";
  const settles = v.log.filter((e) => e.t === "debate" && e.step === "settle");
  // A settled issue's cards leave the board, so the table is rebuilt from the (public) reveals.
  const shown = Object.fromEntries(ISSUES.map((n) => [n, [[], [], []]]));
  const start = v.log.map((e) => e.t === "turn" && e.turn === 6).lastIndexOf(true);
  for (const e of v.log.slice(Math.max(start, 0))) {
    if (e.t === "debate" && e.step === "reveal") for (const c of e.cards) if (!c.dead) shown[c.issue][c.seat].push(c.card);
  }
  const cols = ISSUES.map((name) => {
    const st = settles.find((e) => e.issue === name);
    const head = st ? x.tr("debate.settled", { who: x.short(st.seat), n: st.cubes }) : x.tr("debate.open");
    const rows = SHOW_ORDER.map((p) => {
      const cards = shown[name][p];
      const pick = d.picks[p];
      const total = cards.reduce((s, id) => s + CARD[id].cp, 0);
      const picked = pick ? ` <em>${esc(p === v.seat ? x.tr("debate.yours") : x.tr("debate.picked"))}</em>` : "";
      const body = cards.length ? cards.map((id) => `<span class="dc">${esc(x.card(id))} <b>${CARD[id].cp}</b></span>`).join("") : `<span class="dc none">—</span>`;
      return `<div class="drow s${p}"><span class="dw">${esc(x.short(p))}${picked}</span><span class="dcs">${body}</span><span class="dt">${cards.length ? esc(x.tr("debate.total", { n: total })) : ""}</span></div>`;
    }).join("");
    const sums = st ? `<p class="ds">${esc(x.tr("debate.sums", { a: st.cp[1], b: st.cp[2], c: st.cp[0] }))}</p>` : "";
    return `<section class="dcol${st ? " done" : ""}"><h4>${esc(x.issue(name))} <small>${esc(head)}</small></h4>${rows}${sums}</section>`;
  }).join("");
  return `<section class="t-debate"><h3 class="t-h">${esc(x.tr("debate.title"))}</h3><p class="ct">${esc(x.tr("debate.rule"))}</p>${cols}</section>`;
}

// ---------------------------------------------------------------- the record

export function feedLine(e, v, x) {
  const tr = x.tr, who = (p) => x.short(p);
  switch (e.k) {
    case "turn": return tr("f.turn", { n: e.turn, who: who(e.initiative) });
    case "order": return tr(e.election ? "f.orderElection" : "f.order", { who: who(e.seat), n: e.pos + 1 });
    case "play": return tr(e.mode === "event" ? "f.playEvent" : "f.playCp", { who: who(e.seat), card: x.card(e.card) }) + (e.block ? tr("f.block") : "");
    case "cand": return tr("f.cand", { who: who(e.seat) });
    case "trigger": return tr("f.trigger", { who: who(e.seat), card: x.card(e.card) });
    case "fill": case "cross": case "steal": case "grey": case "remove":
      return tr("f." + e.k + (e.ok ? "Ok" : "Fail"), { who: who(e.seat), county: x.county(e.county), target: e.target != null ? who(e.target) : "" });
    case "move": return tr("f.move", { who: who(e.seat), county: x.county(e.to) });
    case "ad": return tr(e.ok ? "f.adOk" : "f.adFail", { who: who(e.seat) });
    case "media": return e.target == null ? tr("f.mediaPlace", { who: who(e.seat), region: x.region(e.region) }) : tr("f.mediaRemove", { who: who(e.seat), region: x.region(e.region), target: who(e.target) });
    case "issue": return e.target == null ? tr("f.issuePlace", { who: who(e.seat), issue: x.issue(e.issue) }) : tr("f.issueRemove", { who: who(e.seat), issue: x.issue(e.issue), target: who(e.target) });
    case "swap": return tr("f.swap", { who: who(e.seat) });
    case "reward": return tr(e.pick === "mom" ? "f.rewardMom" : "f.rewardEndorse", { who: who(e.seat) });
    case "endorseOne": return tr("f.endorseOne", { who: who(e.seat), region: x.region(e.region) });
    case "pickMom": return tr("f.pickMom", { who: who(e.seat) });
    case "save": return tr("f.save", { who: who(e.seat), n: e.n });
    case "pick": return tr("f.pick", { who: who(e.seat) });
    case "reveal": return tr("f.reveal", { who: who(e.seat), card: x.card(e.card), issue: x.issue(e.issue) });
    case "dead": return tr("f.dead", { who: who(e.seat), card: x.card(e.card), issue: x.issue(e.issue) });
    case "settle": return tr("f.settle", { issue: x.issue(e.issue), who: who(e.seat), n: e.cubes });
    case "canvass": return tr("f.canvass", { who: who(e.seat), county: x.county(e.county) });
    case "convert": return tr("f.convert");
    case "strategic": case "endorse": {
      const text = SHOW_ORDER.filter((p) => e.per[p]).map((p) => `${who(p)} +${e.per[p]}`).join(" · ");
      if (!text) return e.k === "strategic" ? tr("f.strategicNone") : "";
      return tr(e.k === "endorse" ? "f.endorse" : e.half ? "f.strategicHalf" : "f.strategic", { text });
    }
    case "result": return tr("f.result");
  }
  return "";
}

// What a bot's team says about its move: talk[why.key] with the placeholders read as names.
// A placeholder the move did not carry is shown as "…", never as a raw "{x}".
export function sayLine(why, seat, x) {
  const t = x.d.talk && x.d.talk[why.key];
  if (!t) return "";
  const who = (s) => (typeof s === "number" ? s : SEATS.indexOf(s));
  const vars = {};
  if (why.card != null) vars.card = x.card(why.card);
  if (why.county != null) vars.county = x.lang === "en" ? x.d.counties[why.county] || why.county : why.county;
  if (why.region != null) vars.region = x.lang === "en" ? x.d.regions[why.region] || why.region : why.region;
  if (why.issue != null) vars.issue = x.issue(why.issue);
  for (const k of ["target", "seat"]) if (why[k] != null && who(why[k]) >= 0) vars[k] = x.short(who(why[k]));
  if (why.cp != null) vars.cp = why.cp;
  if (why.slot != null) vars.slot = why.slot;
  const tag = x.d.ui.room && x.d.ui.room.say;
  const head = tag && seat != null ? fill(tag, { who: x.short(seat) }) + " " : "";
  return head + fill(t, vars).replace(/\{\w+\}/g, "…");
}

function feedHTML(v, x, o) {
  const feed = (o.feed || []).slice(-14).reverse();
  if (!feed.length) return "";
  const rows = feed.map((e) => {
    const line = e.k === "say" ? "" : feedLine(e, v, x);
    const say = e.why && e.why.key !== "only_move" ? sayLine(e.why, line ? null : e.seat, x) : "";
    if (!line && !say) return "";
    return `<li class="${e.seat != null ? "s" + e.seat : "sys"}${e.k === "turn" ? " turn" : ""}">${line ? esc(line) : ""}${say ? `<span class="say">${esc(say)}</span>` : ""}</li>`;
  }).join("");
  return `<section class="t-feed"><h3 class="t-h">${esc(x.tr("hdr.feed"))}</h3><ol>${rows}</ol></section>`;
}

// ---------------------------------------------------------------- the count

function endHTML(v, x, o) {
  const r = v.result, S = x.S;
  const names = [0, 1, 2];
  const max = Math.max(...r.votes, 1);
  const order = names.slice().sort((a, b) => r.votes[b] - r.votes[a] || r.leads[b] - r.leads[a] || r.momentum[b] - r.momentum[a]);
  const w = r.winner, second = order.find((p) => p !== w);
  const diff = r.votes[w] - r.votes[second];
  const total = COUNTIES.reduce((s, c) => s + c[2] + c[3] + c[4], 0);
  const emptyLeft = v.counties.reduce((s, c) => s + c.blocks.filter((b) => b.o < 0).length, 0);
  const youWon = w === v.seat;
  const bars = order.map((p) => `<div class="bar s${p}"><span class="bn">${NO[p]} ${esc(x.full(p))}</span><span class="bt"><i style="width:${Math.round((r.votes[p] / max) * 100)}%"></i></span><b>${r.votes[p]}</b></div>`).join("");
  const leadsBy = names.map((p) => ({ p, ks: v.counties.map((c, k) => k).filter((k) => leader([0, 1, 2].map((q) => cubesIn(v, k, q))) === p) }));
  const leadRows = SHOW_ORDER.map((p) => { const e = leadsBy[p]; return `<p class="s${p}"><b>${esc(x.short(p))} ${e.ks.length}</b> · ${esc(e.ks.map((k) => x.county(k)).join(x.lang === "en" ? ", " : "、") || "—")}</p>`; }).join("");
  // election day, from the log: everything after the conversion
  const log = v.log, from = log.map((e) => e.t).lastIndexOf("convert");
  const day = from >= 0 ? log.slice(from) : [];
  const lines = [];
  for (const p of SHOW_ORDER) {
    const cs = day.filter((e) => e.t === "canvass" && e.seat === p);
    const cards = cs.filter((e) => e.card).length;
    const pl = cs.filter((e) => e.step === "place");
    const cnt = (ty) => pl.filter((e) => e.move.type === ty).length;
    if (cards) lines.push(`<li class="s${p}">${esc(x.tr("end.canvass", { who: x.short(p), cards, fill: cnt("fill") + cnt("cross") + cnt("grey"), take: cnt("remove") }))}</li>`);
  }
  for (const e of day.filter((e) => e.t === "strategic")) {
    const per = [0, 0, 0]; for (const m of e.moved) per[m.seat] += m.n;
    if (per.some(Boolean)) lines.push(`<li class="sys">${esc(x.tr("end.strategic", { text: SHOW_ORDER.filter((p) => per[p]).map((p) => `${x.short(p)} +${per[p]}`).join(" · ") }))}</li>`);
    else lines.push(`<li class="sys">${esc(x.tr("end.strategicNone"))}</li>`);
  }
  for (const e of day.filter((e) => e.t === "endorse")) {
    const per = [0, 0, 0]; for (const m of e.given) per[m.seat] += m.n;
    if (per.some(Boolean)) lines.push(`<li class="sys">${esc(x.tr("end.endorse", { text: SHOW_ORDER.filter((p) => per[p]).map((p) => `${x.short(p)} +${per[p]}`).join(" · ") }))}</li>`);
  }
  const q = x.lang === "en" ? "?lang=en" : "";
  void S;
  return `<section class="t-end"><p class="kick">${esc(x.tr("end.kicker"))}</p><p class="elected">${esc(x.tr("end.elected"))}</p><h2 class="s${w}">${esc(x.full(w))}</h2>` +
    `<p class="sum">${esc(diff > 0 ? x.tr("end.margin", { who: x.full(w), other: x.full(second), n: diff, wan: diff * 10, votes: String(diff * 100000).replace(/\B(?=(\d{3})+(?!\d))/g, ",") }) : x.tr("end.marginTie", { who: x.full(w), other: x.full(second) }))} ${esc(x.tr(youWon ? "end.youWon" : "end.youLost"))}</p>` +
    `<div class="bars">${bars}</div><p class="note">${esc(x.tr("end.unit", { total }))} · ${esc(x.tr("end.emptyLeft", { n: emptyLeft }))}</p>` +
    `<h3 class="t-h">${esc(x.tr("end.dayTitle"))}</h3><ul class="day">${lines.join("")}</ul>` +
    `<h3 class="t-h">${esc(x.tr("end.leadTitle"))}</h3><div class="leads">${leadRows}</div>` +
    `<p class="hist">${esc(x.tr("end.history"))}</p>` +
    `<div class="opts">${o.again ? `<button type="button" class="opt" data-msg="${esc(JSON.stringify(o.again.data))}">${esc(o.again.label)}</button>` : o.noAgain ? (o.againWait ? `<p class="sub wait">${esc(o.againWait)}</p>` : "") : `<button type="button" class="opt" data-act="again">${esc(x.tr("end.again"))}</button>`}<a class="opt ghost" href="./${q}">${esc(x.tr("end.home"))}</a></div></section>`;
}

// ---------------------------------------------------------------- the whole table

// The advisor's switch above the table, and (when it is on and the seat is to act) its reason.
// o.advisor = { on, why }: absent → no switch; why is the advise() reason.
function advisorBar(x, o) {
  const A = x.d.ui.advisor, on = !!o.advisor.on;
  return `<div class="t-adv"><button type="button" class="advsw${on ? " on" : ""}" data-advisor="${on ? "off" : "on"}" aria-pressed="${on}">` +
    `<span class="sw" aria-hidden="true"></span><b>${esc(A.label)}</b><em>${esc(on ? A.on : A.off)}</em></button>` +
    `<span class="advn">${esc(A.note)}</span></div>`;
}
function adviceLine(x, o) {
  const why = o.advisor && o.advisor.on && o.advisor.why;
  if (!why || why.key === "only_move") return "";
  const say = sayLine(why, null, x);
  return say ? `<p class="advice"><b>${esc(x.d.ui.advisor.prefix)}</b> ${esc(say)}</p>` : "";
}

export function tableHTML(view, choices, lang, opts = {}) {
  const x = bind(lang), v = view, o = opts;
  const bar = o.advisor ? advisorBar(x, o) : "";
  const open = o.open || [v.pos ? REGION_OF[v.pos[v.seat]] : 0];
  if (v.phase === "end") {
    return `<div class="tbl end" data-phase="end">${headerHTML(v, choices, x, o)}${endHTML(v, x, o)}${trackHTML(v, x)}${mapHTML(v, x, open)}${feedHTML(v, x, o)}</div>`;
  }
  return `<div class="tbl${bar ? " hasbar" : ""}" data-phase="${esc(v.phase)}">${bar}${headerHTML(v, choices, x, o)}${trackHTML(v, x)}${oppHTML(v, x)}` +
    `<section class="t-act${choices.length ? " mine" : ""}" id="act">${choices.length ? adviceLine(x, o) : ""}${panelHTML(v, choices, x, o)}</section>` +
    `${v.phase === "debate" ? debateHTML(v, x) : ""}${mapHTML(v, x, open)}${feedHTML(v, x, o)}${handHTML(v, choices, x, o)}</div>`;
}
