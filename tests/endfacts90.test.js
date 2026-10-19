// What the end page and the CP warning need from the engine (issue #90): where each block came from, how the count was
// decided, a recap of the game, and how much 士氣 an event moves. Orchestrator's file: a peer may run it and falsify
// against it, and does not edit it.
//
//   node --test tests/endfacts90.test.js      (or `npm test`)
//
// Owner, 2026-10-18, to the wave-2 design canvas (end page, election night, first-game tips, the CP warning): 「可以 開工」.
// The end page says why you won or lost with numbers: "你的 52 塊從哪裡來：行動 24・政見發表會 6・投票日催票 11・棄保 6・
// 背書 5", "每回合結束時的票數", and on a tie "同票怎麼分勝負：① 票數 ② 領先的縣市 ③ 催票順序". The CP warning says what
// the rival gets: "宋會得到：宋士氣 +15%（50% → 65%）". Contract (orchestrator, #90):
//   - every block with an owner carries s, where it came from: "start" (on the board at the start), "act" (an action:
//     campaign, a candidate card), "event" (a card's effect), "debate" (a policy forum's award), "canvass" (election
//     day), "strategic" (棄保), "endorse" (背書); a block without an owner carries no s;
//   - st.result.sources: for each seat, { start, act, event, debate, canvass, strategic, endorse }, integers ≥ 0 that
//     add up to st.result.votes[seat] and are the seat's blocks on the board at the end by s; a game whose board has an
//     owned block without s (saved before #90) ends with sources null;
//   - st.result.decidedBy: "votes" | "leads" | "momentum" | "order", the first rule of the count (votes, then counties
//     led, then the momentum before the conversion, then the election-day order) that puts the winner alone ahead;
//   - public/shared/recap.js exports recap(v): null before the end; at the end, from the state or any seat's view (the
//     same object for both): { votes, winner, decidedBy, sources, trend, leads, issueLeads, canvass, debates, gifts,
//     received }:
//       trend      9 rows { turn, votes }: turns 1–8 the board's votes when that turn ended, turn 9 the count;
//       leads      for each seat, the counties (indices) where it has the most blocks alone;
//       issueLeads for each seat, the issues it led at the conversion;
//       canvass    for each seat { cards, checks, hits, luck }: election-day cards, checks, successes, and the
//                  canvassing 士氣 min(95, 士氣 + 10 × issues led);
//       debates    for each seat, the issues it won at a policy forum;
//       gifts      for each seat, [{ card, to }]: a rival's event it played for CP that then happened for the rival;
//       received   for each seat, [{ card, by }]: the same, from the other side;
//   - recap.js exports moraleOf(id): the 士氣 an event moves when it happens, [[who, points], …], who a seat (0 陳,
//     1 宋, 2 連), "all", "leader" (the headline issue's unique leader) or "lowest"; [] (or points 0) for a card that
//     moves none. It agrees with the card's text and with what the engine does when a rival plays the card for CP.
//   - nothing else changes: 38 seeded games end exactly as on main before #90 (a217364).
// Rows report 尚未實作 until the part they check exists; the 38 games are checked from the start.
import test from "node:test";
import assert from "node:assert/strict";
import { R, section, check, eq, ok, nonEmpty, summary } from "./harness.js";
import * as E from "../public/shared/engine.js";
import * as BOT from "../public/shared/bots.js";
import * as BD from "../public/shared/board.js";
import { EVENTS } from "../public/shared/cards.js";
import * as D from "./driver.js";

let RC = null, RC_ERR = "";
try { RC = await import("../public/shared/recap.js"); } catch (e) { RC_ERR = e && e.code === "ERR_MODULE_NOT_FOUND" ? "" : `public/shared/recap.js 載入失敗：${e.message}`; }

const OPTS = { rules: "v0.7", issueLuck: "lead", momentum: "none", trigger: "always", moraleCards: "full", luck: [50, 50, 50] };
const simRng = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const LV = [[1, 1, 1], [2, 2, 2], [3, 3, 3], [1, 2, 3], [3, 2, 1], [2, 1, 3]];
// Measured on main a217364 with this loop (seed: winner : votes 陳/宋/連 : counties led : log length : how the count
// was decided, by this file's own reading of the rule). Seeds 1–30 and the ties found in 1–120.
const GOLD = Object.fromEntries(("1:0:51/47/42:7/8/4:519:votes 2:2:43/45/48:8/6/5:485:votes 3:2:40/45/49:3/9/8:476:votes 4:2:44/45/47:6/8/3:489:votes " +
  "5:0:54/48/39:6/8/3:525:votes 6:1:40/53/47:5/10/4:381:votes 7:1:46/47/44:4/7/5:553:votes 8:2:42/44/48:6/8/7:489:votes 9:2:43/43/48:7/7/5:457:votes " +
  "10:1:47/47/43:5/7/4:489:leads 11:2:44/43/49:5/8/7:476:votes 12:2:38/49/52:3/7/6:376:votes 13:1:48/49/40:9/10/4:525:votes 14:0:47/43/46:7/6/5:489:votes " +
  "15:1:43/51/42:3/9/4:473:votes 16:0:49/44/44:7/5/4:493:votes 17:2:42/38/54:6/5/6:486:votes 18:1:44/49/46:6/6/3:399:votes 19:0:50/42/44:8/7/6:532:votes " +
  "20:2:43/43/50:4/10/5:488:votes 21:1:39/57/41:4/10/5:482:votes 22:1:45/47/42:6/7/3:484:votes 23:2:43/43/49:6/6/6:507:votes 24:1:47/50/43:6/9/4:386:votes " +
  "25:2:47/41/48:6/8/7:535:votes 26:2:47/40/50:5/6/7:498:votes 27:1:48/49/44:5/8/4:480:votes 28:1:44/49/42:5/10/5:458:votes 29:1:47/48/41:8/8/4:485:votes " +
  "30:1:42/51/46:7/10/3:380:votes 39:1:45/47/47:7/8/4:517:leads 70:1:41/49/49:4/7/4:503:leads 73:0:46/45/46:6/9/5:541:leads 81:1:44/46/46:5/8/6:493:leads " +
  "85:0:46/46/46:7/6/5:546:leads 95:2:42/47/47:4/7/7:504:order 97:1:45/46/46:7/8/5:534:leads 99:0:48/43/48:4/9/4:450:order")
  .split(" ").map((s) => { const [seed, w, votes, leads, log, by] = s.split(":"); return [Number(seed), { w: Number(w), votes, leads, log: Number(log), by }]; }));
const SEEDS = Object.keys(GOLD).map(Number);
const SRC = ["start", "act", "event", "debate", "canvass", "strategic", "endorse"];
const SEAT_OF = { chen: 0, soong: 1, lien: 2 };
const NAME = ["陳", "宋", "連"];
const cname = (k) => BD.COUNTIES[k][0];

// Started: after 300 steps of a game, some block carries a source (so a missing "start" alone is a failure, not 尚未實作).
const TAGGED = (() => { let st = E.createGame(1, OPTS); const Rr = simRng(1); for (let n = 0; n < 300 && st.phase !== "end"; n++) { const seat = E.mustAct(st)[0]; st = E.apply(st, seat, BOT.chooseMove(st, seat, 1, Rr).move); } return st.counties.some((c) => c.blocks.some((b) => b.s !== undefined)); })();
const votesOf = (st) => [0, 1, 2].map((p) => st.counties.reduce((s, c) => s + c.blocks.filter((b) => b.o === p).length, 0));
function tagBad(st) {
  for (let k = 0; k < st.counties.length; k++) for (const b of st.counties[k].blocks) {
    if (b.o >= 0 && !SRC.includes(b.s)) return `${cname(k)}：${NAME[b.o]}的方塊來源是 ${JSON.stringify(b.s)}`;
    if (b.o < 0 && b.s !== undefined) return `${cname(k)}：沒有主的方塊還留著來源 ${JSON.stringify(b.s)}`;
  }
  return null;
}
// The count's rule, read independently: votes, then counties led, then momentum, then the election-day order.
function decided(st) {
  const r = st.result, day = st.log.filter((e) => e.t === "turn" && e.turn === 9).pop();
  let pool = [0, 1, 2]; const top = (f) => { const m = Math.max(...pool.map(f)); pool = pool.filter((p) => f(p) === m); };
  let by = "votes"; top((p) => r.votes[p]);
  if (pool.length > 1) { by = "leads"; top((p) => r.leads[p]); }
  if (pool.length > 1) { by = "momentum"; top((p) => r.momentum[p]); }
  if (pool.length > 1) { by = "order"; pool = [day.order.find((p) => pool.includes(p))]; }
  return { by, w: pool[0] };
}
function loop(st, seed, from, each) {
  const lv = LV[seed % LV.length], Rr = from.R;
  for (let n = 0; n < 20000 && st.phase !== "end"; n++) {
    const seat = E.mustAct(st)[0];
    if (seat == null) throw new Error(`seed ${seed}: nobody to act in ${st.phase}`);
    const before = st;
    st = E.apply(st, seat, BOT.chooseMove(st, seat, lv[seat], Rr).move);
    each(before, st, n);
  }
  if (st.phase !== "end") throw new Error(`seed ${seed}: did not end`);
  return st;
}
// One step's new owners (a new owner, or a new source: a block taken at canvassing and given back by 棄保 in the same
// step keeps its owner), by the source they were given, against what that step's log entries placed: a forum award,
// an election-day placement, 棄保 and 背書 are each counted exactly; "start" never comes back after the start.
const KINDS = ["debate", "canvass", "strategic", "endorse"];
function stepCount(before, after) {
  const got = Object.fromEntries(SRC.map((k) => [k, 0]));
  after.counties.forEach((c, k) => c.blocks.forEach((b, i) => { const a = before.counties[k].blocks[i]; if (b.o >= 0 && (a.o !== b.o || a.s !== b.s)) got[b.s] = (got[b.s] || 0) + 1; }));
  const add = after.log.slice(before.log.length), want = { debate: 0, canvass: 0, strategic: 0, endorse: 0 };
  for (const e of add) {
    if (e.t === "debate" && e.step === "place") want.debate++;
    else if (e.t === "canvass" && e.step === "place" && e.move.type !== "remove") want.canvass++;
    else if (e.t === "strategic") want.strategic += e.moved.reduce((s, m) => s + m.n, 0);
    else if (e.t === "endorse") want.endorse += e.given.reduce((s, m) => s + m.n, 0);
  }
  return { got, want };
}
function play(seed, every) {
  const Rr = simRng(seed * 977 + 13);
  const st0 = E.createGame(seed, OPTS);
  const snaps = [], out = { checks: 0, owned: 0, bad: null, luckAt: null, stepBad: null, kinds: { debate: 0, canvass: 0, strategic: 0, endorse: 0 } };
  const st = loop(st0, seed, { R: Rr }, (before, after, n) => {
    if (after.turn !== before.turn) snaps.push({ turn: after.turn, votes: votesOf(after) });
    if (!out.luckAt && after.phase === "election") out.luckAt = after.luck.slice();
    if (!out.bad && (n % every === 0 || after.phase === "end")) { out.checks++; out.owned += votesOf(after).reduce((a, b) => a + b, 0); out.bad = tagBad(after); }
    if (TAGGED && !out.stepBad) {
      const { got, want } = stepCount(before, after);
      for (const k of KINDS) { out.kinds[k] += want[k]; if (got[k] !== want[k]) out.stepBad = `第 ${after.turn} 回合（${after.phase}）一步裡紀錄放了 ${k} ${want[k]} 塊，盤上新記成 ${k} 的有 ${got[k]} 塊（這一步新增：${JSON.stringify(got)}）`; }
      if (got.start) out.stepBad = `第 ${after.turn} 回合有 ${got.start} 塊新放的方塊記成 start`;
    }
  });
  return { seed, st, snaps, ...out };
}
let GAMES = null;
const games = () => GAMES || (GAMES = SEEDS.map((seed) => play(seed, seed <= 5 ? 1 : 10)));
// Since #90 landed (2521f07), a missing part is a failure, not 尚未實作.
const GONE = "：#90 已上線（2521f07），這是退步，不是尚未實作";
const cT = (name, fn) => check(name, () => (TAGGED ? fn() : "方塊沒有來源（下了 300 步，盤上沒有一塊方塊有 s）" + GONE));
const cD = (name, fn) => check(name, () => (games().some((g) => g.st.result.decidedBy !== undefined) ? fn() : "st.result 沒有 decidedBy" + GONE));
const cR = (name, fn) => check(name, () => (RC_ERR ? RC_ERR : !RC ? "public/shared/recap.js 不見了" + GONE : typeof RC.recap !== "function" ? "recap.js 沒有匯出 recap" + GONE : fn()));
const cM = (name, fn) => check(name, () => (RC_ERR ? RC_ERR : !RC ? "public/shared/recap.js 不見了" + GONE : typeof RC.moraleOf !== "function" ? "recap.js 沒有匯出 moraleOf" + GONE : fn()));

// ------------------------------------------------------------------------------------------------ 1
section("1 沒有改變遊戲");
check("38 局（種子 1–30 與 8 局同票）的勝者、票數、領先縣市、紀錄長度跟 #90 之前（a217364）一樣", () => {
  const diff = [], by = {};
  for (const g of games()) {
    const r = g.st.result, want = GOLD[g.seed], d = decided(g.st);
    const have = { w: r.winner, votes: r.votes.join("/"), leads: r.leads.join("/"), log: g.st.log.length, by: d.by };
    by[d.by] = (by[d.by] || 0) + 1;
    if (d.w !== r.winner) diff.push(`種子 ${g.seed}：照規則讀是 ${NAME[d.w]}贏，引擎說 ${NAME[r.winner]}`);
    for (const k of Object.keys(want)) if (have[k] !== want[k]) diff.push(`種子 ${g.seed} 的 ${k}：之前 ${want[k]}，現在 ${have[k]}`);
  }
  return ok(!diff.length, diff.length ? diff.slice(0, 6).join("；") : `38 局都一樣（分出勝負靠：${Object.entries(by).map(([k, n]) => `${k} ${n}`).join("、")}）`);
});

// ------------------------------------------------------------------------------------------------ 2
section("2 每塊方塊的來源");
cT("開局：盤上有主的方塊都是 \"start\"，數目等於棋盤的起始方塊", () => {
  const bad = [];
  const init = [0, 1, 2].map((p) => BD.COUNTIES.reduce((s, c) => s + c[5][p], 0));
  for (let seed = 1; seed <= 5; seed++) {
    const st = E.createGame(seed, OPTS);
    for (let k = 0; k < st.counties.length; k++) for (const b of st.counties[k].blocks) if (b.o >= 0 && b.s !== "start") bad.push(`種子 ${seed} ${cname(k)} ${JSON.stringify(b.s)}`);
    const v = votesOf(st);
    if (v.join() !== init.join()) bad.push(`種子 ${seed} 起始方塊 ${v.join("/")}，棋盤寫 ${init.join("/")}`);
  }
  const r = nonEmpty(init.reduce((a, b) => a + b, 0), "起始方塊"); if (r !== true) return r;
  return ok(!bad.length, bad.length ? bad.slice(0, 5).join("；") : `5 局開局的 ${init.join("/")} 塊都是 start`);
});
cT("整局：有主的方塊一定有來源（七種之一），沒有主的方塊沒有來源", () => {
  const gs = games(), bad = gs.filter((g) => g.bad).map((g) => `種子 ${g.seed}：${g.bad}`);
  const n = gs.reduce((s, g) => s + g.checks, 0), owned = gs.reduce((s, g) => s + g.owned, 0);
  const r = nonEmpty(owned, "檢查過的有主方塊"); if (r !== true) return r;
  return ok(!bad.length, bad.length ? bad.slice(0, 5).join("；") : `38 局 ${n} 個時點（種子 1–5 每一步）共看了 ${owned} 塊有主的方塊`);
});
cT("每一步：新放上的方塊裡，發表會、催票、棄保、背書各記了幾塊，就是這一步紀錄裡放的幾塊；開局之後不再有 start", () => {
  const gs = games(), bad = gs.filter((g) => g.stepBad).map((g) => `種子 ${g.seed}：${g.stepBad}`);
  const tot = Object.fromEntries(KINDS.map((k) => [k, gs.reduce((s, g) => s + g.kinds[k], 0)]));
  const zero = KINDS.filter((k) => !tot[k]);
  if (zero.length && !bad.length) return `38 局的紀錄裡這幾種一塊都沒放，分不出對錯：${zero.join("、")}`;
  return ok(!bad.length, bad.length ? bad.slice(0, 4).join("；") : `38 局每一步都對（紀錄放的：${KINDS.map((k) => `${k} ${tot[k]}`).join("、")}）`);
});
cT("結算：result.sources 每家七種、整數 ≥ 0、加起來等於得票，而且就是終局盤上依來源數的方塊", () => {
  const bad = [];
  for (const g of games()) {
    const r = g.st.result, s = r.sources;
    if (!Array.isArray(s) || s.length !== 3) { bad.push(`種子 ${g.seed}：sources 是 ${JSON.stringify(s)}`); continue; }
    for (let p = 0; p < 3; p++) {
      const keys = Object.keys(s[p] || {}).sort().join();
      if (keys !== SRC.slice().sort().join()) { bad.push(`種子 ${g.seed} ${NAME[p]}：鍵是 ${keys}`); continue; }
      if (SRC.some((k) => !Number.isInteger(s[p][k]) || s[p][k] < 0)) bad.push(`種子 ${g.seed} ${NAME[p]}：${JSON.stringify(s[p])}`);
      const sum = SRC.reduce((a, k) => a + s[p][k], 0);
      if (sum !== r.votes[p]) bad.push(`種子 ${g.seed} ${NAME[p]}：加起來 ${sum}，得票 ${r.votes[p]}`);
      const tally = Object.fromEntries(SRC.map((k) => [k, 0]));
      for (const c of g.st.counties) for (const b of c.blocks) if (b.o === p && b.s in tally) tally[b.s]++;
      if (SRC.some((k) => tally[k] !== s[p][k])) bad.push(`種子 ${g.seed} ${NAME[p]}：盤上 ${JSON.stringify(tally)}，sources ${JSON.stringify(s[p])}`);
    }
  }
  return ok(!bad.length, bad.length ? bad.slice(0, 4).join("；") : "38 局 × 3 家都對得上");
});
cT("棄保與背書的來源跟紀錄一樣多；催票、發表會、開局的來源不多於紀錄裡放的", () => {
  const bad = [], tot = Object.fromEntries(SRC.map((k) => [k, 0]));
  const init = [0, 1, 2].map((p) => BD.COUNTIES.reduce((s, c) => s + c[5][p], 0));
  for (const g of games()) {
    const s = g.st.result.sources; if (!Array.isArray(s)) { bad.push(`種子 ${g.seed}：沒有 sources`); continue; }
    const log = g.st.log, conv = log.findIndex((e) => e.t === "convert");
    for (let p = 0; p < 3; p++) {
      for (const k of SRC) tot[k] += s[p][k];
      const strategic = log.filter((e) => e.t === "strategic").reduce((a, e) => a + e.moved.filter((m) => m.seat === p).reduce((x, m) => x + m.n, 0), 0);
      const endorse = log.filter((e) => e.t === "endorse").reduce((a, e) => a + e.given.filter((m) => m.seat === p).reduce((x, m) => x + m.n, 0), 0);
      const placed = log.slice(conv).filter((e) => e.t === "canvass" && e.step === "place" && e.seat === p && e.move.type !== "remove").length;
      const lost = log.slice(conv).filter((e) => e.t === "canvass" && e.step === "place" && e.move.type === "remove" && e.move.target === p).length;
      const forum = log.filter((e) => e.t === "debate" && e.step === "place" && e.seat === p).length;
      if (s[p].strategic !== strategic) bad.push(`種子 ${g.seed} ${NAME[p]} 棄保：sources ${s[p].strategic}，紀錄 ${strategic}`);
      if (s[p].endorse !== endorse) bad.push(`種子 ${g.seed} ${NAME[p]} 背書：sources ${s[p].endorse}，紀錄 ${endorse}`);
      if (s[p].canvass > placed || s[p].canvass < placed - lost) bad.push(`種子 ${g.seed} ${NAME[p]} 催票：sources ${s[p].canvass}，紀錄放了 ${placed}、被搶 ${lost}`);
      if (s[p].debate > forum) bad.push(`種子 ${g.seed} ${NAME[p]} 發表會：sources ${s[p].debate}，紀錄只放了 ${forum}`);
      if (s[p].start > init[p]) bad.push(`種子 ${g.seed} ${NAME[p]} 開局：sources ${s[p].start}，開局只有 ${init[p]}`);
    }
  }
  const zero = SRC.filter((k) => !tot[k]);
  if (zero.length && !bad.length) return `38 局裡這幾種來源一塊都沒有，分不出對錯：${zero.join("、")}`;
  return ok(!bad.length, bad.length ? bad.slice(0, 5).join("；") : `38 局三家合計：${SRC.map((k) => `${k} ${tot[k]}`).join("、")}`);
});
cT("#90 之前存的局（盤上方塊沒有來源）照樣下完，sources 是 null", () => {
  const seed = 3, Rr = simRng(seed * 977 + 13);
  let st = E.createGame(seed, OPTS), mid = null;
  st = loop(st, seed, { R: Rr }, (b, a) => { if (!mid && a.turn === 5) mid = a; });
  void st;
  if (!mid) return "種子 3 沒有走到第 5 回合";
  const old = E.clone(mid);
  for (const c of old.counties) for (const b of c.blocks) delete b.s;
  let end;
  try { end = loop(old, seed, { R: simRng(5) }, () => {}); } catch (e) { return `沒有來源的局下不完：${e.message}`; }
  return ok(end.result.sources === null, `下完了，result.sources = ${JSON.stringify(end.result.sources)}`);
});

// ------------------------------------------------------------------------------------------------ 3
section("3 怎麼分出勝負");
cD("result.decidedBy 是讓勝者單獨領先的第一條規則（票數、領先縣市、動能、投票日順序）", () => {
  const bad = [], by = {};
  for (const g of games()) {
    const d = decided(g.st), have = g.st.result.decidedBy;
    by[d.by] = (by[d.by] || 0) + 1;
    if (have !== d.by) bad.push(`種子 ${g.seed}（${g.st.result.votes.join("/")}，縣市 ${g.st.result.leads.join("/")}）：應是 ${d.by}，寫 ${JSON.stringify(have)}`);
  }
  const miss = ["votes", "leads", "order"].filter((k) => !by[k]);
  if (miss.length) return `38 局裡沒有靠 ${miss.join("、")} 分出勝負的，分不出對錯`;
  return ok(!bad.length, bad.length ? bad.slice(0, 5).join("；") : `38 局都對（${Object.entries(by).map(([k, n]) => `${k} ${n}`).join("、")}）`);
});

// ------------------------------------------------------------------------------------------------ 4
section("4 recap(v)：結局頁讀的整局摘要");
cR("還沒結束的局：recap 是 null", () => {
  const st = E.createGame(1, OPTS);
  return eq(RC.recap(st), null, "開局的 recap");
});
cR("票數、勝者、怎麼分出勝負、來源跟 st.result 一樣", () => {
  const bad = [];
  for (const g of games()) {
    const r = RC.recap(g.st), x = g.st.result;
    if (!r) { bad.push(`種子 ${g.seed}：recap 是 ${JSON.stringify(r)}`); continue; }
    if (JSON.stringify(r.votes) !== JSON.stringify(x.votes)) bad.push(`種子 ${g.seed} votes ${JSON.stringify(r.votes)}`);
    if (r.winner !== x.winner) bad.push(`種子 ${g.seed} winner ${r.winner}`);
    if (r.decidedBy !== decided(g.st).by) bad.push(`種子 ${g.seed} decidedBy ${r.decidedBy}`);
    if (JSON.stringify(r.sources) !== JSON.stringify(x.sources)) bad.push(`種子 ${g.seed} sources ${JSON.stringify(r.sources)}`);
  }
  return ok(!bad.length, bad.length ? bad.slice(0, 5).join("；") : "38 局都一樣");
});
cR("trend：9 列，第 1–8 回合是那一回合結束時盤上的票數，第 9 列是開票結果", () => {
  const bad = [];
  for (const g of games()) {
    const t = (RC.recap(g.st) || {}).trend;
    if (!Array.isArray(t) || t.length !== 9) { bad.push(`種子 ${g.seed}：trend ${JSON.stringify(t)}`); continue; }
    for (let i = 0; i < 9; i++) {
      const want = i < 8 ? (g.snaps.find((s) => s.turn === i + 2) || {}).votes : g.st.result.votes;
      if (!t[i] || t[i].turn !== i + 1 || JSON.stringify(t[i].votes) !== JSON.stringify(want)) { bad.push(`種子 ${g.seed} 第 ${i + 1} 列：${JSON.stringify(t[i])}，應是 ${JSON.stringify(want)}`); break; }
    }
  }
  return ok(!bad.length, bad.length ? bad.slice(0, 4).join("；") : `38 局都對（例：種子 1 ${RC.recap(games()[0].st).trend.map((r) => r.votes.join("/")).join(" → ")}）`);
});
cR("leads：每家單獨最多方塊的縣市，數目等於 result.leads", () => {
  const bad = [];
  for (const g of games()) {
    const l = (RC.recap(g.st) || {}).leads, want = [[], [], []];
    g.st.counties.forEach((c, k) => { const n = [0, 1, 2].map((p) => c.blocks.filter((b) => b.o === p).length), m = Math.max(...n); if (m > 0 && n.filter((x) => x === m).length === 1) want[n.indexOf(m)].push(k); });
    if (!Array.isArray(l) || [0, 1, 2].some((p) => JSON.stringify((l[p] || []).slice().sort((a, b) => a - b)) !== JSON.stringify(want[p]))) bad.push(`種子 ${g.seed}：${JSON.stringify(l)}，應是 ${JSON.stringify(want)}`);
    else if ([0, 1, 2].some((p) => l[p].length !== g.st.result.leads[p])) bad.push(`種子 ${g.seed}：數目 ${l.map((x) => x.length)}，result.leads ${g.st.result.leads}`);
  }
  return ok(!bad.length, bad.length ? bad.slice(0, 3).join("；") : "38 局都對");
});
cR("issueLeads 與 canvass：轉換時領先的議題、投票日的牌數、檢定數、成功數、催票士氣 min(95, 士氣 + 10 × 議題)", () => {
  const bad = []; let checks = 0, led = 0;
  for (const g of games()) {
    const r = RC.recap(g.st) || {}, log = g.st.log, ci = log.findIndex((e) => e.t === "convert"), conv = log[ci];
    if (JSON.stringify(r.issueLeads) !== JSON.stringify(conv.leads)) bad.push(`種子 ${g.seed} issueLeads ${JSON.stringify(r.issueLeads)}，轉換時 ${JSON.stringify(conv.leads)}`);
    for (let p = 0; p < 3; p++) {
      const day = log.slice(ci);
      const want = {
        cards: day.filter((e) => e.t === "canvass" && e.seat === p && e.card).length,
        checks: day.filter((e) => e.t === "check" && e.seat === p).length,
        hits: day.filter((e) => e.t === "check" && e.seat === p && e.ok).length,
        luck: Math.min(95, g.luckAt[p] + 10 * conv.leads[p]),
      };
      checks += want.checks; led += conv.leads[p];
      const have = (r.canvass || [])[p];
      if (JSON.stringify(have) !== JSON.stringify(want)) bad.push(`種子 ${g.seed} ${NAME[p]}：${JSON.stringify(have)}，應是 ${JSON.stringify(want)}`);
      const lk = day.filter((e) => e.t === "check" && e.seat === p).map((e) => e.luck).filter((x) => x !== want.luck);
      if (lk.length) bad.push(`種子 ${g.seed} ${NAME[p]}：投票日的檢定用了 ${lk[0]}%，不是 ${want.luck}%`);
    }
  }
  const z = nonEmpty(checks, "投票日的檢定"); if (z !== true) return z;
  if (!led) return "38 局都沒有人在轉換時領先議題，催票士氣的 +10 分不出對錯";
  return ok(!bad.length, bad.length ? bad.slice(0, 4).join("；") : `38 局都對（投票日檢定 ${checks} 次、轉換時領先的議題共 ${led} 條）`);
});
cR("debates：每家在政見發表會贏的議題數", () => {
  const bad = []; let n = 0;
  for (const g of games()) {
    const d = (RC.recap(g.st) || {}).debates, want = [0, 1, 2].map((p) => g.st.log.filter((e) => e.t === "debate" && e.step === "settle" && e.seat === p).length);
    n += want.reduce((a, b) => a + b, 0);
    if (JSON.stringify(d) !== JSON.stringify(want)) bad.push(`種子 ${g.seed}：${JSON.stringify(d)}，應是 ${JSON.stringify(want)}`);
  }
  const z = nonEmpty(n, "發表會結算"); if (z !== true) return z;
  return ok(!bad.length, bad.length ? bad.slice(0, 4).join("；") : `38 局都對（共結算 ${n} 條）`);
});
cR("gifts / received：拿對手的事件當 CP、事件替對手發生的每一張", () => {
  const bad = []; let n = 0;
  const owner = Object.fromEntries(EVENTS.map((e) => [e.id, SEAT_OF[e.owner]]));
  for (const g of games()) {
    const r = RC.recap(g.st) || {}, log = g.st.log, want = [[], [], []], back = [[], [], []];
    log.forEach((e, i) => {
      if (e.t !== "play" || e.mode !== "cp" || !(e.card in owner)) return;
      const q = owner[e.card];
      if (q === undefined || q === e.seat) return;
      // the trigger that belongs to this play: before the next card is played
      const rest = log.slice(i + 1), next = rest.findIndex((x) => x.t === "play");
      const tr = (next < 0 ? rest : rest.slice(0, next)).find((x) => x.t === "trigger" && x.card === e.card);
      if (tr && tr.seat === q) { want[e.seat].push(`${e.card}>${q}`); back[q].push(`${e.card}<${e.seat}`); }
    });
    n += want.flat().length;
    const have = (r.gifts || []).map((a) => (a || []).map((x) => `${x.card}>${x.to}`).sort());
    const got = (r.received || []).map((a) => (a || []).map((x) => `${x.card}<${x.by}`).sort());
    if (JSON.stringify(have) !== JSON.stringify(want.map((a) => a.sort()))) bad.push(`種子 ${g.seed} gifts ${JSON.stringify(have)}，應是 ${JSON.stringify(want)}`);
    if (JSON.stringify(got) !== JSON.stringify(back.map((a) => a.sort()))) bad.push(`種子 ${g.seed} received ${JSON.stringify(got)}，應是 ${JSON.stringify(back)}`);
  }
  const z = nonEmpty(n, "拿對手的牌當 CP 而觸發"); if (z !== true) return z;
  return ok(!bad.length, bad.length ? bad.slice(0, 3).join("；") : `38 局都對（共 ${n} 張）`);
});
cR("從任何一家的 view 算出來的 recap 跟從整個局面算的一樣", () => {
  const bad = [];
  for (const g of games().slice(0, 8)) {
    const want = JSON.stringify(RC.recap(g.st));
    for (let p = 0; p < 3; p++) { const have = JSON.stringify(RC.recap(E.view(g.st, p))); if (have !== want) bad.push(`種子 ${g.seed} ${NAME[p]}的 view：${have.slice(0, 80)}…`); }
  }
  return ok(!bad.length, bad.length ? bad.slice(0, 3).join("；") : "8 局 × 3 家的 view 都一樣");
});
cR("#90 之前存的局：recap 照樣有，sources 是 null", () => {
  const g = games()[2], old = E.clone(g.st);
  for (const c of old.counties) for (const b of c.blocks) delete b.s;
  old.result = { ...old.result, sources: null };
  let r; try { r = RC.recap(old); } catch (e) { return `recap 丟錯：${e.message}`; }
  if (!r) return "recap 是 null";
  return ok(r.sources === null && Array.isArray(r.trend) && r.trend.length === 9, `sources ${JSON.stringify(r.sources)}，trend ${r.trend ? r.trend.length : "沒有"} 列`);
});

// ------------------------------------------------------------------------------------------------ 5
section("5 moraleOf(id)：事件發生時士氣怎麼動");
const WHO = { "陳": 0, "宋": 1, "連": 2 };
function stated(text) {
  const out = [];
  for (const m of text.matchAll(/(陳|宋|連)士氣 ?([+−-])(\d+)%/g)) out.push([WHO[m[1]], (m[2] === "+" ? 1 : -1) * Number(m[3])]);
  for (const m of text.matchAll(/所有人士氣 ?([+−-])(\d+)%/g)) out.push(["all", (m[1] === "+" ? 1 : -1) * Number(m[2])]);
  for (const m of text.matchAll(/士氣最低者 ?([+−-])(\d+)%/g)) out.push(["lowest", (m[1] === "+" ? 1 : -1) * Number(m[2])]);
  for (const m of text.matchAll(/領先者士氣 ?([+−-])(\d+)%/g)) out.push(["leader", (m[1] === "+" ? 1 : -1) * Number(m[2])]);
  return out;
}
cM("跟牌面寫的一樣：牌文寫了「某人士氣 ±n%」的，moraleOf 有那一筆；牌文沒提士氣的，moraleOf 不動任何人", () => {
  const bad = [], vague = []; let n = 0;
  for (const e of EVENTS) {
    let have; try { have = RC.moraleOf(e.id); } catch (err) { bad.push(`${e.name}：丟錯 ${err.message}`); continue; }
    if (!Array.isArray(have)) { bad.push(`${e.name}：${JSON.stringify(have)}`); continue; }
    const want = stated(e.text);
    if (!/士氣/.test(e.text)) { if (have.some((x) => x[1] !== 0)) bad.push(`${e.name}（牌文沒提士氣）：${JSON.stringify(have)}`); continue; }
    if (!want.length) { vague.push(e.name); continue; }
    n += want.length;
    for (const w of want) if (!have.some((x) => x[0] === w[0] && x[1] === w[1])) bad.push(`${e.name}「${e.text}」：沒有 ${JSON.stringify(w)}，moraleOf ${JSON.stringify(have)}`);
  }
  const z = nonEmpty(n, "牌文寫了士氣變動的牌"); if (z !== true) return z;
  return ok(!bad.length, bad.length ? bad.slice(0, 5).join("；") : `${n} 筆都對；牌文提到士氣但沒有固定數字、這裡不比的：${vague.join("、") || "沒有"}`);
});
// The CP warning's own case: a rival plays the card for CP at its first play decision, it triggers for its owner, and
// the owner's 士氣 moves by what moraleOf says (from where it was, held within 20–80).
const GIFT = ["million_signatures", "local_factions", "alternation", "kneel_for_votes", "hand_in_hand", "lin_chairman", "chang_chiu", "kmt_anniversary", "chang_yung_fa", "lee_attacks_soong"];
function giftDelta(id) {
  const q = SEAT_OF[EVENTS.find((e) => e.id === id).owner], p = q === undefined ? 0 : (q + 1) % 3;
  let st = E.createGame(4, OPTS);
  const Rr = simRng(17);
  st = D.playUntil(st, (s) => E.mustAct(s)[0] === p && D.isPlayDecision(E.legalMoves(s, p)), Rr, (s, seat, moves) => D.quiet(s, seat, moves));
  st = D.giveCard(st, p, id);
  const before = st.luck.slice(), n0 = st.log.length;
  st = D.act(st, p, { type: "play", card: id, mode: "cp" });
  // until the event has happened and the table is back at somebody's play decision (the effect fully resolved)
  const fired = (s) => s.log.slice(n0).some((e) => (e.t === "trigger" || e.t === "effect") && e.card === id);
  const back = (s) => fired(s) && E.mustAct(s).length > 0 && D.isPlayDecision(E.legalMoves(s, E.mustAct(s)[0]));
  st = D.playUntil(st, back, Rr, (s, seat, moves) => D.quiet(s, seat, moves));
  return { q, p, delta: st.luck.map((x, i) => x - before[i]), before, after: st.luck.slice(), trig: fired(st) };
}
cM("拿去當 CP 而事件發生時，士氣照 moraleOf 變（10 張對手的牌被觸發；李登輝痛批宋是連的牌、動的是宋）", () => {
  const bad = [], seen = [];
  for (const id of GIFT) {
    const name = EVENTS.find((e) => e.id === id).name;
    let g; try { g = giftDelta(id); } catch (e) { bad.push(`${name}：${e.message.slice(0, 120)}`); continue; }
    if (!g.trig) { bad.push(`${name}：${NAME[g.p]}當 CP 打出後事件沒有發生`); continue; }
    const m = RC.moraleOf(id), want = [0, 1, 2].map((s) => m.filter((x) => x[0] === s || x[0] === "all").reduce((a, x) => a + x[1], 0));
    const exp = want.map((d, s) => Math.max(20, Math.min(80, g.before[s] + d)) - g.before[s]);
    seen.push(`${name} ${[0, 1, 2].filter((s) => g.delta[s]).map((s) => `${NAME[s]} ${g.before[s]}→${g.after[s]}`).join(" ") || "沒有人變"}`);
    if (JSON.stringify(exp) !== JSON.stringify(g.delta)) bad.push(`${name}：士氣變了 ${g.delta.join("/")}，moraleOf 說 ${exp.join("/")}`);
  }
  return ok(!bad.length, bad.length ? bad.slice(0, 4).join("；") : seen.join("；"));
});

test("endfacts90", () => {
  const s = summary();
  for (const p of R.pass) console.log(`  ✓ ${p.label}${p.msg ? " — " + p.msg : ""}`);
  for (const t of s.todos) console.log(`  … ${t.label} — ${t.msg}`);
  for (const x of s.failures) console.log(`  ✗ ${x.label} — ${x.msg}`);
  console.log(`  通過 ${s.pass} / 失敗 ${s.fail} / 尚未實作 ${s.todo}`);
  assert.equal(s.fail, 0, s.failures.map((x) => `${x.label}: ${x.msg}`).join("\n"));
});
