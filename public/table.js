// The table: tableHTML(view, choices, lang, opts) is a pure function of what one seat may see
// (E.view) and what it may do (the legal moves with labels). It never touches the DOM or the
// engine's state, so the solo controller and the room client (#13, which only gets { view, legal })
// draw the same table. labelMove(view, move, lang) writes the words of one legal move.
// Every visible string comes from i18n `ui.solo`, `ui`, `counties`, `regions`, `cards`.
import en from "./i18n/en.js";
import zh from "./i18n/zh-Hant.js";
import { COUNTIES, REGIONS, REGION_EDGES, SEATS, BOSS_THRESHOLD, ISSUES } from "./shared/board.js";
import { EVENTS, localCards, CANDIDATE_CARDS } from "./shared/cards.js";
import { taiwanMap, popPlace } from "./map.js";

const CARD = Object.fromEntries(EVENTS.concat(localCards()).map((c) => [c.id, c]));
const NO = [5, 1, 2]; // the ballot numbers on the 1999 flags: 陳 5, 宋 1, 連 2
const SHOW_ORDER = [1, 2, 0]; // 宋, 連, 陳: ballot-number order, as in the mockups
const REGION_OF = COUNTIES.map((c) => c[1]);

// The pictures (#24, public/art/): one per event card, one per county for its local cards, one per issue,
// one per candidate. The paths are relative so the page works under any prefix.
const COUNTY_SLUG = {
  "台北市": "taipei-city", "台北縣": "taipei-county", "基隆市": "keelung", "桃園縣": "taoyuan",
  "新竹縣": "hsinchu-county", "新竹市": "hsinchu-city", "苗栗縣": "miaoli", "台中縣": "taichung-county",
  "台中市": "taichung-city", "彰化縣": "changhua", "南投縣": "nantou", "雲林縣": "yunlin",
  "嘉義縣": "chiayi-county", "嘉義市": "chiayi-city", "台南縣": "tainan-county", "台南市": "tainan-city",
  "高雄市": "kaohsiung-city", "高雄縣": "kaohsiung-county", "屏東縣": "pingtung", "宜蘭縣": "yilan",
  "花蓮縣": "hualien", "台東縣": "taitung", "澎湖縣": "penghu", "金馬": "kinma",
};
const cardArt = (id) => (CARD[id].owner === "local" ? `art/local/${COUNTY_SLUG[CARD[id].county]}.webp` : `art/cards/${id}.webp`);
// Event and local pictures are 600x400, issues 640x480, candidates 480x640: the sizes are written on the
// <img> so the page does not jump when a picture arrives.
const cardImg = (id, x) => `<img src="${cardArt(id)}" alt="${esc(x.card(id))}" width="600" height="400" loading="lazy" decoding="async">`;
const issueImg = (name, x) => `<img src="art/issues/${name}.webp" alt="${esc(x.issue(name))}" width="640" height="480" loading="lazy" decoding="async">`;

export const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const fill = (s, vars = {}) => s.replace(/\{(\w+)(?:#([^|}]*)\|([^}]*))?\}/g, (m, k, one, many) => (!(k in vars) ? m : one === undefined ? vars[k] : Number(vars[k]) === 1 ? one : many)); // "{n#block|blocks}": the singular at 1 (#30)
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

// " · no check" / " · check about 34%" / "" (not sure): the tail of a placement's label.
function suffixFor(v, m, x) {
  const rate = bagRate(v, v.seat), ck = checkKind(v, v.seat, m);
  return ck === "none" ? x.tr("o.noCheck") : ck === "check" && rate != null ? x.tr("o.check", { p: rate }) : "";
}

export function labelMove(v, m, lang) {
  const x = bind(lang), seat = v.seat, tr = x.tr;
  const rate = bagRate(v, seat);
  const suffix = suffixFor(v, m, x);
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

// A placement's short words inside its county's block (the county is the block's heading), or null.
function shortOpt(v, m, x) {
  const tr = x.tr, suffix = suffixFor(v, m, x);
  const kind = () => ({ who: x.short(m.target), kind: tr("o.block." + m.t) });
  switch (m.type) {
    case "fill": return tr("p.c.fill") + suffix;
    case "cross": return tr("p.c.cross") + suffix;
    case "steal": return tr("p.c.steal", kind()) + suffix;
    case "remove": return tr("p.c.remove", kind()) + suffix;
    case "grey": return tr("p.c.grey");
    case "convert": return tr("p.c.convert");
    case "move": {
      const left = v.pending && typeof v.pending.cp === "number" ? v.pending.cp - moveCost(v.seat, v.pos[v.seat], m.to) : null;
      return left == null ? null : tr("p.c.move", { county: x.county(m.to), left });
    }
  }
  return null;
}

// ---------------------------------------------------------------- the order of the options

const PLACE_T = new Set(["fill", "cross", "steal", "grey", "remove", "convert"]);
const END_T = new Set(["done", "pass", "noswap"]);
const isPlace = (c) => PLACE_T.has(c.move.type) && c.move.county != null;

// The options in the order the table shows them (#23): whatever is not about a county, then the
// counties (one block per county, the ones that offer a placement with no check first, and inside a
// county the no-check ones first), then moving, then "end the action". `free(move)` says whether a
// placement needs no support check; the solo page asks the engine, the room (which has only a view)
// reads the rules off it. Lists with no county placement come back unchanged.
export function orderChoices(v, list, free) {
  const place = list.filter(isPlace);
  if (!place.length) return list;
  const isFree = (c) => (free ? !!free(c.move) : checkKind(v, v.seat, c.move) === "none");
  const byCounty = new Map();
  for (const c of place) { if (!byCounty.has(c.move.county)) byCounty.set(c.move.county, []); byCounty.get(c.move.county).push(c); }
  const groups = [...byCounty].map(([k, items]) => {
    const f = items.map(isFree);
    return { k, free: f.some(Boolean), items: items.map((c, i) => ({ c, f: f[i], i })).sort((a, b) => Number(!a.f) - Number(!b.f) || a.i - b.i).map((z) => z.c) };
  }).sort((a, b) => Number(!a.free) - Number(!b.free) || a.k - b.k);
  const moves = list.filter((c) => c.move.type === "move"), end = list.filter((c) => END_T.has(c.move.type));
  const rest = list.filter((c) => !place.includes(c) && !moves.includes(c) && !end.includes(c));
  return [...rest, ...groups.flatMap((g) => g.items), ...moves, ...end];
}

// ---------------------------------------------------------------- "just now" and "your result"

const NUMBERED = new Set(["fill", "cross", "steal", "remove", "grey", "issue", "issueRemove"]);
const listSep = (x) => (x.lang === "en" ? ", " : "、");

function turnLine(e, v, x) {
  if (e.turn === 6) return x.tr("r.turnDebate", { n: e.turn });
  if (e.turn === 9) return x.tr("r.turnElection", { n: e.turn });
  const who = e.initiative >= 0 ? x.short(e.initiative) : "—";
  const cards = v && Array.isArray(v.hands[v.seat]) ? v.hands[v.seat].length : 0;
  return cards && v.phase !== "end" ? x.tr("r.turn", { n: e.turn, who, cards }) : x.tr("r.turnNoDeal", { n: e.turn, who });
}

// The few words one placement entry takes inside a line: "台南縣 +2", "雲林縣 沒填成".
function phrase(key, vars, n, x) {
  const t = x.tr("r.p." + key, { ...vars, n });
  return NUMBERED.has(key) || n < 2 ? t : t + " " + x.tr("r.times", { n });
}
function entryPhrase(e, x) {
  const county = e.county != null ? x.county(e.county) : "", target = e.target != null ? x.short(e.target) : "";
  switch (e.k) {
    case "fill": case "cross": case "grey": return phrase(e.k + (e.ok ? "" : "Fail"), { county }, 1, x);
    case "steal": case "remove": return phrase(e.k + (e.ok ? "" : "Fail"), { county, target }, 1, x);
    case "ad": return phrase(e.ok ? "adOk" : "adFail", {}, 1, x);
  }
  return "";
}

// What happened since the human last decided, from the record's entries (solo.js, roomclient.js):
// [{ seat, text }] in order. One line per action: the card an opponent played and, after the colon,
// what it did ("宋拿「X」做 CP：台南縣 +2、雲林縣 沒填成"), never one line per block.
export function recentLines(entries, v, x) {
  const tr = x.tr, who = (p) => x.short(p), items = [], last = {};
  const group = (seat, head) => { const g = { seat, head, parts: new Map() }; items.push(g); last[seat] = g; return g; };
  const part = (seat, key, vars) => {
    const g = last[seat] || group(seat, who(seat)), id = key + "|" + JSON.stringify(vars), p = g.parts.get(id);
    if (p) p.n++; else g.parts.set(id, { key, vars, n: 1 });
  };
  const line = (seat, text) => { if (text) items.push({ seat, line: text }); };
  for (const e of entries) {
    const county = e.county != null ? x.county(e.county) : "", target = e.target != null ? who(e.target) : "";
    switch (e.k) {
      case "turn": line(null, turnLine(e, v, x)); for (const s of Object.keys(last)) delete last[s]; break;
      case "play": case "cand": case "trigger": case "canvass": group(e.seat, feedLine(e, v, x)); break;
      case "fill": case "cross": case "grey": part(e.seat, e.k + (e.ok ? "" : "Fail"), { county }); break;
      case "steal": case "remove": part(e.seat, e.k + (e.ok ? "" : "Fail"), { county, target }); break;
      case "move": part(e.seat, "move", { county: x.county(e.to) }); break;
      case "ad": part(e.seat, e.ok ? "adOk" : "adFail", {}); break;
      case "media": part(e.seat, e.target == null ? "media" : "mediaRemove", { region: x.region(e.region), target }); break;
      case "issue": part(e.seat, e.target == null ? "issue" : "issueRemove", { issue: x.issue(e.issue), target }); break;
      case "say": break;
      default: line(e.seat ?? null, feedLine(e, v, x));
    }
  }
  return items.map((g) => {
    if (g.line != null) return { seat: g.seat, text: g.line };
    const what = [...g.parts.values()].map((p) => phrase(p.key, p.vars, p.n, x)).join(listSep(x));
    return { seat: g.seat, text: what ? tr("r.group", { head: g.head, what }) : g.head };
  }).filter((l) => l.text);
}

// The counties an entry list touched, for the map to mark. `tried`: count a failed attempt too.
export function changedCounties(entries, tried = false) {
  const s = new Set();
  for (const e of entries) {
    if (["fill", "cross", "steal", "grey", "remove"].includes(e.k) && e.county != null && (e.ok || tried)) s.add(e.county);
    else if (e.k === "move" && e.to != null) s.add(e.to);
  }
  return [...s];
}

// The outcome of your own last move when it made a support check ({ checks: [{ ok, drew }], lines:
// the entries of the move }), else null. The last check decides what it says.
export function resultLine(res, x) {
  if (!res || !res.checks || !res.checks.length) return null;
  const c = res.checks[res.checks.length - 1], ents = (res.lines || []).filter((e) => entryPhrase(e, x));
  if (c.ok) {
    const e = ents.slice().reverse().find((q) => q.ok);
    return e ? x.tr("res.ok", { what: entryPhrase(e, x) }) : x.tr("res.okPlain");
  }
  const drew = c.drew != null ? x.short(c.drew) : "…", e = ents.slice().reverse().find((q) => !q.ok) || ents[ents.length - 1];
  return e ? x.tr("res.fail", { where: entryPhrase({ ...e, ok: false }, x), drew }) : x.tr("res.failNoWhere", { drew });
}

// What the table writes at the top of the decision after your own step: { text, kind } with kind
// "ok" / "fail" (a support check was made: resultLine) or "did" (a placement that needed none, so
// the table can still say it went on the board; lastResult stays null for those), else null.
export function resultBlock(res, x) {
  const text = resultLine(res, x);
  if (text) return { text, kind: res.checks[res.checks.length - 1].ok ? "ok" : "fail" };
  const e = res && (res.lines || []).slice().reverse().find((q) => q.ok && entryPhrase(q, x));
  return e ? { text: x.tr("res.did", { what: entryPhrase(e, x) }), kind: "did" } : null;
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
  // Thick cream paper: a wooden cube of the camp's colour and the kind, the red CP stamp, the picture, the
  // name in serif, the text, and at the foot where it canvasses and how many cubes it rests.
  return `<article class="pcard ${band}${c.must ? " must" : ""}">` +
    `<div class="pc-top"><span class="pc-k"><i class="cube"></i>${esc(u.owner[c.owner])} · ${esc(isLocal ? x.S.card.local : u.kind.event)} · ${esc(u.deck[c.deck])}</span><span class="stamp" aria-label="${c.cp} ${esc(u.cpUnit)}">${c.cp}</span></div>` +
    `<p class="pc-i${issue ? "" : " none"}">${esc(issue ? issue.name : u.noIssue)}${flags}</p>` +
    `<div class="pc-art">${cardImg(id, x)}</div>` +
    `<h4 class="ttl">${esc(x.card(id))}</h4><p class="txt">${esc(x.cardText(id))}</p>` +
    `<div class="foot"><span>${esc(x.d.terms.canvass)} ${esc(x.county(COUNTIES.findIndex((k) => k[0] === c.county)))}</span><span>${esc(fill(u.restCubes, { n: rest }))}</span></div></article>`;
}

// 軍師 (#18): the one option the advisor picked wears a star (choices[i].advised, set by solo.js / roomclient.js).
function starHTML(x) { return `<i class="star-adv" role="img" aria-label="${esc(x.d.ui.advisor.starLabel)}">★</i>`; }

// A card in the hand fan: the wooden cube and the kind, the red CP stamp (top right, so a neighbour never
// hides it), the picture, the name in serif, and (on a big screen) its text. `fan` = the card's tilt and drop.
function miniCard(id, x, cls, attr, star = false, fan = null) {
  const c = CARD[id], u = x.d.ui;
  const band = c.owner === "local" ? "local" : c.owner;
  const who = c.owner === "local" ? x.S.card.local : c.owner === "ext" ? u.owner.ext : x.S.cand[c.owner].short;
  const iss = c.icon ? u.issues[c.icon].short : "—";
  const style = fan ? ` style="--r:${fan.r}deg;--y:${fan.y}px"` : "";
  return `<button type="button" class="hc ${band}${cls ? " " + cls : ""}${star ? " adv" : ""}" ${attr}${style}>` +
    (star ? starHTML(x) : "") +
    `<span class="hm"><i class="cube"></i><span class="hw">${esc(c.owner === "local" ? who : who + " · " + u.kind.event)}</span>${c.must ? ` <em>${esc(u.must)}</em>` : ""}</span>` +
    `<span class="stamp" aria-label="${c.cp} ${esc(u.cpUnit)}">${c.cp}</span>` +
    `<span class="ha">${cardImg(id, x)}</span><span class="hn">${esc(x.card(id))}</span>` +
    `<span class="ht">${esc(x.cardText(id))}</span>` +
    `<span class="hf"><span class="hi">${esc(iss)}</span><span class="hr">${esc(fill(u.restCubes, { n: ({ 2: 2, 3: 1, 4: 0 })[c.cp] ?? 0 }))}</span></span></button>`;
}

// The candidate card, a dark wooden card with a red wax seal "once a game". When the seat may use it now
// it is the same legal move the panel offers (asks again before it plays); otherwise it only sits there.
function candCard(v, ch, x) {
  const me = v.seat, can = ch.find((c) => c.move.type === "candidate"), used = !!v.candidateUsed[me];
  if (v.phase === "debate" || v.phase === "election" || v.phase === "end" || v.phase === "save") return "";
  const L = x.d.ui.look.card;
  const head = `<span class="cc-k">${esc(x.tr("card.cand"))}</span><b class="cc-n">${CANDIDATE_CARDS[SEATS[me]].cp}</b>` +
    `<span class="cc-w"><i class="b o${me}"></i>${esc(x.full(me))}</span><span class="cc-s">${esc(used ? L.used : L.seal)}</span>`;
  if (can && !used) return `<button type="button" class="hc candc" data-move="${esc(JSON.stringify(can.move))}" data-confirm="1">${head}</button>`;
  return `<button type="button" class="hc candc dis" disabled>${head}</button>`;
}

// One option button. The candidate card is the one a new player must not hit by accident: it is drawn
// quietly and asks again (data-confirm; the page keeps the question in its own state).
const btn = (c, cls = "", x = null, label = null) => {
  const adv = !!c.advised && x, cand = c.move.type === "candidate";
  return `<button type="button" class="opt${cls ? " " + cls : ""}${cand ? " weak" : ""}${adv ? " adv" : ""}" data-move="${esc(JSON.stringify(c.move))}"${cand ? ` data-confirm="1"` : ""}>${adv ? starHTML(x) : ""}${esc(label || c.label)}</button>`;
};

// ---------------------------------------------------------------- the board

// The county's box (#25): what stands in county k, then every option that acts on it. Each button is the
// same legal move the decision panel offers (data-move), plus data-choice (its index in `ch`) and data-pop.
function popHTML(v, ch, x, k, narrow) {
  const tr = x.tr, blocks = v.counties[k].blocks;
  const cls = (b) => (b.o >= 0 ? SEATS[b.o] : b.t === "G" ? "green" : b.t === "B" ? "blue" : "grey");
  const order = { chen: 0, soong: 1, lien: 2, green: 3, blue: 4, grey: 5 };
  const cubes = blocks.map(cls).sort((a, b) => order[a] - order[b]).map((c) => `<i class="pb ${c}"></i>`).join("");
  const own = SHOW_ORDER.map((p) => [p, cubesIn(v, k, p)]).filter(([, n]) => n > 0).map(([p, n]) => `<span class="s${p}">${esc(x.short(p))} ${n}</span>`);
  const count = (f) => blocks.filter(f).length;
  const rest = [tr("p.eg", { n: count((b) => b.o < 0 && b.t === "G") }), tr("p.eb", { n: count((b) => b.o < 0 && b.t === "B") }), tr("map.popGrey", { n: count((b) => b.o < 0 && b.t !== "G" && b.t !== "B") })];
  const mine = ch.map((c, i) => ({ c, i })).filter(({ c }) => c.move && (c.move.county === k || (c.move.type === "move" && c.move.to === k)));
  const free = (m) => PLACE_T.has(m.type) && checkKind(v, v.seat, m) === "none";
  const rows = mine.map((z) => ({ ...z, f: free(z.c.move) })).sort((a, b) => Number(!a.f) - Number(!b.f) || a.i - b.i);
  const label = (c) => {
    const m = c.move;
    if (m.type === "move") {
      const left = v.pending && typeof v.pending.cp === "number" ? v.pending.cp - moveCost(v.seat, v.pos[v.seat], m.to) : null;
      return left == null ? c.label : tr("map.popMove", { left });
    }
    return shortOpt(v, m, x) || c.label;
  };
  // "Fill 1 block · no check": the action on top, what it costs or risks smaller under it.
  const words = (s) => { const [head, ...tail] = s.split(" · "); return `<span>${esc(head)}</span>` + (tail.length ? `<small>${esc(tail.join(" · "))}</small>` : ""); };
  const opt = ({ c, i, f }) => `<button type="button" class="opt pop-opt${f ? " go" : ""}${c.advised ? " adv" : ""}" data-move="${esc(JSON.stringify(c.move))}" data-choice="${i}" data-pop="${k}">${c.advised ? starHTML(x) : ""}${words(label(c))}</button>`;
  const at = popPlace(k, narrow, x.lang);
  return `<div class="pop ${at.cls}" data-popover="${k}" role="dialog" aria-label="${esc(x.county(k))}" tabindex="-1" style="${at.style}"><i class="pop-arrow" aria-hidden="true"></i>` +
    `<div class="pop-h"><b>${esc(x.county(k))} · ${esc(tr("map.blocks", { n: blocks.length }))}</b><span>${esc(x.region(REGION_OF[k]))}</span>` +
    `<button type="button" class="pop-x" data-pop-close="1" aria-label="${esc(tr("map.popClose"))}">×</button></div>` +
    `<div class="pop-b"><span class="pbs">${cubes}</span><span class="pbn">${[...own, ...rest.map((s) => `<span>${esc(s)}</span>`)].join("")}</span></div>` +
    (rows.length ? `<div class="pop-o">${rows.map(opt).join("")}</div>` : `<p class="ct">${esc(tr("map.popNone"))}</p>`) + `</div>`;
}

// The room's move clock (o.clock = { left, deadline, tpl }): the page rewrites it every second.
function clockHTML(c) {
  if (!c) return "";
  return ` <span class="clock${c.left <= 10 ? " low" : ""}" data-left="${c.left}" data-deadline="${c.deadline}">${esc(fill(c.tpl, { n: c.left }))}</span>`;
}

// The top row (#29, one row of at most 56 px on a phone): back to the home page, two lines of words (the turn
// and who has the initiative; the phase and whose move it is), the advisor's switch and the menu. The menu
// itself (quit, language) is not drawn here: the page owns it (drawing.js bindMenu) and this is its button.
const ICON_BACK = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>`;
const ICON_MENU = `<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="19" cy="12" r="2" fill="currentColor"/></svg>`;

function headerHTML(v, ch, x, o) {
  const nm = (p) => x.short(p) + (o.names && o.names[p] ? ` (${o.names[p]})` : "");
  const waitNames = (o.wait || []).map(nm).join(x.lang === "en" ? ", " : "、");
  const phase = v.phase === "action" ? x.tr("hdr.ph.action", { n: Math.min(v.step + 1, 4) }) : x.tr("hdr.ph." + v.phase);
  let status = "";
  if (v.phase === "end") status = "";
  else if (ch.length) status = `<span class="yrow"><span class="you">${esc(x.tr("hdr.yourTurn"))}</span>${clockHTML(o.clock)}</span>`;
  else status = `<span class="wait">${esc(o.waitLabel ? fill(o.waitLabel, { who: waitNames || "…" }) : x.tr("hdr.busy", { who: waitNames || "…" }))}${clockHTML(o.clock)}</span>`;
  const init = v.initiative >= 0 && v.phase !== "end" ? ` · ${x.tr("hdr.initiative", { who: x.short(v.initiative) })}` : "";
  const home = "./" + (x.lang === "en" ? "?lang=en" : "");
  return `<header class="t-top"><a class="t-back" href="${home}" aria-label="${esc(x.tr("setup.home"))}">${ICON_BACK}</a>` +
    `<div class="t-ttl"><span class="t-turn" data-turn="1">${esc(x.tr("hdr.turn", { n: v.turn }))}${esc(init)}</span>` +
    `<span class="t-line"><b class="t-phase">${esc(phase)}</b>${status}</span></div>` +
    `${o.advisor && v.phase !== "end" ? advisorBar(x, o) : ""}` +
    `<button type="button" class="t-menu" data-menu aria-haspopup="true" aria-expanded="false" aria-label="${esc(x.tr("menu.label"))}">${ICON_MENU}</button></header>`;
}

// The three player boards, one per candidate in ballot order (#29). The board is one button: the candidate's
// picture on the left fading into the paper, the ballot number, and on the right the name (a little flag when
// the seat has the initiative), the votes ("33" and the small "0萬票": a cube is 10萬票; in English "3.3" and
// "M votes") and the momentum as red dots. Hand, kept cards, the bag and what momentum is sit in a strip under
// the row, which a phone shows for one candidate at a time (the page marks that board .open after it draws, see
// drawing.js applyState: it is where the player tapped, not part of the view); a wide screen always shows it.
function playersHTML(v, x, o = {}) {
  const L = x.d.ui.look.board;
  const inHand = (p) => (Array.isArray(v.hands[p]) ? v.hands[p].length : v.hands[p]);
  const kept = (p) => { const a = v.turn <= 5 ? v.savedDebate[p] : v.savedElection[p]; return Array.isArray(a) ? a.length : a; };
  const onBoard = (p) => v.counties.reduce((s, c) => s + c.blocks.filter((b) => b.o === p).length, 0);
  const first = (p) => v.initiative === p && v.phase !== "end";
  const boards = SHOW_ORDER.map((p) => {
    const mom = v.mom[p], n = onBoard(p);
    const big = n ? (x.lang === "en" ? (n / 10).toFixed(1) : String(n)) : "0";
    const votes = `<b>${big}</b><small>${esc(n ? L.votes : L.votesNone)}</small>`;
    const dots = mom ? `<span class="dots" aria-hidden="true">${"<i></i>".repeat(Math.min(mom, 12))}</span>` : `<b class="m0">0</b>`;
    return `<article class="pl s${p}${p === v.seat ? " me" : ""}${first(p) ? " first" : ""}">` +
      `<div class="pl-card" data-seat="${p}"><button type="button" class="pl-tap" data-detail="${p}" aria-expanded="false" aria-label="${esc(`${x.full(p)} · ${fill(L.cubes, { n })} · ${L.mom} ${mom}`)}">` +
      `<span class="pl-pic"><img src="art/candidates/${SEATS[p]}.webp" alt="${esc(x.full(p))}" width="480" height="640" loading="lazy" decoding="async"></span><b class="no">${NO[p]}</b>` +
      `<span class="pl-t"><span class="pl-n">${first(p) ? `<i class="flag-i" role="img" aria-label="${esc(x.tr("hdr.star"))}" title="${esc(x.tr("hdr.star"))}">⚑</i>` : ""}${esc(x.lang === "en" ? x.short(p) : x.full(p))}</span>` +
      `<span class="pl-v">${votes}</span><span class="pl-mm">${esc(L.mom)} ${dots}</span></span></button></div>` +
      `<div class="pl-d"><span class="pl-h">${esc(fill(L.hand, { n: inHand(p), k: kept(p) }))}</span>` +
      `<button type="button" class="pl-bag helpable${o.help === "bag" ? " on" : ""}" data-help="bag" aria-expanded="${o.help === "bag"}" aria-label="${esc(x.tr("hdr.bag") + " · " + x.tr("hdr.tap"))}">${esc(fill(L.bag, { n: v.bag[p] }))}</button>` +
      `<button type="button" class="pl-m helpable${o.help === "mom" ? " on" : ""}" data-help="mom" aria-expanded="${o.help === "mom"}" aria-label="${esc(x.tr("hdr.momL") + " " + mom + " · " + x.tr("hdr.tap"))}">${esc(L.mom)} <b>${mom}</b></button></div></article>`;
  }).join("");
  return `<section class="t-players" aria-label="${esc(L.label)}">${boards}</section>`;
}

// The one-line explanation under the header, for whichever small label was tapped (o.help).
function helpHTML(x, o) {
  if (!o.help || !["mom", "bag", "slot"].includes(o.help)) return "";
  return `<p class="help" role="note">${esc(x.tr("help." + o.help))} <button type="button" class="hx" data-help="">${esc(x.tr("help.close"))}</button></p>`;
}

function trackHTML(v, x, o = {}) {
  // Three slots (#29), each a capsule button: a round picture of its issue on the left, then the slot, the name
  // and who holds how many cubes on it. Tapping one explains what the slots do (the same note as the label).
  const slots = v.issues.map((iss, i) => `<button type="button" class="slot helpable${o.help === "slot" ? " on" : ""}" data-issue="${esc(iss.name)}" data-help="slot" aria-expanded="${o.help === "slot"}" aria-label="${esc(x.tr("hdr.slotsL") + " · " + x.tr("hdr.slot." + (i + 1)) + " · " + x.issue(iss.name))}">` +
    `<span class="sp">${issueImg(iss.name, x)}</span><span class="sb"><span class="sl">${esc(x.tr("hdr.slot." + (i + 1)))}</span><b>${esc(x.issue(iss.name))}</b>` +
    `<span class="cb">${cubesRow(iss.cubes) || `<em>—</em>`}</span></span></button>`).join("");
  return `<section class="t-track" data-issues="1" aria-label="${esc(x.tr("hdr.slotsL"))}"><button type="button" class="slotsl helpable${o.help === "slot" ? " on" : ""}" data-help="slot" aria-expanded="${o.help === "slot"}" aria-label="${esc(x.tr("hdr.slotsL") + " · " + x.tr("hdr.tap"))}">${esc(x.tr("hdr.slotsL"))} <i aria-hidden="true">?</i></button>${slots}</section>`;
}

// ---------------------------------------------------------------- the action panel

// One county's block: its heading says how it stands now (who has how many cubes, how many empty
// green and blue blocks are left), the buttons under it are what can be done there.
function countyBlock(v, k, items, x) {
  const blocks = v.counties[k].blocks, tr = x.tr;
  const eg = blocks.filter((b) => b.o < 0 && b.t === "G").length, eb = blocks.filter((b) => b.o < 0 && b.t === "B").length;
  const own = SHOW_ORDER.map((p) => `<span class="s${p}">${esc(x.short(p))} ${cubesIn(v, k, p)}</span>`).join("");
  const here = [0, 1, 2].filter((p) => v.pos[p] === k).map((p) => `<span class="s${p}">⚑${esc(x.short(p))}</span>`).join("");
  return `<section class="cg"><h4 class="cg-h"><b class="cg-n">${esc(x.county(k))}</b><span class="cg-o">${own}</span>` +
    `<span class="cg-e"><i class="b eG"></i>${esc(tr("p.eg", { n: eg }))}<i class="b eB"></i>${esc(tr("p.eb", { n: eb }))}</span>${here ? `<span class="cg-p">${here}</span>` : ""}</h4>` +
    `<div class="opts">${items.map((c) => btn(c, "", x, shortOpt(v, c.move, x))).join("")}</div></section>`;
}

// The options in the order choices() gave them: a block per county (placements), then "move to
// another county…" folded away, then "end the action".
function groupedList(v, ch, x, o) {
  const done = ch.filter((c) => END_T.has(c.move.type)), moves = ch.filter((c) => c.move.type === "move");
  const here = ch.filter(isPlace), plain = ch.filter((c) => !done.includes(c) && !moves.includes(c) && !here.includes(c));
  const out = [];
  if (plain.length) out.push(`<div class="opts">${plain.map((c) => btn(c, "", x)).join("")}</div>`);
  const byCounty = new Map();
  for (const c of here) { if (!byCounty.has(c.move.county)) byCounty.set(c.move.county, []); byCounty.get(c.move.county).push(c); }
  for (const [k, items] of byCounty) out.push(countyBlock(v, k, items, x));
  if (moves.length) {
    const open = !!o.moves;
    let list = "";
    if (open) {
      for (let r = 0; r < REGIONS.length; r++) {
        const items = moves.filter((c) => REGION_OF[c.move.to] === r).sort((a, b) => a.move.to - b.move.to);
        if (items.length) list += `<h4 class="t-gh">${esc(x.region(r))}</h4><div class="opts two">${items.map((c) => btn(c, "", x, shortOpt(v, c.move, x))).join("")}</div>`;
      }
    }
    out.push(`<div class="mvs"><button type="button" class="opt weak more${open ? " on" : ""}" data-toggle="moves" aria-expanded="${open}">${esc(x.tr(open ? "p.movesShut" : "p.movesOpen"))}</button>` +
      `<p class="ct">${esc(x.tr("p.moveHint"))}</p>${list}</div>`);
  }
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
    // The candidate card can be used once a game: tapping it asks again before it is played.
    const sure = cand.find((c) => o.confirm && JSON.stringify(c.move) === o.confirm);
    if (sure) {
      return `<div class="confirm"><p class="pr">${esc(x.tr("p.candConfirm"))}</p><div class="opts">` +
        `<button type="button" class="opt" data-move="${esc(JSON.stringify(sure.move))}">${esc(x.tr("p.candYes"))}</button>` +
        `<button type="button" class="opt ghost" data-cancel="1">${esc(x.tr("p.candNo"))}</button></div></div>`;
    }
    return prompt(v, ch, x) + `<p class="ct">${esc(x.tr(v.phase === "debate" ? "p.pickCardDebate" : v.phase === "election" ? "p.pickCardElection" : "p.pickCard"))}</p>` +
      (cand.length ? `<div class="opts">${cand.map((c) => btn(c, "", x)).join("")}</div>` : "");
  }
  return prompt(v, ch, x) + groupedList(v, ch, x, o);
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
  // The fan: each card tilts a little more than the one before it and the middle ones sit highest. The
  // numbers are computed here so the same hand always draws the same string.
  const n = hand.length, mid = (n - 1) / 2, step = Math.min(4, 24 / Math.max(n, 1));
  const fan = (i) => ({ r: ((i - mid) * step).toFixed(1), y: (Math.pow(i - mid, 2) * (n > 6 ? 1.2 : 2)).toFixed(1) });
  const cards = hand.map((id, i) => {
    if (savePhase) return miniCard(id, x, picks.includes(id) ? "sel" : "", `data-pick="${esc(id)}" aria-pressed="${picks.includes(id)}"`, advCards.has(id), fan(i));
    const cls = (o.sel === id ? "sel " : "") + (ch.length && !playable.has(id) ? "dis" : "");
    return miniCard(id, x, cls.trim(), `data-sel="${esc(id)}"`, advCards.has(id), fan(i));
  }).join("") + candCard(v, ch, x);
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
    // The end-of-turn settlement (solo.js settleEntries): why momentum moved.
    case "decay": return tr("r.decay", { text: e.per.map((q, p) => `${who(p)} ${q[0]}→${q[1]}`).join(" · ") });
    case "slot": return tr(e.slot === 1 ? "r.slot1" : "r.slot3", { issue: x.issue(e.issue), who: who(e.seat) });
    case "issueDecay": return tr("r.issueDecay");
    case "momNow": return tr("r.momNow", { text: SHOW_ORDER.map((p) => `${who(p)} ${e.mom[p]}`).join(" · ") });
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

// Of everything a bot says while it does one thing (one card, with every block it places), only the
// first sentence is kept (#23). A new action starts at a card, the turn, or another seat's move.
export function firstSayings(entries) {
  const keep = new Set();
  let seat = null, said = false;
  entries.forEach((e, i) => {
    if (["play", "cand", "trigger", "canvass", "turn", "order"].includes(e.k) || e.seat !== seat) said = false;
    seat = e.seat;
    if (e.why && e.why.key !== "only_move" && !said) { keep.add(i); said = true; }
  });
  return keep;
}

function feedHTML(v, x, o) {
  const all = o.feed || [], keep = firstSayings(all);
  const feed = all.map((e, i) => ({ e, i })).slice(-14).reverse();
  if (!feed.length) return "";
  const rows = feed.map(({ e, i }) => {
    const line = e.k === "say" ? "" : feedLine(e, v, x);
    const say = keep.has(i) ? sayLine(e.why, line ? null : e.seat, x) : "";
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

// "Just now" (o.recent = [{ seat, text }] from recentLines): what the others did since you last decided.
function nowHTML(x, o) {
  const lines = o.recent || [];
  if (!lines.length) return "";
  return `<section class="t-now" data-now="1" aria-label="${esc(x.tr("now.title"))}"><h3 class="t-h">${esc(x.tr("now.title"))}</h3><ul>` +
    lines.map((l) => `<li class="${l.seat != null ? "s" + l.seat : "sys"}">${esc(l.text)}</li>`).join("") + `</ul></section>`;
}

// Your own last step (o.result = resultBlock), at the top of the decision.
function resultHTML(o, x) {
  return o.result ? `<p class="res ${o.result.kind}" data-res="1" role="status"><small>${esc(x.tr("res.label"))}</small>${esc(o.result.text)}</p>` : "";
}

export function tableHTML(view, choices, lang, opts = {}) {
  const x = bind(lang), v = view, o = opts;
  const map = taiwanMap(v, lang, { changed: o.changed, selected: o.county, narrow: o.narrow, overlay: o.county != null ? popHTML(v, choices, x, o.county, o.narrow) : "" });
  // Three columns on a wide desk (the players; the issues and the map; the notes and the decision). On a
  // phone the columns dissolve (display: contents) and style.css puts the pieces in one order.
  if (v.phase === "end") {
    return `<div class="tbl end" data-phase="end">${headerHTML(v, choices, x, o)}<div class="col cl">${playersHTML(v, x, o)}${feedHTML(v, x, o)}</div>` +
      `<div class="col cc">${map}</div><div class="col cr">${endHTML(v, x, o)}${nowHTML(x, o)}${resultHTML(o, x)}</div></div>`;
  }
  return `<div class="tbl" data-phase="${esc(v.phase)}">${headerHTML(v, choices, x, o)}<div class="col cl">${playersHTML(v, x, o)}${feedHTML(v, x, o)}</div>` +
    `<div class="col cc">${trackHTML(v, x, o)}${helpHTML(x, o)}${v.phase === "debate" ? debateHTML(v, x) : ""}${map}</div>` +
    `<div class="col cr">${nowHTML(x, o)}<section class="t-act${choices.length ? " mine" : ""}" id="act">${resultHTML(o, x)}${choices.length ? adviceLine(x, o) : ""}${panelHTML(v, choices, x, o)}</section></div>` +
    `${handHTML(v, choices, x, o)}</div>`;
}
