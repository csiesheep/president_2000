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
c9("名詞表與 bot 三級的名字兩邊都有（樁腳／總幹事／操盤手）", () => {
  for (const [lang, t] of [["zh", zh], ["en", en]]) {
    const tm = TERMS.filter((k) => !t.terms || !String(t.terms[k] || "").trim());
    if (tm.length) return `${lang} 缺名詞：${tm.join(",")}`;
    const bm = BOT_LEVELS.filter((k) => !t.bots || !String(t.bots[k] || "").trim());
    if (bm.length) return `${lang} 缺 bot 等級：${bm.join(",")}`;
  }
  const r = eq(BOT_LEVELS.map((k) => zh.bots[k]).join("/"), "樁腳/總幹事/操盤手", "中文 bot 名字（owner 定）"); if (r !== true) return r;
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

test("i18n", () => {
  const s = summary();
  for (const p of R.pass) console.log(`  ✓ ${p.label}${p.msg ? " — " + p.msg : ""}`);
  for (const t of s.todos) console.log(`  … ${t.label} — ${t.msg}`);
  for (const f of s.failures) console.log(`  ✗ ${f.label} — ${f.msg}`);
  console.log(`  通過 ${s.pass} / 失敗 ${s.fail} / 尚未實作 ${s.todo}`);
  assert.equal(s.fail, 0, s.failures.map((f) => `${f.label}: ${f.msg}`).join("\n"));
});
