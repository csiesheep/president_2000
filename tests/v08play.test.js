// The game becomes v0.8 (issue #82): new solo games, rooms and the tutorial are played with no momentum, an opponent's
// event that always triggers, the cards' morale (V10, #80) and 士氣 50/50/50, and the table shows no momentum.
// Orchestrator's file: a peer may run it and falsify against it, and does not edit it.
//
//   node --test tests/v08play.test.js      (or `npm test`)
//
// Owner, 2026-10-17, to 「要開工嗎？」 (the card texts and the rules page after V10; the game itself on these rules):
// 「yes, go ahead」. The spec is the vault's 「v0.8 草稿（士氣，沒有動能）」. Contract (orchestrator, #82):
//   - S.newSolo(...), a room's start and rematch, and the tutorial create E.createGame(seed, { rules: "v0.7", issueLuck:
//     "lead", momentum: "none", trigger: "always", moraleCards: "full", luck: [50, 50, 50] });
//   - a game saved on v0.7 with momentum (50/50/60) still opens and plays: every screen renders, every choice has words
//     (both languages), and its candidate panels still show momentum (it still counts there);
//   - a v0.8 screen (with the turn card; and the tutorial's), its choices and its "just now" lines speak of no momentum
//     (Chinese 動能; English momentum; text, aria-label, title, alt); every choice has words;
//   - when a rival plays one of the human's events for CP and it triggers by itself, the human's next screen says so:
//     the card's name is in "just now" (S.recent);
//   - TVBS 民調 played by the human with a tie for the lowest 士氣: the question and its options have words, name no
//     momentum, offer the tied seats, and the pick gets 士氣 +5;
//   - on election day, the first screen after the conversion has, in "just now", each seat's canvassing 士氣
//     min(95, 士氣 + 10 × issues led) — 陳 … N%, 宋 … N%, 連 … N% — and no momentum in those lines.
// Every check reports 尚未實作 until S.newSolo starts a v0.8 game (st.moraleCards "full").
import test from "node:test";
import assert from "node:assert/strict";
import { R, section, check, eq, ok, nonEmpty, summary } from "./harness.js";
import * as E from "../public/shared/engine.js";
import * as S from "../public/solo.js";
import * as D from "./driver.js";
import * as RC from "../src/roomcore.js";
import * as T from "../public/tutorial.js";
import { EVENTS } from "../public/shared/cards.js";
import en from "../public/i18n/en.js";

const V8 = (st) => `${st.rules} ${st.issueLuck} ${st.momentum} ${st.trigger} ${st.moraleCards} ${st.luck}`;
const WANT = "v0.7 lead none always full 50,50,50";
const READY = (() => { try { return S.newSolo({ seat: 0, level: 1, seed: 1 }).st.moraleCards === "full"; } catch { return false; } })();
// Since #82 landed (f78b8d3), a new game that is not v0.8 is a failure, not 尚未實作.
const c82 = (name, fn) => check(name, () => (READY ? fn() : "S.newSolo 開的不是 v0.8（st.moraleCards 不是 \"full\"）：#82 已上線（f78b8d3），這是退步，不是尚未實作"));
const LANGS = ["zh-Hant", "en"];
const SHORT = { "zh-Hant": ["陳", "宋", "連"], en: ["Chen", "Soong", "Lien"] };
const FORBID = { "zh-Hant": /動能/, en: /momentum/i };
const MOMW = { "zh-Hant": /動能/, en: /momentum|\bmom\b/i };
const text = (html) => (html.replace(/<[^>]+>/g, " ") + " " + [...html.matchAll(/\b(?:aria-label|title|alt)="([^"]*)"/g)].map((m) => m[1]).join(" ")).replace(/\s+/g, " ");
const NAME = { "zh-Hant": (id) => (EVENTS.find((e) => e.id === id) || {}).name, en: (id) => (en.cards[id] || {}).name };

function walk(session, lang, seed, each) {
  const Rn = D.rng(seed); let s = S.advance(session);
  for (let n = 0; n < 900 && s.st.phase !== "end"; n++) {
    const ch = S.choices(s, lang);
    if (!ch.length) { s = S.advance(s); if (!S.choices(s, lang).length && s.st.phase !== "end") throw new Error(`卡住：${s.st.phase}`); continue; }
    const pick = each(s, ch);
    s = S.advance(S.act(s, (pick || ch[Math.floor(Rn() * ch.length)]).move));
  }
  return s;
}
function tutorial(lang) {
  let s = S.advance(T.newTutorial()); const rec = [];
  for (let n = 0; n < 120; n++) {
    const at = T.step(s, lang);
    rec.push({ id: at.id, text: at.text || "", html: S.screen(s, lang) });
    if (at.kind === "done") return { rec, end: "done" };
    if (at.kind === "next") s = T.next(s);
    else if (at.kind === "county") s = T.openCounty(s, at.county);
    else if (at.kind === "move" && at.moves.length) s = S.advance(T.act(s, at.moves[0]));
    else return { rec, end: `第 ${n} 步「${at.id}」是 ${at.kind}，走不下去` };
  }
  return { rec, end: "120 步還沒走完" };
}
// The candidate panels: the HTML from each .pl-card[data-seat] to the next one, or to the end of its <article> (the last
// one; without that cut it runs into the issue track, whose "+1 mom." the first draft of this file took for the board's).
const panels = (html) => {
  const at = [...html.matchAll(/class="pl-card[^"]*" data-seat="(\d)"/g)];
  return at.map((m, i) => { const art = html.indexOf("</article>", m.index), next = i + 1 < at.length ? at[i + 1].index : m.index + 4000; return { seat: +m[1], html: html.slice(m.index, art > 0 ? Math.min(art, next) : next) }; });
};

section("82 v0.8 上場");

c82("新開的單人、新開的房間、房間的再來一局、教學都是 v0.8：沒有動能、一定觸發、牌的士氣、士氣 50/50/50", () => {
  for (const seed of [1, 2, 3]) { const st = S.newSolo({ seat: seed % 3, level: 2, seed }).st; if (V8(st) !== WANT) return `單人 seed ${seed}：${V8(st)}`; }
  let room = RC.newRoom({ code: "ABCD", seed: 11, now: 0 });
  const h = (ev) => { room = RC.handle(room, ev, 0).room; };
  h({ type: "open", conn: "A", name: "Ann", token: null }); h({ type: "msg", conn: "A", data: { t: "sit", seat: 0 } }); h({ type: "msg", conn: "A", data: { t: "start", level: 1 } });
  let r = eq(room.st && V8(room.st), WANT, "房間"); if (r !== true) return r;
  room.st = { ...room.st, phase: "end" }; h({ type: "msg", conn: "A", data: { t: "rematch" } });
  r = eq(`${V8(room.st)} ${room.st.turn}`, `${WANT} 1`, "房主按再來一局"); if (r !== true) return r;
  r = eq(V8(T.newTutorial().st), WANT, "教學"); if (r !== true) return r;
  return ok(true, "單人 3 個種子、房間、再來一局、教學都是 v0.8");
});

c82("切換前存的 v0.7 局（有動能，50/50/60）照常能玩：每個畫面都畫得出來、每個選項都有字，候選人板還看得到動能（中英）", () => {
  let screens = 0, momBoards = 0;
  for (const lang of LANGS) {
    const s0 = S.newSolo({ seat: 0, level: 1, seed: 5 }); s0.st = E.createGame(5, { rules: "v0.7", issueLuck: "lead" });
    const s = walk(s0, lang, 77, (x, ch) => {
      const html = S.screen(x, lang, { turnCard: true }); screens++;
      if (x.st.phase === "action" && panels(html).some((p) => MOMW[lang].test(text(p.html)))) momBoards++;
      const bad = ch.find((c) => !c.label || !String(c.label).trim()); if (bad) throw new Error(`沒有字的選項：${JSON.stringify(bad.move)}`);
    });
    if (s.st.phase !== "end") return `${lang}：v0.7 的局沒有走完（${s.st.phase}）`;
  }
  const r = nonEmpty(screens, "v0.7 舊局的畫面"); if (r !== true) return r;
  if (!momBoards) return `v0.7 舊局（有動能）走了 ${screens} 個畫面，候選人板一次都沒寫動能：舊局的動能還算數（觸發、平手），不能跟著 v0.8 藏起來`;
  return ok(true, `${screens} 個畫面，中英都走完；${momBoards} 個行動階段畫面的候選人板寫著動能`);
});

c82("整局 v0.8 與教學的畫面（連回合卡、屬性、選項、「剛剛」）沒有動能；每個選項都有字（中英）", () => {
  let screens = 0;
  const look = (where, html, extra = "") => {
    const t = text(html) + " " + extra, m = t.match(FORBID[where.lang]);
    if (m) throw new Error(`${where.what}：「${t.slice(Math.max(0, m.index - 30), m.index + 30)}」`);
    screens++;
  };
  for (const lang of LANGS) {
    for (const seed of [81, 82]) walk(S.newSolo({ seat: seed % 3, level: 2, seed }), lang, seed + 100, (s, ch) => {
      look({ lang, what: `${lang} seed ${seed} 第 ${s.st.turn} 回合（${s.st.phase}）` }, S.screen(s, lang, { turnCard: true }), ch.map((c) => c.label).join(" ") + " " + S.recent(s, lang).join(" ") + " " + (S.lastResult(s, lang) || ""));
      const bad = ch.find((c) => !c.label || !String(c.label).trim()); if (bad) throw new Error(`${lang}：沒有字的選項 ${JSON.stringify(bad.move)}`);
    });
    const w = tutorial(lang); if (w.end !== "done") return `${lang} 教學：${w.end}`;
    for (const r of w.rec) look({ lang, what: `${lang} 教學「${r.id}」` }, r.html, r.text);
  }
  const r = nonEmpty(screens, "v0.8 的畫面"); if (r !== true) return r;
  return ok(true, `${screens} 個畫面（中英各兩局與教學）`);
});

c82("對手把你的事件當 CP 打出、它自動替你發生之後，你下一個畫面的「剛剛」寫出那張牌（中英）", () => {
  let n = 0;
  for (const lang of LANGS) for (const seed of [83, 84]) {
    let seen = 0;
    walk(S.newSolo({ seat: seed % 3, level: 2, seed }), lang, seed + 9, (s) => {
      const autos = s.st.log.filter((e) => e.t === "trigger" && e.auto && e.seat === s.seat);
      if (autos.length <= seen) return;
      const fresh = autos.slice(seen); seen = autos.length;
      const lines = S.recent(s, lang).join(" ");
      for (const e of fresh) {
        const name = NAME[lang](e.card);
        if (!name || !lines.includes(name)) throw new Error(`${lang} seed ${seed} 第 ${s.st.turn} 回合：「${name || e.card}」自動替你發生了，「剛剛」沒寫出它：${lines.slice(0, 200)}`);
        n++;
      }
    });
  }
  const r = nonEmpty(n, "替你自動發生的事件"); if (r !== true) return r;
  return ok(true, `${n} 次替你自動發生的事件，「剛剛」都寫出那張牌`);
});

c82("TVBS 民調（士氣最低者 +5%）平手時：你的問題與選項有字、不提動能、列出平手的人，選的人士氣 +5（中英）", () => {
  let asked = 0;
  for (const lang of LANGS) for (const tie of [[40, 40, 60], [50, 50, 50]]) {
    let s = S.advance(S.newSolo({ seat: 0, level: 1, seed: 85 }));
    for (let n = 0; n < 200 && !(s.st.phase === "action" && S.choices(s, lang).some((c) => c.move.type === "play")); n++) {
      if (S.botsToMove(s).length) { s = S.stepBot(s); continue; }
      const ch = S.choices(s, lang); s = ch.length ? S.act(s, ch[0].move) : S.advance(s);
    }
    if (!S.choices(s, lang).some((c) => c.move.type === "play")) return `${lang}：等不到你出牌的畫面`;
    const st = structuredClone(s.st); st.luck = tie.slice(); st.hands[s.seat] = ["tvbs_poll", ...st.hands[s.seat].filter((id) => id !== "tvbs_poll").slice(1)];
    s = { ...s, st };
    const play = S.choices(s, lang).find((c) => c.move.type === "play" && c.move.card === "tvbs_poll" && c.move.mode === "event");
    if (!play) return `${lang}：手上有 TVBS 民調，卻沒有「當事件打出」的選項：${S.choices(s, lang).map((c) => c.label).join(" / ").slice(0, 200)}`;
    const after = S.advance(S.act(s, play.move)), ch = S.choices(after, lang), html = text(S.screen(after, lang)) + " " + ch.map((c) => c.label).join(" ");
    const lows = [0, 1, 2].filter((p) => tie[p] === Math.min(...tie));
    if (ch.length !== lows.length) return `${lang} 士氣 ${tie.join("/")}：平手的是 ${lows.map((p) => SHORT[lang][p]).join("、")}，選項卻有 ${ch.length} 個：${ch.map((c) => c.label).join(" / ")}`;
    if (ch.some((c) => !c.label || !String(c.label).trim())) return `${lang}：有沒有字的選項`;
    const m = html.match(FORBID[lang]); if (m) return `${lang} 士氣 ${tie.join("/")}：TVBS 的問題提到動能：「${html.slice(Math.max(0, m.index - 30), m.index + 30)}」`;
    for (const p of lows) if (!ch.some((c) => c.label.includes(SHORT[lang][p]))) return `${lang}：選項沒寫出${SHORT[lang][p]}：${ch.map((c) => c.label).join(" / ")}`;
    const pick = ch.find((c) => c.label.includes(SHORT[lang][lows[lows.length - 1]])), done = S.act(after, pick.move);
    const want = tie.slice(); want[lows[lows.length - 1]] += 5;
    if (done.st.luck.join() !== want.join()) return `${lang}：選了${SHORT[lang][lows[lows.length - 1]]}，士氣變成 ${done.st.luck.join("/")}（應為 ${want.join("/")}）`;
    asked++;
  }
  return ok(true, `${asked} 次平手（兩人平手、三人平手，中英）：問題與選項都有字、不提動能、列出平手的人，選的人 +5`);
});

c82("投票日：轉換之後你看到的第一個畫面，「剛剛」有一行寫出三家的催票士氣（士氣 + 10 × 領先的議題，最多 95%），不提動能（中英）", () => {
  let n = 0, led = 0;
  for (const lang of LANGS) for (const seed of [86, 87, 88]) {
    let seen = false;
    walk(S.newSolo({ seat: seed % 3, level: 2, seed }), lang, seed + 5, (s) => {
      const conv = s.st.log.find((e) => e.t === "convert"); if (!conv || seen) return;
      seen = true;
      const want = [0, 1, 2].map((p) => Math.min(95, s.st.luck[p] + 10 * ((conv.leads || [0, 0, 0])[p])));
      const lines = S.recent(s, lang);
      const hit = lines.find((l) => [0, 1, 2].every((p) => new RegExp(`${SHORT[lang][p]}[^%]{0,16}?${want[p]} ?%`).test(l)));
      if (!hit) throw new Error(`${lang} seed ${seed}：催票士氣應為 ${want.map((w, p) => `${SHORT[lang][p]} ${w}%`).join("、")}；「剛剛」：${JSON.stringify(lines).slice(0, 240)}`);
      if (FORBID[lang].test(hit)) throw new Error(`${lang} seed ${seed}：轉換那一行還提到動能：「${hit}」`);
      n++; if ((conv.leads || []).some((x) => x > 0)) led++;
    });
  }
  const r = nonEmpty(n, "投票日的轉換"); if (r !== true) return r;
  return ok(true, `${n} 局（中英）的轉換都寫出三家的催票士氣、不提動能（${led} 局有人領先議題）`);
});

test("v08play", () => {
  const s = summary();
  for (const p of R.pass) console.log(`  ✓ ${p.label}${p.msg ? " — " + p.msg : ""}`);
  for (const t of s.todos) console.log(`  … ${t.label} — ${t.msg}`);
  for (const x of s.failures) console.log(`  ✗ ${x.label} — ${x.msg}`);
  console.log(`  通過 ${s.pass} / 失敗 ${s.fail} / 尚未實作 ${s.todo}`);
  assert.equal(s.fail, 0, s.failures.map((x) => `${x.label}: ${x.msg}`).join("\n"));
});
