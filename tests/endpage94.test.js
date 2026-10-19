// The end page says why (issue #94): a newspaper extra that tells who won by how much, why, how the votes moved, where
// your blocks came from, and on a tie which rule decided it. Orchestrator's file: a peer may run it and falsify against
// it, and does not edit it. The record, the next challenge and sharing are measured in a browser (tools/endpage94.mjs).
//
//   node --test tests/endpage94.test.js      (or `npm test`)
//
// Owner, 2026-10-18, to the wave-2 design canvas (① 結局頁：講清楚輸贏、給下一局的理由; ② 落選、同票：平手寫出數字):
// 「可以 開工」. The audit (商業盤點 A): a 490–490 tie said only 「靠領先縣市數、再靠投票日的催票順序分出勝負」, not
// which rule or by how much; no vote trend; no "where the votes came from". Contract (orchestrator, #94), on the table
// at the end (Solo.screen; a room's end page is the same page), the numbers from recap() (#90):
//   - [data-end-paper]: the extra's masthead, zh 「選戰日報」 「號外」 「2000 年 3 月 18 日」, en "Extra" "March 18, 2000";
//   - [data-end-head data-end-winner="<seat key>" data-end-me="<seat key>" data-end-result="won|lost|tie"] ("tie": the same votes
//     as the winner, and lost); its text has the margin: won, over the runner-up; lost, to the winner: the blocks and
//     the votes (zh 「N 塊」 and N × 10 「萬」; en "N block(s)" and the full figure, 300,000); tie: the shared votes
//     (zh N × 10 萬, en the full figure) and the winner's name;
//   - [data-end-why]: the three biggest differences between your blocks and the other's (the runner-up when you won,
//     else the winner) by where they came from (sources: start, act, event, debate, canvass, strategic, endorse),
//     largest first (a tie in size: that order), only those that differ; each [data-why="<source>"
//     data-me="<yours>" data-other="<theirs>"] with both numbers in its text;
//   - [data-end-tie data-decided="leads|momentum|order"] when the result is "tie": one [data-tie-rule="<rule>"] per rule
//     up to the one that decided (votes, leads, momentum, order), that one marked data-decided-here; the votes and
//     leads rows give each tied seat's number; when counties led decided it, the difference is in the text;
//   - [data-end-trend]: one [data-trend="<seat key>" data-v="v1,…,v9"] per seat, the 9 rows of recap().trend;
//   - [data-end-src]: one [data-src="<source>" data-n="<n>"] per source you have blocks from (n > 0), n in its text;
//     the n add up to your votes;
//   - [data-end-gifts data-n="<k>"] when you played k rivals' events for CP that then happened for them (k > 0): the
//     first one's card and receiver (short name) in its text;
//   - the facts the end page has had since #33 stay (tests/endpage.test.js stays green: its data-winner and
//     data-result are #33's hooks, which is why the head's are data-end-*);
//   - a game saved before #90 (sources null): no [data-end-why] or [data-end-src], and nothing breaks;
//   - a room's end page (it passes again): no [data-end-record] and no [data-end-next] (they are this device's solo
//     games); in English no Chinese character.
// Reports 尚未實作 until the end page has [data-end-head].
import test from "node:test";
import assert from "node:assert/strict";
import { R, section, check, ok, nonEmpty, summary } from "./harness.js";
import * as E from "../public/shared/engine.js";
import * as S from "../public/solo.js";
import * as D from "./driver.js";
import { bind, tableHTML } from "../public/table.js";
import { recap } from "../public/shared/recap.js";

const LANGS = ["zh-Hant", "en"];
const X = { "zh-Hant": bind("zh-Hant"), en: bind("en") };
const KEY = ["chen", "soong", "lien"];
const SRC = ["start", "act", "event", "debate", "canvass", "strategic", "endorse"];
const RULES = ["votes", "leads", "momentum", "order"];
const CJK = /[㐀-鿿豈-﫿]/;
const dec = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'");
const text = (html) => dec(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const full = (n) => String(n * 100000).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
// Elements that carry attr: [{ attrs, html }], each balanced on its own tag name.
function elements(html, attr) {
  const out = [], re = new RegExp(`<(\\w+)\\b([^>]*\\b${attr}(?:="[^"]*")?[^>]*)>`, "g");
  let m;
  while ((m = re.exec(html))) {
    const tag = m[1], open = new RegExp(`<${tag}\\b`, "g"), close = new RegExp(`</${tag}>`, "g");
    let depth = 1, i = m.index + m[0].length;
    while (depth > 0) {
      open.lastIndex = i; close.lastIndex = i;
      const o = open.exec(html), c = close.exec(html);
      if (!c) { i = html.length; break; }
      if (o && o.index < c.index) { depth++; i = o.index + 1; } else { depth--; i = c.index + c[0].length; }
    }
    const attrs = Object.fromEntries([...m[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map((a) => [a[1], a[2] === undefined ? "" : dec(a[2])]));
    out.push({ attrs, html: html.slice(m.index, i) });
  }
  return out;
}
const one = (html, attr) => elements(html, attr)[0] || null;

// Finished solo games: the human (陳, 宋 or 連) plays at random against bots of a level; kept: won, lost, and lost on a
// tie decided by counties led or by the order, so each kind is seen.
function finish(seat, level, seed) {
  let s = S.advance(S.newSolo({ seat, level, seed }));
  const Rr = D.rng(seed * 31 + seat);
  for (let n = 0; n < 900 && s.st.phase !== "end"; n++) {
    const ch = S.choices(s, "zh-Hant");
    if (!ch.length) { s = S.advance(s); continue; }
    s = S.advance(S.act(s, ch[Math.floor(Rr() * ch.length)].move));
  }
  return s.st.phase === "end" ? s : null;
}
const kindOf = (st, me) => { const r = st.result; return r.winner === me ? "won" : r.votes[me] === r.votes[r.winner] ? "tie" : "lost"; };
let POOL = null;
function pool() {
  if (POOL) return POOL;
  POOL = [];
  const want = { won: 4, lost: 4, tie: 3 }, have = { won: 0, lost: 0, tie: 0 };
  for (let seed = 1; seed <= 400 && Object.keys(want).some((k) => have[k] < want[k]); seed++) {
    const seat = seed % 3, s = finish(seat, seed % 4, seed);
    if (!s) continue;
    const k = kindOf(s.st, seat);
    if (have[k] >= want[k]) continue;
    have[k]++; POOL.push({ seed, seat, kind: k, s });
  }
  return POOL;
}
const READY = () => { const p = pool(); if (!p.length) return "找不到下完的局（instrument）"; return one(S.screen(p[0].s, "zh-Hant"), "data-end-head") ? null : "結局頁沒有 [data-end-head]：#94 已上線（e835786），這是退步，不是尚未實作"; };
const c94 = (name, fn) => check(name, () => READY() || fn());

section("94 結局頁講清楚輸贏");
c94("號外的報頭：選戰日報・號外・2000 年 3 月 18 日（英文 Extra, March 18, 2000）", () => {
  const bad = [];
  for (const g of pool()) for (const lang of LANGS) {
    const e = one(S.screen(g.s, lang), "data-end-paper"), t = e ? text(e.html) : "";
    const want = lang === "en" ? ["Extra", "March 18, 2000"] : ["選戰日報", "號外", "2000 年 3 月 18 日"];
    if (!e) bad.push(`種子 ${g.seed} ${lang}：沒有 [data-end-paper]`); else for (const w of want) if (!t.includes(w)) bad.push(`種子 ${g.seed} ${lang}：報頭「${t.slice(0, 40)}」沒有「${w}」`);
  }
  return ok(!bad.length, bad.slice(0, 4).join("；") || `${pool().length} 局 × 2 種語言都有`);
});
c94("標題：誰當選、你是贏是輸是同票、勝差的塊數與票數（同票寫共同的票數）", () => {
  const bad = [], kinds = {};
  for (const g of pool()) for (const lang of LANGS) {
    const x = X[lang], r = g.s.st.result, w = r.winner, me = g.seat, e = one(S.screen(g.s, lang), "data-end-head");
    kinds[g.kind] = (kinds[g.kind] || 0) + 1;
    if (!e) { bad.push(`種子 ${g.seed} ${lang}：沒有 [data-end-head]`); continue; }
    const a = e.attrs, t = text(e.html);
    if (a["data-end-winner"] !== KEY[w] || a["data-end-me"] !== KEY[me] || a["data-end-result"] !== g.kind) { bad.push(`種子 ${g.seed} ${lang}：${JSON.stringify(a)}，應是 ${KEY[w]}/${KEY[me]}/${g.kind}`); continue; }
    if (g.kind === "tie") {
      const v = r.votes[w];
      if (!t.includes(x.full(w)) || !t.includes(lang === "en" ? full(v) : String(v * 10))) bad.push(`種子 ${g.seed} ${lang} 同票「${t.slice(0, 80)}」沒有 ${x.full(w)} 或共同票數 ${v}`);
      continue;
    }
    const other = g.kind === "won" ? [0, 1, 2].filter((p) => p !== me).sort((p, q) => r.votes[q] - r.votes[p])[0] : w;
    const d = Math.abs(r.votes[me] - r.votes[other]);
    const need = lang === "en" ? [`${d} block`, full(d)] : [`${d} 塊`, `${d * 10} 萬`];
    for (const n of need) if (!t.includes(n)) bad.push(`種子 ${g.seed} ${lang} ${g.kind}「${t.slice(0, 80)}」沒有「${n}」`);
  }
  if (!kinds.won || !kinds.lost || !kinds.tie) return `局裡缺少贏、輸或同票（${JSON.stringify(kinds)}），分不出對錯`;
  return ok(!bad.length, bad.slice(0, 4).join("；") || `贏 ${kinds.won / 2}、輸 ${kinds.lost / 2}、同票 ${kinds.tie / 2} 局 × 2 種語言都對`);
});
c94("為什麼：你和對方（你贏時是第二名，否則是當選人）的方塊來源差最多的三項，由大到小，兩個數字都寫出來", () => {
  const bad = []; let n = 0;
  for (const g of pool()) for (const lang of LANGS) {
    const r = g.s.st.result, me = g.seat, rc = recap(g.s.st);
    const other = g.kind === "won" ? [0, 1, 2].filter((p) => p !== me).sort((p, q) => r.votes[q] - r.votes[p])[0] : r.winner;
    const want = SRC.map((k, i) => ({ k, i, me: rc.sources[me][k], other: rc.sources[other][k] })).filter((x) => x.me !== x.other)
      .sort((a, b) => Math.abs(b.me - b.other) - Math.abs(a.me - a.other) || a.i - b.i).slice(0, 3);
    const box = one(S.screen(g.s, lang), "data-end-why");
    if (!box) { bad.push(`種子 ${g.seed} ${lang}：沒有 [data-end-why]`); continue; }
    const items = elements(box.html, "data-why");
    const have = items.map((e) => `${e.attrs["data-why"]}:${e.attrs["data-me"]}:${e.attrs["data-other"]}`), exp = want.map((x) => `${x.k}:${x.me}:${x.other}`);
    n++;
    if (JSON.stringify(have) !== JSON.stringify(exp)) { bad.push(`種子 ${g.seed} ${lang}：${have.join(" ")}，應是 ${exp.join(" ")}`); continue; }
    for (const e of items) { const t = text(e.html); if (!t.includes(e.attrs["data-me"]) || !t.includes(e.attrs["data-other"])) bad.push(`種子 ${g.seed} ${lang}「${t.slice(0, 60)}」沒有 ${e.attrs["data-me"]} 和 ${e.attrs["data-other"]}`); }
  }
  const z = nonEmpty(n, "有 [data-end-why] 的結局頁"); if (z !== true) return z;
  return ok(!bad.length, bad.slice(0, 4).join("；") || `${n} 頁都對`);
});
c94("同票：一條一條寫到分出勝負的那一條（票數、領先縣市、動能、順序），寫出各家的數字", () => {
  const bad = []; let n = 0; const by = {};
  for (const g of pool()) for (const lang of LANGS) {
    const html = S.screen(g.s, lang), box = one(html, "data-end-tie"), r = g.s.st.result, dby = recap(g.s.st).decidedBy;
    if (g.kind !== "tie") { if (box) bad.push(`種子 ${g.seed} ${lang}：不是同票，卻有 [data-end-tie]`); continue; }
    n++; by[dby] = (by[dby] || 0) + 1;
    if (!box) { bad.push(`種子 ${g.seed} ${lang}：同票，沒有 [data-end-tie]`); continue; }
    if (box.attrs["data-decided"] !== dby) bad.push(`種子 ${g.seed} ${lang}：data-decided=${box.attrs["data-decided"]}，應是 ${dby}`);
    const rows = elements(box.html, "data-tie-rule"), names = rows.map((e) => e.attrs["data-tie-rule"]), upto = RULES.slice(0, RULES.indexOf(dby) + 1);
    if (JSON.stringify(names) !== JSON.stringify(upto)) { bad.push(`種子 ${g.seed} ${lang}：規則列 ${names.join(",")}，應是 ${upto.join(",")}`); continue; }
    const here = rows.filter((e) => "data-decided-here" in e.attrs).map((e) => e.attrs["data-tie-rule"]);
    if (JSON.stringify(here) !== JSON.stringify([dby])) bad.push(`種子 ${g.seed} ${lang}：標成決定的是 ${here.join(",") || "沒有"}`);
    const tied = [0, 1, 2].filter((p) => r.votes[p] === r.votes[r.winner]);
    const vt = text(rows[0].html), lt = rows[1] ? text(rows[1].html) : "";
    for (const p of tied) { if (!vt.includes(String(r.votes[p]))) bad.push(`種子 ${g.seed} ${lang} 票數那一列沒有 ${r.votes[p]}`); if (rows[1] && !lt.includes(String(r.leads[p]))) bad.push(`種子 ${g.seed} ${lang} 縣市那一列沒有 ${r.leads[p]}`); }
    if (dby === "leads") { const d = r.leads[r.winner] - r.leads[g.seat]; if (!text(box.html).includes(String(d))) bad.push(`種子 ${g.seed} ${lang}：沒有寫多領先 ${d} 個縣市`); }
  }
  const z = nonEmpty(n, "你同票落選的結局頁"); if (z !== true) return z;
  return ok(!bad.length, bad.slice(0, 4).join("；") || `${n} 頁都對（${Object.entries(by).map(([k, v]) => `${k} ${v / 2}`).join("、")} 局）`);
});
c94("票數走勢：三家各一條，九個點就是 recap 的 trend（每回合結束時、最後是開票）", () => {
  const bad = []; let n = 0;
  for (const g of pool()) {
    const t = recap(g.s.st).trend, box = one(S.screen(g.s, "zh-Hant"), "data-end-trend");
    if (!box) { bad.push(`種子 ${g.seed}：沒有 [data-end-trend]`); continue; }
    for (let p = 0; p < 3; p++) {
      const e = elements(box.html, "data-trend").find((x) => x.attrs["data-trend"] === KEY[p]), want = t.map((r) => r.votes[p]).join(",");
      n++;
      if (!e || e.attrs["data-v"] !== want) bad.push(`種子 ${g.seed} ${KEY[p]}：${e ? e.attrs["data-v"] : "沒有"}，應是 ${want}`);
    }
  }
  return ok(!bad.length, bad.slice(0, 4).join("；") || `${n} 條線都對`);
});
c94("你的票從哪裡來：每個有方塊的來源一項，數字加起來就是你的票", () => {
  const bad = []; let n = 0;
  for (const g of pool()) for (const lang of LANGS) {
    const src = recap(g.s.st).sources[g.seat], box = one(S.screen(g.s, lang), "data-end-src");
    if (!box) { bad.push(`種子 ${g.seed} ${lang}：沒有 [data-end-src]`); continue; }
    const items = elements(box.html, "data-src"), have = items.map((e) => `${e.attrs["data-src"]}:${e.attrs["data-n"]}`).sort(), want = SRC.filter((k) => src[k] > 0).map((k) => `${k}:${src[k]}`).sort();
    n++;
    if (JSON.stringify(have) !== JSON.stringify(want)) { bad.push(`種子 ${g.seed} ${lang}：${have.join(" ")}，應是 ${want.join(" ")}`); continue; }
    for (const e of items) if (!text(e.html).includes(e.attrs["data-n"])) bad.push(`種子 ${g.seed} ${lang}：「${text(e.html)}」沒有 ${e.attrs["data-n"]}`);
  }
  const z = nonEmpty(n, "有 [data-end-src] 的結局頁"); if (z !== true) return z;
  return ok(!bad.length, bad.slice(0, 4).join("；") || `${n} 頁都對`);
});
c94("送分：你拿對手的事件當 CP 而替他發生了幾次，寫出第一張牌和收到的人", () => {
  const bad = []; let n = 0;
  for (const g of pool()) for (const lang of LANGS) {
    const x = X[lang], gifts = recap(g.s.st).gifts[g.seat], box = one(S.screen(g.s, lang), "data-end-gifts");
    if (!gifts.length) { if (box) bad.push(`種子 ${g.seed} ${lang}：沒有送分，卻有 [data-end-gifts]`); continue; }
    n++;
    if (!box) { bad.push(`種子 ${g.seed} ${lang}：送了 ${gifts.length} 次，沒有 [data-end-gifts]`); continue; }
    const t = text(box.html);
    if (box.attrs["data-n"] !== String(gifts.length)) bad.push(`種子 ${g.seed} ${lang}：data-n=${box.attrs["data-n"]}，應是 ${gifts.length}`);
    if (!t.includes(x.card(gifts[0].card)) || !t.includes(x.short(gifts[0].to))) bad.push(`種子 ${g.seed} ${lang}「${t.slice(0, 70)}」沒有「${x.card(gifts[0].card)}」或 ${x.short(gifts[0].to)}`);
  }
  const z = nonEmpty(n, "有送分的局"); if (z !== true) return z;
  return ok(!bad.length, bad.slice(0, 4).join("；") || `${n} 頁都對`);
});
c94("#90 之前存的局（sources 是 null）：沒有「為什麼」與「從哪裡來」，照樣畫得出來", () => {
  const g = pool()[0], s = JSON.parse(JSON.stringify(g.s));
  for (const c of s.st.counties) for (const b of c.blocks) delete b.s;
  s.st.result.sources = null;
  let html; try { html = S.screen(s, "zh-Hant"); } catch (e) { return `畫不出來：${e.message}`; }
  const bad = ["data-end-why", "data-end-src"].filter((a) => one(html, a));
  if (!one(html, "data-end-head")) bad.push("沒有 [data-end-head]");
  return ok(!bad.length, bad.length ? `舊局：${bad.join("、")}` : "舊局照樣有標題，沒有「為什麼」與「從哪裡來」");
});
c94("房間的結局頁（有 again）：沒有本機戰績與下一個挑戰；英文沒有中文字", () => {
  const bad = []; let n = 0;
  for (const g of pool()) {
    const v = E.view(g.s.st, g.seat);
    const room = tableHTML(v, [], "zh-Hant", { again: { data: { t: "rematch" }, label: "再來一局" } });
    for (const a of ["data-end-record", "data-end-next"]) if (one(room, a)) bad.push(`種子 ${g.seed}：房間的結局頁有 [${a}]`);
    if (!one(room, "data-end-head")) bad.push(`種子 ${g.seed}：房間的結局頁沒有 [data-end-head]`);
    const enText = text(S.screen(g.s, "en"));
    const m = enText.match(CJK);
    if (m) bad.push(`種子 ${g.seed} 英文：「${enText.slice(Math.max(0, enText.indexOf(m[0]) - 15), enText.indexOf(m[0]) + 10)}」`);
    n++;
  }
  return ok(!bad.length, bad.slice(0, 4).join("；") || `${n} 局都對`);
});

test("endpage94", () => {
  const s = summary();
  for (const p of R.pass) console.log(`  ✓ ${p.label}${p.msg ? " — " + p.msg : ""}`);
  for (const t of s.todos) console.log(`  … ${t.label} — ${t.msg}`);
  for (const x of s.failures) console.log(`  ✗ ${x.label} — ${x.msg}`);
  console.log(`  通過 ${s.pass} / 失敗 ${s.fail} / 尚未實作 ${s.todo}`);
  assert.equal(s.fail, 0, s.failures.map((x) => `${x.label}: ${x.msg}`).join("\n"));
});
