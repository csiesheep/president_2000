// The first game teaches as it goes (issue #96): each of seven new things gets one short box the first time it comes
// up. Orchestrator's file: a peer may run it and falsify against it, and does not edit it. That a tap on 「知道了」 or
// 「不再提示」 is kept on this device is the page's (tools/tips96.mjs).
//
//   node --test tests/tips96.test.js      (or `npm test`)
//
// Owner, 2026-10-18, to the wave-2 design canvas (④ 第一局就是教學：新東西第一次出現時說一句; 「第一次遇到 · 7 件裡的
// 第 1 件」; 「第一局會遇到的 7 件事：觸發、搶塊、留牌、政見發表會、催票、棄保、背書。每件只在第一次出現時說一次。」;
// 「知道了 / 不再提示」): 「可以 開工」. Contract (orchestrator, #96): Solo.screen(session, lang, { tipsSeen }) — the ids
// already seen on this device, "off" for no tips at all — draws at most one [data-tip="<id>" data-tip-n="<1–7>"] on the
// human's decision, the first of these, in this order, whose moment it is and that is not seen:
//   1 trigger   you make the choice of your own event that a rival played for CP;
//   2 steal     your choices include taking a rival's block (steal / remove);
//   3 save      you keep cards for later (the save phase, more than one choice);
//   4 debate    you pick a card at a policy forum;
//   5 canvass   you canvass on election day;
//   6 strategic election day (棄保 comes after the canvassing);
//   7 endorse   you hold an endorsement.
// In the box: zh 「第一次遇到」 (en "First time") with its number and 7; a [data-tip-ok] and a [data-tip-off] button;
// trigger names the card and the rival who played it; steal gives the chance of one of the steals you are offered
// (round(checkRate), "N%"); endorse names the region you hold; every box has words beyond its heading, in English
// without Chinese. Never in the tutorial. Reports 尚未實作 until some screen has [data-tip].
import test from "node:test";
import assert from "node:assert/strict";
import { R, section, check, ok, nonEmpty, summary } from "./harness.js";
import * as E from "../public/shared/engine.js";
import * as S from "../public/solo.js";
import * as T from "../public/tutorial.js";
import * as D from "./driver.js";
import { bind, checkRate } from "../public/table.js";
import { EVENTS } from "../public/shared/cards.js";
import { REGIONS } from "../public/shared/board.js";

const IDS = ["trigger", "steal", "save", "debate", "canvass", "strategic", "endorse"];
const LANGS = ["zh-Hant", "en"];
const X = { "zh-Hant": bind("zh-Hant"), en: bind("en") };
const OWNER = Object.fromEntries(EVENTS.map((e) => [e.id, e.owner]));
const CJK = /[㐀-鿿豈-﫿]/;
const dec = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'");
const text = (html) => dec(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
function tips(html) {
  const out = [], re = /<(\w+)\b([^>]*\bdata-tip="([^"]*)"[^>]*)>/g;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[1], open = new RegExp(`<${tag}\\b`, "g"), close = new RegExp(`</${tag}>`, "g");
    let depth = 1, i = m.index + m[0].length;
    while (depth > 0) { open.lastIndex = i; close.lastIndex = i; const o = open.exec(html), c = close.exec(html); if (!c) { i = html.length; break; } if (o && o.index < c.index) { depth++; i = o.index + 1; } else { depth--; i = c.index + c[0].length; } }
    const n = (m[2].match(/data-tip-n="(\d+)"/) || [])[1];
    out.push({ id: m[3], n: n == null ? null : Number(n), html: html.slice(m.index, i) });
  }
  return out;
}
// Which moments hold on the human's decision, in the contract's order.
function moments(s, ch) {
  const st = s.st, v = E.view(st, s.seat), me = s.seat, log = st.log, held = [];
  const ti = log.map((e) => e.t).lastIndexOf("trigger"), tr = log[ti], fx = st.pending && st.pending.fx;
  if (tr && tr.seat === me && OWNER[tr.card] === ["chen", "soong", "lien"][me] && fx && fx.card === tr.card && !log.slice(ti + 1).some((e) => e.t === "play")) {
    const pl = [...log.slice(0, ti)].reverse().find((e) => e.t === "play");
    if (pl && pl.seat !== me && pl.card === tr.card) held.push({ id: "trigger", card: tr.card, by: pl.seat });
  }
  const steals = ch.filter((c) => (c.move.type === "steal" || c.move.type === "remove") && c.move.target != null && c.move.target !== me);
  if (steals.length) held.push({ id: "steal", rates: [...new Set(steals.map((c) => Math.round(checkRate(v, me, c.move))).filter((x) => Number.isFinite(x)))] });
  if (st.phase === "save" && ch.length > 1) held.push({ id: "save" });
  if (st.phase === "debate" && ch.some((c) => c.move.type === "reveal")) held.push({ id: "debate" });
  if (st.phase === "election" && ch.some((c) => c.move.type === "canvass")) held.push({ id: "canvass" });
  if (st.phase === "election") held.push({ id: "strategic" });
  const r = (st.endorse || []).findIndex((h) => h === me);
  if (r >= 0) held.push({ id: "endorse", region: r });
  return held;
}
// Random games of the human (陳, 宋 or 連) against level-2 bots; at the first moment of each tip in a game, the screen
// drawn with nothing seen, with the first one seen, and with "off"; every 40th decision with no moment, nothing seen.
let G = null;
function games() {
  if (G) return G;
  G = { first: [], quiet: [], seen: Object.fromEntries(IDS.map((k) => [k, 0])) };
  for (let seed = 1; seed <= 18; seed++) {
    const seat = seed % 3, Rr = D.rng(seed * 101 + 3), done = new Set();
    let s = S.advance(S.newSolo({ seat, level: 2, seed })), k = 0;
    for (let n = 0; n < 900 && s.st.phase !== "end"; n++) {
      const ch = S.choices(s, "zh-Hant");
      if (!ch.length) { s = S.advance(s); continue; }
      const held = moments(s, ch), fresh = held.filter((h) => !done.has(h.id));
      const langs = seed <= 4 ? LANGS : ["zh-Hant"];
      if (fresh.length) {
        for (const h of fresh) { done.add(h.id); G.seen[h.id]++; }
        for (const lang of langs) G.first.push({ seed, lang, held, none: S.screen(s, lang, { tipsSeen: [] }), one: S.screen(s, lang, { tipsSeen: [held[0].id] }), off: S.screen(s, lang, { tipsSeen: ["off"] }), seat, v: E.view(s.st, seat) });
      } else if (!held.length && k++ % 40 === 0) G.quiet.push({ seed, html: S.screen(s, "zh-Hant", { tipsSeen: [] }) });
      s = S.advance(S.act(s, ch[Math.floor(Rr() * ch.length)].move));
    }
  }
  return G;
}
const READY = () => (games().first.some((f) => tips(f.none).length) ? null : "沒有任何畫面有 [data-tip]：#96 已上線（4160c94），這是退步，不是尚未實作");
const c96 = (name, fn) => check(name, () => READY() || fn());

section("96 第一局就是教學");
c96("七件事在 18 局裡都遇得到（母體）", () => {
  const s = games().seen, miss = IDS.filter((k) => !s[k]);
  return ok(!miss.length, miss.length ? `這幾件一局都沒遇到，分不出對錯：${miss.join("、")}` : IDS.map((k) => `${k} ${s[k]}`).join("、"));
});
c96("遇到的那一刻：一個畫面最多一框，是照順序第一件沒看過的；看過就換下一件；「off」就一框都沒有", () => {
  const bad = [];
  for (const f of games().first) {
    const a = tips(f.none), b = tips(f.one), c = tips(f.off), want0 = f.held[0].id, want1 = f.held[1] ? f.held[1].id : null;
    if (a.length !== 1 || a[0].id !== want0) bad.push(`種子 ${f.seed} ${f.lang}（${f.held.map((h) => h.id).join(",")}）：沒看過時是 ${JSON.stringify(a.map((t) => t.id))}，應是 ${want0}`);
    if (b.length !== (want1 ? 1 : 0) || (want1 && b[0].id !== want1)) bad.push(`種子 ${f.seed} ${f.lang}：看過 ${want0} 之後是 ${JSON.stringify(b.map((t) => t.id))}，應是 ${want1 || "沒有"}`);
    if (c.length) bad.push(`種子 ${f.seed} ${f.lang}：off 還有 ${c.map((t) => t.id).join(",")}`);
    if (a[0] && a[0].n !== IDS.indexOf(a[0].id) + 1) bad.push(`種子 ${f.seed} ${f.lang}：${a[0].id} 的 data-tip-n 是 ${a[0].n}`);
  }
  const z = nonEmpty(games().first.length, "第一次遇到的畫面"); if (z !== true) return z;
  return ok(!bad.length, bad.slice(0, 4).join("；") + (bad.length > 4 ? `……共 ${bad.length} 項` : "") || `${games().first.length} 個畫面都對`);
});
c96("沒有要說的時候不出框", () => {
  const q = games().quiet, bad = q.filter((x) => tips(x.html).length).map((x) => `種子 ${x.seed}：${tips(x.html).map((t) => t.id).join(",")}`);
  const z = nonEmpty(q.length, "沒有任何一件事的畫面"); if (z !== true) return z;
  return ok(!bad.length, bad.slice(0, 4).join("；") || `${q.length} 個畫面都沒有`);
});
c96("框裡：「第一次遇到」與第幾件、兩顆按鈕、觸發寫牌名與打牌的人、搶塊寫一個成功率、背書寫區域；英文沒有中文", () => {
  const bad = [];
  for (const f of games().first) {
    const t = tips(f.none)[0]; if (!t) continue;
    const x = X[f.lang], tx = text(t.html), h = f.held.find((y) => y.id === t.id);
    const head = f.lang === "en" ? "First time" : "第一次遇到";
    if (!tx.includes(head) || !tx.includes(String(t.n)) || !tx.includes("7")) bad.push(`種子 ${f.seed} ${f.lang} ${t.id}：「${tx.slice(0, 40)}」沒有「${head}」、${t.n} 或 7`);
    if (!/data-tip-ok/.test(t.html) || !/data-tip-off/.test(t.html)) bad.push(`種子 ${f.seed} ${f.lang} ${t.id}：沒有 [data-tip-ok] 或 [data-tip-off]`);
    if (tx.length < head.length + 12) bad.push(`種子 ${f.seed} ${f.lang} ${t.id}：只有「${tx}」`);
    if (t.id === "trigger" && !(tx.includes(x.card(h.card)) && tx.includes(x.short(h.by)))) bad.push(`種子 ${f.seed} ${f.lang} trigger：「${tx.slice(0, 80)}」沒有「${x.card(h.card)}」或 ${x.short(h.by)}`);
    if (t.id === "steal" && !h.rates.some((r) => tx.includes(`${r}%`))) bad.push(`種子 ${f.seed} ${f.lang} steal：「${tx.slice(0, 80)}」沒有任何一個搶塊機率 ${h.rates.map((r) => r + "%").join("/")}`);
    if (t.id === "endorse" && !tx.includes(x.region(h.region))) bad.push(`種子 ${f.seed} ${f.lang} endorse：「${tx.slice(0, 80)}」沒有 ${x.region(h.region)}`);
    if (f.lang === "en" && CJK.test(tx)) bad.push(`種子 ${f.seed} en ${t.id}：「${tx.slice(0, 60)}」有中文`);
  }
  return ok(!bad.length, bad.slice(0, 4).join("；") + (bad.length > 4 ? `……共 ${bad.length} 項` : "") || "每一框都對");
});
c96("新手教學裡不出框", () => {
  let s = S.advance(T.newTutorial()), n = 0, end = "120 步還沒走完"; const bad = [];
  for (let i = 0; i < 120; i++) {
    const at = T.step(s, "zh-Hant");
    const html = S.screen(s, "zh-Hant", { tipsSeen: [] }); n++;
    if (tips(html).length) bad.push(`第 ${i} 步（${at.id}）：${tips(html).map((t) => t.id).join(",")}`);
    if (at.kind === "done") { end = null; break; }
    if (at.kind === "next") s = T.next(s);
    else if (at.kind === "county") s = T.openCounty(s, at.county);
    else if (at.kind === "move" && at.moves.length) s = S.advance(T.act(s, at.moves[0]));
    else { end = `第 ${i} 步「${at.id}」是 ${at.kind}，走不下去`; break; }
  }
  if (end) return `教學走不完（instrument）：${end}`;
  return ok(!bad.length, bad.slice(0, 3).join("；") || `教學 ${n} 個畫面都沒有`);
});

test("tips96", () => {
  const s = summary();
  for (const p of R.pass) console.log(`  ✓ ${p.label}${p.msg ? " — " + p.msg : ""}`);
  for (const t of s.todos) console.log(`  … ${t.label} — ${t.msg}`);
  for (const x of s.failures) console.log(`  ✗ ${x.label} — ${x.msg}`);
  console.log(`  通過 ${s.pass} / 失敗 ${s.fail} / 尚未實作 ${s.todo}`);
  assert.equal(s.fail, 0, s.failures.map((x) => `${x.label}: ${x.msg}`).join("\n"));
});
