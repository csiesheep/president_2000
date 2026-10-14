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
import { R, section, check, eq, ok, summary } from "./harness.js";
import * as E from "../public/shared/engine.js";
import * as C from "../public/shared/cards.js";
import en from "../public/i18n/en.js";
import * as D from "./driver.js";

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
c12("存檔：中途的 session 存成 JSON 再讀回來（sessionStorage），畫面一樣；用同樣的選擇接著打，結果跟沒存過一樣", () => {
  const a = soloGame(1, 2, 77, "zh-Hant", { holdAt: 60 });
  if (a.bad) return a.bad;
  if (!a.saved) return "這局不到 60 個決定，沒有存檔可比";
  const back = JSON.parse(a.saved);
  let x = eq(S.screen(back, "zh-Hant") === S.screen(a.live, "zh-Hant"), true, "讀回來的畫面跟存之前一樣"); if (x !== true) return x;
  const run = (s) => {
    const R2 = D.rng(5);
    for (let n = 0; n < 3000 && s.st.phase !== "end"; n++) { const ch = S.choices(s, "zh-Hant"); s = S.advance(S.act(s, ch[Math.floor(R2() * ch.length)].move)); }
    return s;
  };
  const e1 = run(a.live), e2 = run(back);
  x = eq(same(e1.st, e2.st), true, "沒存過與存過再讀回，接著打到的結束狀態"); if (x !== true) return x;
  return ok(true, `從第 60 個決定接著打，兩次都是 ${e1.st.result.votes.join("/")}`);
});

test("solo", () => {
  const s = summary();
  for (const p of R.pass) console.log(`  ✓ ${p.label}${p.msg ? " — " + p.msg : ""}`);
  for (const t of s.todos) console.log(`  … ${t.label} — ${t.msg}`);
  for (const f of s.failures) console.log(`  ✗ ${f.label} — ${f.msg}`);
  console.log(`  通過 ${s.pass} / 失敗 ${s.fail} / 尚未實作 ${s.todo}`);
  assert.equal(s.fail, 0, s.failures.map((f) => `${f.label}: ${f.msg}`).join("\n"));
});
