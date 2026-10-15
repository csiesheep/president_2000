// The turn card (issue #44, P1 ①), as far as node can see it. Orchestrator's file: a peer may run it and falsify
// against it, and does not edit it. When it shows, how long, the pause of the rivals and the fit are measured in a
// browser (tools/turncard44.mjs).
//
//   node --test tests/turncard.test.js      (or `npm test`)
//
// Owner, 2026-10-15, approving the P1 designs. Contract: screen(session, lang, { turnCard: true }) — solo, and the
// room's screen alike, since both draw with table.js from the view and its log — draws one element
// data-turncard="<turn>" for the current turn, carrying:
//   - data-date="YYYY-MM-DD": election day 2000-03-18 minus (9 − turn) × 14 days; data-weeks="(9 − turn) × 2";
//   - data-initiative="chen|soong|lien": who holds the initiative this turn (the turn's log entry);
//   - the headline of the previous turn, data-headline="<card id>" with data-how="event|trigger" and
//     data-who="<seat key>": among the previous turn's cards played as events (log "play", mode "event") and
//     triggered (log "trigger"), the one with the highest CP, the later one on a tie; none on turn 1 or when the
//     previous turn had no event — then no data-headline at all (orchestrator's ruling: the design's sticky said "the
//     step that mattered most", made checkable this way);
//   - three rows data-tc-votes="chen|soong|lien" with data-now = that seat's votes in this turn's log entry and,
//     from turn 2 on, data-delta = data-now minus the previous turn entry's votes (no data-delta on turn 1).
// Without { turnCard: true } nothing is drawn; a tutorial session never draws it.
// Reports 尚未實作 until a screen has data-turncard.
import test from "node:test";
import assert from "node:assert/strict";
import { R, section, check, ok, nonEmpty, summary } from "./harness.js";
import * as D from "./driver.js";
import * as S from "../public/solo.js";
import * as Tut from "../public/tutorial.js";
import * as C from "../public/shared/cards.js";

const KEYS = ["chen", "soong", "lien"];
const CARD = Object.fromEntries([...C.EVENTS, ...C.localCards()].map((c) => [c.id, c]));
// Dates written out here from the rulebook (9 turns, about two weeks each, turn 9 = 2000-03-18).
const DATE = { 1: "1999-11-27", 2: "1999-12-11", 3: "1999-12-25", 4: "2000-01-08", 5: "2000-01-22", 6: "2000-02-05", 7: "2000-02-19", 8: "2000-03-04", 9: "2000-03-18" };

// Solo games stepped one move at a time; each state right after a turn's log entry is written.
function turnStarts() {
  const out = [];
  for (const [seat, seed] of [[0, 4501], [1, 4502], [2, 4503]]) {
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
const tags = (html, name) => [...html.matchAll(new RegExp(`<[a-zA-Z][^<>]*?\\s${name}(?:="([^"]*)")?(?=[\\s/>])[^<>]*>`, "g"))].map((m) => ({ tag: m[0], v: m[1] }));
const attr = (tag, name) => { const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`)); return m ? m[1] : null; };
const turnEntries = (log) => log.filter((e) => e.t === "turn");
// The headline, computed here from the log.
function headline(log, turn) {
  const marks = log.map((e, i) => (e.t === "turn" ? i : -1)).filter((i) => i >= 0);
  const at = marks.find((i) => log[i].turn === turn), prev = marks.find((i) => log[i].turn === turn - 1);
  if (prev == null || at == null) return null;
  let best = null;
  for (const e of log.slice(prev + 1, at)) {
    const how = e.t === "play" && e.mode === "event" ? "event" : e.t === "trigger" ? "trigger" : null;
    if (!how || !CARD[e.card]) continue;
    if (!best || CARD[e.card].cp >= CARD[best.card].cp) best = { card: e.card, how, who: KEYS[e.seat] };
  }
  return best;
}
const gate = (fn) => () => {
  const ne = nonEmpty(POOL.length, "回合開始的局面"); if (ne !== true) return ne;
  if (!POOL.some((p) => tags(S.screen(p.s, "zh-Hant", { turnCard: true }), "data-turncard").length)) return "TODO: 畫面還沒有 data-turncard（#44）";
  return fn();
};

// The tutorial walked the way a player would: open the county a step asks for, play the step's move, let the bots
// move, press next. (#43's checker found the first walker stuck at step 3: it pressed next on a county step.)
function walkTutorial(visit) {
  let t = Tut.newTutorial(), shown = 0, moves = 0;
  for (let n = 0; n < 80; n++) {
    const st = Tut.step(t, "zh-Hant");
    if (!st || st.kind === "done") break;
    const r = visit(t, st, n); if (r !== true) return r;
    shown++; if (st.kind === "move") moves++;
    if (S.botsToMove(t).length) { t = S.stepBot(t); continue; }
    t = st.kind === "county" ? Tut.openCounty(t, st.county) : st.kind === "move" && st.moves.length ? Tut.act(t, st.moves[0]) : Tut.next(t);
  }
  const r = nonEmpty(moves >= 4 ? moves : 0, `教學裡走到的出牌步驟（只走到 ${moves} 個）`); if (r !== true) return r;
  return { shown, moves };
}

section("44 回合開場卡");

check("每回合開始：一張 data-turncard，回合、日期（3/18 往前推）、離投票日幾週、主動權都對", gate(() => {
  const seen = new Set();
  for (const p of POOL) {
    const t = tags(S.screen(p.s, "zh-Hant", { turnCard: true }), "data-turncard"), n = p.s.st.turn;
    if (t.length !== 1) return `${p.where}：有 ${t.length} 張開場卡`;
    const entry = turnEntries(p.s.st.log).find((e) => e.turn === n);
    const want = { "data-turncard": String(n), "data-date": DATE[n], "data-weeks": String((9 - n) * 2), "data-initiative": KEYS[entry.initiative] };
    for (const [k, v] of Object.entries(want)) if (attr(t[0].tag, k) !== v) return `${p.where}：${k} 是「${attr(t[0].tag, k)}」，應為 ${v}`;
    seen.add(n);
  }
  const r = nonEmpty(seen.size >= 9 ? 1 : 0, `九個回合都取樣到（只有 ${[...seen].sort().join(",")}）`); if (r !== true) return r;
  return ok(true, `${POOL.length} 個回合開始，九個回合都對`);
}));

check("頭條：上一回合當事件打出或觸發、CP 最高的牌（同分取後面那張）；第 1 回合或上一回合沒有事件時沒有頭條", gate(() => {
  let some = 0, none = 0;
  for (const p of POOL) {
    const html = S.screen(p.s, "zh-Hant", { turnCard: true }), h = tags(html, "data-headline"), want = headline(p.s.st.log, p.s.st.turn);
    if (!want) { if (h.length) return `${p.where}：不該有頭條，畫面上是 ${h[0].v}`; none++; continue; }
    if (h.length !== 1) return `${p.where}：應有頭條 ${want.card}，畫面上有 ${h.length} 個`;
    if (h[0].v !== want.card || attr(h[0].tag, "data-how") !== want.how || attr(h[0].tag, "data-who") !== want.who) return `${p.where}：頭條是 ${h[0].v}/${attr(h[0].tag, "data-how")}/${attr(h[0].tag, "data-who")}，應為 ${want.card}/${want.how}/${want.who}`;
    some++;
  }
  const r = nonEmpty(some, "有頭條的回合"); if (r !== true) return r;
  const r2 = nonEmpty(none, "沒有頭條的回合（第 1 回合）"); if (r2 !== true) return r2;
  return ok(true, `${some} 個回合有頭條，${none} 個沒有`);
}));

check("票數：三列 data-tc-votes，data-now 是這回合開始的票數，第 2 回合起 data-delta 是跟上一回合開始相比的增減", gate(() => {
  let n = 0;
  for (const p of POOL) {
    const html = S.screen(p.s, "zh-Hant", { turnCard: true }), rows = tags(html, "data-tc-votes");
    const es = turnEntries(p.s.st.log), cur = es.find((e) => e.turn === p.s.st.turn), prev = es.find((e) => e.turn === p.s.st.turn - 1);
    if (rows.map((r) => r.v).sort().join() !== "chen,lien,soong") return `${p.where}：票數列是 ${rows.map((r) => r.v).join(",")}`;
    for (const r of rows) {
      const i = KEYS.indexOf(r.v), now = attr(r.tag, "data-now"), delta = attr(r.tag, "data-delta");
      if (Number(now) !== cur.votes[i]) return `${p.where}：${r.v} 的 data-now 是 ${now}，應為 ${cur.votes[i]}`;
      if (!prev) { if (delta !== null) return `${p.where}：第 1 回合不該有 data-delta`; continue; }
      if (Number(delta) !== cur.votes[i] - prev.votes[i]) return `${p.where}：${r.v} 的 data-delta 是 ${delta}，應為 ${cur.votes[i] - prev.votes[i]}`;
    }
    n++;
  }
  return ok(true, `${n} 張開場卡的票數與增減都對`);
}));

check("沒有要求時不畫；教學裡不畫", gate(() => {
  for (const p of POOL.filter((x, i) => i % 3 === 0)) if (tags(S.screen(p.s, "zh-Hant"), "data-turncard").length) return `${p.where}：沒有 turnCard 也畫了`;
  const w = walkTutorial((t, st, n) => tags(S.screen(t, "zh-Hant", { turnCard: true }), "data-turncard").length ? `教學第 ${n} 步（${st.id}）畫了開場卡` : true);
  if (typeof w === "string") return w;
  return ok(true, `沒有要求時不畫；${w.shown} 個教學畫面（${w.moves} 個出牌步驟）都沒畫`);
}));

test("turncard", () => {
  const s = summary();
  for (const p of R.pass) console.log(`  ✓ ${p.label}${p.msg ? " — " + p.msg : ""}`);
  for (const t of s.todos) console.log(`  … ${t.label} — ${t.msg}`);
  for (const x of s.failures) console.log(`  ✗ ${x.label} — ${x.msg}`);
  console.log(`  通過 ${s.pass} / 失敗 ${s.fail} / 尚未實作 ${s.todo}`);
  assert.equal(s.fail, 0, s.failures.map((x) => `${x.label}: ${x.msg}`).join("\n"));
});
