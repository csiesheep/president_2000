// The rules page: the 14 sections of i18n `rules`, then every card. rulesHTML(lang) is pure
// (no DOM), so node can import it; the page wiring at the bottom runs only in a browser.
// Every visible string comes from i18n/ or shared/cards.js.
import en from "./i18n/en.js";
import zh from "./i18n/zh-Hant.js";
import { EVENTS, localCards, REST_CUBES } from "./shared/cards.js";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => vars[k]);
const L = (lang) => (lang === "en" ? en : zh);

function block(b) {
  if (typeof b === "string") return `<p>${esc(b)}</p>`;
  if (b.list) return `<ul>${b.list.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
  if (b.table) {
    const { head, rows } = b.table;
    return `<div class="tablewrap"><table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>` +
      `<tbody>${rows.map((r) => `<tr>${r.map((c, i) => (i === 0 ? `<th scope="row">${esc(c)}</th>` : `<td>${esc(c)}</td>`)).join("")}</tr>`).join("")}</tbody></table></div>`;
  }
  return "";
}

const SECTION_ORDER = ["chen", "soong", "lien", "ext"];
const BAND = { chen: "chen", soong: "soong", lien: "lien", ext: "ext", local: "local" };

function dots(n, max = 3) {
  return Array.from({ length: max }, (_, i) => `<span class="dot${i < n ? "" : " e"}"></span>`).join("");
}

function eventCard(e, lang) {
  const t = L(lang), u = t.ui;
  const name = lang === "en" ? en.cards[e.id].name : e.name;
  const body = lang === "en" ? en.cards[e.id].text : e.text;
  const issue = u.issues[e.icon];
  const rest = (REST_CUBES[e.cp] ?? 0) + (e.owner === "lien" ? 1 : 0);
  const flags = [e.must ? `<span class="flag">${esc(u.must)}</span>` : "", e.cond ? `<span class="flag alt">${esc(u.conditional)}</span>` : ""].join("");
  return `<article class="card ${BAND[e.owner]}${e.must ? " must" : ""}">` +
    `<div class="band"><span>${esc(u.owner[e.owner])}</span><span class="r">${flags}${esc(u.kind.event)} · ${esc(u.deck[e.deck])}</span></div>` +
    `<div class="cp" aria-label="${e.cp} ${esc(u.cpUnit)}">${e.cp}</div>` +
    `<div class="iss" title="${esc(issue.name)}" aria-label="${esc(issue.name)}">${esc(issue.short)}</div>` +
    `<h4 class="ttl">${esc(name)}</h4>` +
    `<p class="txt">${esc(body)}</p>` +
    `<div class="foot"><span>${esc(t.terms.canvass)} ${esc(lang === "en" ? t.counties[e.county] : e.county)}</span>` +
    `<span class="dots" aria-label="${esc(fill(u.restCubes, { n: rest }))}">${dots(rest)}</span></div></article>`;
}

function localFace(deck, county, cards, lang) {
  const t = L(lang), u = t.ui;
  const label = lang === "en" ? t.cards.local.name.replace("{county}", t.counties[county]) : cards[0].name;
  const body = lang === "en" ? t.cards.local.text : cards[0].text;
  const byCp = new Map();
  for (const c of cards) byCp.set(c.cp, (byCp.get(c.cp) ?? 0) + 1);
  const cps = [...byCp].sort((a, b) => a[0] - b[0]);
  const detail = fill(u.localCount, { n: cards.length }) + " · " + cps.map(([cp, n]) => fill(u.cpCount, { cp, n })).join(lang === "en" ? ", " : "、");
  return `<article class="card local">` +
    `<div class="band"><span>${esc(u.owner.local)}</span><span class="r">${esc(u.deck[deck])}</span></div>` +
    `<div class="cp" aria-label="${cps.map(([cp]) => cp).join("/")} ${esc(u.cpUnit)}">${cps.map(([cp]) => cp).join("/")}</div>` +
    `<div class="iss none" title="${esc(u.noIssue)}" aria-label="${esc(u.noIssue)}">—</div>` +
    `<h4 class="ttl">${esc(label)}</h4>` +
    `<p class="txt">${esc(body)}</p>` +
    `<div class="foot"><span>${esc(t.terms.canvass)} ${esc(lang === "en" ? t.counties[county] : county)}</span><span>${esc(detail)}</span></div></article>`;
}

function allCards(lang) {
  const t = L(lang), u = t.ui, locals = localCards();
  let out = `<section id="allcards" class="cardsec"><h2>${esc(u.allCards)}</h2>` +
    `<p class="note">${esc(fill(u.allCardsNote, { events: EVENTS.length, local: locals.length }))}</p>`;
  for (const deck of ["early", "late"]) {
    out += `<h3>${esc(u.deck[deck])}</h3>`;
    for (const owner of SECTION_ORDER) {
      const evs = EVENTS.filter((e) => e.deck === deck && e.owner === owner);
      if (evs.length) out += `<h4 class="grp ${owner}">${esc(u.owner[owner])} · ${evs.length}</h4><div class="cards">${evs.map((e) => eventCard(e, lang)).join("")}</div>`;
    }
    const mine = locals.filter((c) => c.deck === deck);
    const counties = [...new Set(mine.map((c) => c.county))];
    out += `<h4 class="grp local">${esc(u.owner.local)} · ${mine.length}</h4><div class="cards">` +
      counties.map((county) => localFace(deck, county, mine.filter((c) => c.county === county), lang)).join("") + `</div>`;
  }
  return out + `</section>`;
}

export function rulesHTML(lang) {
  const t = L(lang), u = t.ui;
  const toc = `<nav class="toc" aria-label="${esc(u.toc)}">` +
    [...t.rules.map((s) => [s.id, s.title]), ["allcards", u.allCards]].map(([id, title]) => `<a href="#${id}">${esc(title)}</a>`).join("") + `</nav>`;
  const sections = t.rules.map((s) => `<section id="${s.id}" class="rule"><h2>${esc(s.title)}</h2>${s.body.map(block).join("")}</section>`).join("");
  return toc + sections + allCards(lang);
}

if (typeof document !== "undefined") {
  const lang = new URLSearchParams(location.search).get("lang") === "en" ? "en" : "zh-Hant";
  const t = L(lang), q = lang === "en" ? "?lang=en" : "";
  document.documentElement.lang = t.lang;
  document.title = `${t.nav.rules} · ${t.title}`;
  const set = (sel, fn) => { const el = document.querySelector(sel); if (el) fn(el); };
  set("#home", (el) => { el.textContent = t.ui.home; el.href = "./" + q; });
  set("#lang", (el) => { el.textContent = t.nav.lang; el.href = lang === "en" ? "rules" : "rules?lang=en"; });
  set("#kicker", (el) => { el.textContent = t.ui.kicker; });
  set("#title", (el) => { el.textContent = t.ui.pageTitle; });
  set("#credit", (el) => { el.textContent = t.credit; });
  set("#content", (el) => {
    el.innerHTML = rulesHTML(lang);
    if (location.hash) document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();
  });
}
