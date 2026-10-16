// The Taiwan map (issue #25), as far as node can see it. Orchestrator's file: a peer may run it and
// falsify against it, and does not edit it. Whether it looks like Taiwan and reads well on a phone
// is checked by opening it, not here.
//
//   node --test tests/map.test.js      (or `npm test`)
//
// Contract (owner chose map one, the printed board, 2026-10-14): public/map.js exports, with no DOM
// at import time,
//   taiwanMap(view, lang, opts) → string      opts: { changed: [county index], selected: county index }
// where the string holds
//   - one element per county with data-county="<k>" (k = 0…23, board order), tabindex="0" and an
//     aria-label holding the county's name in lang; data-changed on the counties in opts.changed and
//     data-selected on opts.selected, on that same element, and on no other;
//   - one element per vote block with data-slot="chen|soong|lien|green|blue|grey" and data-of="<k>":
//     a cube of that seat, or an empty green / blue / grey (non-voter) block;
//   - one element per candidate pawn with data-pawn="chen|soong|lien" and data-of="<county it stands in>";
//   - one element per media region with data-region="<r>", data-media="<陳>,<宋>,<連>" (rulebook v0.3; from v0.4, #34,
//     media is one national box: no data-media on the regions, and one element data-media-national="<陳>,<宋>,<連>"; in a
//     v0.5 game, #53, there is no media: neither) and data-endorse="<seat index or -1>".
// public/table.js's tableHTML(view, choices, lang, opts) draws that map, and with opts.county = k it
// opens the county's box: an element with data-popover="<k>", and for each choice whose move acts on
// county k (move.county === k, or a pawn move with move.to === k) one button with data-choice="<i>"
// (i = its index in choices) and data-pop="<k>". No other choice gets data-pop="<k>"; without
// opts.county there is no data-popover.
// Every check reports 尚未實作 until public/map.js exports taiwanMap.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { R, section, check, eq, ok, nonEmpty, summary } from "./harness.js";
import * as E from "../public/shared/engine.js";
import * as B from "../public/shared/board.js";
import en from "../public/i18n/en.js";
import * as D from "./driver.js";
import * as S from "../public/solo.js";
import { tableHTML } from "../public/table.js";

const CJK = /[㐀-鿿豈-﫿]/;
const SEAT = ["chen", "soong", "lien"];
const FILE = new URL("../public/map.js", import.meta.url);
let M = null, IMPORT_ERR = null;
if (existsSync(FILE)) { try { M = await import(FILE.href); } catch (e) { IMPORT_ERR = e; } }
const c25 = (name, fn) => check(name, () => {
  if (!existsSync(FILE)) return "TODO: public/map.js 還沒有（#25）";
  if (IMPORT_ERR) return `public/map.js 在 node 裡 import 就丟錯（不能在 import 時碰 DOM）：${IMPORT_ERR.message}`;
  if (typeof M.taiwanMap !== "function") return "TODO: public/map.js 還沒有 taiwanMap（#25）";
  return fn();
});

// The opening tag of every element carrying attribute `name`, with its attributes.
function tags(html, name) {
  const out = [];
  const re = new RegExp(`<[a-zA-Z][^<>]*?\\s${name}(?:="([^"]*)")?(?=[\\s/>])[^<>]*>`, "g");
  let m;
  while ((m = re.exec(html))) out.push({ tag: m[0], v: m[1] });
  return out;
}
const attr = (tag, name) => { const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`)); return m ? m[1] : null; };
const flag = (tag, name) => new RegExp(`\\s${name}(?:=|\\s|>|/)`).test(tag);
const countyName = (k, lang) => (lang === "en" ? en.counties[B.COUNTIES[k][0]] : B.COUNTIES[k][0]);

// What the map must show for county k, straight from the view's blocks.
function wantSlots(v, k) {
  const w = { chen: 0, soong: 0, lien: 0, green: 0, blue: 0, grey: 0 };
  for (const b of v.counties[k].blocks) {
    if (b.o >= 0) w[SEAT[b.o]]++;
    else w[b.t === "G" ? "green" : b.t === "B" ? "blue" : "grey"]++;
  }
  return w;
}
// Which choices act on county k.
const onCounty = (m, k) => m && (m.county === k || (m.type === "move" && m.to === k));

// A pool of real positions: the human's decisions in a few solo games, both languages.
function positions() {
  const out = [];
  for (const [seat, seed] of [[0, 501], [1, 502], [2, 503]]) {
    for (const lang of ["zh-Hant", "en"]) {
      let s = S.advance(S.newSolo({ seat, level: 2, seed }));
      const R1 = D.rng(seed * 7 + seat);
      for (let n = 0; n < 400 && s.st.phase !== "end"; n++) {
        const ch = S.choices(s, lang);
        if (!ch.length) break;
        if (n % 3 === 0) out.push({ v: E.view(s.st, seat), ch, lang, where: `${SEAT[seat]} seed ${seed} 第 ${s.st.turn} 回合 ${s.st.phase} 第 ${n} 個決定（${lang}）` });
        s = S.advance(S.act(s, ch[Math.floor(R1() * ch.length)].move));
      }
    }
  }
  return out;
}
const POOL = M && typeof M.taiwanMap === "function" ? positions() : [];

section("25 台灣地圖");

c25("24 個縣市各一個：data-county 0…23 各出現一次，可以用鍵盤點（tabindex=0），aria-label 寫著那個縣市的名字（中英）", () => {
  const ne = nonEmpty(POOL.length, "對局裡的決定"); if (ne !== true) return ne;
  for (const lang of ["zh-Hant", "en"]) {
    const p = POOL.find((x) => x.lang === lang);
    const html = M.taiwanMap(p.v, lang, {});
    const cs = tags(html, "data-county");
    const ks = cs.map((t) => Number(t.v)).sort((a, b) => a - b);
    const r = eq(JSON.stringify(ks), JSON.stringify([...Array(24).keys()]), `${lang} 的 data-county`); if (r !== true) return r;
    for (const t of cs) {
      const k = Number(t.v), name = countyName(k, lang), label = attr(t.tag, "aria-label") || "";
      if (attr(t.tag, "tabindex") !== "0") return `${lang} 縣市 ${k}（${name}）沒有 tabindex="0"`;
      if (!label.includes(name)) return `${lang} 縣市 ${k} 的 aria-label 是「${label}」，沒有「${name}」`;
      if (lang === "en" && CJK.test(label)) return `en 縣市 ${k} 的 aria-label 有中文：「${label}」`;
    }
  }
  return ok(true, "中英各 24 個縣市");
});

c25("每一塊票都畫出來而且狀態對：每個縣市的 data-slot 數等於它的票塊數，陳宋連的方塊、空綠、空藍、無色各自的數量跟 view 一樣", () => {
  const ne = nonEmpty(POOL.length, "對局裡的決定"); if (ne !== true) return ne;
  let checked = 0, moved = 0;
  for (const p of POOL) {
    const html = M.taiwanMap(p.v, p.lang, {});
    const got = Array.from({ length: 24 }, () => ({ chen: 0, soong: 0, lien: 0, green: 0, blue: 0, grey: 0 }));
    for (const t of tags(html, "data-slot")) {
      const k = Number(attr(t.tag, "data-of"));
      if (!(k >= 0 && k < 24)) return `${p.where}：有一塊票的 data-of 是「${attr(t.tag, "data-of")}」`;
      if (!(t.v in got[k])) return `${p.where}：縣市 ${k} 有一塊票的 data-slot 是「${t.v}」`;
      got[k][t.v]++;
    }
    for (let k = 0; k < 24; k++) {
      const w = wantSlots(p.v, k);
      if (JSON.stringify(got[k]) !== JSON.stringify(w)) return `${p.where}：${B.COUNTIES[k][0]} 畫的是 ${JSON.stringify(got[k])}，view 是 ${JSON.stringify(w)}`;
    }
    checked++;
    const start = E.view(E.createGame(1), 0);
    if (p.v.counties.some((c, k) => JSON.stringify(c.blocks) !== JSON.stringify(start.counties[k].blocks))) moved++;
  }
  const ne2 = nonEmpty(moved, "盤面跟開局不一樣的局面（只驗開局等於沒驗方塊會動）"); if (ne2 !== true) return ne2;
  return ok(true, `${checked} 個局面、其中 ${moved} 個盤面已經變了，每縣每種格子的數量都對`);
});

c25("候選人的棋子在對的縣市：三個 data-pawn 各一個，data-of 是 view.pos", () => {
  const ne = nonEmpty(POOL.length, "對局裡的決定"); if (ne !== true) return ne;
  let away = 0;
  for (const p of POOL) {
    const pw = tags(M.taiwanMap(p.v, p.lang, {}), "data-pawn");
    if (pw.length !== 3) return `${p.where}：有 ${pw.length} 個 data-pawn，應為 3`;
    for (let s = 0; s < 3; s++) {
      const t = pw.find((x) => x.v === SEAT[s]);
      if (!t) return `${p.where}：沒有 ${SEAT[s]} 的棋子`;
      if (Number(attr(t.tag, "data-of")) !== p.v.pos[s]) return `${p.where}：${SEAT[s]} 畫在 ${attr(t.tag, "data-of")}，實際在 ${p.v.pos[s]}`;
    }
    if (p.v.pos.some((k, s) => k !== E.createGame(1).pos[s])) away++;
  }
  const ne2 = nonEmpty(away, "有候選人離開起點的局面"); if (ne2 !== true) return ne2;
  return ok(true, `${POOL.length} 個局面，其中 ${away} 個有人移動過`);
});

c25("剛剛有變動、已選取：data-changed 只在 opts.changed 的縣市、data-selected 只在 opts.selected，都標在 data-county 那個元素上", () => {
  const p = POOL[0]; if (!p) return nonEmpty(0, "對局裡的決定");
  const changed = [3, 11, 17], selected = 11;
  const cs = tags(M.taiwanMap(p.v, p.lang, { changed, selected }), "data-county");
  const ch = cs.filter((t) => flag(t.tag, "data-changed")).map((t) => Number(t.v)).sort((a, b) => a - b);
  const se = cs.filter((t) => flag(t.tag, "data-selected")).map((t) => Number(t.v));
  const r1 = eq(JSON.stringify(ch), JSON.stringify(changed), "標了 data-changed 的縣市"); if (r1 !== true) return r1;
  const r2 = eq(JSON.stringify(se), JSON.stringify([selected]), "標了 data-selected 的縣市"); if (r2 !== true) return r2;
  const none = tags(M.taiwanMap(p.v, p.lang, {}), "data-county").filter((t) => flag(t.tag, "data-changed") || flag(t.tag, "data-selected"));
  if (none.length) return `沒給 changed / selected 時還有 ${none.length} 個縣市被標記`;
  return ok(true, "changed 3 個、selected 1 個，都標對；沒給就沒有");
});

c25("七個區：data-region 0…6 各一個，data-endorse 是背書持有者；媒體（v0.3）每區 data-media，（v0.4，#34）一個 data-media-national，（v0.5，#53）沒有媒體", () => {
  const ne = nonEmpty(POOL.length, "對局裡的決定"); if (ne !== true) return ne;
  // v0.5 (#53): the state has no media at all, and the map shows none.
  const kind = (v) => (v.media === undefined ? "none" : typeof v.media[0] === "number" ? "national" : "regions");
  let withMedia = 0, without = 0;
  for (const p of POOL) {
    const html = M.taiwanMap(p.v, p.lang, {});
    const rs = tags(html, "data-region");
    const national = kind(p.v) === "national";
    if (kind(p.v) === "none") {
      if (tags(html, "data-media-national").length) return `${p.where}：v0.5 沒有媒體，地圖卻有 data-media-national`;
      if (rs.some((t) => attr(t.tag, "data-media") != null)) return `${p.where}：v0.5 沒有媒體，區卻帶著 data-media`;
      without++;
    } else if (national) {
      const nm = tags(html, "data-media-national");
      if (nm.length !== 1) return `${p.where}：有 ${nm.length} 個 data-media-national，應為 1`;
      if (nm[0].v !== p.v.media.join(",")) return `${p.where}：data-media-national 是「${nm[0].v}」，view 是 ${p.v.media.join(",")}`;
      if (rs.some((t) => attr(t.tag, "data-media") != null)) return `${p.where}：v0.4 的區還帶著 data-media`;
    }
    const idx = rs.map((t) => Number(t.v)).sort((a, b) => a - b);
    if (JSON.stringify(idx) !== JSON.stringify([0, 1, 2, 3, 4, 5, 6])) return `${p.where}：data-region 是 ${JSON.stringify(idx)}`;
    for (const t of rs) {
      const r = Number(t.v);
      if (kind(p.v) === "regions" && attr(t.tag, "data-media") !== p.v.media[r].join(",")) return `${p.where}：${B.REGIONS[r]} 的 data-media 是「${attr(t.tag, "data-media")}」，view 是 ${p.v.media[r].join(",")}`;
      if (Number(attr(t.tag, "data-endorse")) !== p.v.endorse[r]) return `${p.where}：${B.REGIONS[r]} 的 data-endorse 是「${attr(t.tag, "data-endorse")}」，view 是 ${p.v.endorse[r]}`;
    }
    if (kind(p.v) === "national" ? p.v.media.some((n) => n > 0) : kind(p.v) === "regions" ? p.v.media.some((m) => m.some((n) => n > 0)) : false) withMedia++;
  }
  if (without < POOL.length) { const ne2 = nonEmpty(withMedia, "有媒體方塊的局面"); if (ne2 !== true) return ne2; }
  return ok(true, `${POOL.length} 個局面的區與背書都對；${without ? `其中 ${without} 個是 v0.5，沒有媒體` : `媒體 ${withMedia} 個局面有方塊`}`);
});

c25("點縣市開選項框：tableHTML 帶 opts.county=k 時，data-pop=k 的選項正好是所有作用在縣市 k 的選項（含移到 k），一個不多一個不少；沒帶 county 就沒有選項框", () => {
  const ne = nonEmpty(POOL.length, "對局裡的決定"); if (ne !== true) return ne;
  let boxes = 0, empties = 0, moves = 0;
  for (const p of POOL) {
    const base = tableHTML(p.v, p.ch, p.lang, {});
    if (tags(base, "data-popover").length) return `${p.where}：沒帶 county 也畫了選項框`;
    if (tags(base, "data-county").length !== 24) return `${p.where}：tableHTML 裡的地圖不是 24 個縣市`;
    const targeted = [...new Set(p.ch.flatMap((c) => [c.move && c.move.county, c.move && c.move.type === "move" ? c.move.to : null]).filter((k) => k != null))];
    const idle = [...Array(24).keys()].find((k) => !targeted.includes(k));
    for (const k of targeted.slice(0, 4).concat(idle != null ? [idle] : [])) {
      const html = tableHTML(p.v, p.ch, p.lang, { county: k });
      const pop = tags(html, "data-popover");
      if (pop.length !== 1 || Number(pop[0].v) !== k) return `${p.where}：county=${k} 時 data-popover 是 ${JSON.stringify(pop.map((t) => t.v))}`;
      const got = tags(html, "data-pop").filter((t) => Number(t.v) === k).map((t) => Number(attr(t.tag, "data-choice"))).sort((a, b) => a - b);
      const want = p.ch.map((c, i) => (onCounty(c.move, k) ? i : -1)).filter((i) => i >= 0);
      if (JSON.stringify(got) !== JSON.stringify(want)) return `${p.where}：${B.COUNTIES[k][0]} 的選項框是 ${JSON.stringify(got)}，應為 ${JSON.stringify(want)}`;
      if (want.length) boxes++; else empties++;
      if (p.ch.some((c) => c.move && c.move.type === "move" && c.move.to === k)) moves++;
    }
  }
  for (const [n, what] of [[boxes, "有選項的選項框"], [empties, "沒有選項的縣市"], [moves, "含「移到這裡」的選項框"]]) { const r = nonEmpty(n, what); if (r !== true) return r; }
  return ok(true, `${boxes} 個有選項的選項框、${empties} 個空的、${moves} 個含移動，選項都對`);
});

test("map", () => {
  const s = summary();
  for (const p of R.pass) console.log(`  ✓ ${p.label}${p.msg ? " — " + p.msg : ""}`);
  for (const t of s.todos) console.log(`  … ${t.label} — ${t.msg}`);
  for (const f of s.failures) console.log(`  ✗ ${f.label} — ${f.msg}`);
  console.log(`  通過 ${s.pass} / 失敗 ${s.fail} / 尚未實作 ${s.todo}`);
  assert.equal(s.fail, 0, s.failures.map((f) => `${f.label}: ${f.msg}`).join("\n"));
});
