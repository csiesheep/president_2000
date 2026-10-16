// The game becomes v0.5 (issue #53): new solo games and new rooms are played on rulebook v0.5, and the table shows it.
// Orchestrator's file: a peer may run it and falsify against it, and does not edit it.
//
//   node --test tests/v05play.test.js      (or `npm test`)
//
// Owner, 2026-10-15, after the v0.5 simulations (#49): 「改成 v0.5」. Contract (orchestrator, #53):
//   - S.newSolo(...) starts a v0.5 game (st.rules === "v0.5"), the tutorial too; a room's game ("start") is v0.5;
//   - a game saved before the switch (its state has no `rules`: v0.4, with media) still opens and plays: every screen
//     renders and every choice has words;
//   - a v0.5 game shows no ads and no media anywhere (Chinese: no 廣告 or 媒體; English: no "ad(s)", "advert…" or
//     "media"; the card names 黨產廣告 / Party-Assets Ads / Massive Ad Buy aside), no [data-media-national];
//   - 「任一議題」: when a card asks which issue, each choice has words naming its issue and how many cubes, and no CP
//     (it is the card's effect, it costs nothing; 「清廉 · 放 1 顆（1 CP）」 is the issue action's wording): three for
//     putting cubes on (羅文嘉文宣部: 2), 開除宋楚瑜黨籍 only the issues where 宋 has cubes, naming 宋 (Soong);
//   - the issue leader (most cubes over the three issues, a tie is nobody) is on the table: [data-issue-lead="<seat or
//     -1>"], its text with each candidate's total (陳 n, 宋 n, 連 n);
//   - when the issue leader gains its +1 momentum, the "just now" lines (S.recent) say so with 「議題總領先者」.
// Every check reports 尚未實作 until S.newSolo starts a v0.5 game (or a later rule set built on it: v0.6, #57, keeps all of
// this — no media, the issue leader — so these checks keep holding after the game moves on).
import test from "node:test";
import assert from "node:assert/strict";
import { R, section, check, eq, ok, nonEmpty, summary } from "./harness.js";
import * as E from "../public/shared/engine.js";
import * as S from "../public/solo.js";
import * as D from "./driver.js";
import * as RC from "../src/roomcore.js";

const LATER = ["v0.5", "v0.6", "v0.7"]; // v0.5 and the rule sets built on it
const READY = (() => { try { return LATER.includes(S.newSolo({ seat: 0, level: 1, seed: 1 }).st.rules); } catch { return false; } })();
const c53 = (name, fn) => check(name, () => (READY ? fn() : "TODO: S.newSolo 開的還不是 v0.5（st.rules），#53"));
const LANGS = ["zh-Hant", "en"];
const SHORT = ["陳", "宋", "連"];
const ISSUE = { "zh-Hant": { cross: "兩岸", clean: "清廉", econ: "經濟民生" }, en: { cross: "Cross-Strait", clean: "Clean Politics", econ: "Economy" } };
// The words a v0.5 screen must not have (card names that carry them stripped first).
const strip = (html) => html.replace(/黨產廣告|Party-Assets Ads|Massive Ad Buy/g, "");
const FORBID = { "zh-Hant": /廣告|媒體/, en: /\bads?\b|advert|\bmedia\b/i };
const forbidden = (html, lang) => { const h = strip(html), m = h.match(FORBID[lang]); return m ? h.slice(Math.max(0, m.index - 40), m.index + 40).replace(/\s+/g, " ") : null; };
const leaderOf = (st) => { const t = [0, 1, 2].map((p) => st.issues.reduce((s, i) => s + i.cubes[p], 0)); const max = Math.max(...t); return { t, lead: t.filter((x) => x === max).length === 1 ? t.indexOf(max) : -1 }; };
const issueLead = (html) => { const m = html.match(/<([a-z]+)[^>]*data-issue-lead="(-?\d)"[^>]*>([\s\S]*?)<\/\1>/); return m ? { seat: Number(m[2]), text: m[3].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() } : null; };

// A whole solo game: the human (seat 0) picks at random among the choices; returns what each human screen showed.
function walk(session, lang, seed, each) {
  const Rn = D.rng(seed); let s = S.advance(session), n = 0;
  for (; n < 900 && s.st.phase !== "end"; n++) {
    const ch = S.choices(s, lang);
    if (!ch.length) { s = S.advance(s); if (!S.choices(s, lang).length && s.st.phase !== "end") throw new Error(`卡住：${s.st.phase}`); continue; }
    each(s, ch);
    s = S.advance(S.act(s, ch[Math.floor(Rn() * ch.length)].move));
  }
  return { s, n };
}
// The human (seat) at a play decision of turn 1 holding card `id`.
function holding(seat, id, seed = 3) {
  let s = S.advance(S.newSolo({ seat, level: 1, seed }));
  for (let i = 0; i < 20; i++) {
    const legal = E.legalMoves(s.st, seat);
    if (legal.some((m) => m.type === "play")) break;
    s = S.advance(S.act(s, legal[0]));
  }
  D.giveCard(s.st, seat, id);
  return s;
}

section("53 v0.5 上場");
c53("新開的單人是 v0.5（或之後的版本）；新開的房間也一樣", () => {
  for (const seed of [1, 2, 3]) { const st = S.newSolo({ seat: 0, level: 2, seed }).st; if (!LATER.includes(st.rules) || st.media !== undefined) return `單人 seed ${seed}：rules ${st.rules}、media ${JSON.stringify(st.media)}`; }
  let room = RC.newRoom({ code: "ABCD", seed: 11, now: 0 });
  const h = (ev) => { room = RC.handle(room, ev, 0).room; };
  h({ type: "open", conn: "A", name: "Ann", token: null }); h({ type: "msg", conn: "A", data: { t: "sit", seat: 0 } }); h({ type: "msg", conn: "A", data: { t: "start", level: 1 } });
  if (!room.st) return "房間開局之後沒有 st";
  if (room.st.rules !== S.newSolo({ seat: 0, level: 1, seed: 1 }).st.rules) return `房間的 st.rules 是 ${room.st.rules}，單人是 ${S.newSolo({ seat: 0, level: 1, seed: 1 }).st.rules}`;
  return ok(true, `單人 3 個種子、房間都是 ${room.st.rules}，沒有媒體`);
});
c53("切換前存的 v0.4 單人照常能玩：每個畫面都畫得出來、每個選項都有字（中英）", () => {
  let screens = 0;
  for (const lang of LANGS) {
    const s0 = S.newSolo({ seat: 0, level: 1, seed: 5 }); s0.st = E.createGame(5); // a state from before the switch: no rules, with media
    if (s0.st.rules !== undefined && s0.st.rules !== "v0.4") return "E.createGame(5) 不是 v0.4 了";
    const { s } = walk(s0, lang, 77, (x, ch) => { S.screen(x, lang); screens++; const bad = ch.find((c) => !c.label || !String(c.label).trim()); if (bad) throw new Error(`沒有字的選項：${JSON.stringify(bad.move)}`); });
    if (s.st.phase !== "end") return `${lang}：v0.4 的局沒有走完（${s.st.phase}）`;
  }
  return ok(true, `${screens} 個畫面，中英都走完`);
});
c53("整局 v0.5 的畫面沒有廣告也沒有媒體（中英）；每個選項都有字", () => {
  let screens = 0;
  for (const lang of LANGS) for (const seed of [31, 32]) {
    walk(S.newSolo({ seat: 0, level: 2, seed }), lang, seed + 100, (s, ch) => {
      const html = S.screen(s, lang); screens++;
      const f = forbidden(html, lang); if (f) throw new Error(`${lang} seed ${seed} 第 ${s.st.turn} 回合：「${f}」`);
      if (/data-media-national/.test(html)) throw new Error(`${lang} seed ${seed}：還有 data-media-national`);
      const bad = ch.find((c) => !c.label || !String(c.label).trim()); if (bad) throw new Error(`${lang}：沒有字的選項 ${JSON.stringify(bad.move)}`);
    });
  }
  const r = nonEmpty(screens, "v0.5 的畫面"); if (r !== true) return r;
  return ok(true, `${screens} 個畫面（中英各兩局）`);
});
c53("「任一議題」：三個議題各一個選項，字寫出議題與顆數、不寫 CP；開除宋楚瑜黨籍只給宋有方塊的議題、寫出宋（中英）", () => {
  const out = [];
  for (const lang of LANGS) {
    let s = holding(0, "lo_propaganda");
    s = S.act(s, { type: "play", card: "lo_propaganda", mode: "event" });
    const ch = S.choices(s, lang).filter((c) => c.move.type === "issue");
    if (ch.length !== 3) return `${lang} 羅文嘉文宣部：議題選項 ${ch.length} 個（3）：${JSON.stringify(S.choices(s, lang).map((c) => c.move))}`;
    for (const c of ch) if (!String(c.label).includes(ISSUE[lang][c.move.issue]) || !/2/.test(c.label) || /CP/.test(c.label)) return `${lang} 羅文嘉文宣部的選項「${c.label}」：要寫出 ${ISSUE[lang][c.move.issue]} 與 2 顆，不寫 CP`;
    let t = holding(2, "expel_soong");
    t.st.issues.find((i) => i.name === "clean").cubes[1] = 3; t.st.issues.find((i) => i.name === "cross").cubes[1] = 1; t.st.issues.find((i) => i.name === "econ").cubes[1] = 0;
    t = S.act(t, { type: "play", card: "expel_soong", mode: "event" });
    const cx = S.choices(t, lang).filter((c) => c.move.type === "issue");
    if (cx.map((c) => c.move.issue).sort().join() !== "clean,cross") return `${lang} 開除宋楚瑜黨籍：選項 ${JSON.stringify(cx.map((c) => c.move))}（清廉、兩岸）`;
    for (const c of cx) if (!String(c.label).includes(ISSUE[lang][c.move.issue]) || !String(c.label).includes(lang === "en" ? "Soong" : "宋") || /CP/.test(c.label)) return `${lang} 開除宋楚瑜黨籍的選項「${c.label}」：要寫出 ${ISSUE[lang][c.move.issue]} 與宋，不寫 CP`;
    out.push(`${lang}：${ch.map((c) => c.label).join("／")}；${cx.map((c) => c.label).join("／")}`);
  }
  return ok(true, out.join("｜"));
});
c53("議題總領先者在牌桌上：[data-issue-lead] 是領先者（平手 -1），字裡有三人各自的總數", () => {
  let n = 0;
  walk(S.newSolo({ seat: 0, level: 2, seed: 41 }), "zh-Hant", 141, (s) => {
    const html = S.screen(s, "zh-Hant"), got = issueLead(html), want = leaderOf(s.st);
    if (!got) throw new Error(`第 ${s.st.turn} 回合：畫面上沒有 [data-issue-lead]`);
    if (got.seat !== want.lead) throw new Error(`第 ${s.st.turn} 回合：data-issue-lead=${got.seat}，總數 ${want.t.join("/")} 的領先者是 ${want.lead}`);
    for (let p = 0; p < 3; p++) if (!new RegExp(SHORT[p] + "\\s*" + want.t[p] + "(?!\\d)").test(got.text)) throw new Error(`第 ${s.st.turn} 回合：「${got.text}」沒寫 ${SHORT[p]} ${want.t[p]}`);
    n++;
  });
  const r = nonEmpty(n, "量過的畫面"); if (r !== true) return r;
  return ok(true, `${n} 個畫面的 data-issue-lead 都對`);
});
c53("議題總領先者 +1 動能時，「剛剛」那幾行寫出「議題總領先者」", () => {
  let leads = 0, said = 0;
  for (const seed of [51, 52, 53]) {
    let seen = 0;
    walk(S.newSolo({ seat: 0, level: 2, seed }), "zh-Hant", seed + 7, (s) => {
      const now = s.st.log.filter((e) => e.t === "momentum" && e.step === "lead").length;
      if (now > seen) { leads += now - seen; seen = now; if (S.recent(s, "zh-Hant").some((l) => /議題總領先者/.test(l))) said++; }
    });
  }
  const r = nonEmpty(leads, "議題總領先者 +1 的回合"); if (r !== true) return r;
  return said >= 1 ? ok(true, `${leads} 次 +1，其中 ${said} 次輪到你時「剛剛」寫出議題總領先者`) : `${leads} 次議題總領先者 +1，「剛剛」一次都沒寫出「議題總領先者」`;
});

test("v05play", () => {
  const s = summary();
  for (const p of R.pass) console.log(`  ✓ ${p.label}${p.msg ? " — " + p.msg : ""}`);
  for (const t of s.todos) console.log(`  … ${t.label} — ${t.msg}`);
  for (const x of s.failures) console.log(`  ✗ ${x.label} — ${x.msg}`);
  console.log(`  通過 ${s.pass} / 失敗 ${s.fail} / 尚未實作 ${s.todo}`);
  assert.equal(s.fail, 0, s.failures.map((x) => `${x.label}: ${x.msg}`).join("\n"));
});
