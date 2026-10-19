// The turn card as a newspaper (issue #64, design 甲 「選戰日報」), as far as node can see it. Orchestrator's file: a
// peer may run it and falsify against it, and does not edit it. The look (sizes, the double rule, square corners) and
// the fit on a phone and a desk are measured in a browser (tools/turncard64.mjs); when it shows and how it leaves stay
// #44's (tests/turncard.test.js, tools/turncard44.mjs), and so do its data-* hooks.
//
//   node --test tests/turncard64.test.js      (or `npm test`)
//
// Owner, 2026-10-17, of three newspaper designs for the turn card (the canvas 「回合簡報 · 報紙版」): 「甲」. Contract,
// screen(session, lang, { turnCard: true }) at the start of every turn, Chinese and English:
//   - a masthead [data-masthead]: 「選戰日報」 in Chinese; in English a paper's name in Latin letters (no Chinese);
//   - a dateline [data-dateline] with this turn's date (election day 2000-03-18 minus (9 − turn) × 14 days, written
//     early / mid / late month as today, the day itself on turn 9); the card still says which turn of 9 it is and how
//     many weeks are left (「今天開票」 / "Election day" on turn 9);
//   - when there is a headline ([data-headline], #44's choice of card), its title [data-hl-title] is one sentence:
//     Chinese 「{誰}打出{牌名}」 for a card played as an event, 「{誰}觸發{牌名}」 for a triggered one; English names the
//     candidate and the card; and its caption [data-hl-text] carries the card's effect, the same words its card face
//     shows in that language;
//   - the order [data-tc-order data-order="k1,k2,k3"]: this turn's order from the log (fewest votes first), the three
//     short names written in that order;
//   - the nine-turn calendar: nine [data-tc-step="1".."9"] in order, data-state "past" before this turn, "now" on it,
//     "far" after; the debate (6) and election day (9) named on the card;
//   - the special turns keep their words: turn 1 the start of the race, turn 6 the debate and its three issues, turn 9
//     the four steps of election day and the dark card (#44).
// Since #64 landed (b931579), a card without a masthead is a failure (it reported 尚未實作 before).
// v0.8 (#81, no momentum): once the Chinese 楊吉雄爆料 says 士氣, election day's first step is 「記下領先的議題，然後議題歸零」 /
// "Issue leads are recorded" (the vault's v0.8 draft); the other three steps stay.
import test from "node:test";
import assert from "node:assert/strict";
import { R, section, check, ok, nonEmpty, summary } from "./harness.js";
import * as D from "./driver.js";
import * as S from "../public/solo.js";
import { bind } from "../public/table.js";
import { EVENTS } from "../public/shared/cards.js";

const KEYS = ["chen", "soong", "lien"];
const SHORT_ZH = { chen: "陳", soong: "宋", lien: "連" };
const SHORT_EN = { chen: "Chen", soong: "Soong", lien: "Lien" };
// Written out here from the rulebook: 9 turns, two weeks apart, turn 9 = 18 March 2000; 1–10 early, 11–20 mid, after late.
const DATE_ZH = { 1: "1999 年 11 月下旬", 2: "1999 年 12 月中旬", 3: "1999 年 12 月下旬", 4: "2000 年 1 月上旬", 5: "2000 年 1 月下旬", 6: "2000 年 2 月上旬", 7: "2000 年 2 月中旬", 8: "2000 年 3 月上旬", 9: "2000 年 3 月 18 日" };
const DATE_EN = { 1: "Late November 1999", 2: "Mid December 1999", 3: "Late December 1999", 4: "Early January 2000", 5: "Late January 2000", 6: "Early February 2000", 7: "Mid February 2000", 8: "Early March 2000", 9: "18 March 2000" };
// The special turns' words as the game has them since #44 (copied here, not read from the strings).
const T1_ZH = "九個回合，每回合約兩週。2000 年 3 月 18 日開票，票多的人當選。";
const T6_ZH = "這回合不發牌、不出手牌。三人同時翻出前五回合留下的牌，在三個議題上比 CP。";
const V08 = (EVENTS.find((e) => e.id === "yang_exposes")?.text || "").includes("士氣");
const T9_ZH = [V08 ? "記下領先的議題，然後議題歸零" : "記下動能與領先的議題，然後歸零", "票數由少到多，少的先催票", "各自翻出留下的 4 張牌催票", "棄保、背書，然後計票"];
const T1_EN = "Nine turns, about two weeks each.";
const T6_EN = "No cards are dealt or played this turn.";
// #98 (orchestrator, after #97's wording pass): 棄保 is "Strategic voting" in English, as on the rules page and election
// night; "Tactical voting" here was the one left.
const T9_EN = [V08 ? "Issue leads are recorded" : "Momentum and issue leads are recorded", "Canvassing goes by votes, fewest first", "Each reveals their 4 kept cards", "Strategic voting, endorsements, then the count"];
const T9_LEGACY = "Tactical voting, endorsements, then the count";
const ISSUES = ["cross", "clean", "econ"];

// Solo games stepped one move at a time; each state right after a turn's log entry is written (as tests/turncard).
function turnStarts() {
  const out = [];
  for (const [seat, seed] of [[0, 6401], [1, 6402], [2, 6403]]) {
    let s = S.newSolo({ seat, level: 2, seed });
    const R1 = D.rng(seed);
    const grab = (x, before) => { if (x.st.log.slice(before).some((e) => e.t === "turn")) out.push({ s: x, where: `seat ${seat} seed ${seed} 第 ${x.st.turn} 回合` }); };
    grab(s, 0);
    for (let n = 0; n < 4000 && s.st.phase !== "end"; n++) {
      const before = s.st.log.length;
      if (S.botsToMove(s).length) s = S.stepBot(s);
      else { const ch = S.choices(s, "zh-Hant"); if (!ch.length) break; s = S.act(s, ch[Math.floor(R1() * ch.length)].move); }
      grab(s, before);
    }
  }
  return out;
}
const POOL = turnStarts();
const LANGS = [["zh-Hant", "中文"], ["en", "英文"]];
const X = { "zh-Hant": bind("zh-Hant"), en: bind("en") };

const tags = (html, name) => [...html.matchAll(new RegExp(`<[a-zA-Z][^<>]*?\\s${name}(?:="([^"]*)")?(?=[\\s/>])[^<>]*>`, "g"))].map((m) => ({ tag: m[0], v: m[1], at: m.index }));
const attr = (tag, name) => { const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`)); return m ? m[1] : null; };
const decode = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&amp;/g, "&");
// The markup of the first element carrying the attribute, up to its own closing tag.
function element(html, name) {
  const t = tags(html, name)[0];
  if (!t) return null;
  const tn = t.tag.match(/^<([a-zA-Z0-9-]+)/)[1].toLowerCase();
  const re = new RegExp(`<(/?)${tn}(?=[\\s>/])[^<>]*>`, "gi");
  re.lastIndex = t.at + t.tag.length;
  let depth = 1, m;
  while ((m = re.exec(html))) { if (m[1]) depth--; else if (!/\/>$/.test(m[0])) depth++; if (!depth) return html.slice(t.at, m.index + m[0].length); }
  return html.slice(t.at);
}
const text = (h) => (h == null ? null : decode(h.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim());
const squash = (s) => (s == null ? null : s.replace(/\s+/g, ""));
const card = (p, lang) => element(S.screen(p.s, lang, { turnCard: true }), "data-turncard");
const entryOf = (p) => p.s.st.log.filter((e) => e.t === "turn" && e.turn === p.s.st.turn).pop();

const gate = (fn) => () => {
  const ne = nonEmpty(POOL.length, "回合開始的局面"); if (ne !== true) return ne;
  if (!POOL.some((p) => tags(S.screen(p.s, "zh-Hant", { turnCard: true }), "data-turncard").length)) return "畫面沒有 data-turncard（#44 已上線，這是退步）";
  if (!POOL.some((p) => tags(card(p, "zh-Hant") || "", "data-masthead").length)) return "開場卡沒有報頭（data-masthead）了（#64 已上線，這是退步，不是尚未實作）";
  return fn();
};

section("64 開場卡 · 選戰日報（甲）");

check("報頭：中文是「選戰日報」，英文是一個英文報名（拉丁字母、沒有中文字）", gate(() => {
  let n = 0, en = null;
  for (const p of POOL) for (const [lang, name] of LANGS) {
    const c = card(p, lang), m = text(element(c, "data-masthead"));
    if (m == null) return `${p.where}（${name}）：沒有報頭`;
    if (lang === "zh-Hant" && squash(m) !== "選戰日報") return `${p.where}：中文報頭是「${m}」，應為「選戰日報」`;
    if (lang === "en" && (!/[A-Za-z]{3}/.test(m) || /[㐀-鿿]/.test(m))) return `${p.where}：英文報頭是「${m}」`;
    if (lang === "en") en = m;
    n++;
  }
  return ok(true, `${n} 張開場卡都有報頭（英文是「${en}」）`);
}));

check("報眉：data-dateline 寫出這回合的日期（3/18 往前推兩週一回合；上、中、下旬；第 9 回合寫日子）；卡上寫出第幾回合、離投票日幾週", gate(() => {
  const seen = new Set();
  for (const p of POOL) for (const [lang, name] of LANGS) {
    const n = p.s.st.turn, c = card(p, lang), dl = text(element(c, "data-dateline")), all = squash(text(c));
    const want = lang === "en" ? DATE_EN[n] : DATE_ZH[n];
    if (dl == null) return `${p.where}（${name}）：沒有 data-dateline`;
    if (!squash(dl).includes(squash(want))) return `${p.where}（${name}）：報眉是「${dl}」，應寫出「${want}」`;
    const turnW = lang === "en" ? `Turn ${n}` : `第 ${n} 回合`;
    const weeksW = n === 9 ? (lang === "en" ? "Election day" : "今天開票") : lang === "en" ? `${(9 - n) * 2} weeks to election day` : `離投票日還有 ${(9 - n) * 2} 週`;
    for (const w of [turnW, weeksW]) if (!all.includes(squash(w))) return `${p.where}（${name}）：卡上沒有「${w}」`;
    seen.add(n);
  }
  const r = nonEmpty(seen.size >= 9 ? 1 : 0, `九個回合都取樣到（只有 ${[...seen].sort().join(",")}）`); if (r !== true) return r;
  return ok(true, `九個回合、兩種語言的報眉都對`);
}));

check("頭條標題：中文「{誰}打出{牌名}」或「{誰}觸發{牌名}」，英文寫出候選人與牌名；圖說寫出那張牌的效果（跟牌面上的字一樣）", gate(() => {
  let some = 0;
  for (const p of POOL) for (const [lang, name] of LANGS) {
    const c = card(p, lang), h = tags(c, "data-headline")[0];
    if (!h) continue;
    const id = h.v, how = attr(h.tag, "data-how"), who = attr(h.tag, "data-who"), x = X[lang];
    const title = text(element(c, "data-hl-title")), cap = text(element(c, "data-hl-text"));
    if (title == null) return `${p.where}（${name}）：頭條沒有 data-hl-title`;
    if (lang === "zh-Hant") {
      const want = SHORT_ZH[who] + (how === "event" ? "打出" : "觸發") + x.card(id);
      if (squash(title) !== squash(want)) return `${p.where}：頭條標題是「${title}」，應為「${want}」`;
    } else if (!title.includes(x.card(id)) || !title.includes(SHORT_EN[who])) return `${p.where}（英文）：頭條標題「${title}」沒有寫出 ${SHORT_EN[who]} 與「${x.card(id)}」`;
    if (cap == null) return `${p.where}（${name}）：頭條沒有 data-hl-text`;
    if (!squash(cap).includes(squash(x.cardText(id)))) return `${p.where}（${name}）：圖說「${cap}」沒有寫出牌面的效果「${x.cardText(id)}」`;
    some++;
  }
  const r = nonEmpty(some, "有頭條的開場卡"); if (r !== true) return r;
  return ok(true, `${some} 張有頭條的開場卡（兩種語言），標題與圖說都對`);
}));

check("出場順序：data-tc-order 照這回合紀錄的順序（票少的先），三個名字照這個順序寫", gate(() => {
  let n = 0;
  for (const p of POOL) for (const [lang, name] of LANGS) {
    const e = entryOf(p);
    if (!e || !Array.isArray(e.order)) continue;
    const el = element(card(p, lang), "data-tc-order");
    if (el == null) return `${p.where}（${name}）：沒有 data-tc-order`;
    const keys = e.order.map((i) => KEYS[i]);
    if (attr(el.match(/^<[^>]*>/)[0], "data-order") !== keys.join(",")) return `${p.where}（${name}）：data-order 是「${attr(el.match(/^<[^>]*>/)[0], "data-order")}」，應為 ${keys.join(",")}`;
    const t = text(el), shorts = keys.map((k) => (lang === "en" ? SHORT_EN[k] : SHORT_ZH[k])), at = shorts.map((s) => t.indexOf(s));
    if (at.some((i) => i < 0) || !(at[0] < at[1] && at[1] < at[2])) return `${p.where}（${name}）：順序「${t}」沒有照 ${shorts.join(" → ")} 寫`;
    n++;
  }
  const r = nonEmpty(n, "紀錄裡有順序的回合"); if (r !== true) return r;
  return ok(true, `${n} 張開場卡的出場順序都對`);
}));

check("選戰行事曆：九格 data-tc-step 1–9 照順序，之前 past、這回合 now、之後 far；卡上寫出政見發表會與投票", gate(() => {
  let n = 0;
  for (const p of POOL) for (const [lang, name] of LANGS) {
    const c = card(p, lang), t = p.s.st.turn, steps = tags(c, "data-tc-step");
    if (steps.map((s) => s.v).join() !== "1,2,3,4,5,6,7,8,9") return `${p.where}（${name}）：行事曆是「${steps.map((s) => s.v).join()}」`;
    for (const s of steps) {
      const i = Number(s.v), want = i < t ? "past" : i === t ? "now" : "far";
      if (attr(s.tag, "data-state") !== want) return `${p.where}（${name}）：第 ${i} 格是 ${attr(s.tag, "data-state")}，應為 ${want}`;
    }
    const all = squash(text(c));
    for (const w of lang === "en" ? ["Debate", "Vote"] : ["政見發表會", "投票"]) if (!all.includes(w)) return `${p.where}（${name}）：卡上沒有「${w}」`;
    n++;
  }
  return ok(true, `${n} 張開場卡的行事曆都對`);
}));

check("特別回合：第 1 回合寫選戰開跑、第 6 回合寫政見發表會與三個議題、第 9 回合寫投票日四步而且是深色版", gate(() => {
  const seen = { 1: 0, 6: 0, 9: 0 };
  for (const p of POOL) for (const [lang, name] of LANGS) {
    const t = p.s.st.turn;
    if (!(t in seen)) continue;
    const c = card(p, lang), all = squash(text(c)), en = lang === "en";
    const want = t === 1 ? [en ? T1_EN : T1_ZH] : t === 6 ? [en ? T6_EN : T6_ZH] : en ? T9_EN : T9_ZH;
    if (en && t === 9 && all.includes(squash(T9_LEGACY))) return "第 9 回合的英文寫回 Tactical voting：#98 已上線（beacb2c），規則頁是 Strategic voting，這是退步";
    for (const w of want) if (!all.includes(squash(w))) return `${p.where}（${name}）：卡上沒有「${w}」`;
    if (t === 6) for (const k of ISSUES) if (!c.includes(`art/issues/${k}.webp`)) return `${p.where}（${name}）：第 6 回合沒有議題「${k}」的圖`;
    if (t === 9 && !/\sclass="[^"]*\bdark\b/.test(c.match(/^<[^>]*>/)[0])) return `${p.where}（${name}）：第 9 回合不是深色版`;
    seen[t]++;
  }
  for (const k of [1, 6, 9]) { const r = nonEmpty(seen[k], `第 ${k} 回合的開場卡`); if (r !== true) return r; }
  return ok(true, `第 1 回合 ${seen[1]} 張、第 6 回合 ${seen[6]} 張、第 9 回合 ${seen[9]} 張都對`);
}));

test("turncard64", () => {
  const s = summary();
  for (const p of R.pass) console.log(`  ✓ ${p.label}${p.msg ? " — " + p.msg : ""}`);
  for (const t of s.todos) console.log(`  … ${t.label} — ${t.msg}`);
  for (const x of s.failures) console.log(`  ✗ ${x.label} — ${x.msg}`);
  console.log(`  通過 ${s.pass} / 失敗 ${s.fail} / 尚未實作 ${s.todo}`);
  assert.equal(s.fail, 0, s.failures.map((x) => `${x.label}: ${x.msg}`).join("\n"));
});
