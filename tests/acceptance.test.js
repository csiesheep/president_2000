// The first guard. Orchestrator's file: a peer may run it and falsify against
// it, and does not edit it (TEAM.md).
//
//   node --test tests/acceptance.test.js      (or `npm test`)
//
// Three verdicts per check (tests/harness.js): 通過 / 失敗 / 尚未實作.
//
// Group 0 compares the product's data with the rulebook's numbers. The numbers
// in SPEC were copied BY HAND from the owner's vault, `Projects/president_2000/
// president_2000 - rulebook.md` (v0.2, 2026-10-13), sections 二–四, 六, 十三,
// 十四. They are not read from the product: changing a number in public/shared/
// to make a later check pass turns this group red.
// Group 1 is the product's verb, with a loose threshold: a game can be set up,
// and every seat has something legal to do at the first action phase.
// Group 2 lists what the rulebook asks for and the engine does not have yet,
// each keyed on the thing that will exist when it is built. The orchestrator
// replaces each of them with real checks BEFORE the work is handed out.
import test from "node:test";
import assert from "node:assert/strict";
import { R, section, check, eq, ok, nonEmpty, summary } from "./harness.js";
import * as B from "../public/shared/board.js";
import * as C from "../public/shared/cards.js";
import * as E from "../public/shared/engine.js";

// ---------------------------------------------------------------- SPEC
// county: [blocks, 陳, 宋, 連, 綠游離 empty, 藍游離 empty, 無色]  (rulebook §四)
const SPEC_COUNTIES = {
  "台北市": [19, 4, 5, 2, 2, 3, 3], "台北縣": [24, 4, 4, 3, 3, 6, 4], "基隆市": [3, 1, 1, 0, 0, 0, 1],
  "桃園縣": [11, 1, 3, 1, 1, 3, 2], "新竹縣": [3, 0, 1, 1, 0, 0, 1], "新竹市": [2, 0, 1, 0, 0, 1, 0], "苗栗縣": [4, 0, 1, 1, 0, 1, 1],
  "台中縣": [10, 1, 2, 1, 1, 3, 2], "台中市": [6, 1, 1, 1, 0, 2, 1], "彰化縣": [9, 1, 2, 1, 1, 2, 2], "南投縣": [4, 1, 1, 1, 0, 0, 1],
  "雲林縣": [5, 1, 1, 1, 0, 1, 1], "嘉義縣": [4, 1, 1, 1, 0, 0, 1], "嘉義市": [2, 1, 0, 0, 0, 0, 1], "台南縣": [8, 1, 1, 1, 1, 2, 2], "台南市": [5, 1, 1, 1, 0, 1, 1],
  "高雄市": [10, 2, 2, 1, 2, 2, 1], "高雄縣": [9, 2, 1, 1, 1, 2, 2], "屏東縣": [6, 1, 1, 1, 1, 1, 1],
  "宜蘭縣": [3, 1, 1, 0, 0, 0, 1], "花蓮縣": [3, 0, 1, 1, 0, 0, 1], "台東縣": [2, 0, 1, 0, 0, 0, 1],
  "澎湖縣": [1, 0, 1, 0, 0, 0, 0], "金馬": [1, 0, 1, 0, 0, 0, 0],
};
const SPEC = {
  counties: 25 - 1, // 25 named in the rulebook with 金門+連江 merged into one row
  blocks: 154, greenBlocks: 38, blueBlocks: 85, greyBlocks: 31,
  start: [25, 35, 20], floating: [13, 30], grey: 31,
  regions: ["北北基", "桃竹苗", "中彰投", "雲嘉南", "高屏", "宜花東", "離島"],
  regionCounties: { "北北基": 3, "桃竹苗": 4, "中彰投": 4, "雲嘉南": 5, "高屏": 3, "宜花東": 3, "離島": 2 },
  startCounty: { chen: "台南縣", soong: "南投縣", lien: "台北市" },
  startMomentum: [3, 2, 1], bagSeed: 12, bossThreshold: 4, turns: 9,
  startMedia: { lien: ["北北基", "中彰投"] },
  issues: 3,
  events: { total: 60, chen: 18, soong: 17, lien: 18, ext: 7, early: 40, late: 20 },
  locals: { total: 36, early: 20, late: 16, cp2: 20, cp3: 16 },
  decks: { early: 60, late: 36 },
  restCubes: { 2: 2, 3: 1, 4: 0 },
  candidate: { chen: [5, 0], soong: [5, 0], lien: [3, 2] },
  hand: { deal: 7, play: 4, saveEarly: 1, saveLate: 2 },
  must: ["yang_exposes"],
  cpRange: [2, 4],
};

// ---------------------------------------------------------------- group 0
section("0 常數對照");
check("縣市數", () => eq(B.COUNTIES.length, SPEC.counties, "縣市數"));
check("每縣市票塊數與初始盤", () => {
  const bad = [];
  for (const c of B.COUNTIES) {
    const s = SPEC_COUNTIES[c[0]];
    if (!s) { bad.push(c[0] + " 不在規則書"); continue; }
    const [name, , G, Bb, N, init] = c;
    const got = [G + Bb + N, init[0], init[1], init[2], G - init[0], Bb - init[1] - init[2], N];
    if (got.join() !== s.join()) bad.push(`${name}: 期望 ${s.join("/")}，實際 ${got.join("/")}`);
  }
  return bad.length ? bad.join("；") : ok(true, `${B.COUNTIES.length} 縣市逐列相符`);
});
check("總塊數 154 與三色塊數", () => {
  const G = B.COUNTIES.reduce((s, c) => s + c[2], 0), Bb = B.COUNTIES.reduce((s, c) => s + c[3], 0), N = B.COUNTIES.reduce((s, c) => s + c[4], 0);
  const r = eq(G + Bb + N, SPEC.blocks, "總塊數"); if (r !== true) return r;
  const r2 = eq([G, Bb, N].join(), [SPEC.greenBlocks, SPEC.blueBlocks, SPEC.greyBlocks].join(), "綠/藍/無色塊數"); if (r2 !== true) return r2;
  return ok(true, `154 = 綠 ${G} + 藍 ${Bb} + 無色 ${N}`);
});
check("初始方塊 25/35/20 與游離 13/30", () => {
  const st = E.createGame(1);
  const cubes = [0, 0, 0]; let eG = 0, eB = 0, eN = 0;
  for (const c of st.counties) for (const b of c.blocks) { if (b.o >= 0) cubes[b.o]++; else if (b.t === "G") eG++; else if (b.t === "B") eB++; else eN++; }
  const r = eq(cubes.join(), SPEC.start.join(), "初始方塊 陳/宋/連"); if (r !== true) return r;
  const r2 = eq([eG, eB, eN].join(), [SPEC.floating[0], SPEC.floating[1], SPEC.grey].join(), "空的 綠游離/藍游離/無色"); if (r2 !== true) return r2;
  return ok(true, `陳 ${cubes[0]} 宋 ${cubes[1]} 連 ${cubes[2]}；空 綠 ${eG} 藍 ${eB} 無色 ${eN}`);
});
check("七個區域與各區縣市數", () => {
  const r = eq(B.REGIONS.join(), SPEC.regions.join(), "區域"); if (r !== true) return r;
  for (const [name, n] of Object.entries(SPEC.regionCounties)) {
    const got = B.COUNTIES.filter((c) => B.REGIONS[c[1]] === name).length;
    if (got !== n) return `${name}: 期望 ${n} 縣市，實際 ${got}`;
  }
  return ok(true, "7 區，縣市數相符");
});
check("起始位置、動能、袋子、門檻、回合數、議題數", () => {
  for (const [s, c] of Object.entries(SPEC.startCounty)) { const r = eq(B.START_COUNTY[s], c, "起始位置 " + s); if (r !== true) return r; }
  const r1 = eq(B.START_MOMENTUM.join(), SPEC.startMomentum.join(), "起始動能"); if (r1 !== true) return r1;
  const r2 = eq(B.BAG_SEED, SPEC.bagSeed, "袋子起始"); if (r2 !== true) return r2;
  const r3 = eq(B.BOSS_THRESHOLD, SPEC.bossThreshold, "樁腳主門檻"); if (r3 !== true) return r3;
  const r4 = eq(B.TURNS, SPEC.turns, "回合數"); if (r4 !== true) return r4;
  const r5 = eq(B.ISSUES.length, SPEC.issues, "議題數"); if (r5 !== true) return r5;
  return ok(true, "全部相符");
});
check("連的起始媒體：北北基、中彰投各 1", () => {
  const got = B.REGIONS.filter((_, r) => B.START_MEDIA[r][B.LIEN] === 1);
  const others = B.START_MEDIA.flat().reduce((s, x) => s + x, 0) - got.length;
  const r = eq(got.join(), SPEC.startMedia.lien.join(), "連起始媒體"); if (r !== true) return r;
  return eq(others, 0, "其他媒體方塊");
});
check("事件牌 60：陳 18、宋 17、連 18、外力 7；前期 40、後期 20", () => {
  const n = (f) => C.EVENTS.filter(f).length;
  const got = { total: C.EVENTS.length, chen: n((e) => e.owner === "chen"), soong: n((e) => e.owner === "soong"), lien: n((e) => e.owner === "lien"), ext: n((e) => e.owner === "ext"), early: n((e) => e.deck === "early"), late: n((e) => e.deck === "late") };
  for (const k of Object.keys(SPEC.events)) { const r = eq(got[k], SPEC.events[k], "事件牌 " + k); if (r !== true) return r; }
  return ok(true, JSON.stringify(got));
});
check("事件牌 id 唯一、CP 在 2–4、議題圖示合法", () => {
  const ids = new Set(C.EVENTS.map((e) => e.id));
  const r = eq(ids.size, C.EVENTS.length, "唯一 id 數"); if (r !== true) return r;
  const badCp = C.EVENTS.filter((e) => e.cp < SPEC.cpRange[0] || e.cp > SPEC.cpRange[1]).map((e) => e.id);
  if (badCp.length) return "CP 超出 2–4: " + badCp.join(",");
  const badIcon = C.EVENTS.filter((e) => !["cross", "clean", "econ"].includes(e.icon)).map((e) => e.id);
  if (badIcon.length) return "議題圖示不合法: " + badIcon.join(",");
  return ok(true, `${ids.size} 個 id`);
});
check("必觸發牌只有楊吉雄爆料；條件牌指向存在的牌", () => {
  const must = C.EVENTS.filter((e) => e.must).map((e) => e.id);
  const r = eq(must.join(), SPEC.must.join(), "必觸發"); if (r !== true) return r;
  const ids = new Set(C.EVENTS.map((e) => e.id));
  const badCond = C.EVENTS.filter((e) => e.cond && !ids.has(e.cond)).map((e) => e.id);
  return badCond.length ? "條件指向不存在的牌: " + badCond.join(",") : ok(true, "授意說 → 爆料；說法反覆 → 授意說");
});
check("地方牌 36：前期 20、後期 16；2 CP 20、3 CP 16", () => {
  const L = C.localCards();
  const got = { total: L.length, early: L.filter((c) => c.deck === "early").length, late: L.filter((c) => c.deck === "late").length, cp2: L.filter((c) => c.cp === 2).length, cp3: L.filter((c) => c.cp === 3).length };
  for (const k of Object.keys(SPEC.locals)) { const r = eq(got[k], SPEC.locals[k], "地方牌 " + k); if (r !== true) return r; }
  return ok(true, JSON.stringify(got));
});
check("牌庫 前期 60、後期 36", () => {
  const st = E.createGame(2);
  const early = st.decks.early.length + st.hands.flat().length; // turn 1 dealt 21 from the early deck
  const r = eq(early, SPEC.decks.early, "前期牌庫"); if (r !== true) return r;
  return eq(st.decks.late.length, SPEC.decks.late, "後期牌庫");
});
check("休息方塊 2/1/0、候選人牌 5/0、5/0、3/2、手牌 7/4/1/2", () => {
  const r = eq(JSON.stringify(C.REST_CUBES), JSON.stringify(SPEC.restCubes), "休息方塊"); if (r !== true) return r;
  for (const s of Object.keys(SPEC.candidate)) { const r2 = eq([C.CANDIDATE_CARDS[s].cp, C.CANDIDATE_CARDS[s].rest].join(), SPEC.candidate[s].join(), "候選人牌 " + s); if (r2 !== true) return r2; }
  return eq(JSON.stringify(C.HAND), JSON.stringify(SPEC.hand), "手牌");
});

// ---------------------------------------------------------------- group 1
section("1 產品的動詞");
check("一局能被設定：第 1 回合、三席、各 7 張手牌、154 塊都在盤上", () => {
  const st = E.createGame(7);
  const r = eq(st.turn, 1, "回合"); if (r !== true) return r;
  const r2 = eq(st.hands.map((h) => h.length).join(), "7,7,7", "手牌數"); if (r2 !== true) return r2;
  const blocks = st.counties.reduce((s, c) => s + c.blocks.length, 0);
  const r3 = eq(blocks, 154, "盤上塊數"); if (r3 !== true) return r3;
  return ok(true, `回合 ${st.turn}，主動權 ${st.initiative}，手牌 7/7/7`);
});
check("第 1 階段每一席都有合法動作（輪到時）", () => {
  const st = E.createGame(11);
  const counts = [];
  for (let seat = 0; seat < 3; seat++) {
    const probe = E.clone(st); probe.actor = seat; // ask each seat as if it were up
    const moves = E.legalMoves(probe, seat);
    const r = nonEmpty(moves.length, `seat ${seat} 的合法動作`); if (r !== true) return r;
    counts.push(moves.length);
  }
  return ok(true, `合法動作數 ${counts.join("/")}（含候選人牌）`);
});
check("同一個種子兩次設定完全相同（可重放）", () => {
  const a = JSON.stringify(E.createGame(99)), b = JSON.stringify(E.createGame(99));
  return eq(a === b, true, "同種子相同");
});
check("view 藏別人的手牌，露自己的", () => {
  const st = E.createGame(5);
  const v = E.view(st, 1);
  if (!Array.isArray(v.hands[1]) || v.hands[1].length !== 7) return "自己的手牌沒露出";
  if (typeof v.hands[0] !== "number" || typeof v.hands[2] !== "number") return "別人的手牌露出了: " + JSON.stringify([v.hands[0], v.hands[2]]);
  if ("rng" in v || "endorseDeck" in v) return "rng 或背書牌庫露出了";
  return ok(true, "自己 7 張，別人只有數量");
});

// ---------------------------------------------------------------- group 2
section("2 規則書要求、引擎還沒有的");
check("出牌結算：當事件 / 當 CP、觸發、封鎖", () => "TODO: engine.apply（規則書 §六）");
check("行動：競選（填／跨營填／搶）、廣告、議題", () => "TODO: §七，含宋跨區固定 1 CP");
check("支持檢定與袋子（抽空重裝 12）", () => "TODO: §八");
check("樁腳主、區域媒體優勢免檢定", () => "TODO: §3.4、§8.1");
check("動能結算：衰減（陳進位）、議題交換、槽位獎勵、背書、議題衰減", () => "TODO: §5.3");
check("留牌：前期留 1、後期留 2", () => "TODO: §5.4");
check("60 張事件牌的效果", () => "TODO: §14.3，含本回合旗標與必觸發");
check("政見發表會（第 6 回合）", () => "TODO: §九");
check("兩段棄保結算（差距 ≥ 2；一半／全部）", () => "TODO: §十一");
check("投票日七步", () => "TODO: §十二");
check("合法動作的 fuzz：隨機走完 9 回合不崩、不卡", () => "TODO: M1 收尾");

// ---------------------------------------------------------------- report
test("acceptance", () => {
  const s = summary();
  for (const p of R.pass) console.log(`  ✓ ${p.label}${p.msg ? " — " + p.msg : ""}`);
  for (const t of s.todos) console.log(`  … ${t.label} — ${t.msg}`);
  for (const f of s.failures) console.log(`  ✗ ${f.label} — ${f.msg}`);
  console.log(`  通過 ${s.pass} / 失敗 ${s.fail} / 尚未實作 ${s.todo}`);
  assert.equal(s.fail, 0, s.failures.map((f) => `${f.label}: ${f.msg}`).join("\n"));
});
