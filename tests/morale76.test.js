// 運氣 is renamed 士氣 (Luck → Morale) everywhere a player reads it (issue #76). Orchestrator's file: a peer may run it and
// falsify against it, and does not edit it.
//
//   node --test tests/morale76.test.js      (or `npm test`)
//
// Owner, 2026-10-17: 「把運氣 改叫 士氣」. Only the word changes: the numbers, the rules and the code's own names (st.luck,
// data-luck, i18n keys such as luckW) stay as they are.
//   - Chinese: no string value of the zh-Hant i18n, no card text (shared/cards.js), no rules page (rulesHTML) and no solo
//     screen (Chinese, desk and phone maps, all phases of six games) holds 「運氣」; the candidate boards say 「士氣 N%」.
//   - English: the same in the en i18n, the English card texts, the English rules page and screens, for the word luck
//     (Luck, lucks …); the boards say "Morale N%".
// 尚未實作 until some Chinese string says 士氣.
import test from "node:test";
import assert from "node:assert/strict";
import { R, section, check, ok, nonEmpty, summary } from "./harness.js";
import * as D from "./driver.js";
import * as S from "../public/solo.js";
import en from "../public/i18n/en.js";
import zh from "../public/i18n/zh-Hant.js";
import { EVENTS, localCards } from "../public/shared/cards.js";
import { rulesHTML } from "../public/rules.js";

const strings = (o, path = "", out = []) => {
  if (typeof o === "string") out.push([path, o]);
  else if (Array.isArray(o)) o.forEach((x, i) => strings(x, `${path}[${i}]`, out));
  else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) strings(v, path ? `${path}.${k}` : k, out);
  return out;
};
const text = (html) => html.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
function screens() {
  const out = [];
  for (let i = 0; i < 6; i++) {
    const seat = i % 3, seed = 7601 + i;
    let s = S.newSolo({ seat, level: 2, seed }); const R1 = D.rng(seed);
    for (let n = 0; n < 4000 && s.st.phase !== "end"; n++) {
      if (n % 7 === 0) out.push({ s, where: `seat ${seat} seed ${seed} 第 ${s.st.turn} 回合第 ${n} 步（${s.st.phase}）` });
      const bots = S.botsToMove(s).length > 0, ch = S.choices(s, "zh-Hant");
      if (bots && (!ch.length || R1() < 0.5)) s = S.stepBot(s); else { if (!ch.length) break; s = S.act(s, ch[Math.floor(R1() * ch.length)].move); }
    }
    out.push({ s, where: `seat ${seat} seed ${seed} 結束` });
  }
  return out;
}
const POOL = screens();
const ZH_STR = strings(zh), EN_STR = strings(en);
const CARD_ZH = [...EVENTS, ...localCards()].map((c) => [c.id, c.text || ""]);
const GATE = ZH_STR.some(([, v]) => v.includes("士氣")) || CARD_ZH.some(([, t]) => t.includes("士氣"));
const gate = (fn) => () => { const ne = nonEmpty(POOL.length, "牌桌的狀態"); if (ne !== true) return ne; return GATE ? fn() : "中文字串裡沒有「士氣」（#76 已上線，e9cbb26；這是退步，不是尚未實作）"; };
const OLD = { zh: /運氣/, en: /\bluck/i };

section("76 運氣改叫士氣（Luck → Morale）");

check("中文：i18n、牌文、規則頁、牌桌畫面都沒有「運氣」；候選人板寫「士氣 N%」", gate(() => {
  const s1 = ZH_STR.filter(([, v]) => OLD.zh.test(v)); if (s1.length) return `zh i18n 還有 ${s1.length} 句寫「運氣」：${s1.slice(0, 3).map(([k, v]) => `${k}「${v.slice(0, 30)}」`).join("、")}`;
  const s2 = CARD_ZH.filter(([, t]) => OLD.zh.test(t)); if (s2.length) return `牌文還有 ${s2.length} 張寫「運氣」：${s2.slice(0, 3).map(([id, t]) => `${id}「${t}」`).join("、")}`;
  const r = text(rulesHTML("zh-Hant")); if (OLD.zh.test(r)) return `中文規則頁還有「運氣」：…${r.slice(Math.max(0, r.search(OLD.zh) - 20), r.search(OLD.zh) + 20)}…`;
  if (!r.includes("士氣")) return "中文規則頁沒有「士氣」";
  let boards = 0;
  for (const p of POOL) for (const mo of [{}, { narrow: true }]) {
    const h = text(S.screen(p.s, "zh-Hant", mo));
    if (OLD.zh.test(h)) return `${p.where}：畫面還有「運氣」：…${h.slice(Math.max(0, h.search(OLD.zh) - 20), h.search(OLD.zh) + 20)}…`;
    if (p.s.st.phase === "action" && /士氣 \d+%/.test(h)) boards++;
  }
  const ne = nonEmpty(boards, "寫著「士氣 N%」的行動階段畫面"); if (ne !== true) return ne;
  return ok(true, `${ZH_STR.length} 句 i18n、${CARD_ZH.length} 張牌、規則頁與 ${POOL.length * 2} 個畫面都沒有「運氣」；${boards} 個行動階段畫面寫「士氣 N%」`);
}));

check("英文：i18n、牌文、規則頁、牌桌畫面都沒有 luck；候選人板寫 \"Morale N%\"", gate(() => {
  const s1 = EN_STR.filter(([, v]) => OLD.en.test(v)); if (s1.length) return `en i18n 還有 ${s1.length} 句寫 luck：${s1.slice(0, 3).map(([k, v]) => `${k}「${v.slice(0, 40)}」`).join("、")}`;
  const r = text(rulesHTML("en")); if (OLD.en.test(r)) return `英文規則頁還有 luck：…${r.slice(Math.max(0, r.search(OLD.en) - 20), r.search(OLD.en) + 20)}…`;
  if (!/morale/i.test(r)) return "英文規則頁沒有 morale";
  let boards = 0;
  for (const p of POOL) for (const mo of [{}, { narrow: true }]) {
    const h = text(S.screen(p.s, "en", mo));
    if (OLD.en.test(h)) return `${p.where}：英文畫面還有 luck：…${h.slice(Math.max(0, h.search(OLD.en) - 20), h.search(OLD.en) + 20)}…`;
    if (p.s.st.phase === "action" && /Morale \d+%/.test(h)) boards++;
  }
  const ne = nonEmpty(boards, "寫著 \"Morale N%\" 的行動階段畫面"); if (ne !== true) return ne;
  return ok(true, `${EN_STR.length} 句 i18n、規則頁與 ${POOL.length * 2} 個畫面都沒有 luck；${boards} 個行動階段畫面寫 "Morale N%"`);
}));

test("morale76", () => {
  const s = summary();
  for (const p of R.pass) console.log(`  ✓ ${p.label}${p.msg ? " — " + p.msg : ""}`);
  for (const t of s.todos) console.log(`  … ${t.label} — ${t.msg}`);
  for (const x of s.failures) console.log(`  ✗ ${x.label} — ${x.msg}`);
  console.log(`  通過 ${s.pass} / 失敗 ${s.fail} / 尚未實作 ${s.todo}`);
  assert.equal(s.fail, 0, s.failures.map((x) => `${x.label}: ${x.msg}`).join("\n"));
});
