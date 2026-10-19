// The screen tells the truth (issue #92): what a rival gets when you play its card for CP, why you are placing for an
// event a rival played, what a policy forum really placed, and nothing of a face-down forum pick before it is turned
// over. Orchestrator's file: a peer may run it and falsify against it, and does not edit it.
//
//   node --test tests/truth92.test.js      (or `npm test`)
//
// Owner, 2026-10-18, to the wave-2 design canvas (⑤ 畫面說真話：拿對手的牌當 CP 會送他什麼): 「可以 開工」. The audit
// (商業盤點 A, v0.8): a rival's card played for CP always happens for the rival and the screen never said so (9 and 12
// times in two games); a triggered event asked you to place blocks without saying why; the record said 「放 4 顆」 when no
// block could be placed (40 games claimed 356, placed 21); the rivals' sayings named the issue of a face-down forum pick.
// Contract (orchestrator, #92), on the solo table as Solo.screen draws it (node; the page draws the same string):
//   - a rival's event card (owner 陳/宋/連, not yours) opened in your hand where it can be played for CP: the sheet has
//     one [data-gift="<owner's seat key>"] element whose text names the owner (short name), gives the card's text (the
//     language's own) as what the owner gets, and for every seat whose 士氣 the card moves by a fixed amount
//     (recap.js moraleOf, #90: a seat, or "all") its 士氣 now and after, "N%" each, held within 20–80; when the owner's
//     士氣 goes up and the owner has a block on the board, your chance to take one of its blocks now and after
//     (round(100 × yours / (yours + theirs)), "N%" each). Your own cards, local cards and 外力 have no [data-gift];
//   - a rival plays one of your events for CP and you are the one to make its choice: the screen has
//     [data-trigger-note] naming that rival (short name) and the card;
//   - the record's line for a settled forum issue, once the forum is over, says how many blocks the winner really put
//     down there: 「放 N 顆」 (en "N cube(s)") with N the forum's placements for that issue, or, when none could be
//     placed, that none was (zh 「沒有方塊可放」, en "no … block"); never a number that was not placed;
//   - while a rival's forum pick is face down, no screen shows its saying with that pick's issue (talk.debate_card).
// Rows on the gift note report 尚未實作 until recap.js has moraleOf and a sheet has [data-gift]; the trigger row until
// [data-trigger-note] appears; the forum and the pick rows are measured from the start. Since #92 landed (952e07f)
// every part missing is a failure, not 尚未實作.
import test from "node:test";
import assert from "node:assert/strict";
import { R, section, check, ok, nonEmpty, summary } from "./harness.js";
import * as E from "../public/shared/engine.js";
import * as S from "../public/solo.js";
import * as D from "./driver.js";
import { bind, luckNow } from "../public/table.js";
import { EVENTS } from "../public/shared/cards.js";
import zh from "../public/i18n/zh-Hant.js";
import en from "../public/i18n/en.js";

let RC = null;
try { RC = await import("../public/shared/recap.js"); } catch { /* before #90 */ }
const LANGS = ["zh-Hant", "en"];
const X = { "zh-Hant": bind("zh-Hant"), en: bind("en") };
const DICT = { "zh-Hant": zh, en };
const KEY = ["chen", "soong", "lien"], SEAT_OF = { chen: 0, soong: 1, lien: 2 };
const OWNER = Object.fromEntries(EVENTS.map((e) => [e.id, e.owner]));
const dec = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'");
const text = (html) => dec(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
// The element that carries attr (balanced on its own tag name), or null.
function element(html, attr) {
  const m = new RegExp(`<(\\w+)\\b[^>]*\\b${attr}(?:="([^"]*)")?[^>]*>`).exec(html);
  if (!m) return null;
  const tag = m[1], open = new RegExp(`<${tag}\\b`, "g"), close = new RegExp(`</${tag}>`, "g");
  let depth = 1, i = m.index + m[0].length;
  while (depth > 0) {
    open.lastIndex = i; close.lastIndex = i;
    const o = open.exec(html), c = close.exec(html);
    if (!c) return { value: m[2], html: html.slice(m.index) };
    if (o && o.index < c.index) { depth++; i = o.index + 1; } else { depth--; i = c.index + c[0].length; }
  }
  return { value: m[2], html: html.slice(m.index, i) };
}
const clamp = (n) => Math.max(20, Math.min(80, n));

// The human (陳) at a play decision in turn 1–2 of a v0.8 game, bots level 1.
function atPlay(seed) {
  let s = S.advance(S.newSolo({ seat: 0, level: 1, seed }));
  for (let n = 0; n < 60; n++) {
    const ch = S.choices(s, "zh-Hant");
    if (ch.some((c) => c.move.type === "play")) return s;
    if (!ch.length) return null;
    s = S.advance(S.act(s, ch[0].move));
  }
  return null;
}
function withCard(s0, id) {
  const s = JSON.parse(JSON.stringify(s0));
  D.giveCard(s.st, 0, id);
  return s;
}

// ------------------------------------------------------------------------------------------------ 1
section("1 拿對手的牌當 CP：寫出對手會得到什麼");
const BASE = (() => { for (let seed = 1; seed < 40; seed++) { const s = atPlay(seed); if (s) return s; } return null; })();
const GIFT_READY = () => {
  if (!RC || typeof RC.moraleOf !== "function") return "recap.js 的 moraleOf 不見了：#90 已上線（2521f07），這是退步";
  if (!BASE) return "找不到陳的出牌時機（instrument）";
  for (const e of EVENTS.filter((c) => c.owner === "soong" || c.owner === "lien")) {
    const s = withCard(BASE, e.id);
    if (!S.choices(s, "zh-Hant").some((c) => c.move.type === "play" && c.move.card === e.id && c.move.mode === "cp")) continue;
    if (element(S.screen(s, "zh-Hant", { sel: e.id }), "data-gift")) return null;
  }
  return "打開對手的牌，牌面旁邊沒有 [data-gift]：#92 已上線（952e07f），這是退步，不是尚未實作";
};
check("對手的每一張可以當 CP 的事件牌：[data-gift] 寫出主人、牌文、士氣與搶塊機率的前後（中英）", () => {
  const nr = GIFT_READY(); if (nr) return nr;
  const bad = []; let n = 0, morale = 0, rate = 0;
  for (const lang of LANGS) {
    const x = X[lang];
    for (const e of EVENTS.filter((c) => c.owner === "soong" || c.owner === "lien")) {
      const s = withCard(BASE, e.id);
      if (!S.choices(s, lang).some((c) => c.move.type === "play" && c.move.card === e.id && c.move.mode === "cp")) continue;
      const q = SEAT_OF[e.owner], v = E.view(s.st, 0), html = S.screen(s, lang, { sel: e.id }), g = element(html, "data-gift");
      n++;
      if (!g) { bad.push(`${lang} ${e.name}：沒有 [data-gift]`); continue; }
      const t = text(g.html);
      if (g.value !== KEY[q]) bad.push(`${lang} ${e.name}：data-gift="${g.value}"，主人是 ${KEY[q]}`);
      if (!t.includes(x.short(q))) bad.push(`${lang} ${e.name}：「${t.slice(0, 60)}」沒有寫 ${x.short(q)}`);
      const ct = text(x.cardText(e.id));
      if (!t.includes(ct)) bad.push(`${lang} ${e.name}：「${t.slice(0, 80)}」沒有牌文「${ct}」`);
      const delta = [0, 0, 0];
      for (const [who, d] of RC.moraleOf(e.id)) for (const p of who === "all" ? [0, 1, 2] : typeof who === "number" ? [who] : []) delta[p] += d;
      for (let p = 0; p < 3; p++) {
        if (!delta[p]) continue;
        const b = v.luck[p], a = clamp(b + delta[p]);
        if (a === b) continue;
        morale++;
        if (!t.includes(`${b}%`) || !t.includes(`${a}%`)) bad.push(`${lang} ${e.name}：「${t.slice(0, 90)}」沒有 ${x.short(p)} 的 ${b}% → ${a}%`);
      }
      const hasBlock = s.st.counties.some((c) => c.blocks.some((b) => b.o === q));
      if (delta[q] > 0 && hasBlock) {
        const mine = luckNow(v, 0), th = luckNow(v, q), th2 = clamp(v.luck[q] + delta[q]) + (th - v.luck[q]);
        const r0 = Math.round((100 * mine) / (mine + th)), r1 = Math.round((100 * mine) / (mine + th2));
        if (r0 !== r1) { rate++; if (!t.includes(`${r0}%`) || !t.includes(`${r1}%`)) bad.push(`${lang} ${e.name}：「${t.slice(0, 90)}」沒有搶 ${x.short(q)} 的機率 ${r0}% → ${r1}%`); }
      }
    }
  }
  const z = nonEmpty(n, "可以當 CP 的對手牌"); if (z !== true) return z;
  if (!morale || !rate) return `量到的牌裡沒有會動士氣（${morale}）或會改變搶塊機率（${rate}）的，分不出對錯`;
  return ok(!bad.length, bad.length ? bad.slice(0, 5).join("；") + (bad.length > 5 ? `……共 ${bad.length} 項` : "") : `${n} 張（中英）都寫了；士氣前後 ${morale} 筆、搶塊機率前後 ${rate} 筆`);
});
check("自己的牌、地方牌：打開時沒有 [data-gift]", () => {
  const nr = GIFT_READY(); if (nr) return nr;
  const bad = []; let n = 0;
  const own = EVENTS.filter((c) => c.owner === "chen").map((c) => c.id);
  const local = BASE.st.hands[0].filter((id) => !OWNER[id]);
  for (const id of [...own, ...local]) {
    const s = withCard(BASE, id);
    if (!S.choices(s, "zh-Hant").some((c) => c.move.type === "play" && c.move.card === id)) continue;
    n++;
    if (element(S.screen(s, "zh-Hant", { sel: id }), "data-gift")) bad.push(id);
  }
  const z = nonEmpty(n, "可以打的自己的牌"); if (z !== true) return z;
  return ok(!bad.length, bad.length ? `這些牌不是對手的，卻有 [data-gift]：${bad.join("、")}` : `${n} 張都沒有`);
});

// ------------------------------------------------------------------------------------------------ 2-4: walk games
// The human plays at random; every screen it gets is drawn (both languages for the first games).
const GAMES = [];
function walk(seed, langs) {
  const Rr = D.rng(seed); let s = S.advance(S.newSolo({ seat: 0, level: 2, seed }));
  const out = { seed, trig: [], picks: [], settles: [] };
  for (let n = 0; n < 900 && s.st.phase !== "end"; n++) {
    const ch = S.choices(s, "zh-Hant");
    if (!ch.length) { s = S.advance(s); continue; }
    const st = s.st, log = st.log;
    // a rival played one of your events for CP and it is you who makes the event's choice (the engine's pending effect
    // is that card's)
    const ti = log.map((e) => e.t).lastIndexOf("trigger"), tr = log[ti];
    const fx = st.pending && st.pending.fx;
    if (tr && tr.seat === 0 && OWNER[tr.card] === "chen" && fx && fx.card === tr.card && E.mustAct(st).includes(0) && !log.slice(ti + 1).some((e) => e.t === "play")) {
      const pl = [...log.slice(0, ti)].reverse().find((e) => e.t === "play");
      if (pl && pl.seat !== 0 && pl.card === tr.card) for (const lang of langs) out.trig.push({ lang, card: tr.card, by: pl.seat, html: S.screen(s, lang) });
    }
    // face-down forum picks of the rivals
    if (st.phase === "debate" && st.debate) for (let q = 1; q < 3; q++) { const pk = st.debate.picks[q]; if (pk && pk.issue) for (const lang of langs) out.picks.push({ lang, q, issue: pk.issue, html: S.screen(s, lang, { feedOpen: true }) }); }
    // after the forum: the record's settle lines
    if (st.phase !== "debate" && log.some((e) => e.t === "debate" && e.step === "end") && !out.after) out.after = langs.map((lang) => ({ lang, html: S.screen(s, lang, { feedOpen: true }) }));
    s = S.advance(S.act(s, ch[Math.floor(Rr() * ch.length)].move));
  }
  // what each settled issue really got: the forum's placements between its settle and the next settle or the end
  const log = s.st.log;
  log.forEach((e, i) => {
    if (e.t !== "debate" || e.step !== "settle") return;
    let placed = 0;
    for (const f of log.slice(i + 1)) { if (f.t === "debate" && (f.step === "settle" || f.step === "end")) break; if (f.t === "debate" && f.step === "place") placed++; }
    out.settles.push({ issue: e.issue, seat: e.seat, cubes: e.cubes, placed });
  });
  return out;
}
const games = () => { if (!GAMES.length) for (let seed = 1; seed <= 24; seed++) GAMES.push(walk(seed, seed <= 6 ? LANGS : ["zh-Hant"])); return GAMES; };

section("2 對手拿你的牌當 CP、事件替你發生、輪到你做選擇");
check("那個畫面有 [data-trigger-note]，寫出是誰打的、哪一張牌", () => {
  const all = games().flatMap((g) => g.trig);
  const z = nonEmpty(all.length, "輪到你替被觸發的事件做選擇的畫面"); if (z !== true) return z;
  if (!all.some((t) => element(t.html, "data-trigger-note"))) return `${all.length} 個這樣的畫面都沒有 [data-trigger-note]：#92 已上線（952e07f），這是退步`;
  const bad = [];
  for (const t of all) {
    const x = X[t.lang], g = element(t.html, "data-trigger-note");
    if (!g) { bad.push(`${t.lang} ${x.card(t.card)}：沒有 [data-trigger-note]`); continue; }
    const tx = text(g.html);
    if (!tx.includes(x.short(t.by)) || !tx.includes(x.card(t.card))) bad.push(`${t.lang}「${tx.slice(0, 80)}」沒有 ${x.short(t.by)} 或「${x.card(t.card)}」`);
  }
  return ok(!bad.length, bad.length ? bad.slice(0, 4).join("；") : `${all.length} 個畫面都寫了`);
});

section("3 政見發表會的紀錄寫實際放了幾顆");
check("發表會結束後，紀錄裡每個結算的議題寫的是真的放下的方塊數（沒有就寫沒有）", () => {
  const bad = []; let n = 0, zero = 0, some = 0;
  for (const g of games()) {
    if (!g.after) continue;
    for (const a of g.after) {
      // the record's rows, one by one
      const x = X[a.lang], lis = [...a.html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map((m) => text(m[1]));
      for (const st of g.settles) {
        const name = x.issue(st.issue), key = a.lang === "en" ? `${name} is settled` : `「${name}」結算`;
        const line = lis.find((l) => l.includes(key));
        if (!line) continue;
        n++; if (st.placed) some++; else zero++;
        const nums = a.lang === "en" ? [...line.matchAll(/(\d+) cubes?/g)].map((k) => Number(k[1])) : [...line.matchAll(/放 ?(\d+) ?顆/g)].map((k) => Number(k[1]));
        if (nums.some((k) => k !== st.placed)) bad.push(`種子 ${g.seed} ${a.lang}「${line.slice(0, 70)}」：實際放了 ${st.placed}`);
        else if (st.placed && !nums.includes(st.placed)) bad.push(`種子 ${g.seed} ${a.lang}「${line.slice(0, 70)}」：沒有寫放了 ${st.placed}`);
        else if (!st.placed && !(a.lang === "en" ? /\bno\b[^.;]*\bblock/i.test(line) : /沒有方塊可放/.test(line))) bad.push(`種子 ${g.seed} ${a.lang}「${line.slice(0, 70)}」：一塊都沒放，卻沒有說沒有方塊可放`);
      }
    }
  }
  const z = nonEmpty(n, "發表會之後紀錄裡的結算行"); if (z !== true) return z;
  if (!zero || !some) return `看到的結算行裡沒有「一塊都沒放」（${zero}）或「有放」（${some}）的，分不出對錯`;
  const msg = bad.slice(0, 4).join("；") + (bad.length > 4 ? `……共 ${bad.length} 行` : "");
  return ok(!bad.length, bad.length ? msg : `${n} 行都對（沒放 ${zero}、有放 ${some}）`);
});

section("4 蓋著的發表會牌不洩漏");
check("對手的牌還蓋著時，畫面上沒有他那句「翻這張，某議題靠它」", () => {
  const all = games().flatMap((g) => g.picks);
  const z = nonEmpty(all.length, "對手的發表會牌蓋著時的畫面"); if (z !== true) return z;
  const bad = [];
  for (const p of all) {
    const x = X[p.lang], tpl = DICT[p.lang].talk && DICT[p.lang].talk.debate_card;
    if (typeof tpl !== "string") return `i18n 找不到 talk.debate_card（${p.lang}）`;
    const said = text(tpl.replace("{issue}", x.issue(p.issue)));
    if (text(p.html).includes(said)) bad.push(`${p.lang} ${x.short(p.q)} 押「${x.issue(p.issue)}」：畫面上有「${said}」`);
  }
  const msg = `${bad.length} 個畫面洩漏，例：${bad.slice(0, 2).join("；")}`;
  return ok(!bad.length, bad.length ? msg : `${all.length} 個畫面都沒有洩漏`);
});

test("truth92", () => {
  const s = summary();
  for (const p of R.pass) console.log(`  ✓ ${p.label}${p.msg ? " — " + p.msg : ""}`);
  for (const t of s.todos) console.log(`  … ${t.label} — ${t.msg}`);
  for (const x of s.failures) console.log(`  ✗ ${x.label} — ${x.msg}`);
  console.log(`  通過 ${s.pass} / 失敗 ${s.fail} / 尚未實作 ${s.todo}`);
  assert.equal(s.fail, 0, s.failures.map((x) => `${x.label}: ${x.msg}`).join("\n"));
});
