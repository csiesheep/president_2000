// The words of rulebook v0.5 (issue #52): the rules page, the help and the lines a v0.5 game shows, and the nine
// rewritten cards, as far as node can see them. Orchestrator's file: a peer may run it and falsify against it, and does
// not edit it. Whether the prose reads well is checked by reading it.
//
//   node --test tests/rulestext.test.js      (or `npm test`)
//
// History: #35 (rulebook v0.4: the national media box) checked the media words; the owner then moved the game to v0.5,
// 「改成 v0.5」 (2026-10-15, after the #49 simulations), so those checks are replaced by these. Contract, both languages:
//   - no ads and no media anywhere (Chinese 廣告 / 媒體; English "ad(s)", "advert…", "media"), except the strings only a
//     game saved before the switch (v0.4) can show, listed in V04_ONLY, and the card names 黨產廣告 / Party-Assets Ads /
//     Massive Ad Buy;
//   - the rules page describes v0.5: the 議題總領先者 (most cubes over the three issues), its +1 momentum and the swap
//     in the momentum phase; 連 starts with 2 cubes on 經濟民生 (the candidates' table: a 起始議題 row);
//   - the momentum help line (ui.solo.help.mom) speaks of the issue leader;
//   - the nine media cards read as in the rulebook v0.5 (§十四), word for word in Chinese, and say "issue" in English;
//   - strings nobody uses since #29–#34 are gone (or used again): see UNUSED.
// Then the owner moved on to v0.6, 「v0.6 4a」 (2026-10-16, #56): the rules page and every string a v0.6 game shows no
// longer speak of 封鎖, 地方大老, 主動權, 進位, 議題交換 or the first strategic vote — except the strings only a game saved on
// v0.5 shows (V05_ONLY); the rules page says each turn's order goes by votes, fewest first, that the issue cards are
// reordered at random, and that slot 2 gives an endorsement. Those checks report 尚未實作 until the Chinese rules page
// says 由少到多. The v0.5 check about the issue leader no longer asks for the swap (v0.6 has none).
// The v0.5 checks report 尚未實作 until the Chinese rules page says 議題總領先者.
// Then v0.7, 「丙 + v0.7」 (2026-10-16, #59): luck instead of the bag and the rest cubes. No string speaks of the bag or the
// rest cubes (Chinese 袋 / 休息方塊 / 休息區 / 補袋; English bag(s), rest cube(s), rest area) except the ones only a game
// saved on v0.6 or before shows (V06_ONLY); the twelve rewritten cards read as in the rulebook v0.7 (§十四), word for word in
// Chinese (CARD_TEXT_V07), the nine luck cards say "luck" in English; the rules page has luck 50/50/60, 我 ÷（我 + 對手）,
// 20%–80%, and the canvassing luck with 領先的議題 and 95%; the candidates' table has 連's 4 CP and a starting-luck row;
// 連's blurb speaks of his 60 % luck. Those report 尚未實作 until the Chinese rules page says 運氣. Three of the nine v0.5
// cards change again on v0.7 (張榮發挺扁, 省府舊部, 張昭雄的醫界): once the v0.7 gate is open the v0.5 row reads them from
// CARD_TEXT_V07.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { R, section, check, ok, summary } from "./harness.js";
import zh from "../public/i18n/zh-Hant.js";
import en from "../public/i18n/en.js";
import { EVENTS } from "../public/shared/cards.js";

const flat = (o, p = "", out = []) => {
  if (typeof o === "string") { out.push([p, o]); return out; }
  if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) flat(v, p ? `${p}.${k}` : k, out);
  return out;
};
const LANGS = [["zh", zh], ["en", en]];
const rulesOf = (d) => flat(d.rules, "rules");
const all = (d) => rulesOf(d).map(([, v]) => v).join("\n");
// Strings only a v0.4 game (saved before the switch) shows: its ad and media choices, lines, and table talk.
const V04_ONLY = new Set([
  "ui.solo.map.media", "ui.solo.map.national", "ui.solo.r.mediaBonus", "ui.solo.r.p.adOk", "ui.solo.r.p.adFail", "ui.solo.r.p.media",
  "ui.solo.r.p.mediaRemove", "ui.solo.p.ads", "ui.solo.p.media", "ui.solo.p.fxMedia", "ui.solo.p.fxMediaRemove", "ui.solo.o.kind.ads",
  "ui.solo.o.kind.adsNoRate", "ui.solo.o.ad", "ui.solo.o.mediaPlace", "ui.solo.o.mediaRemove", "ui.solo.f.adOk", "ui.solo.f.adFail",
  "ui.solo.f.mediaPlace", "ui.solo.f.mediaRemove", "terms.media", "talk.advertise", "talk.ad_roll", "talk.ads_done", "talk.media_lead",
  "talk.media_cut", "talk.effect_media",
]);
// The twelve cards, rulebook v0.7 §十四 (copied by hand from the vault's rulebook).
const CARD_TEXT_V07 = {
  chang_yung_fa: "任一議題陳 +1；陳運氣 +10%",
  chang_chiu: "陳運氣 +10%；陳動能 +1",
  million_signatures: "宋運氣 +10%；宋動能 +1",
  provincial_staff: "本回合連的運氣當作 50%；任一議題宋 +1",
  lee_authorized: "僅在「楊吉雄爆料」出過後可當事件出：宋在任 2 個縣市各 +1 免檢定；清廉議題宋 +1",
  chang_doctors: "任一議題宋 +1；宋運氣 +10%",
  military_civil: "宋在任 2 個縣市各 +1 需檢定；宋運氣 +10%",
  yang_exposes: "宋移除 4 顆盤上方塊（連選）；宋失去清廉議題全部方塊；宋動能歸零",
  shifting_story: "僅在「李登輝授意說」出過後可當事件出：宋移除 2 顆盤上方塊（連選）；連動能 +1",
  local_factions: "連運氣 +10%",
  party_congress: "連運氣 +10%；連動能 +1",
  econ_cabinet: "經濟議題連 +1；連運氣 +10%",
};
const NAMES = /黨產廣告|Party-Assets Ads|Massive Ad Buy/g;
const FORBID = { zh: /廣告|媒體/, en: /\bads?\b|advert|\bmedia\b/i };
// The nine cards, rulebook v0.5 §十四 (copied by hand from the vault's rulebook).
const CARD_TEXT = {
  lo_propaganda: "任一議題陳 +2",
  hsieh_kaohsiung: "高雄市 +2 免檢定；任一議題陳 +1",
  advisory_group: "清廉、經濟議題陳各 +1；任一議題陳 +1",
  chang_yung_fa: "任一議題陳 +1；袋中 +2 陳方塊",
  provincial_staff: "本回合連的休息方塊加成無效；任一議題宋 +1",
  chang_doctors: "任一議題宋 +1；袋中 +2 宋方塊",
  expel_soong: "宋在任一議題 −2；宋動能 +1",
  party_assets_ads: "任一議題連 +2",
  massive_ads: "任一議題連 +3",
};
// Keys nobody reads after #29 (the end page) and #34 (media without regions). Each must be gone, or used again.
const UNUSED = ["ui.solo.p.fxMedia", "ui.solo.p.fxMediaRemove", "ui.solo.end.kicker", "ui.solo.end.elected", "ui.solo.end.youWon", "ui.solo.end.youLost", "ui.solo.end.unit", "ui.solo.end.emptyLeft", "ui.solo.end.history"];
const get = (d, path) => path.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), d);
const SRC = readdirSync(new URL("../public/", import.meta.url)).filter((f) => f.endsWith(".js")).map((f) => readFileSync(new URL(`../public/${f}`, import.meta.url), "utf8")).join("\n");
const gate = (fn) => () => (/議題總領先者/.test(all(zh)) ? fn() : "TODO: 規則頁還是 v0.4（沒有「議題總領先者」，#52）");

section("52 規則與文字 v0.5");

check("沒有廣告也沒有媒體：中英所有字串（只有 v0.4 舊局才會用到的那些除外），連同九張牌的中文牌文", gate(() => {
  const left = [];
  for (const [lang, d] of LANGS) for (const [k, v] of flat(d)) {
    if (V04_ONLY.has(k)) continue;
    const m = v.replace(NAMES, "").match(FORBID[lang]);
    if (m) left.push(`${lang} ${k}：「${v.slice(Math.max(0, m.index - 12), m.index + 16)}」`);
  }
  for (const e of EVENTS) { const m = e.text.match(FORBID.zh); if (m) left.push(`牌文 ${e.id}：「${e.text}」`); }
  return left.length ? `還有 ${left.length} 處：${left.slice(0, 6).join("；")}${left.length > 6 ? "…" : ""}` : ok(true, "中英字串與牌文都沒有廣告、媒體");
}));

check("規則頁講 v0.5：議題總領先者（三個議題的總數）、動能結算裡它 +1 動能（中英）", gate(() => {
  const z = all(zh), e = all(en);
  if (!/總數/.test(z)) return "zh 規則頁沒寫出議題總領先者看的是「總數」";
  if (!/議題總領先者[^。]{0,30}\+?1 動能/.test(z)) return "zh 規則頁找不到「議題總領先者 +1 動能」";
  if (!/(most|total|overall)[^.]{0,60}issues|issues?[^.]{0,60}(most|total|overall)/i.test(e)) return "en 規則頁沒寫出 issue leader 看三個議題的總數";
  if (!/\+?1 momentum/i.test(e)) return "en 規則頁找不到 +1 momentum";
  return ok(true, "中英都有議題總領先者、總數、+1 動能");
}));

check("候選人表與開局：連起始在經濟民生議題 2 顆（起始議題那一列）（中英）", gate(() => {
  for (const [lang, d] of LANGS) {
    const rows = rulesOf(d).filter(([k]) => /table\.rows\.\d+\.\d+$/.test(k));
    const label = rows.find(([, v]) => (lang === "zh" ? /起始議題/ : /start/i).test(v) && (lang === "zh" || /issue/i.test(v)));
    if (!label) return `${lang} 候選人表找不到起始議題那一列`;
    const row = label[0].replace(/\.\d+$/, "");
    const cells = rows.filter(([k]) => k.startsWith(row + ".") && k !== label[0]).map(([, v]) => v);
    if (!cells.some((c) => (lang === "zh" ? /經濟民生/ : /econom/i).test(c) && /2/.test(c))) return `${lang} 起始議題那一列沒有經濟民生 2：${cells.join(" / ")}`;
  }
  return ok(true, "中英候選人表：連起始經濟民生 2");
}));

check("動能的說明（ui.solo.help.mom）講議題總領先者（中英）", gate(() => {
  for (const [lang, d] of LANGS) {
    const v = get(d, "ui.solo.help.mom") || "";
    if (!(lang === "zh" ? /議題總領先者/ : /issue/i).test(v)) return `${lang} help.mom 沒講議題總領先者：「${v.slice(0, 80)}」`;
  }
  return ok(true, "中英的動能說明都講議題總領先者");
}));

check("九張改寫的牌：中文牌文照規則書 v0.5 §十四一字不差；英文寫 issue", gate(() => {
  const bad = [];
  for (const [id, want] of Object.entries(CARD_TEXT)) {
    const c = EVENTS.find((e) => e.id === id);
    if (!c) { bad.push(`${id} 不在牌庫`); continue; }
    const w = /運氣/.test(all(zh)) && CARD_TEXT_V07[id] ? CARD_TEXT_V07[id] : want;
    if (c.text !== w) bad.push(`${id}：「${c.text}」（${w}）`);
    const t = get(en, `cards.${id}.text`) || "";
    if (!/issue/i.test(t)) bad.push(`${id} 英文：「${t}」沒寫 issue`);
  }
  return bad.length ? bad.join("；") : ok(true, "九張中英牌文都對");
}));

check("沒人用的字串拿掉了：#29–#34 之後沒人讀的 key 不在字典裡（或又被用了）", () => {
  const left = [];
  for (const [lang, d] of LANGS) for (const k of UNUSED) {
    if (get(d, k) === undefined) continue;
    const short = k.split(".").slice(-2).join(".");
    // Used = its last two parts appear as a path (x.tr("end.kicker"), S.end.kicker); ".kicker" alone matches other kickers (checker, #35).
    if (!SRC.includes(short)) left.push(`${lang} ${k}`);
  }
  return left.length ? `還在、也沒人用：${left.join("、")}` : ok(true, `${UNUSED.length} 個 key 都處理了`);
});

// ---------------------------------------------------------------- v0.6 (#56)
// Strings only a game saved on v0.5 shows (its order, block and swap choices and lines, the initiative in its header,
// turn card and lines, the first strategic vote's line, its table talk).
const V05_ONLY = new Set([
  "ui.solo.o.playBlock", "ui.solo.f.block", "talk.block_trigger", "ui.solo.map.boss", "terms.boss", "terms.initiative",
  "ui.solo.p.order", "ui.solo.p.orderElection", "ui.solo.p.swap", "ui.solo.o.swap", "ui.solo.o.noswap", "ui.solo.f.swap",
  "talk.swap_issue", "ui.solo.f.strategicHalf", "ui.solo.hdr.initiative", "ui.solo.hdr.star", "ui.solo.tc.initiative",
  "ui.solo.r.turn", "ui.solo.r.turnNoDeal", "ui.solo.f.turn",
]);
const FORBID6 = { zh: /封鎖|地方大老|主動權|進位|議題交換|交換相鄰|第一段棄保|第一次棄保/, en: /initiative|local boss|boss(es)?|rounds? up|swap/i };
const gate6 = (fn) => () => (/由少到多/.test(all(zh)) ? fn() : "TODO: 規則頁還是 v0.5（沒有「由少到多」，#56）");
section("56 規則與文字 v0.6");

check("沒有封鎖、地方大老、主動權、進位、議題交換、第一次棄保：中英所有字串（只有 v0.5、v0.4 舊局才會用到的那些除外）", gate6(() => {
  const left = [];
  for (const [lang, d] of LANGS) for (const [k, v] of flat(d)) {
    if (V05_ONLY.has(k) || V04_ONLY.has(k)) continue;
    const m = v.match(FORBID6[lang]);
    if (m) left.push(`${lang} ${k}：「${v.slice(Math.max(0, m.index - 12), m.index + 16)}」`);
  }
  return left.length ? `還有 ${left.length} 處：${left.slice(0, 6).join("；")}${left.length > 6 ? "…" : ""}` : ok(true, "中英字串都沒有 v0.6 拿掉的規則");
}));

// Slot 2 as a choice (v0.5): 「第二槽…或／自選／選獎勵」, "slot 2 … or / picks a reward / their choice". The words of the
// v0.5 reward choice itself (its prompt, its two options, its lines and table talk: every key named *reward*) are only
// shown by a v0.5 save. On main before #56: the tutorial's issue step, ui.solo.help.slot, the rules page (both languages).
const SLOT2_CHOICE = { zh: /(第\s*(2|二)\s*槽)[^。；]{0,16}(或|自選|選獎勵|二選一)/, en: /(slot 2|second slot)[^.;]{0,60}(\bor\b|\bpicks?\b|choose|choice)/i };
check("第二槽不再二選一：中英所有字串都沒寫第二槽是「動能或背書」（v0.5 的 reward 選項本身除外）", gate6(() => {
  const left = [];
  for (const [lang, d] of LANGS) for (const [k, v] of flat(d)) {
    if (/reward/i.test(k.split(".").pop()) || V05_ONLY.has(k)) continue;
    const m = v.match(SLOT2_CHOICE[lang]);
    if (m) left.push(`${lang} ${k}：「${v.slice(Math.max(0, m.index - 6), m.index + m[0].length + 8)}」`);
  }
  return left.length ? `還有 ${left.length} 處：${left.join("；")}` : ok(true, "中英字串的第二槽都只給背書");
}));

check("規則頁講 v0.6：順序照票數由少到多、議題槽隨機重排、第二槽給背書（不二選一）（中英）", gate6(() => {
  const z = all(zh), e = all(en);
  if (!/票數[^。]{0,30}由少到多|由少到多[^。]{0,30}票數/.test(z)) return "zh 規則頁沒寫出行動順序照票數由少到多";
  if (!/議題[^。]{0,30}隨機|隨機[^。]{0,30}議題/.test(z)) return "zh 規則頁沒寫出議題槽隨機重排";
  if (!/第二槽[^。]{0,20}背書/.test(z)) return "zh 規則頁沒寫出第二槽給背書";
  if (/第二槽[^。]{0,30}(或|自選)/.test(z)) return "zh 規則頁的第二槽還是二選一";
  if (!/fewest/i.test(e)) return "en 規則頁沒寫出 fewest votes first";
  if (!/random/i.test(e)) return "en 規則頁沒寫出議題槽隨機（random）";
  return ok(true, "中英都有票數由少到多、隨機重排、第二槽背書");
}));

section("59 規則與文字 v0.7");

// Strings only a game saved on v0.6 or before shows: the bag on the candidate panel, its help, the rest cubes on the card's
// stub, the conversion line, and the glossary word.
const V06_ONLY = new Set(["ui.solo.hdr.bag", "ui.solo.help.bag", "ui.restCubes", "ui.solo.f.convert", "ui.look.board.bag", "terms.rest"]);
const FORBID7 = { zh: /袋|休息方塊|休息區|補袋/, en: /bags?|rest[- ]cubes?|rest area/i };
const LUCK_CARDS = ["chang_yung_fa", "chang_chiu", "million_signatures", "provincial_staff", "chang_doctors", "military_civil", "local_factions", "party_congress", "econ_cabinet"];
const gate7 = (fn) => () => (/運氣/.test(all(zh)) ? fn() : "TODO: 規則頁還是 v0.6（沒有「運氣」，#59）");

check("沒有袋子也沒有休息方塊：中英所有字串、所有中文牌文（只有 v0.6 以前的舊局才會用到的那些除外）", gate7(() => {
  const left = [];
  for (const [lang, d] of LANGS) for (const [k, v] of flat(d)) {
    if (V06_ONLY.has(k)) continue;
    const m = v.match(FORBID7[lang]);
    if (m) left.push(`${lang} ${k}：「${v.slice(Math.max(0, m.index - 12), m.index + 14)}」`);
  }
  for (const c of EVENTS) { const m = (c.text || "").match(FORBID7.zh); if (m) left.push(`cards.js ${c.id}：「${c.text}」`); }
  return left.length ? `還有 ${left.length} 處：${left.slice(0, 6).join("；")}${left.length > 6 ? "…" : ""}` : ok(true, "中英字串與牌文都沒有袋子、休息方塊");
}));
check("十二張改寫的牌：中文牌文照規則書 v0.7 §十四一字不差；九張運氣牌的英文寫 luck", gate7(() => {
  const bad = [];
  for (const [id, want] of Object.entries(CARD_TEXT_V07)) {
    const c = EVENTS.find((e) => e.id === id);
    if (!c) { bad.push(`${id} 不在牌庫`); continue; }
    if (c.text !== want) bad.push(`${id}：「${c.text}」（${want}）`);
  }
  for (const id of LUCK_CARDS) { const t = get(en, `cards.${id}.text`) || ""; if (!/luck/i.test(t)) bad.push(`${id} 英文：「${t}」沒寫 luck`); }
  return bad.length ? bad.join("；") : ok(true, "十二張中文牌文都對，九張運氣牌的英文都寫 luck");
}));
check("規則頁講 v0.7：運氣 陳 50%、宋 50%、連 60%；我 ÷（我 + 對手）；20%–80%；催票運氣算領先的議題、最多 95%（中英）", gate7(() => {
  const z = all(zh), e = all(en);
  if (!/陳 ?50%[^。]{0,8}宋 ?50%[^。]{0,8}連 ?60%/.test(z)) return "zh 規則頁沒寫出開局運氣 陳 50%、宋 50%、連 60%";
  if (!/÷/.test(z) || !/對手的運氣/.test(z)) return "zh 規則頁沒寫出有特定對手時的成功率（我 ÷（我 + 對手））";
  if (!/20%[^。]{0,4}80%/.test(z)) return "zh 規則頁沒寫出運氣 20%–80%";
  if (!/催票運氣/.test(z) || !/領先的議題/.test(z) || !/95%/.test(z)) return "zh 規則頁沒寫出催票運氣（領先的議題、最多 95%）";
  if (!/luck/i.test(e) || !/÷|divided by/i.test(e) || !/95 ?%/.test(e)) return "en 規則頁沒寫出 luck、÷（divided by）或 95%";
  return ok(true, "中英都有開局運氣、對手的運氣、上下限、催票運氣與 95%");
}));
check("候選人表：連的候選人牌 4 CP，有一列起始運氣；連的簡介講 60% 的運氣（中英）", gate7(() => {
  const z = all(zh), e = all(en);
  if (!/起始運氣/.test(z) || !/startw* luck/i.test(e)) return "候選人表沒有起始運氣那一列（中：起始運氣；英：starting luck）";
  const rows = (d) => flat(d.rules, "rules").filter(([k]) => /table.rows/.test(k)).map(([, v]) => v);
  if (!rows(zh).some((v) => /^4 CP/.test(v)) || !rows(en).some((v) => /^4 CP/.test(v))) return "候選人表裡沒有一格以 4 CP 開頭（連的候選人牌）";
  const zb = get(zh, "ui.solo.cand.lien.blurb") || "", eb = get(en, "ui.solo.cand.lien.blurb") || "";
  if (!/運氣/.test(zb) || !/60%/.test(zb)) return `zh 連的簡介沒講 60% 的運氣：「${zb}」`;
  if (!/luck/i.test(eb) || !/60 ?%/.test(eb)) return `en 連的簡介沒講 60% luck：「${eb}」`;
  return ok(true, "候選人表有 4 CP 與起始運氣；連的簡介講 60%");
}));

test("rulestext", () => {
  const s = summary();
  for (const p of R.pass) console.log(`  ✓ ${p.label}${p.msg ? " — " + p.msg : ""}`);
  for (const t of s.todos) console.log(`  … ${t.label} — ${t.msg}`);
  for (const x of s.failures) console.log(`  ✗ ${x.label} — ${x.msg}`);
  console.log(`  通過 ${s.pass} / 失敗 ${s.fail} / 尚未實作 ${s.todo}`);
  assert.equal(s.fail, 0, s.failures.map((x) => `${x.label}: ${x.msg}`).join("\n"));
});
