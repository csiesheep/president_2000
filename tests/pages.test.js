// The pages (M3), as far as node can see them. Orchestrator's file: a peer may run it and falsify
// against it, and does not edit it. What a page looks like is checked by opening it, not here.
//
//   node --test tests/pages.test.js      (or `npm test`)
//
// Contract (issue #11): public/rules.js exports
//   rulesHTML(lang) → string        lang ∈ "zh-Hant" | "en"
// the HTML of the rules page's content: the 14 sections of i18n `rules` (each an element with
// id = the section id, in order) and every card. Importing rules.js must not touch the DOM.
// Every check reports 尚未實作 until public/rules.js exists.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { R, section, check, eq, ok, nonEmpty, summary } from "./harness.js";
import * as B from "../public/shared/board.js";
import * as C from "../public/shared/cards.js";
import zh from "../public/i18n/zh-Hant.js";
import en from "../public/i18n/en.js";

const CJK = /[㐀-鿿豈-﫿]/;
const LANGS = [["zh-Hant", zh], ["en", en]];
const RULES_FILE = new URL("../public/rules.js", import.meta.url);
let RULES = null, IMPORT_ERR = null;
if (existsSync(RULES_FILE)) { try { RULES = await import(RULES_FILE.href); } catch (e) { IMPORT_ERR = e; } }
const c11 = (name, fn) => check(name, () => {
  if (!existsSync(RULES_FILE)) return "TODO: public/rules.js 還沒有（#11）";
  if (IMPORT_ERR) return `public/rules.js 在 node 裡 import 就丟錯（不能在 import 時碰 DOM）：${IMPORT_ERR.message}`;
  if (typeof RULES.rulesHTML !== "function") return "TODO: public/rules.js 還沒有 rulesHTML（#11）";
  return fn();
});

// The text a reader sees: tags dropped, the five usual entities decoded, whitespace collapsed.
const text = (html) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]*>/g, " ")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&amp;/g, "&")
  .replace(/\s+/g, " ");
const flat = (s) => s.replace(/\s+/g, " ").trim();
function strings(o, out = []) {
  if (typeof o === "string") out.push(o);
  else if (o && typeof o === "object") for (const v of Object.values(o)) strings(v, out);
  return out;
}
const render = {};
const html = (lang) => (render[lang] ??= String(RULES.rulesHTML(lang)));

section("11 規則頁");
c11("每一節都在：元素的 id 是章節 id、照順序，標題與每一段、每一項、每一格表格的字都在頁上", () => {
  const out = [];
  for (const [lang, t] of LANGS) {
    const h = html(lang), seen = text(h);
    const ids = [...h.matchAll(/\sid="([a-z]+)"/g)].map((m) => m[1]).filter((id) => t.rules.some((s) => s.id === id));
    const r = eq(ids.join(","), t.rules.map((s) => s.id).join(","), `${lang} 頁上的章節 id 順序`); if (r !== true) return r;
    let n = 0;
    for (const s of t.rules) {
      for (const str of [s.title, ...strings(s.body)]) {
        if (!seen.includes(flat(str))) return `${lang} 「${s.id}」少了一段字：${JSON.stringify(str.slice(0, 50))}`;
        n++;
      }
    }
    out.push(`${lang} ${t.rules.length} 節 ${n} 段`);
  }
  return ok(true, out.join("；"));
});
c11("全部的牌：70 張事件牌的牌名與效果、41 張地方牌的縣市，中英各用自己的字", () => {
  const out = [];
  const r = nonEmpty(C.EVENTS.length, "事件牌"); if (r !== true) return r;
  for (const [lang, t] of LANGS) {
    const seen = text(html(lang));
    for (const e of C.EVENTS) {
      const name = lang === "en" ? en.cards[e.id].name : e.name, body = lang === "en" ? en.cards[e.id].text : e.text;
      if (!seen.includes(flat(name))) return `${lang} 少了牌名：${e.id}（${name}）`;
      if (!seen.includes(flat(body))) return `${lang} 少了效果：${e.id}（${body.slice(0, 40)}）`;
    }
    const locals = [...new Set(C.localCards().map((c) => c.county))];
    for (const county of locals) {
      const label = lang === "en" ? en.cards.local.name.replace("{county}", en.counties[county]) : C.localCards().find((c) => c.county === county).name;
      if (!seen.includes(flat(label))) return `${lang} 少了地方牌：${label}`;
    }
    out.push(`${lang} ${C.EVENTS.length} 張事件、${locals.length} 個縣市的地方牌`);
  }
  return ok(true, out.join("；"));
});
c11("語言不混：英文頁沒有中文字；中文頁沒有英文的章節標題與英文牌名", () => {
  const e = text(html("en")), z = text(html("zh-Hant"));
  const cjk = e.match(new RegExp(`.{0,12}${CJK.source}.{0,12}`));
  if (cjk) return `英文頁有中文：${JSON.stringify(cjk[0])}`;
  const leak = [...en.rules.map((s) => s.title), ...C.EVENTS.map((x) => en.cards[x.id].name)].filter((s) => s.length > 6 && z.includes(s));
  if (leak.length) return "中文頁有英文：" + leak.slice(0, 5).join("；");
  return ok(true, `英文頁 ${e.length} 字、中文頁 ${z.length} 字`);
});
c11("rules.html 載入 rules.js，頁上不再有「建設中」", () => {
  const page = readFileSync(new URL("../public/rules.html", import.meta.url), "utf8");
  if (!/<script[^>]+type="module"[^>]+src="[^"]*rules\.js"/.test(page) && !/<script[^>]+src="[^"]*rules\.js"[^>]+type="module"/.test(page)) return "rules.html 沒有用 <script type=\"module\"> 載入 rules.js";
  if (page.includes("建設中")) return "rules.html 還寫著「建設中」";
  return ok(true, "rules.html → rules.js");
});

test("pages", () => {
  const s = summary();
  for (const p of R.pass) console.log(`  ✓ ${p.label}${p.msg ? " — " + p.msg : ""}`);
  for (const t of s.todos) console.log(`  … ${t.label} — ${t.msg}`);
  for (const f of s.failures) console.log(`  ✗ ${f.label} — ${f.msg}`);
  console.log(`  通過 ${s.pass} / 失敗 ${s.fail} / 尚未實作 ${s.todo}`);
  assert.equal(s.fail, 0, s.failures.map((f) => `${f.label}: ${f.msg}`).join("\n"));
});
