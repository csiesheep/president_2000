// Seven cards about real people renamed after the fact check of #84 (issue #85). Orchestrator's file: a peer may run it
// and falsify against it, and does not edit it.
//
//   node --test tests/cards85.test.js      (or `npm test`)
//
// Owner, 2026-10-18, to the #84 proposals (the effects stay, only names and words change): 「全部照建議改」.
//   - Chinese names, word for word: 李登輝暗助 → 李登輝暗助說 (as 李登輝授意說); 馬英九公布民調 → 馬英九選前民調談話;
//     跪票 → 選前之夜催票 (no record of 宋 kneeling in 2000); 說法反覆 → 興票案說法反覆; 花東原鄉 → 花東鄉親.
//     張榮發挺扁 and 掃除黑金 stay (the record bears them out).
//   - English: 外省眷村 is "Military Dependents' Villages"; 花東鄉親 names Hualien and Taitung; the four renamed cards no
//     longer carry their old English names; 李登輝暗助說 says it is a rumour (rumo(u)r / alleged / said / claim);
//     選前之夜催票 says nothing of kneeling.
//   - The old names are gone from every string, card text and the rules page, both languages (the new 李登輝暗助說 and
//     興票案說法反覆 contain the old 李登輝暗助 and 說法反覆, so those two are looked for when not part of the new name).
//   - The effects are untouched: each card's text is what it was before #85 (copied here).
// 尚未實作 until 李登輝暗助 is renamed.
import test from "node:test";
import assert from "node:assert/strict";
import { R, section, check, ok, summary } from "./harness.js";
import zh from "../public/i18n/zh-Hant.js";
import en from "../public/i18n/en.js";
import { EVENTS, localCards } from "../public/shared/cards.js";
import { rulesHTML } from "../public/rules.js";

const NAME_ZH = { lee_secret_help: "李登輝暗助說", ma_leaks_polls: "馬英九選前民調談話", kneel_for_votes: "選前之夜催票", shifting_story: "興票案說法反覆", east_coast: "花東鄉親", chang_yung_fa: "張榮發挺扁", sweep_black_gold: "掃除黑金" };
const OLD_EN = { lee_secret_help: "Lee Teng-hui's Quiet Help", ma_leaks_polls: "Ma Ying-jeou Releases Polls", kneel_for_votes: "Kneeling for Votes", veterans_village: "Mainlander Veterans' Villages", east_coast: "Eastern Indigenous Communities" };
// The old Chinese names, as patterns that do not match inside the new ones.
const OLD_ZH = [/李登輝暗助(?!說)/, /馬英九公布民調/, /跪票/, /(?<!興票案)說法反覆/, /花東原鄉/];
// The effects before #85 (main fcc75bc), copied by hand.
const TEXT_ZH = {
  lee_secret_help: "陳在任 2 個縣市各 +1 免檢定",
  ma_leaks_polls: "法定競選期：連在任 2 個縣市各 +1 需檢定；宋、陳士氣各 +5%",
  kneel_for_votes: "宋士氣 +10%；宋在任 2 個縣市各 +1 需檢定",
  shifting_story: "僅在「李登輝授意說」出過後可當事件出：宋移除 2 顆盤上方塊（連選）；宋士氣 −10%",
};
const strings = (o, p = "", out = []) => {
  if (typeof o === "string") out.push([p, o]);
  else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) strings(v, p ? `${p}.${k}` : k, out);
  return out;
};
const card = (id) => EVENTS.find((e) => e.id === id) || localCards().find((e) => e.id === id) || {};
const GATE = card("lee_secret_help").name === "李登輝暗助說";
const gate = (fn) => () => (GATE ? fn() : "TODO: 李登輝暗助還沒改名（#85）");
const text = (html) => html.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/\s+/g, " ");

section("85 真實人物牌改名（#84 查證）");

check("中文牌名照 owner 定的一字不差；張榮發挺扁、掃除黑金不改", gate(() => {
  const bad = Object.entries(NAME_ZH).filter(([id, n]) => card(id).name !== n).map(([id, n]) => `${id}：「${card(id).name}」（應為「${n}」）`);
  return bad.length ? bad.join("；") : ok(true, `${Object.keys(NAME_ZH).length} 張的中文牌名都對`);
}));

check("英文牌名：眷村是 Military Dependents' Villages、花東寫 Hualien and Taitung、四張改了名、暗助說寫明是傳聞、選前之夜不提下跪", gate(() => {
  const nm = (id) => (en.cards[id] || {}).name || "", bad = [];
  if (!/Military Dependents' Villages/.test(nm("veterans_village"))) bad.push(`veterans_village：「${nm("veterans_village")}」`);
  if (!/Hualien/.test(nm("east_coast")) || !/Taitung/.test(nm("east_coast"))) bad.push(`east_coast：「${nm("east_coast")}」`);
  for (const [id, old] of Object.entries(OLD_EN)) if (nm(id) === old) bad.push(`${id} 還是舊名「${old}」`);
  if (!/rumou?r|alleged|said|claim/i.test(nm("lee_secret_help"))) bad.push(`lee_secret_help：「${nm("lee_secret_help")}」沒寫明是傳聞`);
  if (/kneel/i.test(nm("kneel_for_votes") + " " + ((en.cards.kneel_for_votes || {}).text || ""))) bad.push(`kneel_for_votes 英文還提到下跪：「${nm("kneel_for_votes")}」`);
  return bad.length ? bad.join("；") : ok(true, `英文：${nm("lee_secret_help")} / ${nm("ma_leaks_polls")} / ${nm("kneel_for_votes")} / ${nm("veterans_village")} / ${nm("east_coast")}`);
}));

check("舊名不見了：中英所有字串、牌文與規則頁", gate(() => {
  const left = [];
  for (const [k, v] of strings(zh)) for (const re of OLD_ZH) if (re.test(v)) left.push(`zh ${k}：「${v.slice(0, 40)}」`);
  for (const c of [...EVENTS, ...localCards()]) for (const re of OLD_ZH) if (re.test(`${c.name || ""} ${c.text || ""}`)) left.push(`cards.js ${c.id}：「${c.name}」「${(c.text || "").slice(0, 30)}」`);
  for (const [k, v] of strings(en)) for (const old of Object.values(OLD_EN)) if (v.includes(old)) left.push(`en ${k}：「${v.slice(0, 50)}」`);
  const rz = text(rulesHTML("zh-Hant")), re_ = text(rulesHTML("en"));
  for (const re of OLD_ZH) if (re.test(rz)) left.push(`中文規則頁：${re}`);
  for (const old of Object.values(OLD_EN)) if (re_.includes(old)) left.push(`英文規則頁：「${old}」`);
  return left.length ? `還有 ${left.length} 處：${left.slice(0, 6).join("；")}` : ok(true, "中英字串、牌文、規則頁都沒有舊名");
}));

check("效果沒變：四張改名牌的中文牌文跟 #85 之前一字不差", gate(() => {
  const bad = Object.entries(TEXT_ZH).filter(([id, t]) => card(id).text !== t).map(([id, t]) => `${id}：「${card(id).text}」（應為「${t}」）`);
  return bad.length ? bad.join("；") : ok(true, "四張的牌文都沒變");
}));

test("cards85", () => {
  const s = summary();
  for (const p of R.pass) console.log(`  ✓ ${p.label}${p.msg ? " — " + p.msg : ""}`);
  for (const t of s.todos) console.log(`  … ${t.label} — ${t.msg}`);
  for (const x of s.failures) console.log(`  ✗ ${x.label} — ${x.msg}`);
  console.log(`  通過 ${s.pass} / 失敗 ${s.fail} / 尚未實作 ${s.todo}`);
  assert.equal(s.fail, 0, s.failures.map((x) => `${x.label}: ${x.msg}`).join("\n"));
});
