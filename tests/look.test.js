// The direction-C table with its pictures (issue #26), as far as node can see it. Orchestrator's
// file: a peer may run it and falsify against it, and does not edit it. The wood, the paper, the
// fanned hand and the home page are checked by opening them, not here.
//
//   node --test tests/look.test.js      (or `npm test`)
//
// Contract (owner chose direction C with art three for cards and counties, art two for issues and
// candidates, 2026-10-14; the files are #24's, tests/art.test.js): the table that tableHTML draws
// (solo and room alike) shows
//   - every card in the human's own hand with its picture: an <img> whose src ends in
//     art/cards/<event id>.webp, or art/local/<county slug>.webp for a local card, and whose alt holds
//     the card's name in lang;
//   - each candidate with art/candidates/<chen|soong|lien>.webp, alt holding the candidate's name;
//   - each issue on the track with art/issues/<clean|econ|cross>.webp, alt holding the issue's name.
// Every art/ picture the table or the home page asks for is one of #24's 100 files and exists.
// The checks report 尚未實作 until the table draws any art/ picture.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { R, section, check, eq, ok, nonEmpty, summary } from "./harness.js";
import * as E from "../public/shared/engine.js";
import * as B from "../public/shared/board.js";
import * as C from "../public/shared/cards.js";
import * as D from "./driver.js";
import * as S from "../public/solo.js";
import { bind } from "../public/table.js";

const CJK = /[㐀-鿿豈-﫿]/;
const SEAT = ["chen", "soong", "lien"];
// Same slugs as tests/art.test.js (the #24 contract).
const COUNTY_SLUG = {
  "台北市": "taipei-city", "台北縣": "taipei-county", "基隆市": "keelung", "桃園縣": "taoyuan",
  "新竹縣": "hsinchu-county", "新竹市": "hsinchu-city", "苗栗縣": "miaoli", "台中縣": "taichung-county",
  "台中市": "taichung-city", "彰化縣": "changhua", "南投縣": "nantou", "雲林縣": "yunlin",
  "嘉義縣": "chiayi-county", "嘉義市": "chiayi-city", "台南縣": "tainan-county", "台南市": "tainan-city",
  "高雄市": "kaohsiung-city", "高雄縣": "kaohsiung-county", "屏東縣": "pingtung", "宜蘭縣": "yilan",
  "花蓮縣": "hualien", "台東縣": "taitung", "澎湖縣": "penghu", "金馬": "kinma",
};
const CONTRACT = new Set([
  ...C.EVENTS.map((c) => `cards/${c.id}.webp`),
  ...Object.values(COUNTY_SLUG).map((s) => `local/${s}.webp`),
  ...["clean", "econ", "cross"].map((k) => `issues/${k}.webp`),
  ...SEAT.map((k) => `candidates/${k}.webp`),
]);
const LOCAL = Object.fromEntries(C.localCards().map((c) => [c.id, c]));
const artOf = (id) => (LOCAL[id] ? `local/${COUNTY_SLUG[LOCAL[id].county]}.webp` : `cards/${id}.webp`);
const ART = new URL("../public/art/", import.meta.url);

// Every <img> in an HTML string: its src and alt.
function imgs(html) {
  const out = [];
  for (const m of html.matchAll(/<img\b[^>]*>/g)) {
    const src = (m[0].match(/\ssrc="([^"]*)"/) || [])[1] || "";
    const alt = (m[0].match(/\salt="([^"]*)"/) || [])[1];
    out.push({ src, alt: alt == null ? null : alt.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'") });
  }
  return out;
}
const artPath = (src) => { const m = src.match(/(?:^|\/)art\/((?:cards|local|issues|candidates)\/[^?#"]+)/); return m ? m[1] : null; };

// Real positions: the human's decisions in solo games, three seats, both languages.
function positions() {
  const out = [];
  for (const [seat, seed] of [[0, 611], [1, 612], [2, 613]]) {
    for (const lang of ["zh-Hant", "en"]) {
      let s = S.advance(S.newSolo({ seat, level: 2, seed }));
      const R1 = D.rng(seed * 11 + seat);
      for (let n = 0; n < 300 && s.st.phase !== "end"; n++) {
        const ch = S.choices(s, lang);
        if (!ch.length) break;
        if (n % 5 === 0) out.push({ s, seat, lang, html: S.screen(s, lang), where: `${SEAT[seat]} seed ${seed} 第 ${s.st.turn} 回合 ${s.st.phase} 第 ${n} 個決定（${lang}）` });
        s = S.advance(S.act(s, ch[Math.floor(R1() * ch.length)].move));
      }
    }
  }
  return out;
}
const POOL = positions();
const started = POOL.some((p) => imgs(p.html).some((i) => artPath(i.src)));
const c26 = (name, fn) => check(name, () => (started ? fn() : "TODO: 牌桌還沒有畫任何 art/ 圖（#26）"));

section("26 C 版牌桌的插圖");

c26("手牌每一張都有圖：事件牌 art/cards/<id>.webp、地方牌 art/local/<縣市>.webp，alt 是牌名（中英）", () => {
  const ne = nonEmpty(POOL.length, "對局裡的決定"); if (ne !== true) return ne;
  let cards = 0, locals = 0;
  for (const p of POOL) {
    const hand = p.s.st.hands[p.seat];
    if (!Array.isArray(hand)) continue;
    const x = bind(p.lang), pics = imgs(p.html);
    for (const id of hand) {
      const want = artOf(id), pic = pics.find((i) => artPath(i.src) === want);
      if (!pic) return `${p.where}：手牌「${x.card(id)}」沒有 ${want} 的圖`;
      if (!pic.alt || !pic.alt.includes(x.card(id))) return `${p.where}：${want} 的 alt 是「${pic.alt}」，沒有牌名「${x.card(id)}」`;
      if (LOCAL[id]) locals++; else cards++;
    }
  }
  for (const [n, what] of [[cards, "手牌裡的事件牌"], [locals, "手牌裡的地方牌"]]) { const r = nonEmpty(n, what); if (r !== true) return r; }
  return ok(true, `${cards} 張事件牌、${locals} 張地方牌都有圖與牌名`);
});

c26("三位候選人都有圖：art/candidates/<chen|soong|lien>.webp，alt 是候選人的名字", () => {
  const ne = nonEmpty(POOL.length, "對局裡的決定"); if (ne !== true) return ne;
  for (const p of POOL) {
    const x = bind(p.lang), pics = imgs(p.html);
    for (let s = 0; s < 3; s++) {
      const pic = pics.find((i) => artPath(i.src) === `candidates/${SEAT[s]}.webp`);
      if (!pic) return `${p.where}：沒有 ${SEAT[s]} 的候選人圖`;
      if (!pic.alt || !pic.alt.includes(x.full(s))) return `${p.where}：${SEAT[s]} 的 alt 是「${pic.alt}」，沒有「${x.full(s)}」`;
    }
  }
  return ok(true, `${POOL.length} 個畫面都有三位候選人的圖`);
});

c26("議題軌道上的議題都有圖：art/issues/<clean|econ|cross>.webp，alt 是議題名", () => {
  const ne = nonEmpty(POOL.length, "對局裡的決定"); if (ne !== true) return ne;
  let n = 0;
  for (const p of POOL) {
    const x = bind(p.lang), pics = imgs(p.html);
    for (const it of p.s.st.issues || []) {
      if (!it || !it.name) continue;
      const pic = pics.find((i) => artPath(i.src) === `issues/${it.name}.webp`);
      if (!pic) return `${p.where}：議題 ${it.name} 沒有圖`;
      if (!pic.alt || !pic.alt.includes(x.issue(it.name))) return `${p.where}：議題 ${it.name} 的 alt 是「${pic.alt}」，沒有「${x.issue(it.name)}」`;
      n++;
    }
  }
  const ne2 = nonEmpty(n, "軌道上的議題"); if (ne2 !== true) return ne2;
  return ok(true, `${n} 個議題位置都有圖`);
});

c26("沒有拼錯的圖：牌桌與首頁要的每一張 art/ 圖都在 #24 的 100 張裡，而且檔案存在；英文的 alt 沒有中文", () => {
  const ne = nonEmpty(POOL.length, "對局裡的決定"); if (ne !== true) return ne;
  const asked = new Map();
  for (const p of POOL) for (const i of imgs(p.html)) {
    const a = artPath(i.src);
    if (!a) continue;
    if (!asked.has(a)) asked.set(a, p.where);
    if (p.lang === "en" && i.alt && CJK.test(i.alt)) return `${p.where}：英文畫面的圖 ${a} alt 有中文「${i.alt}」`;
  }
  const home = new URL("../public/index.html", import.meta.url);
  if (existsSync(home)) for (const m of readFileSync(home, "utf8").matchAll(/art\/((?:cards|local|issues|candidates)\/[^"')\s?#]+)/g)) if (!asked.has(m[1])) asked.set(m[1], "index.html");
  const ne2 = nonEmpty(asked.size, "被要求的 art/ 圖"); if (ne2 !== true) return ne2;
  const bad = [...asked].filter(([a]) => !CONTRACT.has(a)).map(([a, w]) => `${a}（${w}）`);
  if (bad.length) return `不在美術契約裡的圖：${bad.slice(0, 8).join("、")}`;
  const missing = [...asked.keys()].filter((a) => !existsSync(new URL(a, ART)));
  if (missing.length) return `檔案不存在：${missing.slice(0, 8).join("、")}${missing.length > 8 ? `……共 ${missing.length} 張` : ""}`;
  return ok(true, `${asked.size} 張不同的圖，都在契約裡也都存在`);
});

test("look", () => {
  const s = summary();
  for (const p of R.pass) console.log(`  ✓ ${p.label}${p.msg ? " — " + p.msg : ""}`);
  for (const t of s.todos) console.log(`  … ${t.label} — ${t.msg}`);
  for (const f of s.failures) console.log(`  ✗ ${f.label} — ${f.msg}`);
  console.log(`  通過 ${s.pass} / 失敗 ${s.fail} / 尚未實作 ${s.todo}`);
  assert.equal(s.fail, 0, s.failures.map((f) => `${f.label}: ${f.msg}`).join("\n"));
});
