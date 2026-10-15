// The end page (issue #33), as far as node can see it. Orchestrator's file: a peer may run it and falsify
// against it, and does not edit it. How it looks on a phone is measured in a browser (tools/end33.mjs) and
// checked by looking.
//
//   node --test tests/endpage.test.js      (or `npm test`)
//
// Owner, 2026-10-15: 「end game page，可以用qwen2.1 產生圖，顯示得票數跟得票率」, then chose 「第一版」 (開票之夜,
// design canvas R26gizGsymbFUZnLxPoP7V). Contract: when the game is over, the table (solo and room alike, from the
// view's result) shows
//   - the winner's hero picture: <img data-end-hero src="art/end/<chen|soong|lien>.webp" alt="…"> (alt not empty)
//     and the winner's full name in an element with data-winner="<seat>";
//   - one result row per candidate, data-result="<seat>", most votes first (the winner first on a tie), each with
//     the ballot number, the votes (zh: blocks × 10 then 萬票, "0票" for none; en: blocks / 10 with one decimal then
//     "M votes", "0 votes" for none) and the share of the votes cast, blocks / all cubes on the board, with one
//     decimal and %; whitespace between the pieces does not matter;
//   - the turnout, cubes on the board / 154, one decimal: zh "投票率 x%", en "Turnout x%";
//   - the viewer's own result, data-you: rank (zh 第一名 / 第二名 / 第三名, en 1st / 2nd / 3rd), votes, share;
//   - the year 2000's real shares and turnout for comparison: 39.3%, 36.8%, 23.1%, 82.7%;
//   - the margin over the runner-up in votes (zh "<blocks × 10>萬", en the full figure with commas), unless tied;
//   - election day's record and the counties led, as today (their headings end.dayTitle and end.leadTitle).
// Reports 尚未實作 until the end page has a data-end-hero.
import test from "node:test";
import assert from "node:assert/strict";
import { R, section, check, ok, nonEmpty, summary } from "./harness.js";
import * as E from "../public/shared/engine.js";
import * as D from "./driver.js";
import * as S from "../public/solo.js";
import zh from "../public/i18n/zh-Hant.js";
import en from "../public/i18n/en.js";

const SEAT = ["chen", "soong", "lien"];
const NO = [5, 1, 2];
const BLOCKS = 154;
// From the record of the 2000 election (the rules page's history line), not from the product.
const HISTORY = ["39.3%", "36.8%", "23.1%", "82.7%"];
const RANK = { "zh-Hant": ["第一名", "第二名", "第三名"], en: ["1st", "2nd", "3rd"] };

const plain = (s) => s.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, "");
const pct = (a, b) => `${(Math.round((a / b) * 1000) / 10).toFixed(1)}%`;
const votes = (n, lang) => (lang === "en" ? (n ? `${(n / 10).toFixed(1)}Mvotes` : "0votes") : (n ? `${n * 10}萬票` : "0票"));
const tags = (html, name) => { const out = []; const re = new RegExp(`<[a-zA-Z][^<>]*?\\s${name}(?:="([^"]*)")?(?=[\\s/>])[^<>]*>`, "g"); let m; while ((m = re.exec(html))) out.push({ tag: m[0], v: m[1], at: m.index }); return out; };
const attr = (tag, name) => { const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`)); return m ? m[1] : null; };
// From an element's opening tag to the next element carrying the same attribute (or the end of its section).
function segment(html, t, name) {
  const next = tags(html.slice(t.at + 1), name)[0];
  const end = next ? t.at + 1 + next.at : html.indexOf("</section>", t.at);
  return html.slice(t.at, end < 0 ? undefined : end);
}

// Finished games: each seat in both languages, and a game the viewer wins.
function finished() {
  const out = [];
  for (const [seat, seed] of [[0, 4101], [1, 4102], [2, 4103], [0, 4104], [1, 4105], [2, 4106]]) {
    let s = S.advance(S.newSolo({ seat, level: 2, seed }));
    const R1 = D.rng(seed);
    for (let n = 0; n < 900 && s.st.phase !== "end"; n++) {
      const ch = S.choices(s, "zh-Hant");
      if (!ch.length) break;
      s = S.advance(S.act(s, ch[Math.floor(R1() * ch.length)].move));
    }
    if (s.st.phase === "end") for (const lang of ["zh-Hant", "en"]) out.push({ s, v: E.view(s.st, seat), lang, where: `${SEAT[seat]} seed ${seed}（${lang}）` });
  }
  return out;
}
const GAMES = finished();
const gate = (fn) => () => {
  const ne = nonEmpty(GAMES.length, "打到結束的局"); if (ne !== true) return ne;
  if (!tags(S.screen(GAMES[0].s, GAMES[0].lang), "data-end-hero").length) return "TODO: 結局頁還沒有主視覺 data-end-hero（#33）";
  return fn();
};
const order = (r) => [0, 1, 2].sort((a, b) => r.votes[b] - r.votes[a] || (b === r.winner) - (a === r.winner));
const cast = (r) => r.votes[0] + r.votes[1] + r.votes[2];

section("33 結局頁");

check("主視覺：當選人的 art/end/<seat>.webp（alt 不是空的），當選人的全名在 data-winner 上", gate(() => {
  for (const g of GAMES) {
    const html = S.screen(g.s, g.lang), w = g.v.result.winner, T = g.lang === "en" ? en : zh;
    const hero = tags(html, "data-end-hero");
    if (hero.length !== 1) return `${g.where}：有 ${hero.length} 個 data-end-hero`;
    if (attr(hero[0].tag, "src") !== `art/end/${SEAT[w]}.webp`) return `${g.where}：主視覺是「${attr(hero[0].tag, "src")}」，當選人是 ${SEAT[w]}`;
    if (!(attr(hero[0].tag, "alt") || "").trim()) return `${g.where}：主視覺沒有 alt`;
    const win = tags(html, "data-winner");
    if (win.length !== 1 || win[0].v !== SEAT[w]) return `${g.where}：data-winner 是 ${JSON.stringify(win.map((t) => t.v))}`;
    const full = T.ui.solo.cand[SEAT[w]].name;
    if (!plain(segment(html, win[0], "data-winner").slice(0, 400)).includes(plain(full))) return `${g.where}：data-winner 那裡沒有「${full}」`;
  }
  const winners = new Set(GAMES.map((g) => g.v.result.winner));
  return ok(true, `${GAMES.length} 個結局，當選人有 ${[...winners].map((p) => SEAT[p]).join("、")}`);
}));

check("得票：三列 data-result，票多的在前；每列有號次、得票數（570萬票 / 5.7M votes）、得票率（佔投出票數，一位小數）", gate(() => {
  let n = 0;
  for (const g of GAMES) {
    const html = S.screen(g.s, g.lang), r = g.v.result, rows = tags(html, "data-result");
    if (rows.length !== 3) return `${g.where}：有 ${rows.length} 列 data-result`;
    const want = order(r).map((p) => SEAT[p]), got = rows.map((t) => t.v);
    if (JSON.stringify(got) !== JSON.stringify(want)) return `${g.where}：順序是 ${got.join(",")}，票數 ${r.votes.join("/")}，應為 ${want.join(",")}`;
    for (const t of rows) {
      const p = SEAT.indexOf(t.v), txt = plain(segment(html, t, "data-result"));
      const v = votes(r.votes[p], g.lang), sh = pct(r.votes[p], cast(r));
      if (!new RegExp(`(^|[^0-9.])${v.replace(/\./g, "\\.")}`).test(txt)) return `${g.where}：${t.v} ${r.votes[p]} 塊，應寫「${v}」，實際「${txt.slice(0, 70)}」`;
      if (!txt.includes(sh)) return `${g.where}：${t.v} 的得票率應為 ${sh}（${r.votes[p]} / ${cast(r)}），實際「${txt.slice(0, 70)}」`;
      if (!new RegExp(`(^|\\D)${NO[p]}(\\D|$)`).test(txt)) return `${g.where}：${t.v} 那列沒有號次 ${NO[p]}`;
      n++;
    }
  }
  return ok(true, `${n} 列得票數與得票率都對`);
}));

check("投票率：投出的票塊 / 154，一位小數（投票率 84.4% / Turnout 84.4%）", gate(() => {
  for (const g of GAMES) {
    const txt = plain(S.screen(g.s, g.lang)), t = pct(cast(g.v.result), BLOCKS);
    const want = g.lang === "en" ? `Turnout${t}` : `投票率${t}`;
    if (!txt.includes(want)) return `${g.where}：找不到「${want}」`;
  }
  return ok(true, `${GAMES.length} 個結局的投票率都對`);
}));

check("你的成績：data-you 寫名次（第一名/1st…）、你的得票數與得票率", gate(() => {
  for (const g of GAMES) {
    const html = S.screen(g.s, g.lang), r = g.v.result, me = g.v.seat, you = tags(html, "data-you");
    if (you.length !== 1) return `${g.where}：有 ${you.length} 個 data-you`;
    const txt = plain(segment(html, you[0], "data-you").slice(0, 1200));
    const rank = order(r).indexOf(me), word = RANK[g.lang][rank];
    if (!txt.includes(word)) return `${g.where}：你是第 ${rank + 1} 名，data-you 沒有「${word}」：「${txt.slice(0, 60)}」`;
    if (!txt.includes(votes(r.votes[me], g.lang)) || !txt.includes(pct(r.votes[me], cast(r)))) return `${g.where}：data-you 沒有你的得票數或得票率：「${txt.slice(0, 80)}」`;
  }
  const ranks = new Set(GAMES.map((g) => order(g.v.result).indexOf(g.v.seat)));
  const r = nonEmpty(ranks.size >= 2 ? 1 : 0, "不只一種名次的結局（全是第一名或全是第三名等於沒驗）"); if (r !== true) return r;
  return ok(true, `${GAMES.length} 個結局，名次有 ${[...ranks].map((x) => x + 1).join("、")}`);
}));

check("跟 2000 年比：畫面上有史實的 39.3%、36.8%、23.1% 與投票率 82.7%", gate(() => {
  for (const g of GAMES) {
    const txt = plain(S.screen(g.s, g.lang));
    const miss = HISTORY.filter((h) => !txt.includes(h));
    if (miss.length) return `${g.where}：少了 ${miss.join("、")}`;
  }
  return ok(true, "中英都有史實得票率與投票率");
}));

check("勝差與細節：勝差寫成萬票（英文寫完整票數），投票日流水與領先縣市的標題還在", gate(() => {
  let margins = 0;
  for (const g of GAMES) {
    const txt = plain(S.screen(g.s, g.lang)), r = g.v.result, T = (g.lang === "en" ? en : zh).ui.solo.end;
    const [a, b] = order(r), diff = r.votes[a] - r.votes[b];
    if (diff > 0) {
      const want = g.lang === "en" ? String(diff * 100000).replace(/\B(?=(\d{3})+(?!\d))/g, ",") : `${diff * 10}萬`;
      if (!txt.includes(want)) return `${g.where}：勝差 ${diff} 塊，找不到「${want}」`;
      margins++;
    }
    for (const h of [T.dayTitle, T.leadTitle]) if (!txt.includes(plain(h))) return `${g.where}：找不到標題「${h}」`;
  }
  const r = nonEmpty(margins, "有勝差的結局"); if (r !== true) return r;
  return ok(true, `${margins} 個結局的勝差都對，細節標題都在`);
}));

test("endpage", () => {
  const s = summary();
  for (const p of R.pass) console.log(`  ✓ ${p.label}${p.msg ? " — " + p.msg : ""}`);
  for (const t of s.todos) console.log(`  … ${t.label} — ${t.msg}`);
  for (const x of s.failures) console.log(`  ✗ ${x.label} — ${x.msg}`);
  console.log(`  通過 ${s.pass} / 失敗 ${s.fail} / 尚未實作 ${s.todo}`);
  assert.equal(s.fail, 0, s.failures.map((x) => `${x.label}: ${x.msg}`).join("\n"));
});
