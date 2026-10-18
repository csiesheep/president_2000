// The game becomes v0.7 with option 丙 (issue #60): new solo games, rooms and the tutorial are played on rulebook v0.7
// (luck instead of the bag and the rest cubes; issues led on election day add canvassing luck), and the table shows it.
// Orchestrator's file: a peer may run it and falsify against it, and does not edit it.
//
//   node --test tests/v07play.test.js      (or `npm test`)
//
// Owner, 2026-10-16, after the #58 simulations: 「丙 + v0.7」 (v0.7 as drafted, luck 50/50/60, with option 丙). Contract
// (orchestrator, #60):
//   - S.newSolo(...), a room's start and rematch, and the tutorial create E.createGame(seed, { rules: "v0.7", issueLuck:
//     "lead" }): st.rules "v0.7", st.issueLuck "lead", st.luck [50, 50, 60];
//   - a game saved on v0.6 still opens and plays: every screen renders, every choice has words (both languages);
//   - a v0.7 screen (with the turn card; and the tutorial's) speaks of no bag and no rest cubes (Chinese 袋 / 休息方塊 /
//     休息區 / 補袋; English bag(s), rest cube(s), rest area; text, aria-label, title, alt) and draws no rest cubes on
//     the cards' stubs ([data-rest]); every choice has words;
//   - each candidate panel (.pl-card[data-seat]) shows that seat's luck: 「運氣 N%」 / "Luck N%", N its st.luck (or 50 for
//     連 in a turn of 省府舊部);
//   - a choice that says 「 · 檢定約 N%」 makes a support check whose chance (the check log's p, #55: 我 ÷ (我 + 對手) when
//     there is a particular opponent) rounds to N; one that says 「 · 免檢定」 makes none; 連's candidate card says 4 CP;
//   - after the human's own check, the result line (S.lastResult) gives the chance used, 「N%」, and does not speak of
//     drawing a cube (抽到);
//   - on election day, the first screen the human sees after the conversion has, in "just now" (S.recent), a line with
//     each seat's canvassing luck: min(95, min(80, luck + 10 × momentum) + 10 × issues led) — 陳 … N%, 宋 … N%, 連 … N%.
// Every check reported 尚未實作 until S.newSolo started a v0.7 丙 game; since #60 landed, that is a failure.
import test from "node:test";
import assert from "node:assert/strict";
import { R, section, check, eq, ok, nonEmpty, summary } from "./harness.js";
import * as E from "../public/shared/engine.js";
import * as S from "../public/solo.js";
import * as D from "./driver.js";
import * as RC from "../src/roomcore.js";
import * as T from "../public/tutorial.js";
import * as RU from "../public/rules.js";

const READY = (() => { try { const st = S.newSolo({ seat: 0, level: 1, seed: 1 }).st; return st.rules === "v0.7" && st.issueLuck === "lead"; } catch { return false; } })();
// Since #60 landed (7ec3d47), a new game that is not v0.7 丙 is a failure, not 尚未實作.
const c60 = (name, fn) => check(name, () => (READY ? fn() : "S.newSolo 開的不是 v0.7 丙（st.rules / st.issueLuck）：#60 已上線，這是退步，不是尚未實作"));
const LANGS = ["zh-Hant", "en"];
const SHORT = { "zh-Hant": ["陳", "宋", "連"], en: ["Chen", "Soong", "Lien"] };
const FORBID = { "zh-Hant": /袋|休息方塊|休息區|補袋/, en: /\bbags?\b|rest[- ]cubes?|rest area/i };
// #76: 運氣 is renamed 士氣 (Luck → Morale); either word, until it lands.
const LUCKW = { "zh-Hant": (n) => [`運氣 ${n}%`, `士氣 ${n}%`], en: (n) => [`Luck ${n}%`, `Morale ${n}%`] };
const hasAny = (html, list) => list.some((w) => html.includes(w));
const text = (html) => (html.replace(/<[^>]+>/g, " ") + " " + [...html.matchAll(/\b(?:aria-label|title|alt)="([^"]*)"/g)].map((m) => m[1]).join(" ")).replace(/\s+/g, " ");
const V7 = (st) => `${st.rules} ${st.issueLuck} ${st.luck}`;
const WANT = "v0.7 lead 50,50,60";

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
// The candidate panels: the HTML from each .pl-card[data-seat] to the next one.
const panels = (html) => { const at = [...html.matchAll(/class="pl-card[^"]*" data-seat="(\d)"/g)]; return at.map((m, i) => ({ seat: +m[1], html: html.slice(m.index, i + 1 < at.length ? at[i + 1].index : m.index + 4000) })); };

section("60 v0.7 上場");
c60("新開的單人、新開的房間、房間的再來一局、教學都是 v0.7 丙，運氣 50/50/60", () => {
  for (const seed of [1, 2, 3]) { const st = S.newSolo({ seat: 0, level: 2, seed }).st; if (V7(st) !== WANT) return `單人 seed ${seed}：${V7(st)}`; }
  let room = RC.newRoom({ code: "ABCD", seed: 11, now: 0 });
  const h = (ev) => { room = RC.handle(room, ev, 0).room; };
  h({ type: "open", conn: "A", name: "Ann", token: null }); h({ type: "msg", conn: "A", data: { t: "sit", seat: 0 } }); h({ type: "msg", conn: "A", data: { t: "start", level: 1 } });
  let r = eq(room.st && V7(room.st), WANT, "房間"); if (r !== true) return r;
  room.st = { ...room.st, phase: "end" }; h({ type: "msg", conn: "A", data: { t: "rematch" } });
  r = eq(`${V7(room.st)} ${room.st.turn}`, `${WANT} 1`, "房主按再來一局"); if (r !== true) return r;
  r = eq(V7(T.newTutorial().st), WANT, "教學"); if (r !== true) return r;
  return ok(true, "單人 3 個種子、房間、再來一局、教學都是 v0.7 丙、50/50/60");
});
c60("切換前存的 v0.6 單人照常能玩：每個畫面都畫得出來、每個選項都有字（中英）", () => {
  let screens = 0;
  for (const lang of LANGS) {
    const s0 = S.newSolo({ seat: 0, level: 1, seed: 5 }); s0.st = E.createGame(5, { rules: "v0.6", fill: "candidate" });
    const s = walk(s0, lang, 77, (x, ch) => { S.screen(x, lang, { turnCard: true }); screens++; const bad = ch.find((c) => !c.label || !String(c.label).trim()); if (bad) throw new Error(`沒有字的選項：${JSON.stringify(bad.move)}`); });
    if (s.st.phase !== "end") return `${lang}：v0.6 的局沒有走完（${s.st.phase}）`;
  }
  return ok(true, `${screens} 個畫面，中英都走完`);
});
c60("整局 v0.7 與教學的畫面（連回合卡、屬性）沒有袋子、休息方塊，票根上不畫休息方塊；每個選項都有字（中英）", () => {
  let screens = 0;
  const look = (where, html, extra = "") => {
    const t = text(html) + " " + extra, m = t.match(FORBID[where.lang]);
    if (m) throw new Error(`${where.what}：「${t.slice(Math.max(0, m.index - 30), m.index + 30)}」`);
    if (/data-rest="/.test(html)) throw new Error(`${where.what}：票根上還有休息方塊（data-rest）`);
    screens++;
  };
  for (const lang of LANGS) {
    for (const seed of [61, 62]) walk(S.newSolo({ seat: seed % 3, level: 2, seed }), lang, seed + 100, (s, ch) => {
      look({ lang, what: `${lang} seed ${seed} 第 ${s.st.turn} 回合` }, S.screen(s, lang, { turnCard: true }), ch.map((c) => c.label).join(" "));
      const bad = ch.find((c) => !c.label || !String(c.label).trim()); if (bad) throw new Error(`${lang}：沒有字的選項 ${JSON.stringify(bad.move)}`);
    });
    const w = tutorial(lang); if (w.end !== "done") return `${lang} 教學：${w.end}`;
    for (const r of w.rec) look({ lang, what: `${lang} 教學「${r.id}」` }, r.html, r.text);
  }
  const r = nonEmpty(screens, "v0.7 的畫面"); if (r !== true) return r;
  return ok(true, `${screens} 個畫面（中英各兩局與教學）`);
});
c60("候選人板寫出各家的運氣：「運氣 N%」（省府舊部那一回合，連可以寫 50%）", () => {
  let n = 0;
  for (const lang of LANGS) walk(S.newSolo({ seat: 1, level: 2, seed: 63 }), lang, 163, (s) => {
    if (s.st.phase !== "action") return;
    const ps = panels(S.screen(s, lang)); if (ps.length !== 3) throw new Error(`第 ${s.st.turn} 回合：候選人板 ${ps.length} 個`);
    for (const p of ps) {
      const ok50 = p.seat === 2 && (s.st.active || []).includes("provincial_staff");
      if (!hasAny(p.html, LUCKW[lang](s.st.luck[p.seat])) && !(ok50 && hasAny(p.html, LUCKW[lang](50)))) throw new Error(`${lang} 第 ${s.st.turn} 回合：${SHORT[lang][p.seat]}的板子沒有「${LUCKW[lang](s.st.luck[p.seat])}」：${text(p.html).slice(0, 120)}`);
    }
    n++;
  });
  const r = nonEmpty(n, "行動階段的畫面"); if (r !== true) return r;
  return ok(true, `${n} 個畫面的三張候選人板都寫出運氣`);
});
c60("選項上的「檢定約 N%」是引擎實際用的成功率（含對手的運氣）、「免檢定」不檢定；連的候選人牌寫 4 CP", () => {
  let n = 0, vs = 0, free = 0, cand = 0;
  for (const seed of [64, 65, 66]) walk(S.newSolo({ seat: seed % 3, level: 2, seed }), "zh-Hant", seed + 7, (s, ch) => {
    for (const c of ch) {
      if (c.move.type === "candidate" && s.seat === 2) { if (!/4 CP/.test(c.label)) throw new Error(`連的候選人牌寫「${c.label}」（應為 4 CP）`); cand++; }
      const m = c.label.match(/ · 檢定約 (\d+)%$/), none = / · 免檢定$/.test(c.label);
      if (!m && !none) continue;
      const before = s.st.log.length, after = S.act(s, c.move);
      const e = after.st.log.slice(before).find((x) => x.t === "check" && x.seat === s.seat);
      if (none) { if (e) throw new Error(`seed ${seed} 第 ${s.st.turn} 回合：「${c.label}」，引擎卻檢定了（${e.p}%）`); free++; continue; }
      if (!e) throw new Error(`seed ${seed} 第 ${s.st.turn} 回合：「${c.label}」，引擎沒有檢定`);
      // The exact chance, from the lucks (the log's p is rounded to one decimal: 45.45 is logged 45.5, and rounding that
      // again shows 46 — the first delivery of #60 did). The label must be the exact chance rounded once.
      const theirs = e.vs < 0 ? null : e.vs === 2 && (s.st.active || []).includes("provincial_staff") ? 50 : s.st.luck[e.vs];
      const exact = theirs == null ? e.luck : (100 * e.luck) / (e.luck + theirs);
      if (+m[1] !== Math.round(exact)) throw new Error(`seed ${seed} 第 ${s.st.turn} 回合：「${c.label}」，實際成功率 ${exact.toFixed(2)}%（運氣 ${e.luck}、對手 ${e.vs}${theirs == null ? "" : ` 運氣 ${theirs}`}），應寫 ${Math.round(exact)}%`);
      n++; if (e.vs >= 0) vs++;
    }
  });
  let r = nonEmpty(n, "寫了「檢定約 N%」的選項"); if (r !== true) return r;
  r = nonEmpty(vs, "有特定對手的檢定選項"); if (r !== true) return r;
  r = nonEmpty(cand, "連的候選人牌選項"); if (r !== true) return r;
  return ok(true, `${n} 個「檢定約」（${vs} 個有特定對手）、${free} 個「免檢定」都跟引擎一致；連的候選人牌 4 CP`);
});
c60("自己檢定之後，結果那一行寫出用的成功率「N%」，不寫抽到", () => {
  let n = 0, bad = null;
  for (const seed of [67, 68]) walk(S.newSolo({ seat: seed % 3, level: 2, seed }), "zh-Hant", seed + 3, (s, ch) => {
    if (bad) return;
    const c = ch[0], before = s.st.log.length, after = S.act(s, c.move);
    const e = after.st.log.slice(before).filter((x) => x.t === "check" && x.seat === s.seat).pop();
    if (!e) return;
    const line = S.lastResult(after, "zh-Hant") || "";
    // The exact chance from the lucks, rounded once (the log's p is already rounded to one decimal).
    const theirs = e.vs < 0 ? null : e.vs === 2 && (s.st.active || []).includes("provincial_staff") ? 50 : s.st.luck[e.vs];
    const shown = Math.round(theirs == null ? e.luck : (100 * e.luck) / (e.luck + theirs));
    if (!line.includes(`${shown}%`) || /抽到/.test(line)) bad = `第 ${s.st.turn} 回合「${c.label}」：結果寫「${line}」（成功率 ${shown}%，紀錄的 p ${e.p}）`;
    n++;
    return c;
  });
  if (bad) return bad;
  const r = nonEmpty(n, "自己的檢定"); if (r !== true) return r;
  return ok(true, `${n} 次自己的檢定，結果都寫出成功率`);
});
c60("投票日：轉換之後你看到的第一個畫面，「剛剛」有一行寫出三家的催票運氣（算進動能與領先的議題）", () => {
  let n = 0, led = 0;
  for (const seed of [69, 70, 71]) {
    let seen = false;
    walk(S.newSolo({ seat: seed % 3, level: 2, seed }), "zh-Hant", seed + 5, (s) => {
      const conv = s.st.log.find((e) => e.t === "convert"); if (!conv || seen) return;
      seen = true;
      const want = [0, 1, 2].map((p) => Math.min(95, Math.min(80, s.st.luck[p] + 10 * conv.mom[p]) + 10 * ((conv.leads || [0, 0, 0])[p])));
      const lines = S.recent(s, "zh-Hant");
      const hit = lines.find((l) => [0, 1, 2].every((p) => new RegExp(`${SHORT["zh-Hant"][p]}[^%]{0,12}?${want[p]}%`).test(l)));
      if (!hit) throw new Error(`seed ${seed}：催票運氣應為 陳 ${want[0]}%、宋 ${want[1]}%、連 ${want[2]}%；「剛剛」：${JSON.stringify(lines).slice(0, 240)}`);
      n++; if ((conv.leads || []).some((x) => x > 0)) led++;
    });
  }
  const r = nonEmpty(n, "投票日的轉換"); if (r !== true) return r;
  return ok(true, `${n} 局的轉換都寫出三家的催票運氣（${led} 局有人領先議題）`);
});

// #61 (the owner: 「手機也要顯示運氣」, design 乙): each panel says in data-luck the luck it shows, and shows it — in the action
// phases the seat's luck (「運氣 N%」 / "Luck N%"; 50 for 連 in a turn of 省府舊部), on election day the canvassing luck
// (「催票 N%」 / "Canvass N%", N = min(95, min(80, luck + 10 × momentum) + 10 × issues led)). 尚未實作 until data-luck exists.
const canvassOf = (st, p) => Math.min(95, Math.min(80, st.luck[p] + 10 * st.election.mom[p]) + 10 * ((st.election.leads || [0, 0, 0])[p]));
const HAS_DATA_LUCK = (() => { try { return /class="pl-card[^"]*" data-seat="\d"[^>]*data-luck="/.test(S.screen(S.advance(S.newSolo({ seat: 0, level: 1, seed: 1 })), "zh-Hant")); } catch { return false; } })();
c60("候選人板的 data-luck 與字：行動階段是運氣、投票日是催票運氣「催票 N%」（中英；#61）", () => {
  if (!HAS_DATA_LUCK) return "TODO: 候選人板還沒有 data-luck（#61）";
  let act = 0, elect = 0;
  const WORD = { "zh-Hant": { luck: ["運氣", "士氣"], canvass: ["催票"] }, en: { luck: ["Luck", "Morale"], canvass: ["Canvass"] } };
  for (const lang of LANGS) for (const seed of [72, 73]) walk(S.newSolo({ seat: seed % 3, level: 2, seed }), lang, seed + 11, (s) => {
    const inElection = s.st.phase === "election" && s.st.election;
    if (s.st.phase !== "action" && !inElection) return;
    const html = S.screen(s, lang);
    for (const p of panels(html)) {
      const want = inElection ? canvassOf(s.st, p.seat) : p.seat === 2 && (s.st.active || []).includes("provincial_staff") ? 50 : s.st.luck[p.seat];
      const dl = (p.html.match(/data-luck="(\d+)"/) || [])[1], word = WORD[lang][inElection ? "canvass" : "luck"];
      if (Number(dl) !== want) throw new Error(`${lang} 第 ${s.st.turn} 回合（${s.st.phase}）：${SHORT[lang][p.seat]}的 data-luck 是 ${dl}（應為 ${want}）`);
      if (!word.some((w) => text(p.html).includes(`${w} ${want}%`))) throw new Error(`${lang} 第 ${s.st.turn} 回合（${s.st.phase}）：${SHORT[lang][p.seat]}的板子沒有「${word} ${want}%」：${text(p.html).slice(0, 120)}`);
      if (inElection) elect++; else act++;
    }
  });
  let r = nonEmpty(act, "行動階段的候選人板"); if (r !== true) return r;
  r = nonEmpty(elect, "投票日的候選人板"); if (r !== true) return r;
  // A turn of 省府舊部, set up by hand: the random games above never reach one on a human screen (the checker on #61:
  // writing 60 for 連 there turned nothing red). 省府舊部 is put among this turn's cards and the first screen is drawn.
  for (const lang of LANGS) {
    const s = S.advance(S.newSolo({ seat: 0, level: 1, seed: 3 }));
    s.st = { ...s.st, active: [...(s.st.active || []), "provincial_staff"] };
    const lien = panels(S.screen(s, lang)).find((p) => p.seat === 2);
    if (!lien) return `${lang}：省府舊部的局面畫不出連的板子`;
    const dl = (lien.html.match(/data-luck="(\d+)"/) || [])[1];
    if (Number(dl) !== 50 || !WORD[lang].luck.some((w) => text(lien.html).includes(`${w} 50%`))) return `${lang} 省府舊部那一回合：連的 data-luck 是 ${dl}、字是「${text(lien.html).slice(0, 80)}」（應為 50、「${WORD[lang].luck} 50%」）`;
  }
  return ok(true, `${act} 塊行動階段的板子寫運氣、${elect} 塊投票日的板子寫催票運氣，data-luck 都對；省府舊部那一回合連寫 50（中英，人為局面）`);
});

// The rules page describes the rules in play, v0.7 since #60: its card gallery (rules.js, 「全部的牌」) draws the same
// stubs as the table, so no rest cubes there either. Found at #60's first delivery (6d38a16): rules.js still drew them.
c60("規則頁「全部的牌」也不畫休息方塊：rulesHTML（中英）沒有 data-rest；牌還在", () => {
  for (const lang of ["zh-Hant", "en"]) {
    const html = RU.rulesHTML(lang), cards = (html.match(/data-face=/g) || []).length;
    if (cards < 70) return `${lang} 規則頁只有 ${cards} 張牌面（data-face）`;
    const n = (html.match(/data-rest="/g) || []).length;
    if (n) return `${lang} 規則頁還有 ${n} 個 data-rest（休息方塊）`;
  }
  return ok(true, "中英規則頁的牌都沒有休息方塊");
});

test("v07play", () => {
  const s = summary();
  for (const p of R.pass) console.log(`  ✓ ${p.label}${p.msg ? " — " + p.msg : ""}`);
  for (const t of s.todos) console.log(`  … ${t.label} — ${t.msg}`);
  for (const x of s.failures) console.log(`  ✗ ${x.label} — ${x.msg}`);
  console.log(`  通過 ${s.pass} / 失敗 ${s.fail} / 尚未實作 ${s.todo}`);
  assert.equal(s.fail, 0, s.failures.map((x) => `${x.label}: ${x.msg}`).join("\n"));
});
