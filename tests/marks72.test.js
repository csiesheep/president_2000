// Every action's result on the map, the rivals' and the human's own (issue #72), as far as node can see it. Orchestrator's
// file: a peer may run it and falsify against it, and does not edit it. Where the chips sit and whether their words are
// cut is measured in a browser (tools/marks72.mjs).
//
//   node --test tests/marks72.test.js      (or `npm test`)
//
// Owner, 2026-10-17: 「自己和對手，每個動作都要顯示效果，比如 檢定成功或失敗；目前只能在記錄中看到」; on the canvas
// 「輪到誰 · 動作結果」 (the proposal: a mark per action at its county): 「動作結果可以」.
// Contract, screen(session, lang, opts) of a solo game, Chinese and English, the desk and the phone map (opts.narrow):
//   - every entry of the rivals in session.rec that acts on a county (k fill / cross / grey / steal / remove with a county,
//     or move with a `to`) and every such entry of the human's own last move (session.mine.lines) is one mark
//     [data-act-mark] inside the chip of that county and that candidate: [data-act-chip][data-county="k"][data-who="<seat
//     key>"], the human's own chip also carrying data-mine; the marks in the record's order, each with data-k="<k>" and
//     data-ok="1" (it worked) or "0" (the check failed); a move is data-k="move";
//   - in Chinese a mark reads 「+1」 for a fill, cross or grey that worked, 「搶」 for a steal that worked, 「−1」 for a
//     removal that worked, 「✗」 for any that failed, 「▸」 for a move;
//   - no chip for a county and candidate with no such entry; the county of every chip carries data-changed.
//   (The issue chips on the headlines, #66, stay as they are.)
import test from "node:test";
import assert from "node:assert/strict";
import { R, section, check, ok, nonEmpty, summary } from "./harness.js";
import * as D from "./driver.js";
import * as S from "../public/solo.js";

const KEYS = ["chen", "soong", "lien"];
const CUBE = new Set(["fill", "cross", "grey", "steal", "remove"]);
const word = (e) => (e.k === "move" ? "▸" : !e.ok ? "✗" : e.k === "steal" ? "搶" : e.k === "remove" ? "−1" : "+1");

function states() {
  const out = [];
  for (let i = 0; i < 6; i++) {
    const seat = i % 3, seed = 7201 + i;
    let s = S.newSolo({ seat, level: 2, seed });
    const R1 = D.rng(seed);
    let a = 0;
    for (let n = 0; n < 4000 && s.st.phase !== "end"; n++) {
      const bots = S.botsToMove(s).length > 0, ch = S.choices(s, "zh-Hant");
      if (!bots && ch.length && (a++ % 3 === 0 || (s.rec || []).some((e) => e.ok === false))) out.push({ s, where: `seat ${seat} seed ${seed} 第 ${s.st.turn} 回合第 ${n} 步` });
      if (bots && (!ch.length || R1() < 0.5)) s = S.stepBot(s);
      else { if (!ch.length) break; s = S.act(s, ch[Math.floor(R1() * ch.length)].move); }
    }
  }
  return out;
}
const POOL = states();
const LANGS = [["zh-Hant", "中文"], ["en", "英文"]];
const MAPS = [[{}, "桌面地圖"], [{ narrow: true }, "手機地圖"]];

const tags = (html, name) => [...html.matchAll(new RegExp(`<[a-zA-Z][^<>]*?\\s${name}(?:="([^"]*)")?(?=[\\s/>])[^<>]*>`, "g"))].map((m) => ({ tag: m[0], v: m[1], at: m.index }));
const attr = (tag, name) => { const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`)); return m ? m[1] : null; };
const has = (tag, name) => new RegExp(`\\s${name}(?:="[^"]*")?(?=[\\s/>])`).test(tag);
function elementAt(html, t) {
  const tn = t.tag.match(/^<([a-zA-Z0-9-]+)/)[1].toLowerCase();
  const re = new RegExp(`<(/?)${tn}(?=[\\s>/])[^<>]*>`, "gi");
  re.lastIndex = t.at + t.tag.length;
  let depth = 1, m;
  while ((m = re.exec(html))) { if (m[1]) depth--; else if (!/\/>$/.test(m[0])) depth++; if (!depth) return html.slice(t.at, m.index + m[0].length); }
  return html.slice(t.at);
}
const text = (html) => html.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
// what should be marked: per "county:seat" the entries in order (the rivals' from rec, the human's own from mine.lines)
function wanted(s) {
  const per = new Map();
  const add = (e, mine) => {
    const k = e.k === "move" ? e.to : e.county;
    if (k == null || !(CUBE.has(e.k) || e.k === "move")) return;
    const key = `${k}:${e.seat}`;
    if (!per.has(key)) per.set(key, { k, seat: e.seat, mine, list: [] });
    per.get(key).list.push(e);
  };
  for (const e of s.rec || []) if (e.seat != null && e.seat !== s.seat) add(e, false);
  for (const e of (s.mine && s.mine.lines) || []) add({ ...e, seat: e.seat ?? s.seat }, true);
  return per;
}
const countyChips = (html) => tags(html, "data-act-chip").filter((t) => attr(t.tag, "data-county") != null);

const GATE = POOL.some((p) => tags(S.screen(p.s, "zh-Hant"), "data-act-mark").length);
const gate = (fn) => () => {
  const ne = nonEmpty(POOL.length, "牌桌的狀態"); if (ne !== true) return ne;
  if (!GATE) return "地圖上沒有每個動作的記號（data-act-mark）（#72 已上線，bea65f2；這是退步，不是尚未實作）";
  return fn();
};

section("72 每個動作的結果標在地圖上");

check("對手與自己的每一個動作在那個縣市、那位候選人的 chip 裡一個 data-act-mark（照紀錄的順序，data-k、data-ok）", gate(() => {
  let marks = 0, fails = 0, mineN = 0, chipsN = 0;
  for (const p of POOL) for (const [lang, name] of LANGS) for (const [mo, mname] of MAPS) {
    const html = S.screen(p.s, lang, mo), want = wanted(p.s), chips = countyChips(html);
    for (const [key, w] of want) {
      const c = chips.filter((t) => attr(t.tag, "data-county") === String(w.k) && attr(t.tag, "data-who") === KEYS[w.seat]);
      if (c.length !== 1) return `${p.where}（${name}，${mname}）：縣市 ${w.k}、${KEYS[w.seat]} 有 ${c.length} 個 chip（應 1 個，${w.list.length} 個動作）`;
      if (w.mine !== has(c[0].tag, "data-mine")) return `${p.where}（${name}，${mname}）：縣市 ${w.k} 的 chip ${w.mine ? "是自己的卻沒有" : "是對手的卻有"} data-mine`;
      const chip = elementAt(html, c[0]), got = tags(chip, "data-act-mark");
      if (got.length !== w.list.length) return `${p.where}（${name}，${mname}）：縣市 ${w.k}、${KEYS[w.seat]} 有 ${got.length} 個記號，紀錄裡有 ${w.list.length} 個動作`;
      for (let i = 0; i < got.length; i++) {
        const e = w.list[i], g = got[i];
        if (attr(g.tag, "data-k") !== e.k || attr(g.tag, "data-ok") !== (e.k === "move" || e.ok ? "1" : "0")) return `${p.where}（${name}，${mname}）：縣市 ${w.k} 第 ${i + 1} 個記號是 ${attr(g.tag, "data-k")}/${attr(g.tag, "data-ok")}，紀錄是 ${e.k}/${e.ok ? 1 : 0}`;
        if (lang === "zh-Hant") { const t = text(elementAt(chip, g)); if (t !== word(e)) return `${p.where}（中文，${mname}）：縣市 ${w.k} 第 ${i + 1} 個記號寫「${t}」，應為「${word(e)}」`; }
        marks++; if (e.k !== "move" && !e.ok) fails++;
      }
      if (w.mine) mineN++;
      chipsN++;
    }
    const extra = chips.filter((t) => !want.has(`${attr(t.tag, "data-county")}:${KEYS.indexOf(attr(t.tag, "data-who"))}`));
    if (extra.length) return `${p.where}（${name}，${mname}）：多了 ${extra.length} 個沒有動作的 chip（縣市 ${attr(extra[0].tag, "data-county")}、${attr(extra[0].tag, "data-who")}）`;
  }
  for (const [n, w] of [[fails, "沒過的檢定"], [mineN, "自己的一步"], [chipsN, "縣市 chip"]]) { const r = nonEmpty(n, w); if (r !== true) return r; }
  return ok(true, `${chipsN} 個 chip、${marks} 個記號（${fails} 個沒過、${mineN} 個是自己的）都對`);
}));

check("有 chip 的縣市都帶 data-changed", gate(() => {
  let n = 0;
  for (const p of POOL) for (const [mo, mname] of MAPS) {
    const html = S.screen(p.s, "zh-Hant", mo);
    for (const c of countyChips(html)) {
      const k = attr(c.tag, "data-county"), g = tags(html, "data-county").find((t) => t.v === k && /class="tw-c/.test(t.tag));
      if (!g || !has(g.tag, "data-changed")) return `${p.where}（${mname}）：縣市 ${k} 有 chip 卻沒有 data-changed`;
      n++;
    }
  }
  const r = nonEmpty(n, "縣市 chip"); if (r !== true) return r;
  return ok(true, `${n} 個`);
}));

test("marks72", () => {
  const s = summary();
  for (const p of R.pass) console.log(`  ✓ ${p.label}${p.msg ? " — " + p.msg : ""}`);
  for (const t of s.todos) console.log(`  … ${t.label} — ${t.msg}`);
  for (const x of s.failures) console.log(`  ✗ ${x.label} — ${x.msg}`);
  console.log(`  通過 ${s.pass} / 失敗 ${s.fail} / 尚未實作 ${s.todo}`);
  assert.equal(s.fail, 0, s.failures.map((x) => `${x.label}: ${x.msg}`).join("\n"));
});
