// The player-visible text: rules page sections, English card text, place names, glossary, bot
// names. Orchestrator's file: a peer may run it and falsify against it, and does not edit it.
//
//   node --test tests/i18n.test.js      (or `npm test`)
//
// Three verdicts per check (tests/harness.js). Every check reports 尚未實作 until the writer
// starts (#9): until zh-Hant.js has a `rules` array.
import test from "node:test";
import assert from "node:assert/strict";
import { R, section, check, eq, ok, nonEmpty, summary } from "./harness.js";
import * as B from "../public/shared/board.js";
import * as C from "../public/shared/cards.js";
import zh from "../public/i18n/zh-Hant.js";
import en from "../public/i18n/en.js";
import * as E from "../public/shared/engine.js";
import * as BOTS from "../public/shared/bots.js";
import * as D from "./driver.js";

// The rules page follows the rulebook's chapters (v0.3, vault e487d8e). Copied by hand.
const SECTIONS = ["overview", "components", "board", "setup", "turn", "play", "actions", "checks",
  "debate", "late", "abandon", "election", "candidates", "decks"];
const TERMS = ["cp", "momentum", "endorsement", "boss", "floating", "grey", "rest", "abandon", "canvass", "initiative", "media", "issue"];
const BOT_LEVELS = [1, 2, 3];
const CJK = /[㐀-鿿豈-﫿]/;

const STARTED = Array.isArray(zh.rules);
const c9 = (name, fn) => check(name, () => (STARTED ? fn() : "TODO: 規則頁文字還沒開始（#9）"));

// Every leaf path of an object, with arrays indexed and `cards` (English only) left out.
function leaves(o, path = "", out = []) {
  if (o === null || typeof o !== "object") { out.push(path); return out; }
  for (const k of Object.keys(o)) { if (path === "" && k === "cards") continue; leaves(o[k], path ? `${path}.${k}` : k, out); }
  return out;
}
function strings(o, out = []) {
  if (typeof o === "string") out.push(o);
  else if (o && typeof o === "object") for (const v of Object.values(o)) strings(v, out);
  return out;
}

section("9 玩家看得到的字");
c9("中英兩份字串的結構一樣（英文另外多一份 cards）", () => {
  const a = new Set(leaves(zh)), b = new Set(leaves(en));
  const onlyZh = [...a].filter((k) => !b.has(k)), onlyEn = [...b].filter((k) => !a.has(k));
  if (onlyZh.length || onlyEn.length) return `只有中文：${onlyZh.slice(0, 8).join(",") || "無"}；只有英文：${onlyEn.slice(0, 8).join(",") || "無"}`;
  return ok(true, `${a.size} 個字串位置兩邊都有`);
});
c9("規則頁的章節：照規則書的順序、中英同一組 id，每節有標題與內容", () => {
  for (const [lang, t] of [["zh", zh], ["en", en]]) {
    if (!Array.isArray(t.rules)) return `${lang} 沒有 rules 陣列`;
    const ids = t.rules.map((s) => s.id);
    const r = eq(ids.join(","), SECTIONS.join(","), `${lang} 的章節 id`); if (r !== true) return r;
    const empty = t.rules.filter((s) => !s.title || !Array.isArray(s.body) || !s.body.length || !strings(s.body).every((x) => x.trim())).map((s) => s.id);
    if (empty.length) return `${lang} 有空的章節或空字串：${empty.join(",")}`;
  }
  return ok(true, `${SECTIONS.length} 節`);
});
c9("英文牌文：70 張事件牌都有英文牌名與效果，沒有多出來的 id；地方牌有英文的名稱樣板", () => {
  if (!en.cards || typeof en.cards !== "object") return "en.js 沒有 cards";
  const ids = C.EVENTS.map((e) => e.id);
  const r = nonEmpty(ids.length, "事件牌"); if (r !== true) return r;
  const missing = ids.filter((id) => !en.cards[id] || !String(en.cards[id].name || "").trim() || !String(en.cards[id].text || "").trim());
  if (missing.length) return "缺英文牌名或效果：" + missing.slice(0, 10).join(",") + (missing.length > 10 ? `…（共 ${missing.length}）` : "");
  const extra = Object.keys(en.cards).filter((id) => id !== "local" && !ids.includes(id));
  if (extra.length) return "cards.js 沒有的 id：" + extra.join(",");
  if (!en.cards.local || !/\{county\}/.test(en.cards.local.name || "") || !String(en.cards.local.text || "").trim()) return "en.cards.local 要有帶 {county} 的 name 與 text";
  return ok(true, `${ids.length} 張事件 + 地方牌樣板`);
});
c9("地名：24 縣市與 7 個區域都有英文名，中文名跟 board.js 一字不差", () => {
  for (const [lang, t] of [["zh", zh], ["en", en]]) {
    if (!t.counties || !t.regions) return `${lang} 沒有 counties 或 regions`;
    const cm = B.COUNTIES.filter((c) => !String(t.counties[c[0]] || "").trim()).map((c) => c[0]);
    if (cm.length) return `${lang} 缺縣市：${cm.join(",")}`;
    const rm = B.REGIONS.filter((n) => !String(t.regions[n] || "").trim());
    if (rm.length) return `${lang} 缺區域：${rm.join(",")}`;
  }
  const wrong = B.COUNTIES.filter((c) => zh.counties[c[0]] !== c[0]).map((c) => c[0]);
  if (wrong.length) return "中文縣市名跟 board.js 不同：" + wrong.join(",");
  return ok(true, "24 縣市、7 區域");
});
// The exact names are checked in section 20 (owner renamed level 1 on 2026-10-14).
c9("名詞表與 bot 三級的名字兩邊都有", () => {
  for (const [lang, t] of [["zh", zh], ["en", en]]) {
    const tm = TERMS.filter((k) => !t.terms || !String(t.terms[k] || "").trim());
    if (tm.length) return `${lang} 缺名詞：${tm.join(",")}`;
    const bm = BOT_LEVELS.filter((k) => !t.bots || !String(t.bots[k] || "").trim());
    if (bm.length) return `${lang} 缺 bot 等級：${bm.join(",")}`;
  }
  return ok(true, `${TERMS.length} 個名詞、3 級 bot`);
});
// The language switch names the other language in its own script (orchestrator 裁決, #9): on
// the English page it reads 中文, the one Chinese string English carries.
c9("英文字串裡沒有中文字（語言切換鈕 nav.lang 除外，它寫的是中文）", () => {
  const bad = strings({ ...en, nav: { ...en.nav, lang: "" } }).filter((s) => CJK.test(s));
  if (bad.length) return "英文裡有中文：" + bad.slice(0, 5).map((s) => JSON.stringify(s.slice(0, 40))).join("；");
  const r = eq(en.nav && en.nav.lang, "中文", "英文頁的語言切換鈕"); if (r !== true) return r;
  return ok(true, `${strings(en).length} 條英文`);
});

// ---- 桌邊話（#14）: one line per bot why.key, in both languages. A {name} placeholder must be a
// param the bot sends with that key every time it sends it (sampled from four bot games), so the
// table never shows a raw "{county}". Every check reports 尚未實作 until zh-Hant.js has `talk`.
const TALKING = !!(zh.talk && typeof zh.talk === "object");
const c14 = (name, fn) => check(name, () => (TALKING ? fn() : "TODO: 桌邊話還沒開始（#14）"));
const TALK_MAX = { zh: 32, en: 100 };  // orchestrator ruling (#14): one bubble on a 390-wide phone
const INTERNAL = new Set(["value", "gain", "lead"]); // the bots' own scores, not for players
const holes = (str) => [...String(str).matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
let PARAMS = null; // key → Set of params present on every occurrence
function sampleParams() {
  if (PARAMS) return PARAMS;
  const seen = {};
  for (const [seed, lv] of [[1, 3], [2, 3], [3, 2], [4, 1]]) {
    let st = E.createGame(seed); const r = D.rng(seed);
    for (let n = 0; n < 20000 && st.phase !== "end"; n++) {
      const p = E.mustAct(st)[0], o = BOTS.chooseMove(st, p, lv, r);
      const ks = new Set(Object.keys(o.why).filter((k) => k !== "key"));
      seen[o.why.key] = seen[o.why.key] ? new Set([...seen[o.why.key]].filter((k) => ks.has(k))) : ks;
      st = E.apply(st, p, o.move);
    }
  }
  return (PARAMS = seen);
}
section("14 桌邊話");
c14("每一個 bot 的 why.key 都有中英一句話，沒有多出來的 key", () => {
  const r = nonEmpty(BOTS.WHY.length, "bots.js 的 WHY"); if (r !== true) return r;
  for (const [lang, t] of [["zh", zh], ["en", en]]) {
    if (!t.talk) return `${lang} 沒有 talk`;
    const miss = BOTS.WHY.filter((k) => !String(t.talk[k] || "").trim());
    if (miss.length) return `${lang} 缺：${miss.slice(0, 8).join("、")}${miss.length > 8 ? `…（共 ${miss.length}）` : ""}`;
    const extra = Object.keys(t.talk).filter((k) => !BOTS.WHY.includes(k));
    if (extra.length) return `${lang} 多了 WHY 裡沒有的 key：${extra.join("、")}`;
  }
  return ok(true, `${BOTS.WHY.length} 個 key 兩邊都有`);
});
c14("佔位字 {…} 只用 bot 每次都會帶的參數（從四局 bot 對打取樣；沒出現過的 key 不能有佔位字）", () => {
  const P = sampleParams();
  const bad = [];
  for (const [lang, t] of [["zh", zh], ["en", en]]) for (const k of BOTS.WHY) {
    const allowed = P[k] || new Set();
    for (const h of holes(t.talk[k])) if (INTERNAL.has(h)) bad.push(`${lang}.${k} 用了 {${h}}：那是 bot 內部的估值，不是給玩家看的數字`);
    else if (!allowed.has(h)) bad.push(`${lang}.${k} 用了 {${h}}（bot 每次都帶的：${[...allowed].join(",") || "無"}${P[k] ? "" : "；這個 key 四局裡沒出現過"}）`);
  }
  if (bad.length) return bad.slice(0, 5).join("；");
  return ok(true, `${Object.keys(P).length} 個 key 取樣到；${BOTS.WHY.filter((k) => !P[k]).join("、") || "全部都有"}沒出現過`);
});
// The room server's error codes (#13 handover, copied by hand; not read from src/roomcore.js).
const ERROR_CODES = ["bad_message", "bad_seat", "seat_taken", "started", "not_host", "bad_level", "not_seated",
  "not_started", "not_your_turn", "illegal_move", "engine_error", "no_room", "empty_chat", "not_ended"]; // the last two from #16
c14(`房間的錯誤碼：${ERROR_CODES.length} 個都有中英說明（errors）`, () => {
  for (const [lang, t] of [["zh", zh], ["en", en]]) {
    const miss = ERROR_CODES.filter((k) => !t.errors || !String(t.errors[k] || "").trim());
    if (miss.length) return `${lang} 缺錯誤說明：${miss.join("、")}`;
  }
  return ok(true, `${ERROR_CODES.length} 個錯誤碼`);
});
c14(`一句話放得進手機上的泡泡：中文 ≤ ${TALK_MAX.zh} 字、英文 ≤ ${TALK_MAX.en} 字元（佔位字不算）`, () => {
  const long = [];
  for (const [lang, t] of [["zh", zh], ["en", en]]) for (const k of BOTS.WHY) {
    const n = [...String(t.talk[k]).replace(/\{\w+\}/g, "")].length;
    if (n > TALK_MAX[lang]) long.push(`${lang}.${k} ${n}`);
  }
  return long.length ? "太長：" + long.slice(0, 6).join("、") : ok(true, `${BOTS.WHY.length * 2} 句`);
});

// ---- 改名（#20）. Owner (2026-10-14, choosing A and C of the orchestrator's proposal):
// 「A and C」 — the weakest bot 樁腳 becomes 助選員 (English Canvasser → Volunteer, which also stops
// clashing with canvass, 催票), and the term 樁腳主 becomes 地方大老 (English stays local boss).
// Reports 尚未實作 while both old names are still in place.
const RENAMING = !(zh.bots && zh.bots[1] === "樁腳" && zh.terms && zh.terms.boss === "樁腳主");
const c20 = (name, fn) => check(name, () => (RENAMING ? fn() : "TODO: 改名還沒開始（#20）"));
section("20 改名");
c20("bot 三級：中文 助選員／總幹事／操盤手，英文 Volunteer／Campaign chief／Strategist", () => {
  let r = eq(BOT_LEVELS.map((k) => zh.bots[k]).join("/"), "助選員/總幹事/操盤手", "中文 bot 名字（owner 定）"); if (r !== true) return r;
  r = eq(BOT_LEVELS.map((k) => en.bots[k]).join("/"), "Volunteer/Campaign chief/Strategist", "英文 bot 名字"); if (r !== true) return r;
  return ok(true, "助選員／總幹事／操盤手");
});
c20("名詞：中文 terms.boss 是「地方大老」，英文仍是 local boss", () => {
  let r = eq(zh.terms.boss, "地方大老", "中文 terms.boss"); if (r !== true) return r;
  r = eq(/local boss/i.test(en.terms.boss), true, `英文 terms.boss 仍是 local boss（實際 "${en.terms.boss}"）`); if (r !== true) return r;
  return ok(true, "地方大老 / local boss");
});
c20("舊名不見了：中文字串沒有「樁腳」（含樁腳主），英文字串沒有 Canvasser；牌文裡也沒有「樁腳主」", () => {
  const zs = strings(zh).filter((s) => s.includes("樁腳"));
  if (zs.length) return `中文還有「樁腳」：${zs.slice(0, 3).map((s) => JSON.stringify(s.slice(0, 30))).join("；")}`;
  const es = strings(en).filter((s) => /canvasser/i.test(s));
  if (es.length) return `英文還有 Canvasser：${es.slice(0, 3).map((s) => JSON.stringify(s.slice(0, 40))).join("；")}`;
  const cs = [...C.EVENTS, ...C.localCards()].filter((c) => /樁腳主/.test(`${c.name} ${c.text}`)).map((c) => c.id);
  if (cs.length) return `牌文還有「樁腳主」：${cs.join("、")}`;
  return ok(true, `中文 ${strings(zh).length} 條、英文 ${strings(en).length} 條、${C.EVENTS.length} 張事件牌都沒有舊名`);
});

// ---- Q7 = B（#22）. Owner (2026-10-14) said 「Yes」 to the orchestrator's advice on Q4–Q8, which
// changed Q7: when the debate cards run out, an issue nobody played a card on (0/0/0) is not
// settled; it goes back to the track in its original order. The rules page has to say so.
// Reports 尚未實作 until the Chinese debate section says 不結算.
const debateText = (t) => strings((t.rules || []).find((s) => s.id === "debate") || {}).join(" ");
const Q7 = /不結算/.test(debateText(zh));
section("22 規則頁：政見發表會沒人出牌的議題");
check("規則頁的政見發表會寫出：沒人出過牌的議題不結算（中文「不結算」、英文 not settled），議題照原順序回軌道", () => {
  if (!Q7) return "中文的政見發表會一節沒有寫「不結算」（Q7 = B，#22）";
  if (!/not settled/i.test(debateText(en))) return "英文的政見發表會一節沒有寫 not settled";
  // The order has to be said after 不結算 / not settled: the sentence before already says the
  // settled ones go in track order (found by the writer, #22).
  const after = (text, re) => { const m = text.match(re); return m ? text.slice(m.index + m[0].length) : ""; };
  if (!/原(來的)?順序/.test(after(debateText(zh), /不結算/))) return "中文在「不結算」之後沒有寫議題照原順序回軌道";
  if (!/original order/i.test(after(debateText(en), /not settled/i))) return "英文在 not settled 之後沒有寫 original order";
  return ok(true, "中英都寫了");
});

test("i18n", () => {
  const s = summary();
  for (const p of R.pass) console.log(`  ✓ ${p.label}${p.msg ? " — " + p.msg : ""}`);
  for (const t of s.todos) console.log(`  … ${t.label} — ${t.msg}`);
  for (const f of s.failures) console.log(`  ✗ ${f.label} — ${f.msg}`);
  console.log(`  通過 ${s.pass} / 失敗 ${s.fail} / 尚未實作 ${s.todo}`);
  assert.equal(s.fail, 0, s.failures.map((f) => `${f.label}: ${f.msg}`).join("\n"));
});
