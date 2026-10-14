// The acceptance harness. Orchestrator's file: a peer may run it and falsify
// against it, and does not edit it (TEAM.md).
//
//   node --test tests/acceptance.test.js      (or `npm test`)
//
// Three verdicts per check (tests/harness.js): 通過 / 失敗 / 尚未實作.
//
// Group 0 compares the product's data with the rulebook's numbers. The numbers
// in SPEC were copied BY HAND from the owner's vault, `Projects/president_2000/
// president_2000 - rulebook.md` (v0.3, 2026-10-14, vault e487d8e), sections 二–四, 六, 十三,
// 十四, and the region adjacency from the design simulator `sim/sim.js`
// (REG_ADJ; the rulebook has no table). They are not read from the product:
// changing a number in public/shared/ to make a later check pass turns this
// group red.
// Group 1 is the product's verb, with a loose threshold: a game can be set up,
// and every seat has something legal to do at the first action phase.
// Group 2 is the rulebook's turn as checks, driven through the engine contract
// written in issue #1 (tests/driver.js holds the helpers). Each check arranges
// a state, plays it, and compares with a value worked out by hand from the
// rulebook section in its label. They report 尚未實作 while engine.apply still
// refuses (Phase 0). The ones still marked TODO are later issues.
import test from "node:test";
import assert from "node:assert/strict";
import { R, section, check, eq, ok, nonEmpty, summary } from "./harness.js";
import * as B from "../public/shared/board.js";
import * as C from "../public/shared/cards.js";
import * as E from "../public/shared/engine.js";
import * as D from "./driver.js";


// ---------------------------------------------------------------- SPEC
// county: [blocks, 陳, 宋, 連, 綠游離 empty, 藍游離 empty, 無色]  (rulebook §四)
const SPEC_COUNTIES = {
  "台北市": [19, 3, 5, 3, 3, 2, 3], "台北縣": [24, 3, 4, 4, 4, 5, 4], "基隆市": [3, 1, 1, 0, 0, 0, 1],
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
  start: [23, 35, 22], floating: [15, 28], grey: 31,
  regions: ["北北基", "桃竹苗", "中彰投", "雲嘉南", "高屏", "宜花東", "離島"],
  regionCounties: { "北北基": 3, "桃竹苗": 4, "中彰投": 4, "雲嘉南": 5, "高屏": 3, "宜花東": 3, "離島": 2 },
  startCounty: { chen: "台南縣", soong: "南投縣", lien: "台北市" },
  startMomentum: [3, 2, 1], bagSeed: 12, bossThreshold: 4, turns: 9,
  startMedia: { lien: ["北北基", "中彰投"] },
  issues: 3,
  events: { total: 70, chen: 20, soong: 20, lien: 21, ext: 9, early: 50, late: 20 },
  locals: { total: 41, early: 25, late: 16, cp2: 23, cp3: 18 },
  decks: { early: 75, late: 36 },
  restCubes: { 2: 2, 3: 1, 4: 0 },
  candidate: { chen: [5, 0], soong: [5, 0], lien: [3, 2] },
  hand: { dealEarly: 5, dealLate: 6, play: 4, saveEarly: 1, saveLate: 2 },
  must: ["yang_exposes"],
  cpRange: [2, 4],
  // §14.2「事件牌上印的縣市也依票塊數加權；兩者合計每個縣市至少出現 1 次」. Orchestrator ruling (#7):
  // each deck apportioned by vote blocks on its own (largest remainder); 澎湖 and 金馬, which no
  // card names otherwise, take one early event each from 台南縣 and 台南市 (the two smallest
  // remainders that were rounded up).
  eventCounties: {
    early: { "台北縣": 8, "台北市": 6, "桃園縣": 3, "台中縣": 3, "高雄市": 3, "彰化縣": 3, "高雄縣": 3, "台南縣": 2, "台中市": 2, "屏東縣": 2,
      "雲林縣": 2, "台南市": 1, "苗栗縣": 1, "南投縣": 1, "嘉義縣": 1, "基隆市": 1, "新竹縣": 1, "宜蘭縣": 1, "花蓮縣": 1, "新竹市": 1,
      "嘉義市": 1, "台東縣": 1, "澎湖縣": 1, "金馬": 1 },
    late: { "台北縣": 3, "台北市": 3, "桃園縣": 2, "台中縣": 1, "高雄市": 1, "彰化縣": 1, "高雄縣": 1, "台南縣": 1, "台中市": 1, "屏東縣": 1,
      "雲林縣": 1, "台南市": 1, "苗栗縣": 1, "南投縣": 1, "嘉義縣": 1 },
  },
  // §14.3 row by row: id: "owner deck cp icon". Transcribed by script from the rulebook's tables
  // (vault e487d8e); the card name was used only to attach the product's id to each row.
  eventTable: {
    taiwan_son: "chen early 3 clean", new_middle: "chen early 3 cross", alternation: "chen early 2 clean",
    sweep_black_gold: "chen early 3 clean", future_resolution: "chen early 2 cross", lu_running_mate: "chen early 2 econ",
    lo_propaganda: "chen early 2 clean", hsieh_kaohsiung: "chen early 3 econ", dpp_counties: "chen early 4 econ",
    three_three_three: "chen early 3 econ", no_nuke4: "chen early 2 econ", lin_chairman: "chen early 2 clean",
    lee_yuan_tseh: "chen late 4 clean", advisory_group: "chen late 3 econ", million_rally: "chen late 4 cross",
    dump_lien_save_chen: "chen late 3 clean", hsu_wen_long: "chen late 2 econ", chang_yung_fa: "chen late 2 econ",
    south_rally: "chen early 3 econ", chang_chiu: "chen early 2 clean", diligent: "soong early 4 econ",
    walk_everywhere: "soong early 3 econ", chang_running_mate: "soong early 3 cross", poll_lead: "soong early 2 clean",
    million_signatures: "soong early 2 clean", hakka_vote: "soong early 2 econ", east_coast: "soong early 2 econ",
    veterans_village: "soong early 3 cross", quake_bond: "soong early 3 econ", li_ao_endorses: "soong early 2 cross",
    provincial_staff: "soong early 3 econ", lee_authorized: "soong early 2 clean", dump_lien_save_soong: "soong late 3 cross",
    new_party_backs_soong: "soong late 3 cross", chang_doctors: "soong late 2 econ", soong_friends: "soong late 2 econ",
    kneel_for_votes: "soong late 3 clean", provincial_build: "soong early 3 econ", military_civil: "soong early 2 econ",
    hsu_hsin_liang: "soong early 2 cross", expel_soong: "lien early 3 clean", yang_exposes: "lien early 4 clean",
    shifting_story: "lien early 3 clean", party_machine: "lien early 4 econ", party_assets_ads: "lien early 3 econ",
    lien_siew: "lien early 3 econ", hand_in_hand: "lien early 2 econ", lee_campaigns: "lien early 3 cross",
    lee_attacks_soong: "lien early 3 clean", stability: "lien early 3 cross", local_factions: "lien early 2 econ",
    farmers_association: "lien early 2 econ", ma_campaigns: "lien early 2 clean", party_unity: "lien early 3 cross",
    massive_ads: "lien late 4 econ", ma_leaks_polls: "lien late 3 clean", lee_alarm: "lien late 3 cross",
    party_congress: "lien late 2 econ", members_return: "lien early 3 econ", econ_cabinet: "lien early 2 econ",
    kmt_anniversary: "lien early 2 cross", poll_published: "ext early 2 clean", strait_tension: "ext early 3 cross",
    white_paper: "ext late 3 cross", zhu_rongji: "ext late 4 cross", us_congress: "ext late 2 cross",
    stock_crash: "ext late 2 econ", lee_secret_help: "ext late 3 clean", tvbs_poll: "ext early 2 clean",
    pla_drill_rumor: "ext early 3 cross",
  },
  // Region adjacency for movement: the rulebook (§7.1) has no table; copied from
  // the design simulator vault sim/sim.js REG_ADJ (the owner's file).
  regionEdges: [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [4, 5], [3, 6], [4, 6]],
  // §14.2's per-county table: [前期 2 CP, 前期 3 CP, 後期 2 CP, 後期 3 CP]. Totals 15/10/8/8.
  localsTable: {
    "台北縣": [5, 1, 0, 0], "台北市": [3, 3, 0, 0], "桃園縣": [3, 1, 0, 0], "台中縣": [0, 3, 0, 0], "高雄市": [2, 1, 0, 0],
    "高雄縣": [1, 0, 1, 1], "台南市": [0, 1, 1, 0], "嘉義市": [1, 0, 0, 0], "彰化縣": [0, 0, 2, 0], "台南縣": [0, 0, 0, 2],
    "屏東縣": [0, 0, 1, 0], "雲林縣": [0, 0, 1, 0], "苗栗縣": [0, 0, 1, 0], "南投縣": [0, 0, 1, 0], "台中市": [0, 0, 0, 1],
    "嘉義縣": [0, 0, 0, 1], "新竹縣": [0, 0, 0, 1], "宜蘭縣": [0, 0, 0, 1], "花蓮縣": [0, 0, 0, 1],
  },
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
check("初始方塊 23/35/22 與游離 15/28", () => {
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
check("事件牌 70：陳 20、宋 20、連 21、外力 9；前期 50、後期 20", () => {
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
check("事件牌逐張：歸屬、前後期、CP、議題照 §14.3", () => {
  const want = SPEC.eventTable, byId = Object.fromEntries(C.EVENTS.map((e) => [e.id, e]));
  const r0 = eq(Object.keys(want).length, SPEC.events.total, "表的列數（抄寫檢查）"); if (r0 !== true) return r0;
  const bad = [];
  for (const [id, w] of Object.entries(want)) {
    const e = byId[id];
    if (!e) { bad.push(`${id} 不在 cards.js`); continue; }
    const got = `${e.owner} ${e.deck} ${e.cp} ${e.icon}`;
    if (got !== w) bad.push(`${id}（${e.name}）期望 ${w} 實際 ${got}`);
  }
  const extra = C.EVENTS.filter((e) => !(e.id in want)).map((e) => e.id);
  if (extra.length) bad.push("規則書沒有的事件：" + extra.join(","));
  return bad.length ? bad.join("；") : ok(true, `${Object.keys(want).length} 張逐張相符`);
});
check("事件牌印的縣市：前期 50、後期 20 各自照票塊數分配；地方牌加事件每縣市至少 1 次；引擎用牌上印的縣市（§14.2；#7）", () => {
  if (!C.EVENTS.some((e) => e.county)) return "TODO: 事件牌還沒有印縣市（#7）";
  const names = new Set(B.COUNTIES.map((c) => c[0]));
  const bad = C.EVENTS.filter((e) => !names.has(e.county)).map((e) => e.id);
  if (bad.length) return "沒有縣市或縣市不在盤上：" + bad.join(",");
  for (const deck of ["early", "late"]) {
    const got = {};
    for (const e of C.EVENTS.filter((x) => x.deck === deck)) got[e.county] = (got[e.county] || 0) + 1;
    const want = SPEC.eventCounties[deck], keys = [...new Set([...Object.keys(got), ...Object.keys(want)])];
    const diff = keys.filter((k) => (got[k] || 0) !== (want[k] || 0)).map((k) => `${k} 期望 ${want[k] || 0} 實際 ${got[k] || 0}`);
    if (diff.length) return `${deck === "early" ? "前期" : "後期"}事件的縣市：${diff.join("；")}`;
  }
  const seen = new Set([...C.EVENTS.map((e) => e.county), ...C.localCards().map((c) => c.county)]);
  const none = [...names].filter((n) => !seen.has(n));
  if (none.length) return "沒有任何一張牌印的縣市：" + none.join(",");
  const st = E.createGame(1);
  const moved = C.EVENTS.filter((e) => st.cards[e.id].county !== e.county).map((e) => e.id);
  if (moved.length) return "引擎沒有用牌上印的縣市：" + moved.slice(0, 5).join(",");
  return ok(true, "70 張照表；24 縣市都有牌；引擎用印的縣市");
});
check("必觸發牌只有楊吉雄爆料；條件牌指向存在的牌", () => {
  const must = C.EVENTS.filter((e) => e.must).map((e) => e.id);
  const r = eq(must.join(), SPEC.must.join(), "必觸發"); if (r !== true) return r;
  const ids = new Set(C.EVENTS.map((e) => e.id));
  const badCond = C.EVENTS.filter((e) => e.cond && !ids.has(e.cond)).map((e) => e.id);
  return badCond.length ? "條件指向不存在的牌: " + badCond.join(",") : ok(true, "授意說 → 爆料；說法反覆 → 授意說");
});
check("地方牌 41：前期 25、後期 16；2 CP 23、3 CP 18", () => {
  const L = C.localCards();
  const got = { total: L.length, early: L.filter((c) => c.deck === "early").length, late: L.filter((c) => c.deck === "late").length, cp2: L.filter((c) => c.cp === 2).length, cp3: L.filter((c) => c.cp === 3).length };
  for (const k of Object.keys(SPEC.locals)) { const r = eq(got[k], SPEC.locals[k], "地方牌 " + k); if (r !== true) return r; }
  return ok(true, JSON.stringify(got));
});
check("牌庫 前期 75、後期 36", () => {
  const st = E.createGame(2);
  const early = st.decks.early.length + st.hands.flat().length; // turn 1 dealt 15 from the early deck
  const r = eq(early, SPEC.decks.early, "前期牌庫"); if (r !== true) return r;
  return eq(st.decks.late.length, SPEC.decks.late, "後期牌庫");
});
check("休息方塊 2/1/0、候選人牌 5/0、5/0、3/2、手牌 前期發 5、後期發 6、出 4、留 1/2", () => {
  const r = eq(JSON.stringify(C.REST_CUBES), JSON.stringify(SPEC.restCubes), "休息方塊"); if (r !== true) return r;
  for (const s of Object.keys(SPEC.candidate)) { const r2 = eq([C.CANDIDATE_CARDS[s].cp, C.CANDIDATE_CARDS[s].rest].join(), SPEC.candidate[s].join(), "候選人牌 " + s); if (r2 !== true) return r2; }
  const keys = (o) => Object.keys(o).sort().map((k) => k + ":" + o[k]).join(",");
  return eq(keys(C.HAND), keys(SPEC.hand), "手牌");
});

check("區域相鄰：規則書沒有表，抄自設計模擬器 REG_ADJ", () => {
  const norm = (es) => es.map(([a, b]) => [Math.min(a, b), Math.max(a, b)].join("-")).sort().join(",");
  const r = eq(norm(B.REGION_EDGES), norm(SPEC.regionEdges), "區域邊"); if (r !== true) return r;
  return ok(true, `${SPEC.regionEdges.length} 條邊相符`);
});
check("地方牌 41 張：逐縣市的前期／後期 × 2 CP／3 CP（§14.2 的表）", () => {
  const got = {};
  for (const c of C.localCards()) {
    const r = (got[c.county] ||= [0, 0, 0, 0]);
    r[(c.deck === "early" ? 0 : 2) + (c.cp === 3 ? 1 : 0)]++;
  }
  const want = SPEC.localsTable;
  const sum = [0, 1, 2, 3].map((k) => Object.values(want).reduce((t, r) => t + r[k], 0)).join("/");
  const r0 = eq(sum, "15/10/8/8", "表的合計（抄寫檢查）"); if (r0 !== true) return r0;
  const keys = [...new Set([...Object.keys(got), ...Object.keys(want)])];
  const bad = keys.filter((k) => (got[k] || [0, 0, 0, 0]).join() !== (want[k] || [0, 0, 0, 0]).join())
    .map((k) => `${k} 期望 ${(want[k] || [0, 0, 0, 0]).join("/")} 實際 ${(got[k] || [0, 0, 0, 0]).join("/")}`);
  return bad.length ? "（前2/前3/後2/後3）" + bad.join("；") : ok(true, `${keys.length} 縣市逐欄相符，合計 15/10/8/8`);
});

// ---------------------------------------------------------------- group 1
section("1 產品的動詞");
check("一局能被設定：第 1 回合、三席、各 5 張手牌、154 塊都在盤上", () => {
  const st = E.createGame(7);
  const r = eq(st.turn, 1, "回合"); if (r !== true) return r;
  const r2 = eq(st.hands.map((h) => h.length).join(), "5,5,5", "手牌數"); if (r2 !== true) return r2;
  const blocks = st.counties.reduce((s, c) => s + c.blocks.length, 0);
  const r3 = eq(blocks, 154, "盤上塊數"); if (r3 !== true) return r3;
  return ok(true, `回合 ${st.turn}，主動權 ${st.initiative}，手牌 5/5/5`);
});
check("第 1 階段每一席都有合法動作（輪到時）", () => {
  let st = E.createGame(11);
  if (st.phase === "order") { // M1: the initiative holder picks a position first
    const om = E.legalMoves(st, st.initiative);
    const r = nonEmpty(om.length, "主動權持有者選位置"); if (r !== true) return r;
    st = E.apply(st, st.initiative, om[0]);
  }
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
  if (!Array.isArray(v.hands[1]) || v.hands[1].length !== 5) return "自己的手牌應該是 5 張的陣列，實際 " + JSON.stringify(v.hands[1]);
  if (typeof v.hands[0] !== "number" || typeof v.hands[2] !== "number") return "別人的手牌露出了: " + JSON.stringify([v.hands[0], v.hands[2]]);
  if ("rng" in v || "endorseDeck" in v) return "rng 或背書牌庫露出了";
  // The seed replays every shuffle: with it, a client can rebuild every deck and hand.
  if ("seed" in v) return "seed 露出了：拿它重放洗牌就看得到所有牌庫與手牌";
  return ok(true, "自己 5 張，別人只有數量；rng、seed、背書牌庫都不在");
});

// ---------------------------------------------------------------- group 2
section("2 規則書要求");
const READY = D.ready();
// The debate (#6) is reached by quiet play; whether it has decisions yet decides some checks below.
// The debate is reached by quiet play of turns 1–5 (seed 4), then arranged at its start: piles
// (savedDebate), the issue order (st.issues = the original track), the initiative (tie priority),
// and a board cleared except for the counties the scenario names, so every 棄保 flow can be worked
// out by hand from §九 and §十一. Placements by debate winners go to counties that end full, so
// they cause no flow of their own.
const toDebate = (seed = 4) => {
  let st = E.createGame(seed);
  st = D.act(st, st.initiative, { type: "order", pos: 0 });
  return D.playUntil(st, (s) => s.phase === "debate" || s.turn > 6, null, D.quiet);
};
const debateReady = () => {
  const st = toDebate();
  return st.phase === "debate" && E.mustAct(st).length > 0 && E.legalMoves(st, E.mustAct(st)[0]).some((m) => m.type === "reveal");
};
const DEBATE_READY = READY && (() => { try { return debateReady(); } catch { return false; } })();
const c2 = (name, fn) => check(name, () => (READY ? fn() : "TODO: engine.apply 還不能結算動作（#1）"));
const { CHEN, SOONG, LIEN, ci, ri } = D;
const zeros7 = () => Array.from({ length: 7 }, () => [0, 0, 0]);
const MUST = new Set(C.EVENTS.filter((e) => e.must).map((e) => e.id));
const DECK_OF = Object.fromEntries(C.EVENTS.map((e) => [e.id, e.deck]).concat(C.localCards().map((c) => [c.id, c.deck])));
const modesOf = (st, seat, id) => [...new Set(E.legalMoves(st, seat).filter((m) => m.type === "play" && m.card === id).map((m) => m.mode))].sort().join();
const cpDone = (st, seat, card) => {
  st = D.act(st, seat, { type: "play", card, mode: "cp" });
  st = D.act(st, seat, { type: "action", kind: "campaign" });
  return D.act(st, seat, { type: "done" });
};
// One campaign operation by 陳 (candidate card, 5 CP) from a fresh turn-1
// state: arrange(st), then optionally move, then `op`. dChecks counts the
// support checks the operation made.
function chenOp(arrange, to, op) {
  let st = D.firstActor(CHEN); arrange(st);
  const c0 = D.checks(st);
  st = D.act(st, CHEN, { type: "candidate" });
  st = D.act(st, CHEN, { type: "action", kind: "campaign" });
  if (to) st = D.act(st, CHEN, { type: "move", to: ci(to) });
  st = D.act(st, CHEN, op);
  return { st, dChecks: D.checks(st) - c0 };
}
const opStr = (x, county, seat) => `${D.cubes(x.st, ci(county), seat)} ${x.st.bag.join()} ${x.dChecks}`;
// The twelfth play of turn 1, where that seat still holds its candidate card,
// so the last play can be made without touching momentum, media or issues.
function atLastPlay() {
  for (let seed = 1; seed < 80; seed++) {
    let st = E.createGame(seed);
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
  throw new Error("80 個種子都找不到第 12 次出牌時還能出候選人牌的局");
}
const lastPlayQuiet = (st, seat) => {
  st = D.act(st, seat, { type: "candidate" });
  st = D.act(st, seat, { type: "action", kind: "campaign" });
  return D.act(st, seat, { type: "done" });
};

// ---- 主動權與順序（§5.1、§5.2）
c2("主動權 · 持有者選第 1/2/3 位，其餘依座位 陳→宋→連 循環填入（§5.1）", () => {
  const st = E.createGame(3);
  let r = eq(st.phase, "order", "開局的 phase"); if (r !== true) return r;
  const init = st.initiative;
  r = eq(JSON.stringify(E.mustAct(st)), JSON.stringify([init]), "主動權階段要動的席"); if (r !== true) return r;
  for (const s of [0, 1, 2]) if (s !== init && E.legalMoves(st, s).length) return `seat ${s} 不是持有者卻有合法動作`;
  const pos = E.legalMoves(st, init).map((m) => (m.type === "order" ? m.pos : "x")).sort().join();
  r = eq(pos, "0,1,2", "持有者的選項"); if (r !== true) return r;
  for (let k = 0; k < 3; k++) {
    const s = D.act(st, init, { type: "order", pos: k });
    const want = [0, 1, 2].map((i) => (init - k + i + 3) % 3);
    r = eq(s.order.join(), want.join(), `持有者 ${init} 選第 ${k + 1} 位的順序`); if (r !== true) return r;
    r = eq(`${s.phase}:${s.actor}`, `action:${want[0]}`, "第一個出牌的"); if (r !== true) return r;
  }
  return ok(true, `持有者 ${init}；選 1/2/3 位的順序都對`);
});
c2("主動權 · 檢定一顆一顆抽、不放回，某色第二顆出現就決定，抽完全部放回（§5.1）", () => {
  const wins = [0, 0, 0], bad = [];
  for (let seed = 1; seed <= 40; seed++) {
    let st = E.createGame(seed);
    st = D.act(st, st.initiative, { type: "order", pos: 0 });
    st = D.playUntil(st, (s) => s.phase === "save", null, D.quiet);
    st.bag = [1, 0, 2]; st.rest = [0, 0, 0];
    for (const s of [0, 1, 2]) st = D.act(st, s, { type: "save" });
    if (st.turn !== 2 || st.phase !== "order") return `seed ${seed}：留牌之後應該是第 2 回合的主動權，實際第 ${st.turn} 回合 ${st.phase}`;
    wins[st.initiative]++;
    if (st.bag.join() !== "1,0,2") bad.push(`seed ${seed} 袋子 ${st.bag.join()}`);
  }
  if (bad.length) return "主動權檢定之後袋子不是原樣：" + bad.slice(0, 3).join("；");
  if (wins[0] || wins[1]) return `袋中 陳1 宋0 連2：陳拿到 ${wins[0]} 次、宋 ${wins[1]} 次。不放回時只有連能抽到兩顆，有放回才會這樣`;
  return ok(true, "40 局全部由連拿到（袋中 陳1 宋0 連2），抽完袋子原樣");
});
c2("行動階段 · 第一階段照持有者排的順序，之後每階段起手者輪轉一位（§5.2）", () => {
  let st = E.createGame(5);
  st = D.act(st, st.initiative, { type: "order", pos: 1 });
  const order = st.order.slice(), seq = [];
  for (let n = 0; n < 3000 && st.phase === "action"; n++) {
    const seat = E.mustAct(st)[0], m = D.quiet(st, seat, E.legalMoves(st, seat));
    if (m.type === "play" || m.type === "candidate") seq.push(seat);
    st = E.apply(st, seat, m);
  }
  const rot = (k) => order.slice(k).concat(order.slice(0, k));
  const want = [...rot(0), ...rot(1), ...rot(2), ...rot(0)];
  const r = eq(seq.join(), want.join(), "12 次出牌的席"); if (r !== true) return r;
  return ok(true, `順序 ${order.join("")}：${seq.join("")}`);
});
c2("牌庫 · 前期發 5、後期發 6，整局不洗牌、每張牌只在一個地方；第 5 回合留牌後進政見發表會；第 7–8 回合用後期牌庫（§5.1、§10、§14.1）", () => {
  // 75 = 5 回合 × 3 人 × 5 張、36 = 2 回合 × 3 人 × 6 張：不洗牌時，第 t 回合發完前期牌庫正好剩 75 − 15t。
  let st = E.createGame(4), turns = 0;
  for (let n = 0; n < 6000 && st.phase !== "debate"; n++) {
    if (st.phase === "order" && st.turn !== turns) {
      turns = st.turn;
      let r = eq(st.hands.map((h) => h.length).join(), "5,5,5", `第 ${st.turn} 回合手牌`); if (r !== true) return r;
      r = eq(st.decks.early.length, 75 - 15 * st.turn, `第 ${st.turn} 回合發完的前期牌庫`); if (r !== true) return r;
      const c = D.conservation(st); if (c !== true) return `第 ${st.turn} 回合：${c}`;
    }
    const seat = E.mustAct(st)[0];
    if (seat === undefined) return `第 ${st.turn} 回合 ${st.phase} 沒有人要動`;
    st = E.apply(st, seat, D.quiet(st, seat, E.legalMoves(st, seat)));
  }
  let r = eq(`${st.phase} ${turns} ${st.decks.early.length}`, "debate 5 0", "走完第 5 回合（前期牌庫剛好發完）"); if (r !== true) return r;
  r = eq(E.mustAct(st).length, DEBATE_READY ? 3 : 0, DEBATE_READY ? "政見發表會開始時要翻牌的人數" : "政見發表會（還沒做）時要動的人數"); if (r !== true) return r;
  let late = E.createGame(4, { startTurn: 7 });
  r = eq(late.turn, 7, "startTurn 7 的回合"); if (r !== true) return r;
  const notLate = late.hands.flat().filter((id) => DECK_OF[id] !== "late");
  if (notLate.length) return "第 7 回合發到前期的牌：" + notLate.join(",");
  r = eq(`${late.hands.map((h) => h.length).join()} ${late.decks.late.length} ${late.decks.early.length}`, "6,6,6 18 75", "第 7 回合 手牌、後期牌庫、前期牌庫"); if (r !== true) return r;
  late = D.playUntil(late, (x) => x.turn === 8 && x.phase === "order", null, D.quiet);
  r = eq(`${late.hands.map((h) => h.length).join()} ${late.decks.late.length}`, "6,6,6 0", "第 8 回合 手牌、後期牌庫"); if (r !== true) return r;
  return ok(true, "第 1–5 回合每回合 5/5/5、前期牌庫 60→0 沒洗過；第 7、8 回合 6/6/6、後期 18→0");
});

// ---- 出牌（§六）
c2("出牌 · 外力牌與必觸發牌只能當事件出（效果之外照樣拿 CP），不能當純 CP、不能封鎖（§6.1）", () => {
  const ids = C.EVENTS.filter((e) => e.owner === "ext" || e.must).map((e) => e.id);
  const r = eq(ids.length, 10, "外力 9 + 必觸發 1"); if (r !== true) return r;
  const bad = [];
  for (const [id, seat] of ids.map((id) => [id, CHEN]).concat([["yang_exposes", LIEN]])) {
    const st = D.giveCard(D.firstActor(seat), seat, id);
    const modes = [...new Set(E.legalMoves(st, seat).filter((m) => m.type === "play" && m.card === id).map((m) => m.mode + (m.block ? "+封鎖" : "")))].sort().join();
    if (modes !== "event") bad.push(`${id}（seat ${seat}）：${modes || "不能出"}`);
  }
  return bad.length ? bad.join("；") : ok(true, "10 張只有 event（含連自己打爆料）");
});
c2("出牌 · 對手的事件不能當事件出，只能當 CP（§6.1）", () => {
  const bad = []; let n = 0;
  for (const e of C.EVENTS.filter((e) => (e.owner === "soong" || e.owner === "lien") && !e.must)) {
    const st = D.giveCard(D.firstActor(CHEN), CHEN, e.id); n++;
    const modes = modesOf(st, CHEN, e.id);
    if (modes !== "cp") bad.push(`${e.id}：${modes || "不能出"}`);
  }
  return bad.length ? "陳手上的對手牌：" + bad.join("；") : ok(true, `陳手上的 ${n} 張宋連事件都只有 cp`);
});
c2("出牌 · 自己的事件：效果還沒做的只給當 CP，做了的兩種都給（#1 的裁決：不假裝）", () => {
  if (typeof E.effectImplemented !== "function") return "engine 沒有 export effectImplemented(id)";
  const bad = []; let todo = 0, done = 0;
  for (const e of C.EVENTS.filter((e) => e.owner === "chen")) {
    const st = D.giveCard(D.firstActor(CHEN), CHEN, e.id);
    const impl = E.effectImplemented(e.id), want = impl ? "cp,event" : "cp";
    impl ? done++ : todo++;
    const modes = modesOf(st, CHEN, e.id);
    if (modes !== want) bad.push(`${e.id}：期望 ${want}，實際 ${modes || "不能出"}`);
  }
  return bad.length ? bad.join("；") : ok(true, `陳的 18 張：${done} 張兩種都給、${todo} 張只給 cp`);
});
c2("出牌 · 必觸發（楊吉雄爆料）拿到的那一回合要打出、哪一階段自選，最後一個階段只能打它（§6.1）", () => {
  let st = D.giveCard(D.firstActor(CHEN), CHEN, "yang_exposes");
  const first = E.legalMoves(st, CHEN);
  if (!first.some((m) => m.type === "play" && m.card !== "yang_exposes")) return "第一個階段只給打爆料（規則書：哪一個行動階段自選）";
  if (!first.some((m) => m.type === "candidate")) return "第一個階段不給出候選人牌";
  let plays = 0, fourth = null;
  for (let n = 0; n < 3000 && st.phase === "action"; n++) {
    const seat = E.mustAct(st)[0], ms = E.legalMoves(st, seat);
    let m;
    if (seat === CHEN && D.isPlayDecision(ms)) {
      plays++;
      if (plays === 4) { fourth = ms; break; }
      m = ms.find((x) => x.type === "play" && x.card !== "yang_exposes" && x.mode === "cp" && !x.block)
        || ms.find((x) => x.type === "play" && x.card !== "yang_exposes");
      if (!m) return `陳的第 ${plays} 次出牌就只剩爆料能打`;
    } else m = D.quiet(st, seat, ms);
    st = E.apply(st, seat, m);
  }
  if (!fourth) return "沒有走到陳的第 4 次出牌";
  const other = fourth.filter((x) => !(x.type === "play" && x.card === "yang_exposes"));
  if (other.length) return "陳的第 4 次出牌還有別的選擇：" + JSON.stringify(other.slice(0, 3));
  return ok(true, `前三階段可以打別的；第四階段 ${fourth.length} 個選項全是爆料`);
});
c2("出牌 · 候選人牌一局一次：陳宋 5 CP、休息 0，連 3 CP、休息 2（§6.3、§十三）", () => {
  const out = [];
  for (const [seat, cp, rest] of [[CHEN, 5, 0], [SOONG, 5, 0], [LIEN, 3, 2]]) {
    let st = D.firstActor(seat); st.bag = [0, 0, 0]; st.bag[seat] = 40;
    const rest0 = st.rest[seat], media0 = st.media[3][seat];
    st = D.act(st, seat, { type: "candidate" });
    st = D.act(st, seat, { type: "action", kind: "ads" });
    let n = 0;
    for (let k = 0; k < 20; k++) {
      if (D.has(st, seat, { type: "media", region: 3 })) { st = D.act(st, seat, { type: "media", region: 3 }); continue; }
      if (D.has(st, seat, { type: "ad" })) { st = D.act(st, seat, { type: "ad" }); n++; continue; }
      break;
    }
    let r = eq(n, cp, `seat ${seat} 候選人牌能打的廣告次數`); if (r !== true) return r;
    r = eq(st.rest[seat] - rest0, rest, `seat ${seat} 候選人牌的休息方塊`); if (r !== true) return r;
    r = eq(st.media[3][seat] - media0, cp, `seat ${seat} 雲嘉南媒體增加`); if (r !== true) return r;
    r = eq(st.candidateUsed[seat], true, `seat ${seat} candidateUsed`); if (r !== true) return r;
    const later = D.playUntil(st, (s) => E.mustAct(s)[0] === seat && D.isPlayDecision(E.legalMoves(s, seat)), null, D.quiet);
    if (D.has(later, seat, { type: "candidate" })) return `seat ${seat} 出過候選人牌，下一次出牌還能出`;
    out.push(`${cp} CP／休息 ${rest}`);
  }
  return ok(true, "陳 宋 連 = " + out.join("、"));
});
c2("出牌 · 休息方塊 2/1/0、連每張 +1；出牌時進休息區，不進袋（§6.4）", () => {
  const local = (cp) => C.localCards().find((c) => c.cp === cp).id;
  const cases = [[CHEN, "alternation", 2, 2], [CHEN, "taiwan_son", 3, 1], [CHEN, "dpp_counties", 4, 0], [LIEN, local(2), 2, 3], [LIEN, local(3), 3, 2], [LIEN, "party_machine", 4, 1]];
  for (const [seat, id, cp, want] of cases) {
    let st = D.giveCard(D.firstActor(seat), seat, id);
    const rest0 = st.rest[seat], bag0 = st.bag.join();
    st = cpDone(st, seat, id);
    let r = eq(st.rest[seat] - rest0, want, `${id}（${cp} CP，seat ${seat}）的休息方塊`); if (r !== true) return r;
    r = eq(st.bag.join(), bag0, `${id} 出完的袋子`); if (r !== true) return r;
  }
  let st = D.giveCard(D.firstActor(LIEN), LIEN, "stability");
  const rest0 = st.rest[LIEN];
  st = D.act(st, LIEN, { type: "play", card: "stability", mode: "event" });
  const r = eq(st.rest[LIEN] - rest0, 2, "連打安定牌（3 CP）當事件的休息方塊"); if (r !== true) return r;
  return ok(true, "陳 2/1/0、連 3/2/1，當事件也拿");
});
c2("出牌 · 觸發：對手的事件當 CP 出，行動結算之後歸屬者可花 1 動能觸發；觸發的移出遊戲、沒觸發的進棄牌堆（§6.2）", () => {
  let st = D.giveCard(D.firstActor(CHEN), CHEN, "stability"); st.mom = [0, 0, 1];
  const cross0 = D.issue(st, "cross").slice();
  st = D.act(st, CHEN, { type: "play", card: "stability", mode: "cp" });
  if (D.has(st, LIEN, { type: "trigger" })) return "陳還沒做行動就問連要不要觸發";
  st = D.act(st, CHEN, { type: "action", kind: "campaign" });
  st = D.act(st, CHEN, { type: "done" });
  let r = eq(JSON.stringify(E.mustAct(st)), "[2]", "陳的行動結算之後要動的席"); if (r !== true) return r;
  r = eq(E.legalMoves(st, LIEN).map((m) => m.type).sort().join(), "pass,trigger", "連的選項"); if (r !== true) return r;
  const where = (s) => (s.removed.includes("stability") ? "移出" : "") + (s.decks.discard.includes("stability") ? "棄牌" : "");
  const yes = D.act(st, LIEN, { type: "trigger" }), no = D.act(st, LIEN, { type: "pass" });
  r = eq(`${yes.mom[2]} ${D.issue(yes, "cross").join("/")} ${where(yes)}`, `0 ${cross0[0]}/${cross0[1]}/${cross0[2] + 2} 移出`, "觸發後 連動能、兩岸、牌在哪"); if (r !== true) return r;
  r = eq(`${no.mom[2]} ${D.issue(no, "cross").join("/")} ${where(no)}`, `1 ${cross0.join("/")} 棄牌`, "不觸發"); if (r !== true) return r;
  let z = D.giveCard(D.firstActor(CHEN), CHEN, "stability"); z.mom = [0, 0, 0];
  z = cpDone(z, CHEN, "stability");
  if (D.has(z, LIEN, { type: "trigger" })) return "連動能 0 還能觸發";
  return ok(true, "行動之後才問；觸發 −1 動能、效果歸連、移出；不觸發進棄牌；動能 0 不問");
});
c2("出牌 · 封鎖：出牌時先花 2 動能，歸屬者就不能觸發；不到 2 動能、或不是對手的牌，沒有封鎖（§6.2）", () => {
  let st = D.giveCard(D.firstActor(CHEN), CHEN, "stability"); st.mom = [2, 0, 1];
  st = D.act(st, CHEN, { type: "play", card: "stability", mode: "cp", block: true });
  let r = eq(st.mom.join(), "0,0,1", "封鎖後的動能"); if (r !== true) return r;
  st = D.act(st, CHEN, { type: "action", kind: "campaign" });
  st = D.act(st, CHEN, { type: "done" });
  if (D.has(st, LIEN, { type: "trigger" })) return "封鎖了，連還能觸發";
  if (!st.decks.discard.includes("stability")) return "封鎖的牌沒有進棄牌堆";
  const poor = D.giveCard(D.firstActor(CHEN), CHEN, "stability"); poor.mom = [1, 0, 1];
  if (D.has(poor, CHEN, { type: "play", card: "stability", mode: "cp", block: true })) return "陳只有 1 動能也能封鎖";
  const rich = D.firstActor(CHEN); rich.mom = [5, 5, 5];
  const blocks = E.legalMoves(rich, CHEN).filter((m) => m.block).map((m) => m.card);
  const wrong = blocks.filter((id) => { const c = C.EVENTS.find((e) => e.id === id); return !c || c.must || !["soong", "lien"].includes(c.owner); });
  if (wrong.length) return "不是對手的牌也能封鎖：" + wrong.join(",");
  return ok(true, `封鎖 −2 動能、不問觸發、進棄牌；陳手上能封鎖的 ${blocks.length} 張都是宋連的牌`);
});
c2("出牌 · 外力事件先結算效果，再用這張牌的 CP 做一個行動（#1 的裁決，照設計模擬器）", () => {
  let st = D.giveCard(D.firstActor(CHEN), CHEN, "poll_published");
  st.mom = [0, 0, 0]; st.issues[0].cubes = [0, 1, 0];
  const slot1 = st.issues[0].name;
  st = D.act(st, CHEN, { type: "play", card: "poll_published", mode: "event" });
  st = D.act(st, CHEN, { type: "action", kind: "issue" });
  st = D.act(st, CHEN, { type: "issue", issue: slot1, target: SOONG });
  const r = eq(st.mom.join(), "0,1,0", "動能（效果先算時宋是第一槽領先者；陳的行動之後才拿掉宋的方塊）"); if (r !== true) return r;
  return ok(true, "效果在 CP 行動之前");
});
c2("出牌 · 效果還沒做的事件不能被觸發（#1 的裁決：不假裝）", () => {
  if (typeof E.effectImplemented !== "function") return "engine 沒有 export effectImplemented(id)";
  const id = C.EVENTS.find((e) => e.owner === "chen" && !E.effectImplemented(e.id))?.id;
  if (!id) return ok(true, "陳的事件都做了，這條沒有東西可測");
  let st = D.giveCard(D.firstActor(LIEN), LIEN, id); st.mom = [3, 0, 0];
  st = cpDone(st, LIEN, id);
  return D.has(st, CHEN, { type: "trigger" }) ? `${id} 的效果還沒做，陳卻能觸發` : ok(true, `${id}：不問陳`);
});

// ---- 行動（§七）
c2("行動 · 競選移動每跨一區 1 CP、同區免費；宋跨區固定 1 CP（§7.1、§十三）", () => {
  const ops = (ms) => ms.find((m) => m.type === "fill" || m.type === "cross");
  const run = (seat, to) => {
    let st = D.firstActor(seat); st.bag = [0, 0, 0]; st.bag[seat] = 40;
    st = D.act(st, seat, { type: "candidate" });
    st = D.act(st, seat, { type: "action", kind: "campaign" });
    st = D.act(st, seat, { type: "move", to: ci(to) });
    return D.repeat(st, seat, ops).n;
  };
  // REG_ADJ: 雲嘉南→北北基 3 區；中彰投→高屏 2 區；北北基→高屏 2 區（經宜花東）。
  // 雲嘉南裡陳能做的剛好 5 個（空綠 1 + 空藍 4）。
  const cases = [[CHEN, "台北縣", 5 - 3, "陳 雲嘉南→北北基"], [CHEN, "台南市", 5, "陳 同區 台南縣→台南市"], [SOONG, "高雄市", 5 - 1, "宋 中彰投→高屏（兩區只付 1）"], [LIEN, "高雄市", 3 - 2, "連 北北基→高屏"]];
  const got = [];
  for (const [seat, to, want, what] of cases) {
    const n = run(seat, to);
    const r = eq(n, want, what + " 之後能做的操作數"); if (r !== true) return r;
    got.push(`${what} ${n}`);
  }
  return ok(true, got.join("；"));
});
c2("行動 · 競選只能在棋子所在區域，移動只在第一個操作之前；棋子停在最後一個操作的縣市（§7.1）", () => {
  let st = D.firstActor(CHEN); st.bag = [40, 0, 0];
  st = D.act(st, CHEN, { type: "candidate" });
  st = D.act(st, CHEN, { type: "action", kind: "campaign" });
  if (D.has(st, CHEN, { type: "fill", county: ci("台北縣") })) return "還沒移動就能在北北基填";
  st = D.act(st, CHEN, { type: "move", to: ci("台北縣") });
  if (!D.has(st, CHEN, { type: "fill", county: ci("台北市") })) return "移到台北縣之後不能在同區的台北市填";
  if (D.has(st, CHEN, { type: "fill", county: ci("桃園縣") })) return "移到北北基之後還能在桃園縣填";
  st = D.act(st, CHEN, { type: "fill", county: ci("台北縣") });
  if (E.legalMoves(st, CHEN).some((m) => m.type === "move")) return "第一個操作之後還能移動";
  st = D.act(st, CHEN, { type: "fill", county: ci("台北市") });
  let r = eq(st.pos[CHEN], ci("台北市"), "陳最後停在"); if (r !== true) return r;
  let s2 = D.firstActor(CHEN);
  s2 = D.act(s2, CHEN, { type: "candidate" });
  s2 = D.act(s2, CHEN, { type: "action", kind: "campaign" });
  s2 = D.act(s2, CHEN, { type: "move", to: ci("基隆市") });
  s2 = D.act(s2, CHEN, { type: "done" });
  r = eq(s2.pos[CHEN], ci("基隆市"), "只移動不操作時停在"); if (r !== true) return r;
  return ok(true, "區域限制、只移動一次、停在最後一個操作的縣市");
});
c2("行動 · 搶：成功時移除一顆對手方塊，那塊回到印的顏色（§4、§7.1）", () => {
  let st = D.firstActor(SOONG); st.bag = [0, 40, 0];
  const tp = ci("台北市");
  st.counties[tp].blocks.find((x) => x.o < 0 && x.t === "B").o = CHEN; // 陳跨營填過一塊藍
  const fmt = (s) => `${D.cubes(s, tp, CHEN)} ${D.empty(s, tp, "G")} ${D.empty(s, tp, "B")}`;
  let r = eq(fmt(st), "4 3 1", "佈置後台北市 陳/空綠/空藍"); if (r !== true) return r;
  st = D.act(st, SOONG, { type: "candidate" });
  st = D.act(st, SOONG, { type: "action", kind: "campaign" });
  st = D.act(st, SOONG, { type: "move", to: tp });
  const a = D.act(st, SOONG, { type: "steal", county: tp, target: CHEN, t: "B" });
  const b = D.act(st, SOONG, { type: "steal", county: tp, target: CHEN, t: "G" });
  r = eq(fmt(a), "3 3 2", "搶陳在藍塊上的方塊之後"); if (r !== true) return r;
  r = eq(fmt(b), "3 4 1", "搶陳在綠塊上的方塊之後"); if (r !== true) return r;
  return ok(true, "藍塊回藍、綠塊回綠");
});
c2("行動 · 無色塊不能用 CP 放（§3.1、§7.1）", () => {
  let st = D.firstActor(CHEN);
  st = D.act(st, CHEN, { type: "candidate" });
  st = D.act(st, CHEN, { type: "action", kind: "campaign" });
  st = D.act(st, CHEN, { type: "move", to: ci("基隆市") });
  const k = ci("基隆市");
  const n = E.legalMoves(st, CHEN).filter((m) => (m.type === "fill" || m.type === "cross") && m.county === k).length;
  const r = eq(n, 0, "基隆市（綠 1 藍 1 都有人、只剩無色 1）的填／跨營填"); if (r !== true) return r;
  return ok(true, "基隆市沒有可以填的");
});
c2("行動 · 廣告每 1 CP 一次檢定；成功在任一區放自己的媒體或移除該區一顆對手媒體，失敗沒有選擇（§7.2）", () => {
  let st = D.firstActor(CHEN); st.bag = [10, 0, 0];
  st = D.act(st, CHEN, { type: "candidate" });
  st = D.act(st, CHEN, { type: "action", kind: "ads" });
  st = D.act(st, CHEN, { type: "ad" });
  const ms = E.legalMoves(st, CHEN);
  if (!ms.length || !ms.every((m) => m.type === "media")) return "廣告成功之後的選項不全是放／移除媒體：" + JSON.stringify(ms.slice(0, 4));
  let r = eq(ms.filter((m) => m.target == null).length, 7, "能放自己媒體的區數"); if (r !== true) return r;
  const rm = ms.filter((m) => m.target != null).map((m) => `${m.region}:${m.target}`).sort().join();
  r = eq(rm, `${ri("北北基")}:2,${ri("中彰投")}:2`, "能移除的對手媒體（連起始在北北基、中彰投）"); if (r !== true) return r;
  const a = D.act(st, CHEN, { type: "media", region: ri("北北基"), target: LIEN });
  r = eq(a.media[ri("北北基")].join(), "0,0,0", "移除連在北北基的媒體之後"); if (r !== true) return r;
  let f = D.firstActor(CHEN); f.bag = [0, 0, 10];
  f = D.act(f, CHEN, { type: "candidate" });
  f = D.act(f, CHEN, { type: "action", kind: "ads" });
  f = D.act(f, CHEN, { type: "ad" });
  const total = f.media.flat().reduce((s, x) => s + x, 0);
  r = eq(`${E.legalMoves(f, CHEN).map((m) => m.type).sort().join()} ${f.bag.join()} ${total}`, "ad,done 0,0,9 2", "失敗之後的選項、袋子、盤上媒體總數"); if (r !== true) return r;
  return ok(true, "成功選放／移除；失敗少一顆、沒有選擇");
});
c2("行動 · 議題：同一個行動第一顆 1 CP、之後每顆 2 CP，放或移除同價，不檢定（§7.3）", () => {
  let st = D.firstActor(CHEN); st.bag = [0, 0, 10];
  st = D.act(st, CHEN, { type: "candidate" });
  st = D.act(st, CHEN, { type: "action", kind: "issue" });
  const e0 = D.issue(st, "econ")[CHEN];
  const r1 = D.repeat(st, CHEN, (ms) => ms.find((m) => m.type === "issue" && m.issue === "econ" && m.target == null));
  let r = eq(`${r1.n} ${D.issue(r1.st, "econ")[CHEN] - e0} ${r1.st.bag.join()}`, "3 3 0,0,10", "5 CP：放的次數、經濟陳增加、袋子"); if (r !== true) return r;
  let s4 = D.giveCard(D.firstActor(CHEN), CHEN, "dpp_counties");
  s4.issues.find((i) => i.name === "clean").cubes = [0, 0, 2];
  s4 = D.act(s4, CHEN, { type: "play", card: "dpp_counties", mode: "cp" });
  s4 = D.act(s4, CHEN, { type: "action", kind: "issue" });
  s4 = D.act(s4, CHEN, { type: "issue", issue: "clean", target: LIEN });
  s4 = D.act(s4, CHEN, { type: "issue", issue: "clean" });
  r = eq(`${D.issue(s4, "clean").join("/")} ${E.legalMoves(s4, CHEN).map((m) => m.type).join()}`, "1/0/1 done", "4 CP 移除連 1、放陳 1 之後"); if (r !== true) return r;
  return ok(true, "5 CP 放 3 顆；4 CP 移 1 放 1，剩 1 CP 只能結束");
});

// ---- 支持檢定與袋子（§八）
c2("檢定 · 抽到自己的顏色成功、放回袋中；抽到別人的顏色失敗、那顆回該玩家供應區（§八）", () => {
  const fmt = (x) => { const c = D.lastCheck(x.st); return `${x.st.bag.join()} ${c ? `${c.seat}:${c.drew}:${c.ok}` : "沒有 check 紀錄"} ${D.cubes(x.st, ci("台南縣"), CHEN)}`; };
  let r = eq(fmt(chenOp((s) => { s.bag = [3, 0, 0]; }, null, { type: "cross", county: ci("台南縣") })), "3,0,0 0:0:true 2", "抽到陳"); if (r !== true) return r;
  r = eq(fmt(chenOp((s) => { s.bag = [0, 3, 0]; }, null, { type: "cross", county: ci("台南縣") })), "0,2,0 0:1:false 1", "抽到宋"); if (r !== true) return r;
  return ok(true, "成功袋子不變；失敗那一色少一顆");
});
c2("檢定 · 袋子抽空時每人投入 12 顆再抽（§8.2）", () => {
  const x = chenOp((s) => { s.bag = [0, 0, 0]; }, null, { type: "cross", county: ci("台南縣") });
  const c = D.lastCheck(x.st); if (!c) return "沒有 check 紀錄";
  const want = [12, 12, 12]; if (!c.ok) want[c.drew]--;
  const r = eq(`${x.st.bag.join()} ${c.ok === (c.drew === CHEN)}`, `${want.join()} true`, `重裝後（抽到 ${c.drew}）的袋子`); if (r !== true) return r;
  return ok(true, `重裝 12/12/12 後抽到 ${c.drew}，袋子 ${x.st.bag.join("/")}`);
});
c2("檢定 · 填同營游離塊，沒有別人的樁腳主、沒有對手候選人 → 不檢定（§8.1）", () => {
  const r = eq(opStr(chenOp((s) => { s.bag = [0, 0, 10]; }, null, { type: "fill", county: ci("台南縣") }), "台南縣", CHEN), "2 0,0,10 0", "陳在台南縣的方塊、袋子、檢定次數"); if (r !== true) return r;
  return ok(true, "台南縣填綠：放上、沒有檢定");
});
c2("檢定 · 跨營填與搶永遠要檢定，有媒體優勢也一樣（§7.1、§8.1）", () => {
  const arrange = (s) => { s.bag = [0, 0, 10]; s.media[ri("雲嘉南")] = [3, 0, 0]; };
  let r = eq(opStr(chenOp(arrange, null, { type: "cross", county: ci("台南縣") }), "台南縣", CHEN), "1 0,0,9 1", "跨營填（陳的方塊、袋子、檢定）"); if (r !== true) return r;
  r = eq(opStr(chenOp(arrange, null, { type: "steal", county: ci("台南縣"), target: LIEN, t: "B" }), "台南縣", LIEN), "1 0,0,9 1", "搶連（連的方塊、袋子、檢定）"); if (r !== true) return r;
  return ok(true, "雲嘉南媒體優勢下，跨營填與搶都檢定");
});

// ---- 樁腳主、區域媒體優勢（§3.4、§8.1）
c2("樁腳主 · 4 顆以上；別人在該縣市是樁腳主就要檢定（自己也是不抵銷），3 顆不算（§3.4、§8.1）", () => {
  const tpx = ci("台北縣");
  // v0.3 開局台北縣 陳 3、宋 4、連 4。先替陳補一顆綠到 4 顆：三人都是樁腳主。
  const four = (s) => { s.bag = [0, 0, 10]; s.counties[tpx].blocks.find((x) => x.o < 0 && x.t === "G").o = CHEN; };
  let r = eq(opStr(chenOp(four, "台北縣", { type: "fill", county: tpx }), "台北縣", CHEN), "4 0,0,9 1", "陳 宋 連 都 4 顆：陳填台北縣"); if (r !== true) return r;
  const three = (s) => { four(s); for (const p of [SOONG, LIEN]) s.counties[tpx].blocks.find((x) => x.o === p).o = -1; };
  r = eq(opStr(chenOp(three, "台北縣", { type: "fill", county: tpx }), "台北縣", CHEN), "5 0,0,10 0", "宋、連各剩 3 顆：陳填台北縣"); if (r !== true) return r;
  return ok(true, "別人 4 顆要檢定、3 顆不用；陳自己 4 顆不抵銷");
});
c2("樁腳主 · 填同營游離塊，該縣市有對手候選人棋子就要檢定（§8.1）", () => {
  let r = eq(opStr(chenOp((s) => { s.bag = [0, 0, 10]; s.pos[SOONG] = ci("台中縣"); }, "台中縣", { type: "fill", county: ci("台中縣") }), "台中縣", CHEN), "1 0,0,9 1", "宋在台中縣：陳填綠"); if (r !== true) return r;
  r = eq(opStr(chenOp((s) => { s.bag = [0, 0, 10]; }, "台中縣", { type: "fill", county: ci("台中縣") }), "台中縣", CHEN), "2 0,0,10 0", "宋在南投：陳填台中縣"); if (r !== true) return r;
  return ok(true, "對手在場檢定、不在場不檢定");
});
c2("樁腳主 · 區域媒體優勢（該區媒體最多、平手無人）免除樁腳主與候選人在場的檢定（§3.4、§8.1）", () => {
  const fill = (to, arrange) => opStr(chenOp(arrange, to, { type: "fill", county: ci(to) }), to, CHEN);
  let r = eq(fill("台北縣", (s) => { s.bag = [0, 0, 10]; s.media[ri("北北基")] = [2, 0, 1]; }), "4 0,0,10 0", "北北基媒體 陳2 連1：填台北縣"); if (r !== true) return r;
  r = eq(fill("台北縣", (s) => { s.bag = [0, 0, 10]; s.media[ri("北北基")] = [1, 0, 1]; }), "3 0,0,9 1", "北北基媒體 陳1 連1（平手）：填台北縣"); if (r !== true) return r;
  r = eq(fill("台中縣", (s) => { s.bag = [0, 0, 10]; s.pos[SOONG] = ci("台中縣"); s.media[ri("中彰投")] = [2, 0, 1]; }), "2 0,0,10 0", "中彰投媒體優勢、宋在台中縣：填台中縣"); if (r !== true) return r;
  return ok(true, "優勢免兩種檢定；平手不算優勢");
});

// ---- 動能結算（§5.3）
c2("動能結算 · 先減半（宋連捨去、陳進位），第二槽先選，第一槽動能＋背書，第三槽動能，最後議題領先者各 −1（§5.3）", () => {
  const { st, seat } = atLastPlay();
  st.mom = [3, 3, 1]; st.media = zeros7();
  st.issues[0].cubes = [2, 1, 0]; st.issues[1].cubes = [0, 3, 1]; st.issues[2].cubes = [1, 1, 0];
  st.endorse = [-1, -1, LIEN, -1, -1, -1, -1]; st.endorseDeck = [5, 2]; st.endorseDiscard = [];
  const names = st.issues.map((i) => i.name);
  const mid = lastPlayQuiet(st, seat);
  let r = eq(JSON.stringify(E.mustAct(mid)), JSON.stringify([SOONG]), "第二槽領先者（宋）先選"); if (r !== true) return r;
  r = eq(E.legalMoves(mid, SOONG).map((m) => `${m.type}:${m.pick}`).sort().join(), "reward:endorse,reward:mom", "宋的選項"); if (r !== true) return r;
  const got = (s) => `${s.phase}；動能 ${s.mom.join("/")}；背書 ${s.endorse.join(",")}；議題 ${s.issues.map((i) => i.name + "=" + i.cubes.join("/")).join(" ")}`;
  const want = (mom, endorse) => `save；動能 ${mom}；背書 ${endorse}；議題 ${names.map((n, k) => n + "=" + ["1/1/0", "0/2/1", "1/1/0"][k]).join(" ")}`;
  // 減半：陳 3→2（進位）、宋 3→1、連 1→0。宋選背書抽到 2（換掉連的）；陳第一槽 +1、抽到 5。第三槽平手。
  r = eq(got(D.act(mid, SOONG, { type: "reward", pick: "endorse" })), want("3/1/0", "-1,-1,1,-1,-1,0,-1"), "宋選背書"); if (r !== true) return r;
  // 宋選動能 1→2；陳抽到 2（換掉連的）。
  r = eq(got(D.act(mid, SOONG, { type: "reward", pick: "mom" })), want("3/2/0", "-1,-1,0,-1,-1,-1,-1"), "宋選動能"); if (r !== true) return r;
  return ok(true, "減半 → 第二槽選 → 第一槽 → 第三槽 → 議題衰減，兩種選法都對");
});
c2("動能結算 · 全國媒體優勢者可交換相鄰兩槽，獎勵照交換後的槽位；全國媒體平手不問（§5.3）", () => {
  const { st, seat } = atLastPlay();
  st.mom = [0, 0, 0]; st.media = zeros7(); st.media[0] = [2, 0, 0];
  st.issues[0].cubes = [0, 0, 0]; st.issues[1].cubes = [2, 0, 0]; st.issues[2].cubes = [0, 1, 0];
  st.endorse = Array(7).fill(-1); st.endorseDeck = [4]; st.endorseDiscard = [];
  const [n0, n1, n2] = st.issues.map((i) => i.name);
  const tie = E.clone(st); tie.media[0] = [1, 1, 0];
  const mid = lastPlayQuiet(st, seat);
  let r = eq(JSON.stringify(E.mustAct(mid)), "[0]", "全國媒體優勢者（陳）決定"); if (r !== true) return r;
  r = eq(E.legalMoves(mid, CHEN).map((m) => m.type + (m.slot ?? "")).sort().join(), "noswap,swap0,swap1", "陳的選項"); if (r !== true) return r;
  const s = D.act(mid, CHEN, { type: "swap", slot: 0 });
  r = eq(s.phase, "save", "交換之後（第二槽無人，沒有別的決定）"); if (r !== true) return r;
  r = eq(s.issues.map((i) => i.name).join(), [n1, n0, n2].join(), "交換後的槽位"); if (r !== true) return r;
  // 第一槽 n1 陳領先：+1 動能、背書抽到 4；第三槽 n2 宋 +1；衰減後 n1 陳 1、n2 宋 0。
  r = eq(`${s.mom.join("/")} ${s.endorse[4]} ${s.issues.map((i) => i.cubes.join("/")).join(" ")}`, "1/1/0 0 1/0/0 0/0/0 0/0/0", "動能、高屏背書、議題"); if (r !== true) return r;
  const t = lastPlayQuiet(tie, seat);
  if (E.legalMoves(t, CHEN).some((m) => m.type === "swap" || m.type === "noswap")) return "全國媒體平手還問交換";
  return ok(true, `陳把 ${n0}、${n1} 對調，獎勵跟著新槽位；平手不問`);
});
c2("動能結算 · 減半時陳進位、宋連捨去；沒有任何領先者時直接進留牌（§5.3、§十三）", () => {
  const { st, seat } = atLastPlay();
  st.mom = [1, 1, 5]; st.media = zeros7();
  for (const i of st.issues) i.cubes = [0, 0, 0];
  const s = lastPlayQuiet(st, seat);
  const r = eq(`${s.phase} ${s.mom.join()}`, "save 1,0,2", "減半之後"); if (r !== true) return r;
  return ok(true, "陳 1→1、宋 1→0、連 5→2");
});
c2("動能結算 · 背書卡抽完把棄掉的洗回（§5.3）", () => {
  const { st, seat } = atLastPlay();
  st.mom = [0, 0, 0]; st.media = zeros7();
  st.issues[0].cubes = [0, 0, 0]; st.issues[1].cubes = [0, 2, 0]; st.issues[2].cubes = [0, 0, 0];
  st.endorse = Array(7).fill(-1); st.endorseDeck = []; st.endorseDiscard = [3];
  const s = D.act(lastPlayQuiet(st, seat), SOONG, { type: "reward", pick: "endorse" });
  const r = eq(s.endorse.join(), "-1,-1,-1,1,-1,-1,-1", "背書（牌庫空、棄牌只有雲嘉南）"); if (r !== true) return r;
  return ok(true, "洗回後抽到雲嘉南");
});

// ---- 留牌（§5.4、§十）
c2("留牌 · 第 1–5 回合每人剩下的 1 張留到政見發表會堆、沒有棄牌；休息方塊這時才進袋（§5.4）", () => {
  let st = D.playUntil(D.firstActor(CHEN), (s) => s.phase === "save", null, D.quiet);
  st.rest = [2, 0, 3]; st.bag = [5, 5, 5];
  const hands = st.hands.map((h) => h.slice()), disc0 = st.decks.discard.length;
  for (const s of [0, 1, 2]) {
    const saves = E.legalMoves(st, s).filter((m) => m.type === "save");
    const r = eq(saves.length, hands[s].length, `seat ${s} 的留牌選項數（手上 ${hands[s].length} 張，留 1）`); if (r !== true) return r;
    if (!saves.every((m) => m.cards.length === 1 && hands[s].includes(m.cards[0]))) return `seat ${s} 的留牌選項不是「手上的 1 張」：${JSON.stringify(saves)}`;
  }
  const kept = [];
  for (const s of [0, 1, 2]) {
    const m = E.legalMoves(st, s).filter((x) => x.type === "save").pop();
    kept.push(m.cards[0]); st = E.apply(st, s, m);
  }
  let r = eq(`${st.turn} ${st.phase}`, "2 order", "三人留完之後"); if (r !== true) return r;
  r = eq(st.savedDebate.map((p) => p.join()).join("|"), kept.join("|"), "政見發表會堆"); if (r !== true) return r;
  r = eq(`${st.bag.join()} ${st.rest.join()}`, "7,5,8 0,0,0", "袋子（5/5/5 加休息 2/0/3）與休息區"); if (r !== true) return r;
  r = eq(st.decks.discard.length, disc0 + hands.reduce((s, h) => s + h.length - 1, 0), "棄牌堆"); if (r !== true) return r;
  const c = D.conservation(st); if (c !== true) return c;
  return ok(true, `手上 ${hands.map((h) => h.length).join("/")} 張各留 1；袋子 7/5/8`);
});
c2("留牌 · 第 7–8 回合留 2 張到投票日堆（§十）", () => {
  let st = D.playUntil(D.firstActor(CHEN, { startTurn: 7 }), (s) => s.phase === "save", null, D.quiet);
  let r = eq(st.turn, 7, "回合"); if (r !== true) return r;
  for (const s of [0, 1, 2]) {
    const h = st.hands[s], saves = E.legalMoves(st, s).filter((m) => m.type === "save");
    r = eq(saves.length, (h.length * (h.length - 1)) / 2, `seat ${s} 的留牌選項數（手上 ${h.length} 張，留 2）`); if (r !== true) return r;
    if (!saves.every((m) => m.cards.length === 2 && m.cards[0] !== m.cards[1] && m.cards.every((id) => h.includes(id)))) return `seat ${s} 的留牌選項不是「手上的 2 張」`;
  }
  for (const s of [0, 1, 2]) st = D.act(st, s, { type: "save" });
  r = eq(`${st.turn} ${st.phase} ${st.savedElection.map((p) => p.length).join("/")} ${st.savedDebate.map((p) => p.length).join("/")}`, "8 order 2/2/2 0/0/0", "留完之後 回合、投票日堆、政見發表會堆"); if (r !== true) return r;
  return ok(true, "每人留 2 到投票日堆，進第 8 回合");
});
c2("留牌 · 出過候選人牌的那一回合前期手上剩 2 張：留 1、另一張進棄牌堆（§5.4、§6.3；owner 裁決 #2：整局唯一會產生棄牌的情況）", () => {
  let used = false;
  let st = D.playUntil(D.firstActor(CHEN), (s) => s.phase === "save", null, (s, seat, ms) => {
    if (seat === CHEN && !used && ms.some((m) => m.type === "candidate")) { used = true; return ms.find((m) => m.type === "candidate"); }
    return D.quiet(s, seat, ms);
  });
  const saves = E.legalMoves(st, CHEN).filter((m) => m.type === "save");
  let r = eq(`${st.hands[CHEN].length} ${saves.filter((m) => m.cards.length === 1).length} ${saves.length}`, "2 2 2", "陳的手牌數、留 1 張的選項數、全部選項數"); if (r !== true) return r;
  const disc0 = st.decks.discard.length;
  st = E.apply(st, CHEN, saves[0]);
  r = eq(`${st.savedDebate[CHEN].length} ${st.hands[CHEN].length} ${st.decks.discard.length - disc0}`, "1 0 1", "陳留完之後 政見發表會堆、手牌、棄牌堆增加"); if (r !== true) return r;
  return ok(true, "陳 2 張、2 種留法，另一張進棄牌堆");
});

// ---- 事件效果（§14.3、§14.2）
const SIMPLE = [
  { id: "alternation", by: CHEN, want: { mom: [2, 0, 0] } },
  { id: "sweep_black_gold", by: CHEN, want: { clean: [2, 0, -1] } },
  { id: "no_nuke4", by: CHEN, want: { econ: [1, 0, -1], mom: [0, 1, 0] } },
  { id: "lin_chairman", by: CHEN, want: { clean: [1, 0, 0], mom: [1, 0, 0] } },
  { id: "poll_lead", by: SOONG, want: { mom: [0, 2, 0] } },
  { id: "million_signatures", by: SOONG, want: { bag: [0, 3, 0], mom: [0, 1, 0] } },
  { id: "lien_siew", by: LIEN, want: { econ: [0, 0, 2] } },
  { id: "hand_in_hand", by: LIEN, want: { mom: [0, 0, 1], econ: [0, 0, 1] } },
  { id: "stability", by: LIEN, want: { cross: [0, 0, 2] } },
  { id: "local_factions", by: LIEN, want: { bag: [0, 0, 4] } },
  { id: "party_congress", by: LIEN, want: { bag: [0, 0, 4], mom: [0, 0, 1] } },
  { id: "poll_published", by: CHEN, arrange: (s) => { s.issues[0].cubes = [0, 2, 1]; }, want: { mom: [0, 1, 0] } },
  { id: "strait_tension", by: CHEN, want: { cross: [-1, -1, -1], mom: [1, 0, 0] } },
  { id: "white_paper", by: CHEN, want: { cross: [1, 0, 0], mom: [1, 0, 0] } },
  { id: "us_congress", by: CHEN, want: { cross: [1, 0, 1] } },
  { id: "stock_crash", by: CHEN, want: { econ: [0, 0, 1], mom: [-1, -1, -1] } },
];
const playEvent = (st, by, id) => {
  st = D.act(st, by, { type: "play", card: id, mode: "event" });
  if (D.has(st, by, { type: "action", kind: "campaign" })) {
    st = D.act(st, by, { type: "action", kind: "campaign" });
    st = D.act(st, by, { type: "done" });
  }
  return st;
};
c2(`事件 · 不需選擇的 ${SIMPLE.length} 張（動能、議題、袋子）：自己的打完沒有 CP 行動、外力的有；打完移出遊戲（§14.3）`, () => {
  if (typeof E.effectImplemented !== "function") return "engine 沒有 export effectImplemented(id)";
  const keys = ["mom", "bag", "cross", "clean", "econ"];
  const snap = (s) => ({ mom: s.mom.slice(), bag: s.bag.slice(), cross: D.issue(s, "cross").slice(), clean: D.issue(s, "clean").slice(), econ: D.issue(s, "econ").slice() });
  const bad = [];
  for (const { id, by, arrange, want } of SIMPLE) {
    if (!E.effectImplemented(id)) { bad.push(`${id} 沒做`); continue; }
    let st = D.giveCard(D.firstActor(by), by, id);
    st.mom = [2, 2, 2]; st.bag = [5, 5, 5];
    for (const i of st.issues) i.cubes = [1, 1, 1];
    if (arrange) arrange(st);
    const a = snap(st);
    const ext = C.EVENTS.find((e) => e.id === id).owner === "ext";
    const after = D.act(st, by, { type: "play", card: id, mode: "event" });
    if (D.has(after, by, { type: "action", kind: "campaign" }) !== ext) { bad.push(`${id}：${ext ? "外力牌打完沒有 CP 行動" : "自己的事件打完還有 CP 行動"}`); continue; }
    st = playEvent(st, by, id);
    const b = snap(st);
    const diff = keys.map((k) => `${k} ${b[k].map((x, p) => x - a[k][p]).join("/")}`).join("；");
    const exp = keys.map((k) => `${k} ${(want[k] || [0, 0, 0]).join("/")}`).join("；");
    if (diff !== exp) bad.push(`${id}：期望 ${exp}，實際 ${diff}`);
    else if (!st.removed.includes(id) || st.decks.discard.includes(id)) bad.push(`${id}：打完沒有移出遊戲`);
  }
  return bad.length ? bad.join("\n      ") : ok(true, `${SIMPLE.length} 張的變化都照規則書`);
});
c2("事件 · 下限：議題方塊、動能不低於 0；對方沒有方塊就無效（§14.3 通用規則）", () => {
  const run = (id, arrange) => { const st = D.giveCard(D.firstActor(CHEN), CHEN, id); arrange(st); return playEvent(st, CHEN, id); };
  let r = eq(D.issue(run("strait_tension", (s) => { for (const i of s.issues) i.cubes = [0, 1, 0]; }), "cross").join(), "0,0,0", "兩岸緊張（兩岸 0/1/0）之後"); if (r !== true) return r;
  r = eq(run("stock_crash", (s) => { s.mom = [0, 1, 0]; }).mom.join(), "0,0,0", "股市重挫（動能 0/1/0）之後"); if (r !== true) return r;
  r = eq(D.issue(run("sweep_black_gold", (s) => { for (const i of s.issues) i.cubes = [0, 0, 0]; }), "clean").join(), "2,0,0", "掃除黑金（連在清廉沒有方塊）之後"); if (r !== true) return r;
  return ok(true, "三種下限都對");
});
c2("事件 · 民調領先只在第 1–3 回合能當事件、也只在那時能被觸發（§14.3）", () => {
  const modes = (turn) => modesOf(D.giveCard(D.firstActor(SOONG, { startTurn: turn }), SOONG, "poll_lead"), SOONG, "poll_lead");
  let r = eq(`${modes(3)} | ${modes(4)}`, "cp,event | cp", "宋手上的民調領先（第 3 | 第 4 回合）"); if (r !== true) return r;
  const trig = (turn) => { const st = D.giveCard(D.firstActor(CHEN, { startTurn: turn }), CHEN, "poll_lead"); st.mom = [0, 3, 0]; return D.has(cpDone(st, CHEN, "poll_lead"), SOONG, { type: "trigger" }); };
  r = eq(`${trig(3)} ${trig(4)}`, "true false", "陳當 CP 打出後宋能不能觸發（第 3／第 4 回合）"); if (r !== true) return r;
  return ok(true, "第 3 回合能、第 4 回合不能");
});
c2("事件 · 地方牌當事件：在牌上的縣市放 1 顆（照 §8.1 檢定；可跨營、不可無色），沒有 CP 行動，打完移出遊戲（§6.1、§14.2）", () => {
  const id = C.localCards().find((c) => c.county === "台北縣").id, k = ci("台北縣");
  const start = (arrange) => { const st = D.giveCard(D.firstActor(CHEN), CHEN, id); arrange(st); return D.act(st, CHEN, { type: "play", card: id, mode: "event" }); };
  const s = start((x) => { x.bag = [0, 9, 0]; });
  let r = eq(E.legalMoves(s, CHEN).map((m) => `${m.type}:${m.county}`).sort().join(), `cross:${k},fill:${k}`, "地方牌（台北縣）的選項"); if (r !== true) return r;
  const a = D.act(s, CHEN, { type: "fill", county: k });
  r = eq(`${D.cubes(a, k, CHEN)} ${a.bag.join()}`, "3 0,8,0", "填綠：宋連是樁腳主 → 檢定失敗"); if (r !== true) return r;
  if (E.mustAct(a).includes(CHEN) && E.legalMoves(a, CHEN).some((m) => m.type === "action")) return "地方牌當事件之後還有 CP 行動";
  if (!a.removed.includes(id)) return "地方牌當事件之後沒有移出遊戲";
  const m = D.act(start((x) => { x.bag = [0, 9, 0]; x.media[ri("北北基")] = [2, 0, 1]; }), CHEN, { type: "fill", county: k });
  r = eq(`${D.cubes(m, k, CHEN)} ${m.bag.join()}`, "4 0,9,0", "有北北基媒體優勢：填綠不檢定"); if (r !== true) return r;
  const c = D.act(start((x) => { x.bag = [0, 9, 0]; x.media[ri("北北基")] = [2, 0, 1]; }), CHEN, { type: "cross", county: k });
  r = eq(`${D.cubes(c, k, CHEN)} ${c.bag.join()}`, "3 0,8,0", "跨營：永遠檢定"); if (r !== true) return r;
  return ok(true, "只能放牌上的縣市；檢定照 §8.1；沒有 CP 行動；移出遊戲");
});
// ---- 需要選擇的事件效果（#4）
// Each spec plays one card as an event from a fresh turn-1 state (the v0.3 opening), applies the
// listed choice moves, and compares every county's cubes and block colours, media, momentum, bag,
// issues and the number of support checks with deltas worked out by hand from §14.3 and the
// rulings in issue #4. The bag holds one opponent colour only, so a failed check is deterministic.
const EFFECT_TYPES = new Set(["fill", "cross", "remove", "convert", "media", "pick"]);
const OPP_BAG = [[0, 0, 10], [10, 0, 0], [0, 10, 0]];
const cn = (k) => B.COUNTIES[k][0];
const countiesOf = (ms, types) => [...new Set(ms.filter((m) => types.includes(m.type)).map((m) => cn(m.county)))].sort().join(",");
const sorted = (names) => names.slice().sort().join(",");
function boardSnap(st) {
  return {
    cubes: st.counties.map((c) => [0, 1, 2].map((p) => c.blocks.filter((b) => b.o === p).length)),
    types: st.counties.map((c) => ["G", "B", "N"].map((t) => c.blocks.filter((b) => b.t === t).length)),
    media: st.media.map((m) => m.slice()), mom: st.mom.slice(), bag: st.bag.slice(),
    issues: Object.fromEntries(st.issues.map((i) => [i.name, i.cubes.slice()])), checks: D.checks(st),
  };
}
function diffSnap(a, b) {
  const out = [], d3 = (x, y) => x.map((v, i) => y[i] - v);
  a.cubes.forEach((r, k) => { const d = d3(r, b.cubes[k]); if (d.some(Boolean)) out.push(`${cn(k)} ${d.join("/")}`); });
  a.types.forEach((r, k) => { const d = d3(r, b.types[k]); if (d.some(Boolean)) out.push(`${cn(k)}塊色 ${d.join("/")}`); });
  a.media.forEach((r, k) => { const d = d3(r, b.media[k]); if (d.some(Boolean)) out.push(`媒體${B.REGIONS[k]} ${d.join("/")}`); });
  for (const key of ["mom", "bag"]) { const d = d3(a[key], b[key]); if (d.some(Boolean)) out.push(`${key} ${d.join("/")}`); }
  for (const n of Object.keys(a.issues)) { const d = d3(a.issues[n], b.issues[n]); if (d.some(Boolean)) out.push(`${n} ${d.join("/")}`); }
  if (b.checks !== a.checks) out.push(`檢定 ${b.checks - a.checks}`);
  return out.sort().join("；") || "無變化";
}
function expectStr(w) {
  const out = [];
  for (const [n, d] of Object.entries(w.cubes || {})) out.push(`${n} ${d.join("/")}`);
  for (const [n, d] of Object.entries(w.types || {})) out.push(`${n}塊色 ${d.join("/")}`);
  for (const [r, d] of Object.entries(w.media || {})) out.push(`媒體${r} ${d.join("/")}`);
  for (const key of ["mom", "bag"]) if (w[key]) out.push(`${key} ${w[key].join("/")}`);
  for (const [n, d] of Object.entries(w.issues || {})) out.push(`${n} ${d.join("/")}`);
  if (w.checks) out.push(`檢定 ${w.checks}`);
  return out.sort().join("；") || "無變化";
}
// steps: [seat, move] applies a choice; ["probe", seat, fn(moves) → true | message] inspects the
// legal moves without moving. While a seat has effect choices, `done` must not be among them.
function runSpec(s) {
  let st = D.giveCard(D.firstActor(s.by, s.opts), s.by, s.id);
  st.bag = (s.bag || OPP_BAG[s.by]).slice(); st.mom = [2, 2, 2];
  if (s.arrange) s.arrange(st);
  const a = boardSnap(st);
  try { st = s.play ? s.play(st) : D.act(st, s.by, { type: "play", card: s.id, mode: "event" }); } catch (e) { return `${s.id}：${e.message}`; }
  for (const step of s.steps) {
    if (step[0] === "probe") { const r = step[2](E.legalMoves(st, step[1])); if (r !== true) return `${s.id}：${r}`; continue; }
    const [seat, want] = step;
    if (!E.mustAct(st).includes(seat)) return `${s.id}：輪到 ${JSON.stringify(E.mustAct(st))}，期望 seat ${seat} 選 ${JSON.stringify(want)}`;
    const ms = E.legalMoves(st, seat);
    if (ms.some((m) => EFFECT_TYPES.has(m.type)) && ms.some((m) => m.type === "done")) return `${s.id}：效果還能選的時候給了 done（能放就必須放）`;
    try { st = D.act(st, seat, want); } catch (e) { return `${s.id}：${e.message}`; }
  }
  const left = E.mustAct(st).flatMap((p) => E.legalMoves(st, p).filter((m) => EFFECT_TYPES.has(m.type)).map((m) => `seat ${p} ${JSON.stringify(m)}`));
  if (left.length) return `${s.id}：效果還有選擇沒做完：${left.slice(0, 3).join("，")}`;
  if (s.after) { const r = s.after(st); if (r !== true) return `${s.id}：${r}`; }
  const got = diffSnap(a, boardSnap(st)), want = expectStr(s.want);
  return got === want ? true : `${s.id}：期望 ${want}；實際 ${got}`;
}
function choiceGroup(label, specs) {
  c2(label, () => {
    if (typeof E.effectImplemented !== "function") return "engine 沒有 export effectImplemented(id)";
    const ids = [...new Set(specs.map((s) => s.id))];
    if (!ids.some((id) => E.effectImplemented(id))) return `TODO: 這 ${ids.length} 張的效果都還沒做（#4）`;
    const bad = [];
    for (const s of specs) {
      if (!E.effectImplemented(s.id)) { bad.push(`${s.id} 沒做`); continue; }
      const r = runSpec(s); if (r !== true) bad.push(r);
    }
    return bad.length ? bad.join("\n      ") : ok(true, `${specs.length} 個情境：${ids.join("、")}`);
  });
}
const F = (county) => ({ type: "fill", county: ci(county) });
const X = (county) => ({ type: "cross", county: ci(county) });
const RM = (county, target, t) => ({ type: "remove", county: ci(county), target, t });
const MD = (region, target) => (target == null ? { type: "media", region: ri(region) } : { type: "media", region: ri(region), target });
const offers = (types, names, what) => (ms) => eq(countiesOf(ms, types), sorted(names), what);

// The runner checks itself on cards that already work: a right expectation passes, a wrong one
// turns red, and a choice step (a local card placed cross-camp, the check failing) is applied.
c2("事件 · 選擇情境的比對機械先自己跑一次（用已經做好的牌：對的期望通過、錯的會紅）", () => {
  const good = runSpec({ id: "alternation", by: CHEN, steps: [], want: { mom: [2, 0, 0] } });
  if (good !== true) return "對的期望沒通過：" + good;
  const bad = runSpec({ id: "alternation", by: CHEN, steps: [], want: { mom: [1, 0, 0] } });
  if (bad === true) return "錯的期望也通過了：比對沒有作用";
  const local = runSpec({ id: C.localCards().find((c) => c.county === "台北縣").id, by: CHEN, steps: [[CHEN, X("台北縣")]], want: { bag: [0, 0, -1], checks: 1 } });
  if (local !== true) return "地方牌在台北縣跨營填（袋中只有連 → 失敗）沒對上：" + local;
  return ok(true, "對的過、錯的紅（" + bad + "）；地方牌的選擇步驟也對得上");
});

choiceGroup("事件 · 指定縣市（照文字順序；沒有空的游離塊就跳過）：9 張（§14.3）", [
  { id: "lu_running_mate", by: CHEN, steps: [["probe", CHEN, offers(["fill", "cross"], ["桃園縣"], "呂秀蓮搭檔可選的縣市")], [CHEN, F("桃園縣")], [CHEN, X("桃園縣")]], want: { cubes: { "桃園縣": [2, 0, 0] } } },
  { id: "hsieh_kaohsiung", by: CHEN, steps: [[CHEN, F("高雄市")], [CHEN, F("高雄市")]], want: { cubes: { "高雄市": [2, 0, 0] }, media: { "高屏": [1, 0, 0] } } },
  { id: "hsu_wen_long", by: CHEN, steps: [["probe", CHEN, offers(["fill", "cross"], ["台南縣"], "第一個縣市")], [CHEN, F("台南縣")], ["probe", CHEN, offers(["fill", "cross"], ["台南市"], "第二個縣市")], [CHEN, X("台南市")]], want: { cubes: { "台南縣": [1, 0, 0], "台南市": [1, 0, 0] } } },
  // 新竹縣開局沒有空的游離塊（藍 2 塊宋連各一）：跳過，直接問苗栗。
  { id: "hakka_vote", by: SOONG, steps: [["probe", SOONG, offers(["fill", "cross"], ["苗栗縣"], "客家票可選的縣市")], [SOONG, F("苗栗縣")]], want: { cubes: { "苗栗縣": [0, 1, 0] } } },
  { id: "east_coast", by: SOONG, arrange: (s) => { s.counties[ci("花蓮縣")].blocks.find((b) => b.o === LIEN).o = -1; }, steps: [["probe", SOONG, offers(["fill", "cross"], ["花蓮縣"], "花東原鄉可選的縣市（台東沒有空塊）")], [SOONG, F("花蓮縣")]], want: { cubes: { "花蓮縣": [0, 1, 0] } } },
  { id: "quake_bond", by: SOONG, steps: [["probe", SOONG, offers(["fill", "cross"], ["台中縣"], "災區情誼可選的縣市（南投沒有空塊）")], [SOONG, F("台中縣")]], want: { cubes: { "台中縣": [0, 1, 0] } } },
  { id: "farmers_association", by: LIEN, steps: [["probe", LIEN, offers(["fill", "cross"], ["雲林縣"], "第一個縣市")], [LIEN, F("雲林縣")], [LIEN, F("彰化縣")]], want: { cubes: { "雲林縣": [0, 0, 1], "彰化縣": [0, 0, 1] } } },
  // 需檢定：開局連在北北基有媒體優勢（連 1、其他 0），§8.1 免除樁腳主檢定 → 兩顆都放上、不檢定。
  { id: "ma_campaigns", by: LIEN, steps: [[LIEN, F("台北市")], [LIEN, F("台北市")]], want: { cubes: { "台北市": [0, 0, 2] } } },
  // 把北北基媒體清掉：台北市宋 5 顆是樁腳主，連填藍要檢定；袋中只有宋 → 兩次都失敗。
  { id: "ma_campaigns", by: LIEN, arrange: (s) => { s.media[ri("北北基")] = [0, 0, 0]; }, steps: [[LIEN, F("台北市")], [LIEN, F("台北市")]], want: { bag: [0, -2, 0], checks: 2 } },
  // 台北市：連 −1（不檢定）再宋 +1；新竹市沒有連的方塊：只有宋 +1。
  { id: "li_ao_endorses", by: SOONG, steps: [[SOONG, RM("台北市", LIEN, "B")], [SOONG, F("台北市")], ["probe", SOONG, (ms) => (ms.some((m) => m.type === "remove") ? "新竹市沒有連的方塊，卻還問移除" : offers(["fill", "cross"], ["新竹市"], "第二個縣市")(ms))], [SOONG, F("新竹市")]], want: { cubes: { "台北市": [0, 1, -1], "新竹市": [0, 1, 0] } } },
]);

choiceGroup("事件 · 任選縣市（各 +1 的縣市不重複；選過的縣市檢定失敗也算用掉）：13 張（§14.3）", [
  { id: "taiwan_son", by: CHEN, steps: [
    ["probe", CHEN, offers(["fill", "cross"], ["雲林縣", "台南縣", "台南市", "高雄市", "高雄縣", "屏東縣"], "台灣之子可選的縣市（雲嘉南或高屏、有空的游離塊）")],
    [CHEN, F("台南縣")],
    ["probe", CHEN, offers(["fill", "cross"], ["雲林縣", "台南市", "高雄市", "高雄縣", "屏東縣"], "選過台南縣之後")],
    [CHEN, X("台南市")], [CHEN, F("高雄市")]], want: { cubes: { "台南縣": [1, 0, 0], "台南市": [1, 0, 0], "高雄市": [1, 0, 0] } } },
  // 需檢定：台北縣、桃園跨營填永遠檢定（袋中只有連 → 失敗）；台南縣填綠沒有樁腳主、沒有對手候選人 → 不檢定。
  { id: "dpp_counties", by: CHEN, steps: [
    ["probe", CHEN, offers(["fill", "cross"], ["台北縣", "桃園縣", "台中縣", "台中市", "台南縣", "台南市", "高雄縣", "屏東縣"], "民進黨執政縣市可選的縣市（新竹縣、宜蘭、嘉義市沒有空塊）")],
    [CHEN, X("台北縣")], [CHEN, X("桃園縣")], [CHEN, F("台南縣")]], want: { cubes: { "台南縣": [1, 0, 0] }, bag: [0, 0, -2], checks: 2 } },
  { id: "million_rally", by: CHEN, steps: [[CHEN, F("台北縣")], [CHEN, X("台北市")], [CHEN, F("高雄市")]], want: { cubes: { "台北縣": [1, 0, 0], "台北市": [1, 0, 0], "高雄市": [1, 0, 0] }, mom: [1, 0, 0] } },
  { id: "south_rally", by: CHEN, steps: [["probe", CHEN, offers(["fill", "cross"], ["高雄市", "高雄縣", "屏東縣"], "南部大造勢可選的縣市")], [CHEN, F("高雄市")], [CHEN, F("屏東縣")]], want: { cubes: { "高雄市": [1, 0, 0], "屏東縣": [1, 0, 0] } } },
  { id: "diligent", by: SOONG, steps: [[SOONG, F("台北市")], [SOONG, F("桃園縣")], [SOONG, X("高雄市")]], want: { cubes: { "台北市": [0, 1, 0], "桃園縣": [0, 1, 0], "高雄市": [0, 1, 0] } } },
  { id: "new_party_backs_soong", by: SOONG, steps: [["probe", SOONG, offers(["fill", "cross"], ["台北市", "台北縣"], "新黨全力挺宋可選的縣市（基隆沒有空塊）")], [SOONG, F("台北市")], [SOONG, F("台北縣")]], want: { cubes: { "台北市": [0, 1, 0], "台北縣": [0, 1, 0] } } },
  // 需檢定：跨營填台北縣失敗（袋中只有陳）；苗栗填藍不檢定。
  { id: "kneel_for_votes", by: SOONG, steps: [[SOONG, X("台北縣")], [SOONG, F("苗栗縣")]], want: { cubes: { "苗栗縣": [0, 1, 0] }, mom: [0, 2, 0], bag: [-1, 0, 0], checks: 1 } },
  // 文字順序：先放方塊（袋中只有陳 → 跨營填失敗），最後才袋中 +1 宋。
  { id: "military_civil", by: SOONG, steps: [[SOONG, X("台北市")], [SOONG, F("苗栗縣")]], want: { cubes: { "苗栗縣": [0, 1, 0] }, bag: [-1, 1, 0], checks: 1 } },
  { id: "party_machine", by: LIEN, steps: [[LIEN, F("台北縣")], [LIEN, F("桃園縣")], [LIEN, X("高雄市")]], want: { cubes: { "台北縣": [0, 0, 1], "桃園縣": [0, 0, 1], "高雄市": [0, 0, 1] } } },
  { id: "lee_campaigns", by: LIEN, steps: [[LIEN, F("桃園縣")], [LIEN, F("台中縣")]], want: { cubes: { "桃園縣": [0, 0, 1], "台中縣": [0, 0, 1] } } },
  { id: "ma_leaks_polls", by: LIEN, opts: { startTurn: 8 }, steps: [[LIEN, X("台南縣")], [LIEN, F("桃園縣")]], want: { cubes: { "桃園縣": [0, 0, 1] }, mom: [1, 1, 0], bag: [0, -1, 0], checks: 1 } },
  // 跨營填台南縣失敗；桃園填藍不檢定；北北基媒體先清掉，台北縣填藍有宋這個樁腳主 → 檢定失敗。
  { id: "lee_alarm", by: LIEN, arrange: (s) => { s.media[ri("北北基")] = [0, 0, 0]; }, steps: [[LIEN, X("台南縣")], [LIEN, F("桃園縣")], [LIEN, F("台北縣")]], want: { cubes: { "桃園縣": [0, 0, 1] }, bag: [0, -2, 0], checks: 2 } },
  // 每個縣市：宋 +1（需檢定）之後，同縣市連有方塊就 −1（不檢定）。
  { id: "veterans_village", by: SOONG, steps: [
    [SOONG, X("台北縣")],
    ["probe", SOONG, (ms) => (ms.every((m) => m.type === "remove" && m.county === ci("台北縣") && m.target === LIEN) && ms.length ? true : "宋在台北縣 +1 之後，選項應該只剩移除台北縣的連：" + JSON.stringify(ms.slice(0, 4)))],
    [SOONG, RM("台北縣", LIEN, "B")], [SOONG, F("桃園縣")], [SOONG, RM("桃園縣", LIEN, "B")]],
    want: { cubes: { "台北縣": [0, 0, -1], "桃園縣": [0, 1, -1] }, bag: [-1, 0, 0], checks: 1 } },
]);

choiceGroup("事件 · 指定塊色與無色塊：三三三安家專案、宋友會、台灣前途決議文（§14.3）", [
  // 文字順序：經濟 +2，再在空的綠營游離塊放 1 顆；規則書沒寫免檢定 → 照 §8.1（台北縣有宋連兩個樁腳主 → 檢定失敗）。
  { id: "three_three_three", by: CHEN, steps: [["probe", CHEN, (ms) => (ms.length && ms.every((m) => m.type === "fill") ? true : "只能放綠營游離塊，選項卻有：" + [...new Set(ms.map((m) => m.type))].join(","))], [CHEN, F("台北縣")]], want: { issues: { econ: [2, 0, 0] }, bag: [0, 0, -1], checks: 1 } },
  { id: "soong_friends", by: SOONG, steps: [["probe", SOONG, (ms) => (ms.length && ms.every((m) => m.type === "fill") ? true : "只能放藍營游離塊，選項卻有：" + [...new Set(ms.map((m) => m.type))].join(","))], [SOONG, F("台北縣")]], want: { cubes: { "台北縣": [0, 1, 0] }, mom: [0, 1, 0] } },
  // 有空無色塊的縣市都能選（開局除了新竹市、澎湖、金馬共 21 個）；那一塊變成空的綠營游離塊。
  { id: "future_resolution", by: CHEN, steps: [["probe", CHEN, (ms) => { const c = countiesOf(ms, ["convert"]).split(",").filter(Boolean); return c.length === 21 && !c.includes("新竹市") && c.includes("台北縣") ? true : "可改的縣市：" + c.join(","); }], [CHEN, { type: "convert", county: ci("台北縣") }]], want: { issues: { cross: [1, 0, 0] }, types: { "台北縣": [1, 0, -1] } } },
]);

choiceGroup("事件 · 同縣市換塊：棄連保扁、棄連保宋、黨內整合（移除要檢定，放方塊照 §8.1）（§14.3）", [
  // 袋中只有陳 → 都成功。移除檢定 1 次；台北縣還有宋 4 顆的樁腳主 → 填綠也檢定。
  { id: "dump_lien_save_chen", by: CHEN, bag: [10, 0, 0], steps: [
    ["probe", CHEN, (ms) => (ms.length && ms.every((m) => m.type === "remove" && m.target === LIEN) ? true : "先選要移除連的縣市，選項卻有：" + JSON.stringify(ms.slice(0, 3)))],
    [CHEN, RM("台北縣", LIEN, "B")],
    ["probe", CHEN, offers(["fill", "cross"], ["台北縣"], "移除之後放方塊的縣市")],
    [CHEN, F("台北縣")]], want: { cubes: { "台北縣": [1, 0, -1] }, checks: 2 } },
  // 移除連之後台北縣沒有別人的樁腳主、沒有對手候選人 → 宋填藍不檢定：一共 1 次。
  { id: "dump_lien_save_soong", by: SOONG, bag: [0, 10, 0], steps: [[SOONG, RM("台北縣", LIEN, "B")], [SOONG, F("台北縣")]], want: { cubes: { "台北縣": [0, 1, -1] }, checks: 1 } },
  { id: "party_unity", by: LIEN, bag: [0, 0, 10], steps: [[LIEN, RM("台北縣", SOONG, "B")], [LIEN, F("台北縣")]], want: { cubes: { "台北縣": [0, -1, 1] }, checks: 1 } },
]);

choiceGroup("事件 · 移除對手方塊：許信良參選（宋選）、李登輝痛批宋（同一縣市 −2）、黨員歸隊（兩個縣市各一次檢定）（§14.3）", [
  { id: "hsu_hsin_liang", by: SOONG, steps: [["probe", SOONG, (ms) => (ms.length && ms.every((m) => m.type === "remove" && m.target === CHEN) ? true : "只能移除陳的方塊，選項卻有：" + JSON.stringify(ms.slice(0, 3)))], [SOONG, RM("台北縣", CHEN, "G")]], want: { cubes: { "台北縣": [-1, 0, 0] }, mom: [0, 1, 0] } },
  { id: "lee_attacks_soong", by: LIEN, steps: [[LIEN, RM("台北市", SOONG, "B")], ["probe", LIEN, offers(["remove"], ["台北市"], "第二顆只能在同一縣市")], [LIEN, RM("台北市", SOONG, "B")]], want: { cubes: { "台北市": [0, -2, 0] }, mom: [0, 1, 0] } },
  { id: "members_return", by: LIEN, bag: [0, 0, 10], steps: [[LIEN, RM("台北縣", SOONG, "B")], ["probe", LIEN, (ms) => (countiesOf(ms, ["remove"]).split(",").includes("台北縣") ? "第二個縣市還能選台北縣" : true)], [LIEN, RM("桃園縣", SOONG, "B")]], want: { cubes: { "台北縣": [0, -1, 0], "桃園縣": [0, -1, 0] }, checks: 2 } },
]);

choiceGroup("事件 · 媒體（事件放媒體不檢定；「任 N 個區」不重複；「任一區 +2」放同一區）：7 張（§14.3）", [
  { id: "lo_propaganda", by: CHEN, steps: [[CHEN, MD("雲嘉南")], ["probe", CHEN, (ms) => (ms.length && ms.every((m) => m.type === "media" && m.region === ri("雲嘉南") && m.target == null) ? true : "第二顆應該只能放在雲嘉南：" + JSON.stringify(ms.slice(0, 3)))], [CHEN, MD("雲嘉南")]], want: { media: { "雲嘉南": [2, 0, 0] } } },
  { id: "chang_yung_fa", by: CHEN, steps: [[CHEN, MD("離島")]], want: { media: { "離島": [1, 0, 0] }, bag: [2, 0, 0] } },
  { id: "chang_doctors", by: SOONG, steps: [[SOONG, MD("桃竹苗")]], want: { media: { "桃竹苗": [0, 1, 0] }, bag: [0, 2, 0] } },
  { id: "advisory_group", by: CHEN, steps: [["probe", CHEN, (ms) => eq(ms.filter((m) => m.type === "media").map((m) => m.region).sort().join(), `${ri("北北基")},${ri("中彰投")}`, "國政顧問團可選的區")], [CHEN, MD("北北基")]], want: { issues: { clean: [1, 0, 0], econ: [1, 0, 0] }, media: { "北北基": [1, 0, 0] } } },
  { id: "party_assets_ads", by: LIEN, steps: [[LIEN, MD("雲嘉南")], ["probe", LIEN, (ms) => (ms.some((m) => m.region === ri("雲嘉南")) ? "第二區還能選雲嘉南" : true)], [LIEN, MD("高屏")]], want: { media: { "雲嘉南": [0, 0, 1], "高屏": [0, 0, 1] } } },
  { id: "massive_ads", by: LIEN, steps: [[LIEN, MD("北北基")], [LIEN, MD("桃竹苗")], [LIEN, MD("中彰投")]], want: { media: { "北北基": [0, 0, 1], "桃竹苗": [0, 0, 1], "中彰投": [0, 0, 1] } } },
  { id: "expel_soong", by: LIEN, arrange: (s) => { for (const r of ["桃竹苗", "雲嘉南", "宜花東"]) s.media[ri(r)][SOONG] = 1; }, steps: [
    ["probe", LIEN, (ms) => eq(ms.map((m) => `${m.type}:${m.region}:${m.target}`).sort().join(), [ri("桃竹苗"), ri("雲嘉南"), ri("宜花東")].map((r) => `media:${r}:1`).sort().join(), "開除宋楚瑜黨籍的選項（只能移除宋的媒體）")],
    [LIEN, MD("桃竹苗", SOONG)], [LIEN, MD("宜花東", SOONG)]], want: { media: { "桃竹苗": [0, -1, 0], "宜花東": [0, -1, 0] }, mom: [0, 1, 0] } },
]);

// Text order made observable: with an empty bag, the first check refills it (12 each) only if the
// placement comes before 「袋中 +1 宋方塊」. The other order leaves one 宋 cube in the bag, the check
// draws it and succeeds, and no refill happens.
c2("事件 · 文字順序：軍公教警先放方塊、最後才袋中 +1（袋子先清空，順序對時第一次檢定會重裝）（#4 裁決 1）", () => {
  if (typeof E.effectImplemented !== "function" || !E.effectImplemented("military_civil")) return "TODO: 軍公教警的效果還沒做（#4）";
  let st = D.giveCard(D.firstActor(SOONG), SOONG, "military_civil");
  st.bag = [0, 0, 0];
  st = D.act(st, SOONG, { type: "play", card: "military_civil", mode: "event" });
  st = D.act(st, SOONG, X("台北市"));
  st = D.act(st, SOONG, F("苗栗縣"));
  const total = st.bag.reduce((a, b) => a + b, 0);
  return total >= 35 ? ok(true, `袋子 ${st.bag.join("/")}：檢定前重裝過，宋的 +1 在最後`) : `袋子 ${st.bag.join("/")}：檢定時袋裡已經有宋的那一顆、沒有重裝，「袋中 +1」比放方塊先做了`;
});
const actionNext = (seat) => (st) => (D.has(st, seat, { type: "action", kind: "campaign" }) ? true : `效果之後 seat ${seat} 應該接著選 CP 行動`);
choiceGroup("事件 · 外力牌由受益的人選（陳的方塊由陳選）；TVBS 民調平手由出牌者選（§14.3；#4 裁決）", [
  { id: "zhu_rongji", by: SOONG, steps: [[CHEN, F("台南縣")], [CHEN, F("高雄市")], [CHEN, X("台北市")]], after: actionNext(SOONG), want: { cubes: { "台南縣": [1, 0, 0], "高雄市": [1, 0, 0], "台北市": [1, 0, 0] }, mom: [1, 0, 0] } },
  { id: "lee_secret_help", by: LIEN, steps: [[CHEN, F("台南縣")], [CHEN, F("高雄市")]], after: actionNext(LIEN), want: { cubes: { "台南縣": [1, 0, 0], "高雄市": [1, 0, 0] }, mom: [0, 0, -1] } },
  { id: "tvbs_poll", by: CHEN, arrange: (s) => { s.mom = [3, 1, 1]; }, steps: [["probe", CHEN, (ms) => eq(ms.filter((m) => m.type === "pick").map((m) => m.seat).sort().join(), "1,2", "宋連平手時陳的選項")], [CHEN, { type: "pick", seat: LIEN }]], after: actionNext(CHEN), want: { mom: [0, 0, 1] } },
  { id: "tvbs_poll", by: CHEN, arrange: (s) => { s.mom = [0, 2, 2]; }, steps: [], after: actionNext(CHEN), want: { mom: [1, 0, 0] } },
]);

choiceGroup("事件 · 觸發的事件由歸屬者選（陳把黨機器動員當 CP 出，連觸發後連選縣市）（§6.2）", [
  { id: "party_machine", by: CHEN, play: (st) => {
    st = D.act(st, CHEN, { type: "play", card: "party_machine", mode: "cp" });
    st = D.act(st, CHEN, { type: "action", kind: "campaign" });
    st = D.act(st, CHEN, { type: "done" });
    return D.act(st, LIEN, { type: "trigger" });
  }, steps: [[LIEN, F("台北縣")], [LIEN, F("桃園縣")], [LIEN, X("高雄市")]], want: { cubes: { "台北縣": [0, 0, 1], "桃園縣": [0, 0, 1], "高雄市": [0, 0, 1] }, mom: [0, 0, -1] } },
]);

const SIMPLE_V03 = [
  { id: "chang_chiu", by: CHEN, want: { bag: [3, 0, 0], mom: [1, 0, 0] } },
  { id: "provincial_build", by: SOONG, want: { econ: [0, 2, 0] } },
  { id: "econ_cabinet", by: LIEN, want: { econ: [0, 0, 1], bag: [0, 0, 2] } },
  { id: "kmt_anniversary", by: LIEN, want: { mom: [0, 0, 1], cross: [0, 0, 1] } },
  { id: "pla_drill_rumor", by: CHEN, want: { cross: [0, 1, 1], mom: [-1, 0, 0] } },
];
c2(`事件 · v0.3 新牌裡不需選擇的 ${SIMPLE_V03.length} 張（§14.3）`, () => {
  if (typeof E.effectImplemented !== "function") return "engine 沒有 export effectImplemented(id)";
  if (!SIMPLE_V03.some((s) => E.effectImplemented(s.id))) return `TODO: 這 ${SIMPLE_V03.length} 張的效果都還沒做（#4）`;
  const keys = ["mom", "bag", "cross", "clean", "econ"];
  const snap = (s) => ({ mom: s.mom.slice(), bag: s.bag.slice(), cross: D.issue(s, "cross").slice(), clean: D.issue(s, "clean").slice(), econ: D.issue(s, "econ").slice() });
  const bad = [];
  for (const { id, by, want } of SIMPLE_V03) {
    if (!E.effectImplemented(id)) { bad.push(`${id} 沒做`); continue; }
    let st = D.giveCard(D.firstActor(by), by, id);
    st.mom = [2, 2, 2]; st.bag = [5, 5, 5];
    for (const i of st.issues) i.cubes = [1, 1, 1];
    const a = snap(st);
    st = playEvent(st, by, id);
    const b = snap(st);
    const diff = keys.map((k) => `${k} ${b[k].map((x, p) => x - a[k][p]).join("/")}`).join("；");
    const exp = keys.map((k) => `${k} ${(want[k] || [0, 0, 0]).join("/")}`).join("；");
    if (diff !== exp) bad.push(`${id}：期望 ${exp}，實際 ${diff}`);
  }
  return bad.length ? bad.join("\n      ") : ok(true, `${SIMPLE_V03.length} 張的變化都照規則書`);
});
// ---- 興票案與「本回合」旗標（#5）
// Expectations come from §6.1, §14.3 and the rulings in issue #5: the must-play card resolves its CP
// action first and its event after (like a trigger, §6.2); 連 chooses the returned cubes; a 本回合
// card stays in st.active until the turn ends; 「本回合放方塊全部免檢定」 waives the same-camp checks
// only (Q6 default, after the design simulator).
const YANG = "yang_exposes";
const gate5 = (ids) => (typeof E.effectImplemented !== "function" ? "engine 沒有 export effectImplemented(id)"
  : ids.some((id) => E.effectImplemented(id)) ? null : `TODO: ${ids.join("、")} 的效果還沒做（#5）`);
const c5 = (name, ids, fn) => c2(name, () => gate5(ids) ?? fn());
const nextDecision = (st, seat) => D.playUntil(st, (s) => E.mustAct(s)[0] === seat && D.isPlayDecision(E.legalMoves(s, seat)), null, D.quiet);
const effectLeft = (st) => E.mustAct(st).flatMap((p) => E.legalMoves(st, p).filter((m) => EFFECT_TYPES.has(m.type)));
const setIssue = (st, name, cubes) => { st.issues.find((i) => i.name === name).cubes = cubes.slice(); };
// Move a card to the bottom of the early deck so the next deals do not reach it.
function park(st, id) {
  const deck = st.decks.early;
  for (const arr of [...st.hands, deck]) { const k = arr.indexOf(id); if (k >= 0) { [arr[k], deck[0]] = [deck[0], arr[k]]; return; } }
  throw new Error("找不到 " + id);
}
const yangRemovals = (st) => { for (const k of ["台北市", "台北市", "台北縣", "桃園縣"]) st = D.act(st, LIEN, RM(k, SOONG, "B")); return st; };
const YANG_WANT = { cubes: { "台北市": [0, -2, 0], "台北縣": [0, -1, 0], "桃園縣": [0, -1, 0] }, bag: [0, 4, 0], mom: [0, -2, 0], issues: { clean: [0, -3, 0] } };

c5("興票案 · 楊吉雄爆料由連自己打出：先做 CP 行動，再由連選 4 顆宋的盤上方塊退回袋中；宋清廉歸零、動能歸零；牌移出遊戲（§6.1、§14.3；#5 裁決）", [YANG], () => {
  let st = D.giveCard(D.firstActor(LIEN), LIEN, YANG);
  st.bag = [0, 10, 0]; st.mom = [2, 2, 2]; setIssue(st, "clean", [1, 3, 1]);
  const a = boardSnap(st);
  st = D.act(st, LIEN, { type: "play", card: YANG, mode: "event" });
  if (E.legalMoves(st, LIEN).some((m) => m.type === "remove")) return "CP 行動之前就問要退回哪些宋的方塊";
  st = D.act(st, LIEN, { type: "action", kind: "campaign" });
  st = D.act(st, LIEN, { type: "done" });
  if (!E.mustAct(st).includes(LIEN) || !E.legalMoves(st, LIEN).every((m) => m.type === "remove" && m.target === SOONG)) return "CP 行動之後應該由連選宋的方塊：" + JSON.stringify(E.legalMoves(st, LIEN).slice(0, 3));
  st = yangRemovals(st);
  if (effectLeft(st).length) return "退回 4 顆之後還有選擇：" + JSON.stringify(effectLeft(st).slice(0, 3));
  const r = eq(diffSnap(a, boardSnap(st)), expectStr(YANG_WANT), "爆料之後"); if (r !== true) return r;
  if (!st.removed.includes(YANG)) return "爆料打完沒有移出遊戲";
  return ok(true, "CP 之後連選 4 顆退回袋中；清廉宋歸零、動能歸零、移出遊戲");
});

c5("興票案 · 楊吉雄爆料由宋打出：宋先做 CP 行動，之後換連選 4 顆；連不花動能、沒有觸發或封鎖（§6.1）", [YANG], () => {
  let st = D.giveCard(D.firstActor(SOONG), SOONG, YANG);
  st.bag = [10, 0, 0]; st.mom = [2, 2, 2]; setIssue(st, "clean", [1, 3, 1]);
  const a = boardSnap(st);
  st = D.act(st, SOONG, { type: "play", card: YANG, mode: "event" });
  st = D.act(st, SOONG, { type: "action", kind: "campaign" });
  st = D.act(st, SOONG, { type: "done" });
  let r = eq(JSON.stringify(E.mustAct(st)), JSON.stringify([LIEN]), "宋的 CP 行動之後要動的席"); if (r !== true) return r;
  if (E.legalMoves(st, LIEN).some((m) => m.type === "trigger" || m.type === "pass")) return "必觸發牌還問連要不要觸發";
  st = yangRemovals(st);
  r = eq(diffSnap(a, boardSnap(st)), expectStr({ ...YANG_WANT, bag: [0, 4, 0] }), "宋打出爆料之後"); if (r !== true) return r;
  return ok(true, "宋做完 CP，連選 4 顆；連的動能沒動");
});

c5("興票案 · 授意說只在爆料出過後、說法反覆只在授意說出過後能當事件；授意說取回退回方塊的一半（捨去）放回藍營游離塊，說法反覆再退回 2 顆（§14.3）", ["lee_authorized", "shifting_story"], () => {
  const pre = D.giveCard(D.firstActor(SOONG), SOONG, "lee_authorized");
  let r = eq(modesOf(pre, SOONG, "lee_authorized"), "cp", "爆料出過之前宋手上的授意說"); if (r !== true) return r;
  // One turn: 連 first. Phase 1: 連 爆料, 陳, 宋 授意說. Phase 2: 陳, 宋, 連 說法反覆.
  let st = D.firstActor(LIEN);
  D.giveCard(st, LIEN, YANG, 0); D.giveCard(st, LIEN, "shifting_story", 1); D.giveCard(st, SOONG, "lee_authorized", 0);
  r = eq(modesOf(st, LIEN, "shifting_story"), "cp", "授意說出過之前連手上的說法反覆"); if (r !== true) return r;
  st.bag = [0, 10, 0];
  st = D.act(st, LIEN, { type: "play", card: YANG, mode: "event" });
  st = D.act(st, LIEN, { type: "action", kind: "campaign" });
  st = D.act(st, LIEN, { type: "done" });
  st = yangRemovals(st);
  st = nextDecision(st, SOONG);
  r = eq(modesOf(st, SOONG, "lee_authorized"), "cp,event", "爆料出過之後宋手上的授意說"); if (r !== true) return r;
  st.bag = [0, 10, 0];
  let a = boardSnap(st);
  st = D.act(st, SOONG, { type: "play", card: "lee_authorized", mode: "event" });
  const ms = E.legalMoves(st, SOONG);
  if (!ms.length || !ms.every((m) => m.type === "fill")) return "授意說只能放回藍營游離塊，選項卻有：" + [...new Set(ms.map((m) => m.type))].join(",");
  st = D.act(st, SOONG, F("台北市"));
  st = D.act(st, SOONG, F("台北縣"));
  if (effectLeft(st).length) return "授意說放回 2 顆之後還有選擇（爆料退回 4 顆，一半是 2）";
  r = eq(diffSnap(a, boardSnap(st)), expectStr({ cubes: { "台北市": [0, 1, 0], "台北縣": [0, 1, 0] }, bag: [0, -2, 0], issues: { clean: [0, 1, 0] } }), "授意說之後"); if (r !== true) return r;
  st = nextDecision(st, LIEN);
  r = eq(modesOf(st, LIEN, "shifting_story"), "cp,event", "授意說出過之後連手上的說法反覆"); if (r !== true) return r;
  a = boardSnap(st);
  st = D.act(st, LIEN, { type: "play", card: "shifting_story", mode: "event" });
  st = D.act(st, LIEN, RM("台北市", SOONG, "B"));
  st = D.act(st, LIEN, RM("桃園縣", SOONG, "B"));
  r = eq(diffSnap(a, boardSnap(st)), expectStr({ cubes: { "台北市": [0, -1, 0], "桃園縣": [0, -1, 0] }, bag: [0, 2, 0], mom: [0, 0, 1] }), "說法反覆之後"); if (r !== true) return r;
  return ok(true, "爆料退回 4 → 授意說取回 2 → 說法反覆再退回 2；條件沒到之前都只能當 CP");
});

c5("興票案 · 授意說取回「一半（捨去）」：爆料只退回 3 顆時，授意說放回 1 顆（§14.3）", ["lee_authorized"], () => {
  let st = D.firstActor(LIEN);
  D.giveCard(st, LIEN, YANG, 0); D.giveCard(st, SOONG, "lee_authorized", 0);
  // 宋在盤上只留台北市 3 顆：爆料最多退回 3。
  for (const c of st.counties) for (const b of c.blocks) if (b.o === SOONG) b.o = -1;
  st.counties[ci("台北市")].blocks.filter((b) => b.t === "B" && b.o < 0).slice(0, 3).forEach((b) => { b.o = SOONG; });
  st.bag = [0, 10, 0];
  st = D.act(st, LIEN, { type: "play", card: YANG, mode: "event" });
  st = D.act(st, LIEN, { type: "action", kind: "campaign" });
  st = D.act(st, LIEN, { type: "done" });
  for (let k = 0; k < 3; k++) st = D.act(st, LIEN, RM("台北市", SOONG, "B"));
  if (effectLeft(st).length) return "宋在盤上已經沒有方塊，爆料還在問要退回哪一顆";
  st = nextDecision(st, SOONG);
  st.bag = [0, 10, 0];
  const a = boardSnap(st);
  st = D.act(st, SOONG, { type: "play", card: "lee_authorized", mode: "event" });
  st = D.act(st, SOONG, F("台北縣"));
  if (effectLeft(st).length) return "退回 3 顆，授意說放了 1 顆之後還在問（一半捨去是 1）";
  const r = eq(diffSnap(a, boardSnap(st)), expectStr({ cubes: { "台北縣": [0, 1, 0] }, bag: [0, -1, 0], issues: { clean: [0, 1, 0] } }), "授意說之後"); if (r !== true) return r;
  return ok(true, "退回 3 → 放回 1");
});

c5("本回合 · 新中間路線：兩岸陳 +2；本回合外力事件不移除陳的方塊；牌留在 st.active 到回合結束才移出遊戲（§6.1、§14.3）", ["new_middle"], () => {
  let st = D.firstActor(CHEN);
  D.giveCard(st, CHEN, "new_middle"); D.giveCard(st, SOONG, "strait_tension");
  setIssue(st, "cross", [1, 1, 1]);
  st = D.act(st, CHEN, { type: "play", card: "new_middle", mode: "event" });
  let r = eq(D.issue(st, "cross").join(), "3,1,1", "新中間路線之後的兩岸"); if (r !== true) return r;
  if (!Array.isArray(st.active) || !st.active.includes("new_middle")) return "新中間路線沒有留在 st.active（本回合效果類的牌到回合結束才移出遊戲）";
  if (st.removed.includes("new_middle")) return "新中間路線在回合中就移出遊戲了";
  st = nextDecision(st, SOONG);
  st = D.act(st, SOONG, { type: "play", card: "strait_tension", mode: "event" });
  r = eq(D.issue(st, "cross").join(), "3,0,0", "同一回合宋打兩岸緊張之後（陳不扣）"); if (r !== true) return r;
  st = D.act(st, SOONG, { type: "action", kind: "campaign" });
  st = D.act(st, SOONG, { type: "done" });
  st = D.playUntil(st, (s) => s.turn === 2 && s.phase === "order", null, D.quiet);
  r = eq(`${st.active.length} ${st.removed.includes("new_middle")}`, "0 true", "第 2 回合開始時 active 的張數、新中間路線是否已移出遊戲"); if (r !== true) return r;
  return ok(true, "同回合兩岸緊張不扣陳；回合結束牌才移出遊戲");
});

c5("本回合 · 新中間路線只到回合結束：下一回合的兩岸緊張照常移除陳的方塊", ["new_middle"], () => {
  let st = D.giveCard(D.firstActor(CHEN), CHEN, "new_middle");
  park(st, "strait_tension");
  st = D.act(st, CHEN, { type: "play", card: "new_middle", mode: "event" });
  st = D.playUntil(st, (s) => s.turn === 2 && s.phase === "action" && E.mustAct(s).length > 0 && D.isPlayDecision(E.legalMoves(s, E.mustAct(s)[0])), null, D.quiet);
  const seat = E.mustAct(st)[0];
  D.giveCard(st, seat, "strait_tension");
  setIssue(st, "cross", [1, 1, 1]);
  st = D.act(st, seat, { type: "play", card: "strait_tension", mode: "event" });
  const r = eq(D.issue(st, "cross").join(), "0,0,0", "第 2 回合兩岸緊張之後"); if (r !== true) return r;
  return ok(true, `第 2 回合 seat ${seat} 打兩岸緊張，陳照常 −1`);
});

c5("本回合 · 李遠哲挺扁：陳動能 +2；本回合陳填同營免檢定、跨營照常檢定；下一回合恢復（§14.3；#5 裁決，Q6 預設）", ["lee_yuan_tseh"], () => {
  let st = D.giveCard(D.firstActor(CHEN, { startTurn: 7 }), CHEN, "lee_yuan_tseh");
  st.mom = [2, 2, 2];
  st = D.act(st, CHEN, { type: "play", card: "lee_yuan_tseh", mode: "event" });
  let r = eq(st.mom[CHEN], 4, "陳的動能（2 + 2）"); if (r !== true) return r;
  st = nextDecision(st, CHEN);
  st.bag = [0, 0, 10];
  let a = boardSnap(st);
  st = D.act(st, CHEN, { type: "candidate" });
  st = D.act(st, CHEN, { type: "action", kind: "campaign" });
  st = D.act(st, CHEN, { type: "move", to: ci("台北縣") });
  st = D.act(st, CHEN, F("台北縣"));
  st = D.act(st, CHEN, X("台北縣"));
  // 台北縣有宋連兩個樁腳主：填綠本來要檢定（現在免）；跨營照常檢定，袋中只有連 → 失敗。
  r = eq(diffSnap(a, boardSnap(st)), expectStr({ cubes: { "台北縣": [1, 0, 0] }, bag: [0, 0, -1], checks: 1 }), "李遠哲之後同一回合在台北縣 填綠＋跨營"); if (r !== true) return r;
  st = D.playUntil(st, (s) => s.turn === 8 && E.mustAct(s)[0] === CHEN && D.isPlayDecision(E.legalMoves(s, CHEN)), null, D.quiet);
  D.giveCard(st, CHEN, "dpp_counties");
  st.bag = [0, 0, 10];
  a = boardSnap(st);
  st = D.act(st, CHEN, { type: "play", card: "dpp_counties", mode: "cp" });
  st = D.act(st, CHEN, { type: "action", kind: "campaign" });
  // 第 7 回合陳停在台北縣（最後一個操作的縣市）；已經在那裡就不用移動（移到自己所在的縣市不是合法動作）。
  if (st.pos[CHEN] !== ci("台北縣")) st = D.act(st, CHEN, { type: "move", to: ci("台北縣") });
  st = D.act(st, CHEN, F("台北縣"));
  r = eq(diffSnap(a, boardSnap(st)), expectStr({ bag: [0, 0, -1], checks: 1 }), "第 8 回合在台北縣填綠（旗標已過）"); if (r !== true) return r;
  return ok(true, "同一回合填綠免檢定、跨營照常；下一回合恢復檢定");
});

c5("本回合 · 走透透：本回合宋填同營免檢定、跨營照常檢定（§14.3；#5 裁決，Q6 預設）", ["walk_everywhere"], () => {
  let st = D.giveCard(D.firstActor(SOONG), SOONG, "walk_everywhere");
  st = D.act(st, SOONG, { type: "play", card: "walk_everywhere", mode: "event" });
  st = nextDecision(st, SOONG);
  st.bag = [10, 0, 0];
  const a = boardSnap(st);
  st = D.act(st, SOONG, { type: "candidate" });
  st = D.act(st, SOONG, { type: "action", kind: "campaign" });
  st = D.act(st, SOONG, { type: "move", to: ci("台北縣") });
  st = D.act(st, SOONG, F("台北縣"));
  st = D.act(st, SOONG, X("台北縣"));
  // 台北縣連 4 顆是樁腳主：填藍本來要檢定（現在免）；跨營照常檢定，袋中只有陳 → 失敗。
  const r = eq(diffSnap(a, boardSnap(st)), expectStr({ cubes: { "台北縣": [0, 1, 0] }, bag: [-1, 0, 0], checks: 1 }), "走透透之後同一回合在台北縣 填藍＋跨營"); if (r !== true) return r;
  return ok(true, "填藍免檢定、跨營照常");
});

c5("本回合 · 張昭雄搭檔：本回合宋的跨營填前 2 顆免檢定，第 3 顆照常（§14.3）", ["chang_running_mate"], () => {
  let st = D.giveCard(D.firstActor(SOONG), SOONG, "chang_running_mate");
  st = D.act(st, SOONG, { type: "play", card: "chang_running_mate", mode: "event" });
  st = nextDecision(st, SOONG);
  st.bag = [10, 0, 0];
  const a = boardSnap(st);
  st = D.act(st, SOONG, { type: "candidate" });
  st = D.act(st, SOONG, { type: "action", kind: "campaign" });
  st = D.act(st, SOONG, { type: "move", to: ci("台北縣") });
  for (let k = 0; k < 3; k++) st = D.act(st, SOONG, X("台北縣"));
  const r = eq(diffSnap(a, boardSnap(st)), expectStr({ cubes: { "台北縣": [0, 2, 0] }, bag: [-1, 0, 0], checks: 1 }), "張昭雄搭檔之後跨營填 3 次"); if (r !== true) return r;
  return ok(true, "前 2 顆免檢定，第 3 顆檢定失敗");
});

c5("本回合 · 省府舊部：中彰投媒體宋 +1；本回合連的休息方塊加成無效，下一回合恢復（§6.4、§14.3）", ["provincial_staff"], () => {
  const [l0, l1] = C.localCards().filter((c) => c.cp === 2 && c.deck === "early").map((c) => c.id);
  let st = D.giveCard(D.firstActor(SOONG), SOONG, "provincial_staff");
  D.giveCard(st, LIEN, l0, 0);
  const a = boardSnap(st);
  st = D.act(st, SOONG, { type: "play", card: "provincial_staff", mode: "event" });
  let r = eq(diffSnap(a, boardSnap(st)), expectStr({ media: { "中彰投": [0, 1, 0] } }), "省府舊部之後"); if (r !== true) return r;
  st = nextDecision(st, LIEN);
  let rest0 = st.rest[LIEN];
  st = cpDone(st, LIEN, l0);
  r = eq(st.rest[LIEN] - rest0, 2, `同一回合連打 2 CP 的 ${l0}（加成無效：2，不是 3）`); if (r !== true) return r;
  st = D.playUntil(st, (s) => s.turn === 2 && E.mustAct(s)[0] === LIEN && D.isPlayDecision(E.legalMoves(s, LIEN)), null, D.quiet);
  D.giveCard(st, LIEN, l1);
  rest0 = st.rest[LIEN];
  st = cpDone(st, LIEN, l1);
  r = eq(st.rest[LIEN] - rest0, 3, `第 2 回合連打 2 CP 的 ${l1}（加成恢復）`); if (r !== true) return r;
  return ok(true, "媒體 +1；同回合連 2 CP 牌休息 2，下一回合 3");
});
check("事件 · 70 張的效果都做了（最後 8 張是興票案與本回合旗標，#5）", () => {
  if (typeof E.effectImplemented !== "function") return "engine 沒有 export effectImplemented(id)";
  const missing = C.EVENTS.filter((e) => !E.effectImplemented(e.id)).map((e) => e.id);
  const last8 = ["yang_exposes", "lee_authorized", "shifting_story", "new_middle", "lee_yuan_tseh", "walk_everywhere", "chang_running_mate", "provincial_staff"];
  if (!last8.some((id) => E.effectImplemented(id))) return `TODO: 事件效果已實作 ${C.EVENTS.length - missing.length}/${C.EVENTS.length}（#5）`;
  return missing.length ? "還沒做的效果：" + missing.join(",") : ok(true, `${C.EVENTS.length} 張全部做了`);
});
// ---- 政見發表會與第一段棄保（#6）
const c6 = (name, fn) => c2(name, () => (DEBATE_READY ? fn() : "TODO: 政見發表會還沒做（#6）"));
// Put exactly these five cards into a seat's debate pile, swapping each in from wherever it is.
function setPile(st, seat, ids) {
  const pile = st.savedDebate[seat];
  ids.forEach((id, k) => {
    if (pile[k] === id) return;
    const spots = [st.decks.early, st.decks.late, st.decks.discard, ...st.hands, ...st.savedDebate];
    for (const arr of spots) {
      const j = arr.indexOf(id);
      if (j >= 0) { [arr[j], pile[k]] = [pile[k], arr[j]]; return; }
    }
    throw new Error(`找不到 ${id}（移出遊戲了？）`);
  });
}
function clearBoard(st) { for (const c of st.counties) for (const b of c.blocks) b.o = -1; }
function setCounty(st, name, cubes) {   // cubes: { G: [p, …], B: [p, …] } in block order
  const bl = st.counties[ci(name)].blocks;
  for (const t of ["G", "B", "N"]) { const want = (cubes[t] || []).slice(); for (const b of bl) if (b.t === t) b.o = want.length ? want.shift() : -1; }
}
const reveal = (st, seat, card, issue) => D.act(st, seat, issue ? { type: "reveal", card, issue } : { type: "reveal", card });
// One round: each [seat, card, issue?] in the order given (the reveal is simultaneous; order must not matter).
const round = (st, plays) => { for (const [seat, card, issue] of plays) st = reveal(st, seat, card, issue || C.EVENTS.find((e) => e.id === card)?.icon); return st; };
const LOCAL3 = C.localCards().find((c) => c.cp === 3 && c.deck === "early").id;
const cubesOf = (st) => Object.fromEntries(B.COUNTIES.map((c, k) => [c[0], [0, 1, 2].map((p) => st.counties[k].blocks.filter((b) => b.o === p).length)]).filter(([, v]) => v.some(Boolean)));
const cubesStr = (o) => Object.keys(o).sort().map((k) => `${k} ${o[k].join("/")}`).join("；") || "全空";
function debateScene(st) {
  clearBoard(st);
  setCounty(st, "台中縣", { G: [CHEN], B: [SOONG, SOONG, SOONG, LIEN] });   // 藍空 2：宋 3 連 1 差 2 → 一半 1 流向宋；綠空 1 → 一半 0
  setCounty(st, "高雄市", { G: [CHEN, CHEN], B: [SOONG, SOONG, LIEN] });    // 綠空 2 → 一半 1 流向陳；藍差 1 → 不流
  setCounty(st, "台北市", { B: [SOONG, SOONG, SOONG, SOONG, LIEN] });       // 藍空 5：宋 4 連 1 → 一半 2 流向宋；陳 0 → 綠不流
  setCounty(st, "屏東縣", {});                                              // 陳 0：綠空 2 不流；藍 0/0 不流
  const want = { "台中縣": [1, 4, 1], "高雄市": [3, 2, 1], "台北市": [0, 6, 1] };
  return want;
}

c6("政見發表會 · 第 5 回合留牌後進第 6 回合：三人同時從自己的政見發表會堆選一張翻；有圖示的牌只能放在該議題，地方牌可選議題（§九）", () => {
  const st = toDebate();
  let r = eq(`${st.turn} ${st.phase} ${JSON.stringify(E.mustAct(st))}`, "6 debate [0,1,2]", "第 6 回合開始"); if (r !== true) return r;
  for (const s of [0, 1, 2]) {
    const pile = st.savedDebate[s], ms = E.legalMoves(st, s).filter((m) => m.type === "reveal");
    const want = pile.map((id) => (C.EVENTS.find((e) => e.id === id) ? 1 : 3)).reduce((a, b) => a + b, 0);
    r = eq(ms.length, want, `seat ${s} 的翻牌選項數（堆裡 ${pile.length} 張；地方牌 3 個議題、其他 1 個）`); if (r !== true) return r;
    const bad = ms.filter((m) => { const e = C.EVENTS.find((x) => x.id === m.card); return !pile.includes(m.card) || (e && m.issue !== e.icon); });
    if (bad.length) return `seat ${s} 的翻牌選項不對：${JSON.stringify(bad.slice(0, 3))}`;
  }
  return ok(true, "三人同時翻牌；有圖示放自己的議題，地方牌三選一");
});

c6("政見發表會 · 同時翻牌：一人選好之後，別人的 view 看不到他選了哪張（§九）", () => {
  let st = toDebate();
  const card = st.savedDebate[CHEN][0];
  const before = JSON.stringify({ ...E.view(st, SOONG), cards: null });
  const m = E.legalMoves(st, CHEN).find((x) => x.type === "reveal" && x.card === card);
  st = E.apply(st, CHEN, m);
  const after = JSON.stringify({ ...E.view(st, SOONG), cards: null });
  if (after.includes(JSON.stringify(card)) && !before.includes(JSON.stringify(card))) return `陳選了 ${card}，宋的 view 看得到`;
  const r = eq(JSON.stringify(E.mustAct(st)), "[1,2]", "陳選好之後還要選的席"); if (r !== true) return r;
  return ok(true, "選好的牌在三人都選完之前不露出");
});

c6("政見發表會 · 情境 A：同一輪兩個議題到 2 張時照原軌道順序結算（2、3 顆）；平手由主動權持有者優先；翻到已結算議題的牌沒有效果；結算完 4 顆；議題依結算順序回到最低的空槽，方塊保留；之後第一段棄保動一半（§九、§十一）", () => {
  let st = toDebate();
  setPile(st, CHEN, ["dpp_counties", "lu_running_mate", "future_resolution", "taiwan_son", "alternation"]);
  setPile(st, SOONG, ["diligent", "hakka_vote", "poll_lead", "veterans_village", "million_signatures"]);
  setPile(st, LIEN, ["stability", "lee_campaigns", "ma_campaigns", LOCAL3, "party_machine"]);
  st.initiative = SOONG;   // 平手順序：宋 → 連 → 陳
  const byName = Object.fromEntries(st.issues.map((i) => [i.name, i]));
  st.issues = ["cross", "clean", "econ"].map((n) => byName[n]);
  setIssue(st, "cross", [1, 0, 0]); setIssue(st, "clean", [0, 2, 0]); setIssue(st, "econ", [0, 0, 3]);
  const want = debateScene(st);
  const mom0 = st.mom.slice();
  // 第 1 輪：經濟 陳 4、宋 4；兩岸 連 3
  st = round(st, [[CHEN, "dpp_counties"], [SOONG, "diligent"], [LIEN, "stability"]]);
  if (E.legalMoves(st, CHEN).some((m) => m.type === "fill" || m.type === "cross")) return "第 1 輪沒有人有 2 張，卻開始放方塊";
  // 第 2 輪：經濟 陳 2、宋 2（6 比 6）；兩岸 連 3（6）→ 兩岸先結算（原軌道第一）連放 2；經濟平手由宋（持有者）放 3
  st = round(st, [[CHEN, "lu_running_mate"], [SOONG, "hakka_vote"], [LIEN, "lee_campaigns"]]);
  let r = eq(JSON.stringify(E.mustAct(st)), JSON.stringify([LIEN]), "第 2 輪之後先放方塊的人（兩岸在原軌道第一）"); if (r !== true) return r;
  st = D.act(st, LIEN, F("新竹市")); st = D.act(st, LIEN, F("新竹市"));
  r = eq(JSON.stringify(E.mustAct(st)), JSON.stringify([SOONG]), "接著放方塊的人（經濟 6 比 6，持有者宋優先）"); if (r !== true) return r;
  for (let k = 0; k < 3; k++) st = D.act(st, SOONG, F("苗栗縣"));
  // 第 3 輪：陳的台灣前途決議文（兩岸，已結算 → 沒有效果）；清廉 宋 2、連 2
  st = round(st, [[CHEN, "future_resolution"], [SOONG, "poll_lead"], [LIEN, "ma_campaigns"]]);
  // 第 4 輪：清廉 陳 3；宋的外省眷村（兩岸，已結算）；連的地方牌只能選清廉（兩岸、經濟都結算了）→ 連 2 張 2+3 = 5 → 連放 4
  const opts = E.legalMoves(st, LIEN).filter((m) => m.type === "reveal" && m.card === LOCAL3).map((m) => m.issue).join();
  r = eq(opts, "clean", "第 4 輪連的地方牌可選的議題"); if (r !== true) return r;
  st = round(st, [[CHEN, "taiwan_son"], [SOONG, "veterans_village"], [LIEN, LOCAL3, "clean"]]);
  r = eq(JSON.stringify(E.mustAct(st)), JSON.stringify([LIEN]), "第 4 輪之後放方塊的人（清廉 陳 3、宋 2、連 5）"); if (r !== true) return r;
  for (const k of ["澎湖縣", "金馬", "台東縣", "新竹縣"]) st = D.act(st, LIEN, F(k));
  // 三個議題都結算了 → 發表會結束、第一段棄保、進第 7 回合
  r = eq(`${st.turn} ${st.phase}`, "7 order", "三個議題都結算之後"); if (r !== true) return r;
  r = eq(st.issues.map((i) => `${i.name}=${i.cubes.join("/")}`).join(" "), "clean=0/2/0 econ=0/0/3 cross=1/0/0", "議題軌道（清廉第三個結算 → 第一槽）"); if (r !== true) return r;
  r = eq(st.mom.map((x, p) => x - mom0[p]).join(), "0,1,2", "動能變化（每個議題的贏家 +1）"); if (r !== true) return r;
  const expect = { ...want, "新竹市": [0, 0, 2], "苗栗縣": [0, 3, 0], "澎湖縣": [0, 0, 1], "金馬": [0, 0, 1], "台東縣": [0, 0, 1], "新竹縣": [0, 0, 1] };
  r = eq(cubesStr(cubesOf(st)), cubesStr(expect), "第一段棄保之後的盤面"); if (r !== true) return r;
  return ok(true, "兩岸 → 連 2、經濟（平手）→ 宋 3、清廉 → 連 4；軌道 清廉/經濟/兩岸；棄保一半：台中縣宋 +1、高雄市陳 +1、台北市宋 +2");
});

c6("政見發表會 · 情境 B：平手時從持有者順時針比（宋持有，陳連平手 → 連）；牌出完時沒結算的議題依原軌道順序給 CP 總和最高者（0 比 0 比 0 也照主動權順序）（§九）", () => {
  let st = toDebate();
  setPile(st, CHEN, ["dpp_counties", "lu_running_mate", "hsieh_kaohsiung", "three_three_three", "no_nuke4"]);
  setPile(st, SOONG, ["hakka_vote", "east_coast", "diligent", "quake_bond", "provincial_build"]);
  setPile(st, LIEN, ["party_machine", "farmers_association", "lien_siew", "hand_in_hand", "local_factions"]);
  st.initiative = SOONG;
  const byName = Object.fromEntries(st.issues.map((i) => [i.name, i]));
  st.issues = ["cross", "clean", "econ"].map((n) => byName[n]);
  const want = debateScene(st);
  const mom0 = st.mom.slice();
  st = round(st, [[CHEN, "dpp_counties"], [SOONG, "hakka_vote"], [LIEN, "party_machine"]]);
  // 第 2 輪：經濟 陳 4+2、宋 2+2、連 4+2 → 陳連 6 平手，持有者宋之後順時針是連 → 連放 2
  st = round(st, [[CHEN, "lu_running_mate"], [SOONG, "east_coast"], [LIEN, "farmers_association"]]);
  let r = eq(JSON.stringify(E.mustAct(st)), JSON.stringify([LIEN]), "經濟 陳 6、宋 4、連 6 之後放方塊的人"); if (r !== true) return r;
  st = D.act(st, LIEN, F("新竹市")); st = D.act(st, LIEN, F("新竹市"));
  // 第 3–5 輪全是經濟（已結算）→ 沒有效果
  st = round(st, [[CHEN, "hsieh_kaohsiung"], [SOONG, "diligent"], [LIEN, "lien_siew"]]);
  st = round(st, [[CHEN, "three_three_three"], [SOONG, "quake_bond"], [LIEN, "hand_in_hand"]]);
  st = round(st, [[CHEN, "no_nuke4"], [SOONG, "provincial_build"], [LIEN, "local_factions"]]);
  // 牌出完：兩岸（原軌道第一）0/0/0 → 持有者宋放 3；清廉 0/0/0 → 宋放 4
  r = eq(JSON.stringify(E.mustAct(st)), JSON.stringify([SOONG]), "牌出完後放兩岸那 3 顆的人"); if (r !== true) return r;
  for (let k = 0; k < 3; k++) st = D.act(st, SOONG, F("苗栗縣"));
  r = eq(JSON.stringify(E.mustAct(st)), JSON.stringify([SOONG]), "接著放清廉那 4 顆的人"); if (r !== true) return r;
  for (const k of ["澎湖縣", "金馬", "台東縣", "新竹縣"]) st = D.act(st, SOONG, F(k));
  r = eq(`${st.turn} ${st.phase}`, "7 order", "發表會結束之後"); if (r !== true) return r;
  r = eq(st.issues.map((i) => i.name).join(), "clean,cross,econ", "議題軌道（經濟第一個結算 → 第三槽）"); if (r !== true) return r;
  r = eq(st.mom.map((x, p) => x - mom0[p]).join(), "0,2,1", "動能變化"); if (r !== true) return r;
  const expect = { ...want, "新竹市": [0, 0, 2], "苗栗縣": [0, 3, 0], "澎湖縣": [0, 1, 0], "金馬": [0, 1, 0], "台東縣": [0, 1, 0], "新竹縣": [0, 1, 0] };
  r = eq(cubesStr(cubesOf(st)), cubesStr(expect), "第一段棄保之後的盤面"); if (r !== true) return r;
  return ok(true, "陳連平手 → 連；沒人出牌的兩岸、清廉給持有者宋；軌道 清廉/兩岸/經濟");
});

c6("政見發表會 · 情境 C：同一輪兩個議題到 2 張時的順序來自發表會開始時的軌道，不是議題的固定順序（軌道 經濟/清廉/兩岸 → 經濟先結算）（§九）", () => {
  let st = toDebate();
  setPile(st, CHEN, ["dpp_counties", "lu_running_mate", "taiwan_son", "alternation", "future_resolution"]);
  setPile(st, SOONG, ["poll_lead", "hakka_vote", "diligent", "million_signatures", "veterans_village"]);
  setPile(st, LIEN, ["stability", "lee_campaigns", "ma_campaigns", "party_machine", LOCAL3]);
  const byName = Object.fromEntries(st.issues.map((i) => [i.name, i]));
  st.issues = ["econ", "clean", "cross"].map((n) => byName[n]);
  st = round(st, [[CHEN, "dpp_counties"], [SOONG, "poll_lead"], [LIEN, "stability"]]);
  // 第 2 輪：經濟 陳 4+2、宋 2；兩岸 連 3+3 → 兩個議題都到 2 張；軌道上經濟在第一槽 → 陳先放 2 顆，連再放 3 顆
  st = round(st, [[CHEN, "lu_running_mate"], [SOONG, "hakka_vote"], [LIEN, "lee_campaigns"]]);
  let r = eq(JSON.stringify(E.mustAct(st)), JSON.stringify([CHEN]), "第 2 輪之後先放方塊的人（經濟在軌道第一）"); if (r !== true) return r;
  for (let k = 0; k < 2; k++) st = E.apply(st, CHEN, E.legalMoves(st, CHEN)[0]);
  r = eq(JSON.stringify(E.mustAct(st)), JSON.stringify([LIEN]), "陳放完 2 顆之後（接著是兩岸的連）"); if (r !== true) return r;
  r = eq(E.legalMoves(st, LIEN).every((m) => m.type === "fill" || m.type === "cross"), true, "連的選項都是放方塊"); if (r !== true) return r;
  return ok(true, "軌道 經濟/清廉/兩岸：經濟（陳）先、兩岸（連）後");
});

c6("政見發表會 · 發表會的牌全部進前期棄牌堆；第 6 回合結束時前期牌放到一旁（decks.earlyDiscard），第 7 回合的棄牌堆是空的（§14.1）", () => {
  let st = toDebate();
  const debateCards = st.savedDebate.flat();
  let r = nonEmpty(debateCards.length, "政見發表會堆裡的牌"); if (r !== true) return r;
  st = D.playUntil(st, (s) => s.turn === 7 && s.phase === "order", D.rng(5), null);
  if (!Array.isArray(st.decks.earlyDiscard)) return "state 沒有 decks.earlyDiscard（第 6 回合結束時放到一旁的前期棄牌堆）";
  const missing = debateCards.filter((id) => !st.decks.earlyDiscard.includes(id));
  if (missing.length) return "發表會的牌沒有進前期棄牌堆：" + missing.join(",");
  r = eq(`${st.decks.discard.length} ${st.savedDebate.flat().length} ${st.hands.map((h) => h.length).join("/")}`, "0 0 6/6/6", "第 7 回合開始 棄牌堆、政見發表會堆、手牌"); if (r !== true) return r;
  const c = D.conservation(st); if (c !== true) return c;
  return ok(true, `${debateCards.length} 張發表會的牌都在前期棄牌堆；第 7 回合棄牌堆 0`);
});

c6("牌庫 · 後期不夠發時先洗後期棄牌堆，還不夠再洗前期放一旁的棄牌堆（§14.1 的保險）", () => {
  let st = toDebate();
  st = D.playUntil(st, (s) => s.turn === 7 && s.phase === "save", D.rng(6), (s, seat, ms) => (s.phase === "debate" ? ms[0] : D.quiet(s, seat, ms)));
  // 讓第 8 回合不夠發：後期牌庫抽掉 15 張（移出遊戲），只剩 3 張＋後期棄牌堆
  const pulled = st.decks.late.splice(0, 15); st.removed.push(...pulled);
  const latePool = st.decks.late.length + st.decks.discard.length + st.hands.reduce((a, h) => a + Math.max(0, h.length - 2), 0);
  const early0 = st.decks.earlyDiscard.length;
  for (const s of [0, 1, 2]) if (E.mustAct(st).includes(s)) st = D.act(st, s, { type: "save" });
  let r = eq(`${st.turn} ${st.phase} ${st.hands.map((h) => h.length).join("/")}`, "8 order 6/6/6", "第 8 回合開始"); if (r !== true) return r;
  const earlyInHand = st.hands.flat().filter((id) => DECK_OF[id] === "early").length;
  if (latePool >= 18) return `佈置失敗：後期還有 ${latePool} 張可發，測不到前期的保險`;
  r = eq(`${earlyInHand > 0} ${early0 - st.decks.earlyDiscard.length >= 18 - latePool}`, "true true", "手上有前期牌、前期棄牌堆少了至少差額"); if (r !== true) return r;
  const c = D.conservation(st); if (c !== true) return c;
  return ok(true, `後期只有 ${latePool} 張，從前期放一旁的棄牌堆補到 18`);
});

c6("行動階段 · 沒牌又已出過候選人牌的人跳過那一個階段，不卡住（§14.1）", () => {
  let st = D.firstActor(CHEN);
  st.decks.early.push(...st.hands[SOONG].splice(0)); st.candidateUsed[SOONG] = true;
  st = D.act(st, CHEN, { type: "candidate" }); st = D.act(st, CHEN, { type: "action", kind: "campaign" }); st = D.act(st, CHEN, { type: "done" });
  let r = eq(JSON.stringify(E.mustAct(st)), JSON.stringify([LIEN]), "陳出完之後（宋沒牌、候選人牌用過）要動的人"); if (r !== true) return r;
  st = D.playUntil(st, (s) => s.phase === "save", D.rng(8), null);
  // 留牌階段：宋手上沒牌，也跳過（不是給他一個「留 0 張」的動作）
  if (E.mustAct(st).includes(SOONG) || E.legalMoves(st, SOONG).length) return "留牌階段宋手上沒牌，卻還要他動：" + JSON.stringify(E.legalMoves(st, SOONG));
  st = D.playUntil(st, (s) => s.phase === "order" && s.turn === 2, D.rng(9), null);
  const c = D.conservation(st); if (c !== true) return c;
  return ok(true, "宋每個行動階段與留牌階段都被跳過，回合照常走完");
});
check("棄保 · 第二段（投票日，動全部游離塊）", () => "TODO: §十一、§十二（#7）");
check("投票日七步", () => "TODO: §十二");

// ---- 引擎約定：fuzz、重放、view（M1）
function fuzz(label, seeds, opts, end) {
  let steps = 0, nChecks = 0, unimpl = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    let st = E.createGame(seed, opts);
    const R = D.rng(seed * 7919);
    let n = 0;
    for (; n < 5000 && st.phase !== end; n++) {
      const seats = E.mustAct(st);
      const where = `${label} seed ${seed} 第 ${st.turn} 回合 ${st.phase}`;
      if (!seats.length) return `${where}：沒有人要動（卡住）`;
      for (const s of seats) if (!E.legalMoves(st, s).length) return `${where}：seat ${s} 要動卻沒有合法動作`;
      const seat = seats[Math.floor(R() * seats.length)], ms = E.legalMoves(st, seat), m = ms[Math.floor(R() * ms.length)];
      if (st.phase === "order") {
        // A full deal (5 early, 6 late) unless every card is out. v0.3 never runs a
        // deck dry in normal play; the reshuffle rule stays as insurance.
        const deck = st.turn <= 5 ? st.decks.early : st.decks.late, deal = st.turn <= 5 ? 5 : 6;
        if (st.hands.some((h) => h.length > deal) || (st.hands.some((h) => h.length < deal) && (deck.length || st.decks.discard.length))) return `${where}：手牌 ${st.hands.map((h) => h.length).join("/")}（牌庫還有 ${deck.length}、棄牌堆 ${st.decks.discard.length}）`;
        const c = D.conservation(st); if (c !== true) return `${where}：${c}`;
      }
      if (D.isPlayDecision(ms)) { const c = D.conservation(st); if (c !== true) return `${where} 出牌前：${c}`; }
      if (st.phase === "save" && st.hands.some((h) => h.some((id) => MUST.has(id)))) return `${where}：必觸發牌留到了留牌階段`;
      try { st = E.apply(st, seat, m); } catch (e) { return `${where}：apply ${JSON.stringify(m)} 丟錯：${e.message}`; }
      const inv = D.invariants(st); if (inv !== true) return `${where}，${JSON.stringify(m)} 之後：${inv}`;
    }
    if (st.phase !== end) return `${label} seed ${seed}：5000 步還沒走到 ${end}（停在第 ${st.turn} 回合 ${st.phase}）`;
    if (E.mustAct(st).length) return `${label} seed ${seed}：停在 ${end} 卻還有人要動`;
    steps += n; nChecks += D.checks(st);
    unimpl += st.log.filter((e) => e.t === "effect" && e.unimplemented).length;
  }
  return ok(true, `${seeds} 局、${steps} 步、支持檢定 ${nChecks} 次、效果未實作而跳過的事件 ${unimpl} 次`);
}
c2("fuzz · 隨機合法動作從第 1 回合走（政見發表會做好之後一路走到投票日之前）：不丟錯、不卡、盤面與牌守恆（M1）", () => (DEBATE_READY ? fuzz("1–8", 25, undefined, "election") : fuzz("1–5", 25, undefined, "debate")));
c2("fuzz · 隨機合法動作走完第 7–8 回合（startTurn 7）（M1）", () => fuzz("7–8", 25, { startTurn: 7 }, "election"));
check("fuzz · 隨機合法動作走完 9 回合", () => "TODO: 政見發表會、棄保、投票日之後（M1 收尾）");
c2("約定 · 可重放：同種子、同一串動作走到同一個狀態；apply 不改傳入的狀態", () => {
  const R = D.rng(4242);
  let st = E.createGame(21);
  const moves = [];
  for (let n = 0; n < 5000 && st.phase !== "debate"; n++) {
    const seat = E.mustAct(st)[0], ms = E.legalMoves(st, seat), m = ms[Math.floor(R() * ms.length)];
    const before = JSON.stringify(st);
    const next = E.apply(st, seat, m);
    if (JSON.stringify(st) !== before) return `第 ${n} 步 apply 改了傳入的狀態（${JSON.stringify(m)}）`;
    moves.push([seat, m]); st = next;
  }
  let re = E.createGame(21);
  for (const [seat, m] of moves) re = E.apply(re, seat, m);
  const r = eq(JSON.stringify(re) === JSON.stringify(st), true, `重放 ${moves.length} 步之後相同`); if (r !== true) return r;
  return ok(true, `${moves.length} 步，重放相同，傳入狀態沒被改`);
});
c2("約定 · 不合法的動作丟錯：不是你的回合、手上沒有的牌、不在區域內", () => {
  const st = D.firstActor(CHEN);
  const throws = (f) => { try { f(); return false; } catch { return true; } };
  const m = E.legalMoves(st, CHEN).find((x) => x.type === "play");
  if (!throws(() => E.apply(st, SOONG, m))) return "宋拿陳的合法動作去 apply 沒有丟錯";
  if (!throws(() => E.apply(st, CHEN, { type: "play", card: st.hands[SOONG][0], mode: "cp" }))) return "陳打宋手上的牌沒有丟錯";
  let c = D.act(st, CHEN, { type: "candidate" });
  c = D.act(c, CHEN, { type: "action", kind: "campaign" });
  if (!throws(() => E.apply(c, CHEN, { type: "fill", county: ci("桃園縣") }))) return "沒移動就在桃園縣填沒有丟錯";
  return ok(true, "三種都丟錯");
});
c2("約定 · view：留牌之後看不到別人留了哪張（§5.4 面朝下）", () => {
  let st = D.playUntil(D.firstActor(CHEN), (s) => s.phase === "save", null, D.quiet);
  const strip = (v) => JSON.stringify({ ...v, cards: null });
  const before = strip(E.view(st, CHEN));
  for (const s of [0, 1, 2]) st = D.act(st, s, { type: "save" });
  const v = E.view(st, CHEN), after = strip(v);
  const hidden = [...st.savedDebate[SOONG], ...st.savedDebate[LIEN]];
  let r = nonEmpty(hidden.length, "宋連留的牌"); if (r !== true) return r;
  const leak = hidden.filter((id) => after.includes(JSON.stringify(id)) && !before.includes(JSON.stringify(id)));
  if (leak.length) return "陳的 view 裡看得到宋連留的牌：" + leak.join(",");
  r = eq(JSON.stringify(v.savedDebate), JSON.stringify([st.savedDebate[CHEN], 1, 1]), "陳 view 的政見發表會堆"); if (r !== true) return r;
  return ok(true, `宋連留的 ${hidden.length} 張不在陳的 view 裡；自己的看得到`);
});

// ---------------------------------------------------------------- report
test("acceptance", () => {
  const s = summary();
  for (const p of R.pass) console.log(`  ✓ ${p.label}${p.msg ? " — " + p.msg : ""}`);
  for (const t of s.todos) console.log(`  … ${t.label} — ${t.msg}`);
  for (const f of s.failures) console.log(`  ✗ ${f.label} — ${f.msg}`);
  console.log(`  通過 ${s.pass} / 失敗 ${s.fail} / 尚未實作 ${s.todo}`);
  assert.equal(s.fail, 0, s.failures.map((f) => `${f.label}: ${f.msg}`).join("\n"));
});
