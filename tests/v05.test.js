// Rulebook v0.5 draft: ads and media folded into the issues (issue #49). Orchestrator's file: a peer may run it and
// falsify against it, and does not edit it.
//
//   node --test tests/v05.test.js      (or `npm test`)
//
// Owner, 2026-10-15: 「我想合併廣告媒體和議題，就是取消廣告和媒體的動作，其作用合併到議體上，你評估一下」; on the
// evaluation, four yes (「三個議題方塊總數最多的人 +1 動能」, 「議題總數最多」的人, 「經濟議題起始 2 顆」, the nine media
// cards rewritten as 「任一議題」); on the draft, 「v0.5（廣告與媒體併入議題）可以」. The numbers below were copied BY HAND
// from the vault draft `Projects/president_2000/president_2000 - v0.5 草稿（廣告與媒體併入議題）.md`, not read from the
// product. v0.5 is a second rule set next to v0.4 until the owner has seen the simulations (tools/balance49.mjs); v0.4
// stays exactly as it is.
//
// Contract (orchestrator, #49):
//   - E.createGame(seed, { rules: "v0.5" }) starts a v0.5 game and its state says st.rules === "v0.5". Without `rules`
//     (or with "v0.4") the game is today's v0.4, unchanged.
//   - a v0.5 state has no media at all: st.media is undefined.
//   - the 議題總領先者 (most cubes over the three issue cards, a tie is nobody) takes the media leader's two steps of
//     §5.3: +1 momentum right after the halving, logged { t: "momentum", step: "lead", seat }, then the swap question.
//   - 「任一議題」: whoever resolves the card picks one issue, { type: "issue", issue: <name> } (to take 宋's cubes off,
//     { type: "issue", issue: <name>, target: 1 }, offered only on issues where 宋 has some; none, no question). All the
//     cubes go on that one issue; nothing is checked.
// Every v0.5 check reports 尚未實作 until the engine knows v0.5.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { R, section, check, eq, ok, nonEmpty, summary } from "./harness.js";
import * as D from "./driver.js";
import * as E from "../public/shared/engine.js";
import * as B from "../public/shared/bots.js";

const { CHEN, SOONG, LIEN, ci } = D;
const V5 = { rules: "v0.5" };
// ---------------------------------------------------------------- SPEC (the draft, by hand)
const SPEC = {
  startIssues: { cross: [0, 0, 0], clean: [0, 0, 0], econ: [0, 0, 2] }, // 四.5 / 十三: 連 starts with 2 on 經濟民生
  kinds: "campaign,issue", // 七: 競選／議題 (7.2 廣告 is gone)
  v04: { media: [0, 0, 2], kinds: "ads,campaign,issue" }, // today's v0.4, which #49 does not touch
};
const READY = (() => { try { return E.createGame(1, V5).rules === "v0.5"; } catch { return false; } })();
const c5 = (name, fn) => check(name, () => (READY ? fn() : 'TODO: 引擎還沒有 v0.5（createGame(seed, { rules: "v0.5" }) 的 st.rules 不是 "v0.5"，#49）'));
const issueOf = (st, name) => st.issues.find((i) => i.name === name).cubes;
const setIssue = (st, name, cubes) => { st.issues.find((i) => i.name === name).cubes = cubes.slice(); };
const NO_ADS = (m) => m.type === "ad" || m.type === "media" || (m.type === "action" && m.kind === "ads");

// The twelfth play of turn 1 in a v0.5 game, where that seat still holds its candidate card (as in
// acceptance.test.js), so the last play touches nothing.
function atLastPlay() {
  for (let seed = 1; seed < 80; seed++) {
    let st = E.createGame(seed, V5);
    st = D.act(st, st.initiative, { type: "order", pos: 0 });
    let plays = 0;
    for (let n = 0; n < 3000 && st.phase === "action"; n++) {
      const seat = E.mustAct(st)[0], ms = E.legalMoves(st, seat);
      if (D.isPlayDecision(ms) && plays === 11) {
        if (ms.some((m) => m.type === "candidate")) return { st, seat };
        break;
      }
      const m = D.quiet(st, seat, ms);
      if (m.type === "play" || m.type === "candidate") plays++;
      st = E.apply(st, seat, m);
    }
  }
  throw new Error("80 個種子都找不到第 12 次出牌時還能出候選人牌的 v0.5 局");
}
const lastPlayQuiet = (st, seat) => {
  st = D.act(st, seat, { type: "candidate" });
  st = D.act(st, seat, { type: "action", kind: "campaign" });
  return D.act(st, seat, { type: "done" });
};
// The momentum phase after the last play, with the issue cubes (slot order) and momentum given.
const endTurn = (cubes, mom, more) => {
  const { st, seat } = atLastPlay();
  st.mom = mom.slice(); st.issues.forEach((i, k) => { i.cubes = cubes[k].slice(); });
  st.endorse = Array(7).fill(-1); st.endorseDeck = [4]; st.endorseDiscard = [];
  if (more) more(st);
  return lastPlayQuiet(st, seat);
};
const at = (s) => `${s.phase === "momentum" && s.pending && s.pending.stage === "swap" ? "swap:" + s.pending.seat : s.phase} ${s.mom.join()}`;
// Through the rest of the momentum phase declining every swap; says whether a swap was offered and what "lead" said.
function throughMomentum(st) {
  let asked = false;
  for (let n = 0; n < 200 && st.phase === "momentum"; n++) {
    const seat = E.mustAct(st)[0], ms = E.legalMoves(st, seat);
    if (ms.some((m) => m.type === "swap")) asked = true;
    st = E.apply(st, seat, D.quiet(st, seat, ms));
  }
  return { st, asked, lead: st.log.filter((e) => e.t === "momentum" && e.step === "lead").map((e) => e.seat) };
}

// ---------------------------------------------------------------- v0.4 stays as it is (passes today)
section("v0.4 照舊");
check("不帶 rules 的局是今天的 v0.4：全國媒體 [0,0,2]、議題全 0、三種行動；帶 rules: \"v0.4\" 一模一樣（#49 不改 v0.4）", () => {
  const st = E.createGame(7);
  let r = eq(JSON.stringify(st.media), JSON.stringify(SPEC.v04.media), "v0.4 開局的全國媒體"); if (r !== true) return r;
  r = eq(st.issues.map((i) => i.cubes.join("/")).join(" "), "0/0/0 0/0/0 0/0/0", "v0.4 開局的議題"); if (r !== true) return r;
  const k = D.act(D.firstActor(CHEN), CHEN, { type: "candidate" });
  r = eq(E.legalMoves(k, CHEN).map((m) => m.kind).sort().join(), SPEC.v04.kinds, "v0.4 的行動種類"); if (r !== true) return r;
  r = eq(JSON.stringify(E.createGame(7, { rules: "v0.4" })), JSON.stringify(st), "createGame(7, { rules: \"v0.4\" }) 與 createGame(7)"); if (r !== true) return r;
  return ok(true, "媒體 0/0/2、議題全 0、行動 " + SPEC.v04.kinds);
});
// Three whole v0.4 games, all seats 操盤手 with tests/sim.js's move RNG: their logs, recorded from main 10eefec before
// #49. Any change to v0.4's rules or bots changes them.
const simRng = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
function botGame(seed, level, opts) {
  let st = E.createGame(seed, opts); const Rn = simRng(seed * 977 + 13); const bad = [];
  for (let n = 0; n < 20000 && st.phase !== "end"; n++) {
    const seat = E.mustAct(st)[0];
    if (seat == null) throw new Error(`seed ${seed}: 卡在 ${st.phase}，沒有人要動`);
    const m = B.chooseMove(st, seat, level, Rn).move;
    if (NO_ADS(m)) bad.push(JSON.stringify(m));
    st = E.apply(st, seat, m);
  }
  return { st, bad };
}
const V04_LOGS = { 1: "7775288fc424", 2: "1359a8e4aa16", 3: "827399785014" };
check("v0.4 的電腦對局跟 #49 之前一模一樣（3 局操盤手，紀錄的雜湊，main 10eefec）", () => {
  const got = [];
  for (const seed of [1, 2, 3]) {
    const { st } = botGame(seed, 3);
    const h = createHash("sha1").update(JSON.stringify(st.log)).digest("hex").slice(0, 12);
    if (h !== V04_LOGS[seed]) return `seed ${seed}：紀錄的雜湊 ${h}，#49 之前是 ${V04_LOGS[seed]}（票 ${st.result && st.result.votes.join("/")}）`;
    got.push(`${seed}:${h}`);
  }
  return ok(true, got.join(" "));
});

// ---------------------------------------------------------------- v0.5: setup and actions
section("v0.5 設置與行動");
c5("開局：連在經濟民生放 2 顆、其他議題 0；沒有媒體（st.media 不存在）（v0.5 二、四.5、十三）", () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const st = E.createGame(seed, V5);
    let r = eq(st.rules, "v0.5", `seed ${seed} 的 st.rules`); if (r !== true) return r;
    r = eq(st.media, undefined, `seed ${seed} 的 st.media`); if (r !== true) return r;
    for (const [name, cubes] of Object.entries(SPEC.startIssues)) { r = eq(issueOf(st, name).join("/"), cubes.join("/"), `seed ${seed} 開局 ${name}`); if (r !== true) return r; }
  }
  return ok(true, "5 個種子：經濟民生 0/0/2、兩岸與清廉 0/0/0、沒有媒體");
});
c5("行動只有競選與議題兩種（v0.5 七）", () => {
  let st = D.firstActor(CHEN, V5);
  st = D.act(st, CHEN, { type: "candidate" });
  const r = eq(E.legalMoves(st, CHEN).map((m) => m.kind).sort().join(), SPEC.kinds, "候選人牌之後的行動種類");
  return r === true ? ok(true, SPEC.kinds) : r;
});
c5("整局隨機走：沒有任何時候出現廣告或媒體的動作（4 局，每一步的合法動作）", () => {
  let states = 0, kinds = 0;
  for (const seed of [4901, 4902, 4903, 4904]) {
    const Rn = D.rng(seed); let st = E.createGame(seed, V5);
    for (let n = 0; n < 6000 && st.phase !== "end"; n++) {
      const seat = E.mustAct(st)[0]; if (seat == null) return `seed ${seed}：卡在 ${st.phase}`;
      const ms = E.legalMoves(st, seat); states++;
      if (st.pending && st.pending.stage === "kind") kinds++;
      const bad = ms.find(NO_ADS); if (bad) return `seed ${seed} 第 ${st.turn} 回合 ${st.phase}：合法動作裡有 ${JSON.stringify(bad)}`;
      if (st.media !== undefined) return `seed ${seed} 第 ${st.turn} 回合：st.media 出現了 ${JSON.stringify(st.media)}`;
      st = E.apply(st, seat, ms[Math.floor(Rn() * ms.length)]);
    }
    if (st.phase !== "end") return `seed ${seed}：6000 步還沒結束（${st.phase}）`;
  }
  let r = nonEmpty(kinds, "選行動種類的時刻"); if (r !== true) return r;
  return ok(true, `${states} 個局面、其中 ${kinds} 次選行動種類，都沒有廣告或媒體；4 局都走完`);
});

// ---------------------------------------------------------------- v0.5: the issue leader (§3.4, §5.3)
section("v0.5 議題總領先者");
c5("減半之後議題總領先者 +1 動能，接著問他要不要交換；看的是三個議題的總數，不是單一議題（v0.5 3.4、5.3）", () => {
  const Z = [0, 0, 0];
  // 宋 0+2+0 vs 連 0+0+1: 宋. 陳 3→2（進位）、宋 2→1→+1=2、連 1→0（先加再減半會是 宋 1）.
  let r = eq(at(endTurn([Z, [0, 2, 0], [0, 0, 1]], [3, 2, 1])), "swap:1 2,2,0", "宋總數 2 領先"); if (r !== true) return r;
  // 連 4, momentum 0: +1 after the halving (before would give 0).
  r = eq(at(endTurn([Z, Z, [0, 0, 4]], [0, 0, 0])), "swap:2 0,0,1", "連總數 4 領先、動能 0"); if (r !== true) return r;
  // 陳 has the biggest single pile (2 on the first slot), 宋 the most in all (1+1+1 = 3): 宋.
  r = eq(at(endTurn([[2, 1, 0], [0, 1, 0], [0, 1, 0]], [0, 0, 0])), "swap:1 0,1,0", "陳單一議題最多（2）、宋總數最多（3）"); if (r !== true) return r;
  const lead = throughMomentum(endTurn([Z, [0, 2, 0], [0, 0, 1]], [3, 2, 1])).lead;
  r = eq(lead.join(), "1", "紀錄的 { t: \"momentum\", step: \"lead\" }"); if (r !== true) return r;
  return ok(true, "宋 2 > 連 1 → 宋；連 4、動能 0 → 0,0,1；單一議題最多的陳輸給總數 3 的宋；紀錄 step lead");
});
c5("議題總數平手：沒有人 +1、不問交換（v0.5 3.4）", () => {
  const Z = [0, 0, 0], out = [];
  for (const [cubes, what] of [[[[1, 1, 0], Z, Z], "陳宋各 1（同一議題）"], [[[2, 0, 0], [0, 1, 0], [0, 1, 0]], "陳 2（一個議題）、宋 1+1"], [[Z, Z, Z], "大家都 0"]]) {
    const x = throughMomentum(endTurn(cubes, [0, 0, 0]));
    if (x.asked) return `${what}：平手還問了交換`;
    if (x.lead.length) return `${what}：平手還記了領先者 +1（seat ${x.lead.join()}）`;
    if (x.st.phase === "momentum") return `${what}：動能結算沒有走完`;
    out.push(what);
  }
  return ok(true, out.join("；") + "：都沒有 +1、沒有問交換");
});
c5("議題總領先者交換相鄰兩槽，獎勵照交換後的槽位（v0.5 5.3）", () => {
  const { st, seat } = atLastPlay();
  st.mom = [0, 0, 0];
  st.issues[0].cubes = [0, 0, 0]; st.issues[1].cubes = [2, 0, 0]; st.issues[2].cubes = [0, 1, 0];
  st.endorse = Array(7).fill(-1); st.endorseDeck = [4]; st.endorseDiscard = [];
  const [n0, n1, n2] = st.issues.map((i) => i.name);
  const mid = lastPlayQuiet(st, seat);
  let r = eq(JSON.stringify(E.mustAct(mid)), "[0]", "議題總領先者（陳 2 對宋 1）決定"); if (r !== true) return r;
  r = eq(E.legalMoves(mid, CHEN).map((m) => m.type + (m.slot ?? "")).sort().join(), "noswap,swap0,swap1", "陳的選項"); if (r !== true) return r;
  const s = D.act(mid, CHEN, { type: "swap", slot: 0 });
  r = eq(s.issues.map((i) => i.name).join(), [n1, n0, n2].join(), "交換後的槽位"); if (r !== true) return r;
  // 陳 +1（領先者）；第一槽 n1 陳領先 +1、背書抽到 4；第三槽 n2 宋 +1；衰減後 n1 陳 1、n2 宋 0。
  r = eq(`${s.mom.join("/")} ${s.endorse[4]} ${s.issues.map((i) => i.cubes.join("/")).join(" ")}`, "2/1/0 0 1/0/0 0/0/0 0/0/0", "動能、高屏背書、議題"); if (r !== true) return r;
  return ok(true, `陳把 ${n0}、${n1} 對調；動能 2/1/0、高屏背書給陳`);
});

// ---------------------------------------------------------------- v0.5: the nine cards (§14, the draft's table)
section("v0.5 九張改寫的牌");
// Play card id as an event for `by` (turn 1, `by` first), with the bag holding only the opponents' cubes so a
// support check would show; steps are [seat, move] or ["probe", seat, fn(moves)]. Compares what changed.
const OPP_BAG = { [CHEN]: [0, 6, 6], [SOONG]: [6, 0, 6], [LIEN]: [6, 6, 0] };
const snap = (st, counties) => ({ issues: Object.fromEntries(st.issues.map((i) => [i.name, i.cubes.slice()])), bag: st.bag.slice(), mom: st.mom.slice(), checks: D.checks(st), cubes: Object.fromEntries(counties.map((c) => [c, [0, 1, 2].map((p) => D.cubes(st, ci(c), p))])) });
function runCard(s, opts = V5) {
  let st = D.giveCard(D.firstActor(s.by, opts), s.by, s.id);
  st.bag = OPP_BAG[s.by].slice(); st.mom = [2, 2, 2];
  if (s.arrange) s.arrange(st);
  const counties = Object.keys((s.want && s.want.cubes) || {});
  const a = snap(st, counties);
  try { st = D.act(st, s.by, { type: "play", card: s.id, mode: "event" }); } catch (e) { return `${s.id}：${e.message}`; }
  for (const step of s.steps) {
    if (step[0] === "probe") { const r = step[2](E.legalMoves(st, step[1])); if (r !== true) return `${s.id}：${r}`; continue; }
    const [seat, want] = step;
    if (!E.mustAct(st).includes(seat)) return `${s.id}：輪到 ${JSON.stringify(E.mustAct(st))}，期望 seat ${seat} 選 ${JSON.stringify(want)}`;
    try { st = D.act(st, seat, want); } catch (e) { return `${s.id}：${e.message}`; }
  }
  if (st.pending && st.pending.fx) return `${s.id}：效果還有選擇沒做完：${JSON.stringify(E.legalMoves(st, E.mustAct(st)[0]).slice(0, 4))}`;
  const b = snap(st, counties), got = [], want = [];
  for (const n of Object.keys(a.issues)) { const d = b.issues[n].map((x, p) => x - a.issues[n][p]); if (d.some((x) => x)) got.push(`${n} ${d.join("/")}`); }
  for (const n of Object.keys(s.want.issues || {})) want.push(`${n} ${s.want.issues[n].join("/")}`);
  const dv = (k) => b[k].map((x, p) => x - a[k][p]);
  if (dv("bag").some((x) => x)) got.push(`袋 ${dv("bag").join("/")}`);
  if (s.want.bag) want.push(`袋 ${s.want.bag.join("/")}`);
  if (dv("mom").some((x) => x)) got.push(`動能 ${dv("mom").join("/")}`);
  if (s.want.mom) want.push(`動能 ${s.want.mom.join("/")}`);
  for (const c of counties) { const d = b.cubes[c].map((x, p) => x - a.cubes[c][p]); got.push(`${c} ${d.join("/")}`); want.push(`${c} ${s.want.cubes[c].join("/")}`); }
  if (b.checks !== a.checks) got.push(`檢定 ${b.checks - a.checks}`);
  if (s.want.checks) want.push(`檢定 ${s.want.checks}`);
  if (s.after) { const r = s.after(st); if (r !== true) return `${s.id}：${r}`; }
  const g = got.sort().join("；"), w = want.sort().join("；");
  return g === w ? true : `${s.id}：期望 ${w || "（沒有變化）"}；實際 ${g || "（沒有變化）"}`;
}
const PICK = (issue, target) => (target == null ? { type: "issue", issue } : { type: "issue", issue, target });
const offersAll = (seat) => (ms) => eq(ms.map((m) => JSON.stringify(m)).sort().join(" "), ["clean", "cross", "econ"].map((n) => JSON.stringify(PICK(n))).sort().join(" "), `seat ${seat} 的選項（三個議題各一個，沒有別的）`);
const F = (county) => ({ type: "fill", county: ci(county) });

// The runner checks itself on a v0.4 card that already works (new_middle: 兩岸陳 +2): right passes, wrong is red.
check("比對機械先自己跑一次（v0.4 的新中間路線：對的期望通過、錯的會紅）", () => {
  const good = runCard({ id: "new_middle", by: CHEN, steps: [], want: { issues: { cross: [2, 0, 0] } } }, {});
  if (good !== true) return "對的期望沒通過：" + good;
  const bad = runCard({ id: "new_middle", by: CHEN, steps: [], want: { issues: { cross: [1, 0, 0] } } }, {});
  if (bad === true) return "錯的期望也通過了：比對沒有作用";
  return ok(true, "對的過；錯的紅（" + bad + "）");
});
const CARDS = [
  { id: "lo_propaganda", by: CHEN, steps: [["probe", CHEN, offersAll(CHEN)], [CHEN, PICK("clean")]], want: { issues: { clean: [2, 0, 0] } } },
  { id: "hsieh_kaohsiung", by: CHEN, steps: [[CHEN, F("高雄市")], [CHEN, F("高雄市")], ["probe", CHEN, offersAll(CHEN)], [CHEN, PICK("cross")]], want: { cubes: { "高雄市": [2, 0, 0] }, issues: { cross: [1, 0, 0] } } },
  { id: "advisory_group", by: CHEN, steps: [["probe", CHEN, offersAll(CHEN)], [CHEN, PICK("econ")]], want: { issues: { clean: [1, 0, 0], econ: [2, 0, 0] } } },
  { id: "chang_yung_fa", by: CHEN, steps: [["probe", CHEN, offersAll(CHEN)], [CHEN, PICK("cross")]], want: { issues: { cross: [1, 0, 0] }, bag: [2, 0, 0] } },
  { id: "provincial_staff", by: SOONG, steps: [["probe", SOONG, offersAll(SOONG)], [SOONG, PICK("econ")]], want: { issues: { econ: [0, 1, 0] } },
    after: (st) => (st.active.includes("provincial_staff") ? true : "本回合的效果（連的休息方塊加成無效）沒有留在 st.active") },
  { id: "chang_doctors", by: SOONG, steps: [["probe", SOONG, offersAll(SOONG)], [SOONG, PICK("clean")]], want: { issues: { clean: [0, 1, 0] }, bag: [0, 2, 0] } },
  { id: "party_assets_ads", by: LIEN, steps: [["probe", LIEN, offersAll(LIEN)], [LIEN, PICK("econ")]], want: { issues: { econ: [0, 0, 2] } } },
  { id: "massive_ads", by: LIEN, steps: [["probe", LIEN, offersAll(LIEN)], [LIEN, PICK("cross")]], want: { issues: { cross: [0, 0, 3] } } },
];
c5("「任一議題」加方塊：出牌的人選一個議題，全部放在那裡，不檢定；牌上其他效果照舊（v0.5 九張中的八張）", () => {
  const bad = CARDS.map((s) => runCard(s)).filter((r) => r !== true);
  return bad.length ? bad.join("\n      ") : ok(true, `${CARDS.length} 張：${CARDS.map((s) => s.id).join("、")}`);
});
c5("開除宋楚瑜黨籍：連選一個宋有方塊的議題，拿掉宋最多 2 顆（不夠拿到 0）；宋都沒有就不問；宋動能 +1（v0.5）", () => {
  const two = (st) => { setIssue(st, "clean", [0, 3, 0]); setIssue(st, "cross", [0, 1, 0]); };
  const offers = (ms) => eq(ms.map((m) => JSON.stringify(m)).sort().join(" "), [PICK("clean", SOONG), PICK("cross", SOONG)].map((m) => JSON.stringify(m)).sort().join(" "), "連的選項（宋有方塊的清廉、兩岸；經濟民生宋 0 不給）");
  const specs = [
    { id: "expel_soong", by: LIEN, arrange: two, steps: [["probe", LIEN, offers], [LIEN, PICK("clean", SOONG)]], want: { issues: { clean: [0, -2, 0] }, mom: [0, 1, 0] } },
    { id: "expel_soong", by: LIEN, arrange: two, steps: [[LIEN, PICK("cross", SOONG)]], want: { issues: { cross: [0, -1, 0] }, mom: [0, 1, 0] } },
    { id: "expel_soong", by: LIEN, steps: [], want: { mom: [0, 1, 0] } },
  ];
  const bad = specs.map((s) => runCard(s)).filter((r) => r !== true);
  return bad.length ? bad.join("\n      ") : ok(true, "清廉 3→1、兩岸 1→0、宋沒有議題方塊時不問；宋動能 +1");
});

// ---------------------------------------------------------------- v0.5: election day (§十二 1)
section("v0.5 投票日");
c5("轉換：議題方塊全部、動能每枚換 2 顆投入袋中；議題清空、動能歸零；沒有媒體這一項（v0.5 十二 1）", () => {
  let st = D.playUntil(D.firstActor(CHEN, { startTurn: 8, ...V5 }), (s) => s.phase === "save", null, D.quiet);
  setIssue(st, "cross", [1, 0, 0]); setIssue(st, "clean", [0, 2, 0]); setIssue(st, "econ", [2, 0, 1]);
  st.mom = [3, 1, 2]; st.bag = [5, 5, 5]; st.rest = [0, 0, 0];
  for (const s of [0, 1, 2]) if (E.mustAct(st).includes(s)) st = D.act(st, s, { type: "save" });
  // 袋：陳 5+3+6=14、宋 5+2+2=9、連 5+1+4=10（v0.4 還會加媒體）
  const r = eq(`${st.turn} ${st.bag.join("/")} ${st.issues.flatMap((i) => i.cubes).reduce((a, b) => a + b, 0)} ${st.mom.join("/")} ${st.media}`, "9 14/9/10 0 0/0/0 undefined", "第 9 回合 袋子、盤上議題、動能、媒體");
  return r === true ? ok(true, "袋子 14/9/10；議題、動能清空") : r;
});

// ---------------------------------------------------------------- v0.5: the computer
section("v0.5 電腦");
c5("三個等級都下得完一局 v0.5，沒有出過廣告或媒體的動作（#49）", () => {
  const out = [];
  for (const level of [1, 2, 3]) {
    const { st, bad } = botGame(4910 + level, level, V5);
    if (st.phase !== "end") return `等級 ${level}：沒有下完（${st.phase}）`;
    if (bad.length) return `等級 ${level}：電腦出了 ${bad[0]}`;
    out.push(`等級 ${level} 票 ${st.result.votes.join("/")}`);
  }
  return ok(true, out.join("；"));
});

test("v05", () => {
  const s = summary();
  for (const p of R.pass) console.log(`  ✓ ${p.label}${p.msg ? " — " + p.msg : ""}`);
  for (const t of s.todos) console.log(`  … ${t.label} — ${t.msg}`);
  for (const x of s.failures) console.log(`  ✗ ${x.label} — ${x.msg}`);
  console.log(`  通過 ${s.pass} / 失敗 ${s.fail} / 尚未實作 ${s.todo}`);
  assert.equal(s.fail, 0, s.failures.map((x) => `${x.label}: ${x.msg}`).join("\n"));
});
