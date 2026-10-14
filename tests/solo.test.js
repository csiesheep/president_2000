// The solo game (M3): one human against two bots, as far as node can see it. Orchestrator's file: a
// peer may run it and falsify against it, and does not edit it. What the table looks like is
// checked by opening it, not here.
//
//   node --test tests/solo.test.js      (or `npm test`)
//
// Contract (issue #12): public/solo.js exports a controller with no DOM at import time
//   newSolo({ seat, level, seed }) → session      a plain JSON object (it goes to sessionStorage)
//   advance(session) → session                    bots move until the human must act, or the end
//   choices(session, lang) → [{ move, label }]    the human's options: exactly legalMoves(st, seat)
//   act(session, move) → session                  the human's move (then the page calls advance)
//   screen(session, lang) → string                the HTML of what the human sees now
//   session.st is the engine state; lang ∈ "zh-Hant" | "en".
// Every check reports 尚未實作 until public/solo.js exists.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { R, section, check, eq, ok, nonEmpty, summary } from "./harness.js";
import * as E from "../public/shared/engine.js";
import * as C from "../public/shared/cards.js";
import zh from "../public/i18n/zh-Hant.js";
import en from "../public/i18n/en.js";
import * as D from "./driver.js";
import * as BOTS from "../public/shared/bots.js";

const CJK = /[㐀-鿿豈-﫿]/;
const FILE = new URL("../public/solo.js", import.meta.url);
let S = null, IMPORT_ERR = null;
if (existsSync(FILE)) { try { S = await import(FILE.href); } catch (e) { IMPORT_ERR = e; } }
const API = ["newSolo", "advance", "choices", "act", "screen"];
const c12 = (name, fn) => check(name, () => {
  if (!existsSync(FILE)) return "TODO: public/solo.js 還沒有（#12）";
  if (IMPORT_ERR) return `public/solo.js 在 node 裡 import 就丟錯（不能在 import 時碰 DOM）：${IMPORT_ERR.message}`;
  const miss = API.filter((k) => typeof S[k] !== "function");
  if (miss.length) return `TODO: public/solo.js 還沒有 ${miss.join("、")}（#12）`;
  return fn();
});
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const key = (m) => JSON.stringify(m);
const text = (html) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]*>/g, " ")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&amp;/g, "&")
  .replace(/\s+/g, " ");
const NAME = { "zh-Hant": ["陳水扁", "宋楚瑜", "連戰"], en: ["Chen Shui-bian", "James Soong", "Lien Chan"] };
const EV = Object.fromEntries(C.EVENTS.map((e) => [e.id, e]));
const cardName = (id, lang) => (lang === "en" ? en.cards[id].name : EV[id].name);
const cardText = (id, lang) => (lang === "en" ? en.cards[id].text : EV[id].text);
const near = (s, re) => { const m = s.match(new RegExp(`.{0,12}${re.source}.{0,12}`)); return m ? m[0] : ""; };

// Event cards the human cannot see (turns 1–5: other seats' hands and debate piles, both decks)
// whose names show up on the screen. A name that is part of a visible card's name or text is
// not counted.
function leaks(st, seat, lang, html) {
  const seen = text(html);
  const others = [0, 1, 2].filter((p) => p !== seat);
  const hidden = [...others.flatMap((p) => [...st.hands[p], ...st.savedDebate[p]]), ...st.decks.early, ...st.decks.late].filter((id) => EV[id]);
  const hiddenSet = new Set(hidden);
  const visible = C.EVENTS.filter((e) => !hiddenSet.has(e.id)).map((e) => cardName(e.id, lang) + " " + cardText(e.id, lang)).join("\n");
  return hidden.map((id) => cardName(id, lang)).filter((n) => n.length >= 2 && seen.includes(n) && !visible.includes(n));
}

// Play one solo game; the human picks a random choice. Returns { s, bad, decisions, leaks, cjk,
// live, saved }: bad is the first broken mechanic; leaks and cjk collect what the screens show that
// they should not; live and saved are the in-memory session at decision `holdAt` and its JSON.
function soloGame(seat, level, seed, lang, { holdAt = -1 } = {}) {
  let s = S.advance(S.newSolo({ seat, level, seed }));
  const R1 = D.rng(seed * 31 + seat);
  let decisions = 0, live = null, saved = null;
  const found = { leaks: [], cjk: [] };
  const done = (bad) => ({ s, bad, decisions, ...found, live, saved });
  for (let n = 0; n < 3000; n++) {
    const st = s.st;
    if (st.phase === "end") return done(null);
    const where = `${NAME["zh-Hant"][seat]} 對等級 ${level} seed ${seed} 第 ${st.turn} 回合 ${st.phase}`;
    const must = E.mustAct(st);
    if (!same(must, [seat])) return done(`${where}：advance 之後要動的是 ${JSON.stringify(must)}，不是只有人類 [${seat}]`);
    const legal = E.legalMoves(st, seat), ch = S.choices(s, lang);
    const a = new Set(legal.map(key)), b = new Set(ch.map((c) => key(c.move)));
    const missing = legal.filter((m) => !b.has(key(m))), extra = ch.filter((c) => !a.has(key(c.move)));
    if (missing.length || extra.length || ch.length !== legal.length) return done(`${where}：選項跟 legalMoves 不一樣（少 ${JSON.stringify(missing[0])}、多 ${JSON.stringify(extra[0] && extra[0].move)}、${ch.length} 對 ${legal.length}）`);
    const badLabel = ch.find((c) => typeof c.label !== "string" || !c.label.trim());
    if (badLabel) return done(`${where}：選項沒有字：${JSON.stringify(badLabel)}`);
    const html = S.screen(s, lang);
    if (typeof html !== "string" || !html.trim()) return done(`${where}：screen 回的不是 HTML`);
    if (st.turn <= 5) for (const l of leaks(st, seat, lang, html)) found.leaks.push(`${where}：${l}`);
    if (lang === "en") {
      const m = near(text(html).replace(/中文/g, "") + " | " + ch.map((c) => c.label).join(" | "), CJK);
      if (m) found.cjk.push(`${where}：${JSON.stringify(m)}`);
    }
    if (decisions === holdAt) { live = s; saved = JSON.stringify(s); }
    const pick = ch[Math.floor(R1() * ch.length)].move;
    s = S.advance(S.act(s, pick));
    decisions++;
  }
  return done(`${NAME["zh-Hant"][seat]} 對等級 ${level} seed ${seed}：3000 個決定還沒結束`);
}

section("12 單人");
const games = [];
c12("一局打到結束（人類坐三個位子、三個等級、中英都有）：每一步人類的選項就是 legalMoves、每個選項有字；advance 之後只等人類", () => {
  const out = [];
  const plan = [[0, 1, "zh-Hant"], [1, 2, "en"], [2, 3, "zh-Hant"], [0, 3, "en"]];
  for (const [seat, level, lang] of plan) {
    const g = soloGame(seat, level, 40 + seat * 7 + level, lang);
    if (g.bad) return g.bad;
    games.push({ seat, level, lang, g });
    out.push(`${NAME["zh-Hant"][seat]} 對等級 ${level}（${lang}）${g.decisions} 個決定`);
  }
  return ok(true, out.join("；"));
});
c12("不偷看：第 1–5 回合的每一個畫面，都沒有別人手牌、別人的政見發表會堆、牌庫裡的牌名", () => {
  if (games.length !== 4) return "上一條沒跑完";
  const all = games.flatMap((x) => x.g.leaks);
  if (all.length) return `${all.length} 處：${all.slice(0, 3).join("；")}`;
  return ok(true, `4 局 ${games.reduce((a, x) => a + x.g.decisions, 0)} 個畫面`);
});
c12("英文：英文局的每一個畫面與選項都沒有中文字（語言切換鈕的「中文」除外）", () => {
  if (games.length !== 4) return "上一條沒跑完";
  const enGames = games.filter((x) => x.lang === "en");
  const all = enGames.flatMap((x) => x.g.cjk);
  if (all.length) return `${all.length} 處：${all.slice(0, 3).join("；")}`;
  return ok(true, `${enGames.length} 局英文 ${enGames.reduce((a, x) => a + x.g.decisions, 0)} 個畫面`);
});
c12("結束畫面：寫出當選人的名字與三人的票數（方塊數）", () => {
  if (games.length !== 4) return "上一條沒跑完";
  const out = [];
  for (const { seat, level, lang, g } of games) {
    const r = g.s.st.result;
    if (!r) return `${NAME["zh-Hant"][seat]} 對等級 ${level}：結束了卻沒有 st.result`;
    const seen = text(S.screen(g.s, lang));
    if (!seen.includes(NAME[lang][r.winner])) return `${lang} 結束畫面沒有當選人的名字 ${NAME[lang][r.winner]}`;
    const miss = r.votes.filter((v) => !new RegExp(`(^|\\D)${v}(\\D|$)`).test(seen));
    if (miss.length) return `${lang} 結束畫面少了票數 ${miss.join("、")}（全部 ${r.votes.join("/")}）`;
    out.push(`${lang} ${NAME[lang][r.winner]} ${r.votes.join("/")}`);
  }
  return ok(true, out.join("；"));
});
// Level 1 is in here on purpose: levels 2 and 3 hardly ever draw from their rng, so a bot rng
// kept outside the session only shows up with level 1 (found by the FE peer, #12).
c12("存檔：中途的 session 存成 JSON 再讀回來（sessionStorage），畫面一樣；用同樣的選擇接著打，結果跟沒存過一樣（三個存檔點，含等級 1）", () => {
  const out = [];
  for (const [seat, level, seed, holdAt] of [[1, 1, 77, 5], [2, 1, 90, 20], [1, 2, 77, 60]]) {
    const a = soloGame(seat, level, seed, "zh-Hant", { holdAt });
    if (a.bad) return a.bad;
    if (!a.saved) return `等級 ${level} seed ${seed} 這局不到 ${holdAt} 個決定，沒有存檔可比`;
    const back = JSON.parse(a.saved);
    let x = eq(S.screen(back, "zh-Hant") === S.screen(a.live, "zh-Hant"), true, `等級 ${level} 第 ${holdAt} 個決定：讀回來的畫面跟存之前一樣`); if (x !== true) return x;
    const run = (s) => {
      const R2 = D.rng(5);
      for (let n = 0; n < 3000 && s.st.phase !== "end"; n++) { const ch = S.choices(s, "zh-Hant"); s = S.advance(S.act(s, ch[Math.floor(R2() * ch.length)].move)); }
      return s;
    };
    const e1 = run(a.live), e2 = run(back);
    x = eq(same(e1.st, e2.st), true, `等級 ${level} seed ${seed}：沒存過與存過再讀回，從第 ${holdAt} 個決定接著打到的結束狀態`); if (x !== true) return x;
    out.push(`等級 ${level} 第 ${holdAt} 個決定 → ${e1.st.result.votes.join("/")}`);
  }
  return ok(true, out.join("；"));
});

// ---- 軍師（#18）. solo.js also exports setAdvisor(session, on) → session; the switch lives in the
// session, so a reload keeps it (owner: 「Game page 上方有開關 for 軍師模式」). With it on, at every
// human decision choices() marks exactly one option advised: true, the move
// bots.advise(E.view(st, seat), E.legalMoves(st, seat)) picks, and screen() shows the reason: the
// line talk[why.key] with its placeholders filled (not for only_move). Off: nothing marked.
const ADV = !!(S && typeof S.setAdvisor === "function");
const c18 = (name, fn) => c12(name, () => (ADV ? fn() : "TODO: solo.js 還沒有 setAdvisor（#18）"));
// The longest fixed piece of a talk line (what is left when the placeholders are cut out).
const literal = (tpl) => String(tpl).split(/\{\w+\}/).map((x) => x.trim()).filter((x) => x.length >= 2).sort((a, b) => b.length - a.length)[0] || "";
section("18 軍師（單人）");
c18("開著時，每個決定剛好一個選項標 advised，就是 bots.advise 選的那一步；畫面有理由（talk 那一句、佔位字填好）；關著時都沒有標", () => {
  const out = [];
  for (const [lang, t, seat, seed] of [["zh-Hant", zh, 1, 61], ["en", en, 2, 64]]) {
    let s = S.setAdvisor(S.advance(S.newSolo({ seat, level: 2, seed })), true);
    let checked = 0, reasons = 0;
    const R1 = D.rng(seed);
    for (let n = 0; n < 3000 && s.st.phase !== "end"; n++) {
      const st = s.st;
      const ch = S.choices(s, lang);
      const marked = ch.filter((c) => c.advised === true);
      const want = BOTS.advise(E.view(st, seat), E.legalMoves(st, seat));
      const where = `${lang} 第 ${st.turn} 回合 ${st.phase}`;
      if (marked.length !== 1) return `${where}：標 advised 的選項有 ${marked.length} 個`;
      if (!same(marked[0].move, want.move)) return `${where}：標的是 ${JSON.stringify(marked[0].move)}，軍師選的是 ${JSON.stringify(want.move)}`;
      if (want.why.key !== "only_move") {
        const seen = text(S.screen(s, lang)), lit = literal(t.talk[want.why.key]);
        if (lit && !seen.includes(lit)) return `${where}：畫面沒有軍師的理由（${want.why.key}：「${lit}」）`;
        const hole = seen.match(/.{0,10}\{\w+\}.{0,10}/);
        if (hole) return `${where}：畫面有沒填的佔位字：${hole[0]}`;
        reasons++;
      }
      checked++;
      s = S.advance(S.act(s, ch[Math.floor(R1() * ch.length)].move));
    }
    const r = nonEmpty(reasons, `${lang} 有理由的決定`); if (r !== true) return r;
    out.push(`${lang} ${checked} 個決定、${reasons} 句理由`);
  }
  let s = S.setAdvisor(S.advance(S.newSolo({ seat: 0, level: 1, seed: 62 })), false);
  for (let n = 0; n < 60 && s.st.phase !== "end"; n++) {
    const ch = S.choices(s, "zh-Hant");
    if (ch.some((c) => c.advised)) return `軍師關著，第 ${s.st.turn} 回合 ${s.st.phase} 卻有選項標 advised`;
    s = S.advance(S.act(s, ch[0].move));
  }
  return ok(true, out.join("；") + "；關著時 60 個決定都沒有標");
});
c18("開關跟著存檔：開著的 session 存成 JSON 再讀回來，仍然只標一個 advised", () => {
  const s = S.setAdvisor(S.advance(S.newSolo({ seat: 2, level: 1, seed: 63 })), true);
  const back = JSON.parse(JSON.stringify(s));
  const r = eq(S.choices(back, "zh-Hant").filter((c) => c.advised).length, 1, "讀回來之後標 advised 的選項數"); if (r !== true) return r;
  return ok(true, "開關存在 session 裡");
});

// ---- 玩起來看得懂（#23）. Owner (2026-10-14): 「Try to improve the UI as a real human user
// playing it.」 From the orchestrator's playtest. solo.js also exports
//   recent(session, lang) → [string]   what happened since the human last decided: every bot move
//                                       (which card, where it placed or took, check outcomes), in order
//   lastResult(session, lang) → string | null   the outcome of the human's own last move when it
//                                       involved a support check: success or failure, and where
// and screen() shows both above the decision. choices() lists the campaign options in the order the
// page shows them. Reports 尚未實作 until solo.js exports recent.
const UX = !!(S && typeof S.recent === "function" && typeof S.lastResult === "function");
const c23 = (name, fn) => c12(name, () => (UX ? fn() : "TODO: solo.js 還沒有 recent、lastResult（#23）"));
const cardLabel = (id, lang) => (id === "candidate" ? null : EV[id] ? cardName(id, lang) : null);
// Does this move make a support check? Ask the engine: apply it to a copy and look at the log.
const checks = (st, seat, m) => { const s2 = E.apply(st, seat, m); return s2.log.slice(st.log.length).some((e) => e.t === "check"); };
section("23 玩起來看得懂（單人）");
c23("對手做了什麼：每次輪到你時，recent 列出上一次你決定之後 bot 打出的每一張事件牌名，而且這些字在畫面上", () => {
  let checked = 0;
  for (const [lang, seat, seed] of [["zh-Hant", 0, 81], ["en", 1, 82]]) {
    let s = S.advance(S.newSolo({ seat, level: 2, seed }));
    const R1 = D.rng(seed);
    for (let n = 0; n < 120 && s.st.phase !== "end"; n++) {
      const ch = S.choices(s, lang);
      const before = s.st.log.length;
      s = S.act(s, ch[Math.floor(R1() * ch.length)].move);
      const mid = s.st.log.length;
      s = S.advance(s);
      const played = s.st.log.slice(mid).filter((e) => e.t === "play" && e.seat !== seat).map((e) => cardLabel(e.card, lang)).filter(Boolean);
      const lines = S.recent(s, lang);
      if (!Array.isArray(lines)) return `${lang}：recent 回的不是陣列`;
      const all = lines.join(" ");
      const miss = played.filter((nm) => !all.includes(nm));
      if (miss.length) return `${lang} 第 ${s.st.turn} 回合 ${s.st.phase}：bot 打了 ${miss.join("、")}，recent 沒寫（${JSON.stringify(lines.slice(0, 3))}）`;
      const seen = text(S.screen(s, lang));
      const off = lines.filter((l) => !seen.includes(text(l).trim()));
      if (off.length) return `${lang}：recent 的「${off[0]}」不在畫面上`;
      if (played.length) checked++;
      void before;
    }
  }
  const r = nonEmpty(checked, "有 bot 出牌的回合"); if (r !== true) return r;
  return ok(true, `${checked} 次輪到你時，bot 打的牌都寫在 recent 與畫面上`);
});
c23("自己那一步的結果：你做了要檢定的動作之後，lastResult 說成功或失敗，而且在畫面上；沒檢定的動作不說", () => {
  let withCheck = 0, withoutCheck = 0;
  for (const [lang, seat, seed, okWord, failWord] of [["zh-Hant", 0, 83, "成功", "失敗"], ["en", 2, 84, "succe", "fail"]]) {
    let s = S.advance(S.newSolo({ seat, level: 1, seed }));
    const R1 = D.rng(seed);
    for (let n = 0; n < 150 && s.st.phase !== "end"; n++) {
      const ch = S.choices(s, lang);
      const before = s.st.log.length;
      s = S.act(s, ch[Math.floor(R1() * ch.length)].move);
      const mine = s.st.log.slice(before).filter((e) => e.t === "check" && e.seat === seat);
      const res = S.lastResult(s, lang);
      if (mine.length) {
        if (!res) return `${lang} 第 ${s.st.turn} 回合：你剛做了 ${mine.length} 次檢定，lastResult 是空的`;
        const want = mine[mine.length - 1].ok ? okWord : failWord;
        if (!res.toLowerCase().includes(want)) return `${lang}：檢定${mine[mine.length - 1].ok ? "成功" : "失敗"}，lastResult 卻是「${res}」`;
        if (!text(S.screen(s, lang)).includes(text(res).trim())) return `${lang}：lastResult「${res}」不在畫面上`;
        withCheck++;
      } else if (res) return `${lang} 第 ${s.st.turn} 回合 ${s.st.phase}：這一步沒有檢定，lastResult 卻說「${res}」`;
      else withoutCheck++;
      s = S.advance(s);
    }
  }
  const r = nonEmpty(withCheck, "要檢定的步"); if (r !== true) return r;
  return ok(true, `${withCheck} 步有檢定、${withoutCheck} 步沒有，結果都對`);
});
c23("競選的選項好找：同一個縣市的選項排在一起；有不用檢定的填塊時排在最前面；移動排在放方塊之後", () => {
  let checked = 0;
  for (const seed of [85, 86, 87]) {
    let s = S.advance(S.newSolo({ seat: (seed % 3), level: 1, seed }));
    const R1 = D.rng(seed);
    for (let n = 0; n < 200 && s.st.phase !== "end"; n++) {
      const st = s.st, seat = s.seat, ch = S.choices(s, "zh-Hant");
      const place = ch.filter((c) => ["fill", "cross", "steal"].includes(c.move.type));
      if (place.length >= 3 && st.pending && st.pending.stage === "campaign") {
        const order = ch.map((c) => c.move.type);
        const lastPlace = order.map((t, i) => (["fill", "cross", "steal"].includes(t) ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
        const firstMove = order.indexOf("move");
        if (firstMove >= 0 && firstMove < lastPlace) return `第 ${st.turn} 回合：移動排在放方塊前面`;
        const seenC = []; let prev = null;
        for (const c of place) { const k = c.move.county; if (k !== prev && seenC.includes(k)) return `第 ${st.turn} 回合：縣市 ${k} 的選項沒排在一起`; if (k !== prev) seenC.push(k); prev = k; }
        const free = place.filter((c) => !checks(st, seat, c.move));
        if (free.length && checks(st, seat, place[0].move)) return `第 ${st.turn} 回合：有不用檢定的填塊（${free[0].label}），第一個卻是要檢定的「${place[0].label}」`;
        checked++;
      }
      s = S.advance(S.act(s, ch[Math.floor(R1() * ch.length)].move));
    }
  }
  const r = nonEmpty(checked, "競選的決定"); if (r !== true) return r;
  return ok(true, `${checked} 個競選決定的排序都對`);
});
c23("候選人牌：選項上寫明整局只能用一次（中文「整局一次」、英文 once）", () => {
  for (const [lang, word] of [["zh-Hant", "整局一次"], ["en", "once"]]) {
    const s = S.advance(S.newSolo({ seat: 0, level: 1, seed: 88 }));
    let x = s;
    for (let n = 0; n < 20 && !S.choices(x, lang).some((c) => c.move.type === "candidate"); n++) x = S.advance(S.act(x, S.choices(x, lang)[0].move));
    const c = S.choices(x, lang).find((c) => c.move.type === "candidate");
    if (!c) return `${lang}：走不到有候選人牌選項的時候`;
    if (!c.label.toLowerCase().includes(word)) return `${lang} 候選人牌的選項沒寫「${word}」：${c.label}`;
  }
  return ok(true, "中英都寫了");
});
c23("★ 只用在軍師：軍師關著時畫面上沒有 ★（主動權等其他標記不用 ★）", () => {
  let screens = 0;
  for (const lang of ["zh-Hant", "en"]) {
    let s = S.advance(S.newSolo({ seat: 1, level: 1, seed: 89 }));
    for (let n = 0; n < 40 && s.st.phase !== "end"; n++) {
      if (text(S.screen(s, lang)).includes("★")) return `${lang} 第 ${s.st.turn} 回合 ${s.st.phase}：軍師關著，畫面上卻有 ★`;
      screens++;
      s = S.advance(S.act(s, S.choices(s, lang)[0].move));
    }
  }
  return ok(true, `${screens} 個畫面沒有 ★`);
});

test("solo", () => {
  const s = summary();
  for (const p of R.pass) console.log(`  ✓ ${p.label}${p.msg ? " — " + p.msg : ""}`);
  for (const t of s.todos) console.log(`  … ${t.label} — ${t.msg}`);
  for (const f of s.failures) console.log(`  ✗ ${f.label} — ${f.msg}`);
  console.log(`  通過 ${s.pass} / 失敗 ${s.fail} / 尚未實作 ${s.todo}`);
  assert.equal(s.fail, 0, s.failures.map((f) => `${f.label}: ${f.msg}`).join("\n"));
});
