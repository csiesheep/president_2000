// The 111 cards as data: 70 events (rulebook v0.3 §14.3; the nine media cards as v0.4, #34) and 41 local cards
// (§14.2). Chinese card text lives here; the writer edits it as a cross-owner
// change (TEAM.md). Effects are keyed by id and implemented in engine.js
// (M1); a card without an entry there is data only (effectImplemented false).
// v0.3 (#2) added 10 early events, marked "v0.3" below; their effects are a
// later issue. Existing ids never change or get renumbered.
//
// owner: chen | soong | lien | ext (外力)   deck: early (第 1–5 回合) | late (第 7–8)
// icon: cross 兩岸 | clean 清廉 | econ 經濟民生
// must: 必觸發 (anyone playing it fires it; the holder must play it the turn it is drawn)
// cond: playable as an event only after that card was played
// turnMax / lawful: 民調領先 (turns 1–3) / 法定競選期 (turn 8)

export const EVENTS = [
  // 陳水扁 (20)
  { id: "taiwan_son", owner: "chen", deck: "early", cp: 3, icon: "clean", name: "台灣之子", county: "雲林縣", text: "陳在雲嘉南或高屏任 3 個縣市各 +1 免檢定" },
  { id: "new_middle", owner: "chen", deck: "early", cp: 3, icon: "cross", name: "新中間路線", county: "台南縣", text: "兩岸議題陳 +2；本回合外力事件不移除陳的方塊" },
  { id: "alternation", owner: "chen", deck: "early", cp: 2, icon: "clean", name: "政黨輪替", county: "高雄縣", text: "陳動能 +2" },
  { id: "sweep_black_gold", owner: "chen", deck: "early", cp: 3, icon: "clean", name: "掃除黑金", county: "高雄市", text: "清廉議題陳 +2；連在清廉議題 −1" },
  { id: "future_resolution", owner: "chen", deck: "early", cp: 2, icon: "cross", name: "台灣前途決議文", county: "高雄縣", text: "兩岸議題陳 +1；陳在任一縣市把 1 個無色塊改為綠營游離塊" },
  { id: "lu_running_mate", owner: "chen", deck: "early", cp: 2, icon: "econ", name: "呂秀蓮搭檔", county: "桃園縣", text: "桃園 +2 免檢定" },
  { id: "lo_propaganda", owner: "chen", deck: "early", cp: 2, icon: "clean", name: "羅文嘉文宣部", county: "屏東縣", text: "媒體陳 +2 免檢定" },
  { id: "hsieh_kaohsiung", owner: "chen", deck: "early", cp: 3, icon: "econ", name: "謝長廷高雄市長", county: "高雄市", text: "高雄市 +2 免檢定；媒體陳 +1" },
  { id: "dpp_counties", owner: "chen", deck: "early", cp: 4, icon: "econ", name: "民進黨執政縣市", county: "台南縣", text: "陳在民進黨 1997 年執政的縣市中任 3 個各 +1 需檢定" },
  { id: "three_three_three", owner: "chen", deck: "early", cp: 3, icon: "econ", name: "三三三安家專案", county: "高雄市", text: "經濟議題陳 +2；陳在任 1 個空的綠營游離塊放方塊" },
  { id: "no_nuke4", owner: "chen", deck: "early", cp: 2, icon: "econ", name: "核四停建", county: "台北縣", text: "經濟議題陳 +1、連 −1；宋動能 +1" },
  { id: "lin_chairman", owner: "chen", deck: "early", cp: 2, icon: "clean", name: "林義雄主席", county: "宜蘭縣", text: "清廉議題陳 +1；陳動能 +1" },
  { id: "lee_yuan_tseh", owner: "chen", deck: "late", cp: 4, icon: "clean", name: "李遠哲挺扁", county: "台南市", text: "陳動能 +2；陳本回合放方塊全部免檢定" },
  { id: "advisory_group", owner: "chen", deck: "late", cp: 3, icon: "econ", name: "國政顧問團", county: "台中縣", text: "清廉、經濟議題陳各 +1；媒體陳 +1" },
  { id: "million_rally", owner: "chen", deck: "late", cp: 4, icon: "cross", name: "百萬人民站出來", county: "台北縣", text: "陳在任 3 個縣市各 +1 免檢定；陳動能 +1" },
  { id: "dump_lien_save_chen", owner: "chen", deck: "late", cp: 3, icon: "clean", name: "棄連保扁", county: "高雄市", text: "任一縣市：連 −1、陳 +1（需檢定）" },
  { id: "hsu_wen_long", owner: "chen", deck: "late", cp: 2, icon: "econ", name: "許文龍挺扁", county: "台南縣", text: "台南縣、台南市各 +1 免檢定" },
  { id: "chang_yung_fa", owner: "chen", deck: "late", cp: 2, icon: "econ", name: "張榮發挺扁", county: "桃園縣", text: "媒體陳 +1 免檢定；袋中 +2 陳方塊" },
  // v0.3
  { id: "south_rally", owner: "chen", deck: "early", cp: 3, icon: "econ", name: "南部大造勢", county: "高雄縣", text: "陳在高屏任 2 個縣市各 +1 免檢定" },
  { id: "chang_chiu", owner: "chen", deck: "early", cp: 2, icon: "clean", name: "張俊雄邱義仁", county: "屏東縣", text: "袋中 +3 陳方塊；陳動能 +1" },
  // 宋楚瑜 (20)
  { id: "diligent", owner: "soong", deck: "early", cp: 4, icon: "econ", name: "勤政愛民", county: "彰化縣", text: "宋在任 3 個縣市各 +1 免檢定" },
  { id: "walk_everywhere", owner: "soong", deck: "early", cp: 3, icon: "econ", name: "走透透", county: "彰化縣", text: "宋本回合放方塊全部免檢定" },
  { id: "chang_running_mate", owner: "soong", deck: "early", cp: 3, icon: "cross", name: "張昭雄搭檔", county: "台南市", text: "宋本回合跨營填免檢定（上限 2 顆）" },
  { id: "poll_lead", owner: "soong", deck: "early", cp: 2, icon: "clean", name: "民調領先", county: "新竹縣", text: "僅第 1–3 回合可當事件出：宋動能 +2", turnMax: 3 },
  { id: "million_signatures", owner: "soong", deck: "early", cp: 2, icon: "clean", name: "百萬連署", county: "嘉義縣", text: "袋中 +3 宋方塊；宋動能 +1" },
  { id: "hakka_vote", owner: "soong", deck: "early", cp: 2, icon: "econ", name: "客家票", county: "苗栗縣", text: "新竹縣、苗栗各 +1 免檢定" },
  { id: "east_coast", owner: "soong", deck: "early", cp: 2, icon: "econ", name: "花東原鄉", county: "花蓮縣", text: "花蓮、台東各 +1 免檢定" },
  { id: "veterans_village", owner: "soong", deck: "early", cp: 3, icon: "cross", name: "外省眷村", county: "嘉義市", text: "宋在任 2 個縣市各 +1 需檢定，且同縣市連若有方塊各 −1" },
  { id: "quake_bond", owner: "soong", deck: "early", cp: 3, icon: "econ", name: "災區情誼", county: "南投縣", text: "南投、台中縣各 +1 免檢定" },
  { id: "li_ao_endorses", owner: "soong", deck: "early", cp: 2, icon: "cross", name: "李敖勸選宋", county: "台北市", text: "台北市、新竹市：連各 −1、宋各 +1（免檢定）" },
  { id: "provincial_staff", owner: "soong", deck: "early", cp: 3, icon: "econ", name: "省府舊部", county: "台中縣", text: "本回合連的休息方塊加成無效；媒體宋 +1" },
  { id: "lee_authorized", owner: "soong", deck: "early", cp: 2, icon: "clean", name: "李登輝授意說", county: "台北市", text: "僅在「楊吉雄爆料」出過後可當事件出：宋取回退回方塊的一半；清廉議題宋 +1", cond: "yang_exposes" },
  { id: "dump_lien_save_soong", owner: "soong", deck: "late", cp: 3, icon: "cross", name: "棄連保宋", county: "彰化縣", text: "任一縣市：連 −1、宋 +1（需檢定）" },
  { id: "new_party_backs_soong", owner: "soong", deck: "late", cp: 3, icon: "cross", name: "新黨全力挺宋", county: "台北市", text: "北北基任 2 個縣市各 +1 免檢定" },
  { id: "chang_doctors", owner: "soong", deck: "late", cp: 2, icon: "econ", name: "張昭雄的醫界", county: "南投縣", text: "媒體宋 +1；袋中 +2 宋方塊" },
  { id: "soong_friends", owner: "soong", deck: "late", cp: 2, icon: "econ", name: "宋友會", county: "台北縣", text: "宋動能 +1；宋在任 1 個空的藍營游離塊放方塊免檢定" },
  { id: "kneel_for_votes", owner: "soong", deck: "late", cp: 3, icon: "clean", name: "跪票", county: "雲林縣", text: "宋動能 +2；宋在任 2 個縣市各 +1 需檢定" },
  // v0.3
  { id: "provincial_build", owner: "soong", deck: "early", cp: 3, icon: "econ", name: "省政建設", county: "台中縣", text: "經濟議題宋 +2" },
  { id: "military_civil", owner: "soong", deck: "early", cp: 2, icon: "econ", name: "軍公教警", county: "桃園縣", text: "宋在任 2 個縣市各 +1 需檢定；袋中 +1 宋方塊" },
  { id: "hsu_hsin_liang", owner: "soong", deck: "early", cp: 2, icon: "cross", name: "許信良參選", county: "桃園縣", text: "陳在任一縣市 −1（宋選）；宋動能 +1" },
  // 連戰 (21)
  { id: "expel_soong", owner: "lien", deck: "early", cp: 3, icon: "clean", name: "開除宋楚瑜黨籍", county: "台北市", text: "宋媒體 −2；宋動能 +1" },
  { id: "yang_exposes", owner: "lien", deck: "early", cp: 4, icon: "clean", name: "楊吉雄爆料", county: "台北市", text: "宋退回 4 顆盤上方塊到袋中（連選）；宋失去清廉議題全部方塊；宋動能歸零", must: true },
  { id: "shifting_story", owner: "lien", deck: "early", cp: 3, icon: "clean", name: "說法反覆", county: "台北市", text: "僅在「李登輝授意說」出過後可當事件出：宋再退回 2 顆到袋中；連動能 +1", cond: "lee_authorized" },
  { id: "party_machine", owner: "lien", deck: "early", cp: 4, icon: "econ", name: "黨機器動員", county: "台北縣", text: "連在任 3 個縣市各 +1 免檢定" },
  { id: "party_assets_ads", owner: "lien", deck: "early", cp: 3, icon: "econ", name: "黨產廣告", county: "基隆市", text: "媒體連 +2 免檢定" },
  { id: "lien_siew", owner: "lien", deck: "early", cp: 3, icon: "econ", name: "連蕭配", county: "台北縣", text: "經濟議題連 +2" },
  { id: "hand_in_hand", owner: "lien", deck: "early", cp: 2, icon: "econ", name: "心手相連", county: "台北縣", text: "連動能 +1；經濟議題連 +1" },
  { id: "lee_campaigns", owner: "lien", deck: "early", cp: 3, icon: "cross", name: "李登輝站台", county: "台中縣", text: "連在任 2 個縣市各 +1 免檢定" },
  { id: "lee_attacks_soong", owner: "lien", deck: "early", cp: 3, icon: "clean", name: "李登輝痛批宋", county: "台東縣", text: "宋在任一縣市 −2；宋動能 +1" },
  { id: "stability", owner: "lien", deck: "early", cp: 3, icon: "cross", name: "安定牌", county: "台北縣", text: "兩岸議題連 +2" },
  { id: "local_factions", owner: "lien", deck: "early", cp: 2, icon: "econ", name: "地方派系樁腳", county: "彰化縣", text: "袋中 +4 連方塊" },
  { id: "farmers_association", owner: "lien", deck: "early", cp: 2, icon: "econ", name: "農會系統", county: "雲林縣", text: "雲林、彰化各 +1 免檢定" },
  { id: "ma_campaigns", owner: "lien", deck: "early", cp: 2, icon: "clean", name: "馬英九站台", county: "台北市", text: "台北市 +2 需檢定" },
  { id: "party_unity", owner: "lien", deck: "early", cp: 3, icon: "cross", name: "黨內整合", county: "台北縣", text: "任一縣市：宋 −1、連 +1（需檢定）" },
  { id: "massive_ads", owner: "lien", deck: "late", cp: 4, icon: "econ", name: "鉅額文宣", county: "桃園縣", text: "媒體連 +3 免檢定" },
  { id: "ma_leaks_polls", owner: "lien", deck: "late", cp: 3, icon: "clean", name: "馬英九公布民調", county: "台北市", text: "法定競選期：連在任 2 個縣市各 +1 需檢定；宋、陳動能各 +1", lawful: true },
  { id: "lee_alarm", owner: "lien", deck: "late", cp: 3, icon: "cross", name: "李登輝告急", county: "台中市", text: "連在任 3 個縣市各 +1 需檢定" },
  { id: "party_congress", owner: "lien", deck: "late", cp: 2, icon: "econ", name: "黨員大會", county: "台北市", text: "袋中 +4 連方塊；連動能 +1" },
  // v0.3
  { id: "members_return", owner: "lien", deck: "early", cp: 3, icon: "econ", name: "黨員歸隊", county: "台北縣", text: "任 2 個縣市：宋各 −1（每顆需檢定）" },
  { id: "econ_cabinet", owner: "lien", deck: "early", cp: 2, icon: "econ", name: "經濟內閣", county: "新竹市", text: "經濟議題連 +1；袋中 +2 連方塊" },
  { id: "kmt_anniversary", owner: "lien", deck: "early", cp: 2, icon: "cross", name: "國民黨黨慶", county: "台北縣", text: "連動能 +1；兩岸議題連 +1" },
  // 外力 (9)
  { id: "poll_published", owner: "ext", deck: "early", cp: 2, icon: "clean", name: "民調公布", county: "台中市", text: "第一槽議題的領先者動能 +1" },
  { id: "strait_tension", owner: "ext", deck: "early", cp: 3, icon: "cross", name: "兩岸緊張", county: "澎湖縣", text: "兩岸議題上每人 −1；陳動能 +1" },
  { id: "white_paper", owner: "ext", deck: "late", cp: 3, icon: "cross", name: "中共白皮書", county: "苗栗縣", text: "兩岸議題陳 +1；陳動能 +1" },
  { id: "zhu_rongji", owner: "ext", deck: "late", cp: 4, icon: "cross", name: "朱鎔基「沒有好下場」", county: "屏東縣", text: "陳在任 3 個縣市各 +1 免檢定；陳動能 +1" },
  { id: "us_congress", owner: "ext", deck: "late", cp: 2, icon: "cross", name: "美國國會譴責北京", county: "嘉義縣", text: "兩岸議題：陳 +1，連 +1" },
  { id: "stock_crash", owner: "ext", deck: "late", cp: 2, icon: "econ", name: "股市重挫", county: "台北縣", text: "經濟議題連 +1；所有人動能 −1" },
  { id: "lee_secret_help", owner: "ext", deck: "late", cp: 3, icon: "clean", name: "李登輝暗助", county: "高雄縣", text: "陳在任 2 個縣市各 +1 免檢定；連動能 −1" },
  // v0.3
  { id: "tvbs_poll", owner: "ext", deck: "early", cp: 2, icon: "clean", name: "TVBS 民調", county: "台中市", text: "動能最少者 +1（平手由出牌者選）" },
  { id: "pla_drill_rumor", owner: "ext", deck: "early", cp: 3, icon: "cross", name: "中共軍演傳聞", county: "金馬", text: "兩岸議題連 +1、宋 +1；陳動能 −1" },
];

// Local cards: county and count (§14.2), 41 in all.
// local_0–local_35 are the v0.2 set and are generated exactly as before: the
// first 20 by LOCAL_SPEC order go to the early deck, the rest to the late
// deck; CP alternates 2/3 so that 20 are 2 CP and 16 are 3 CP. Do not change
// LOCAL_SPEC or LOCAL_V02_EARLY: that would move or re-cost existing ids.
// local_36–local_40 are v0.3's five extra early cards, listed one by one
// (owner ruling in #2, comment 6163533701, after the §14.2 county table),
// which make it early 25 / late 16, 2 CP 23 / 3 CP 18.
export const LOCAL_SPEC = [
  ["台北縣", 6], ["台北市", 5], ["桃園縣", 3], ["台中縣", 3], ["高雄市", 3], ["彰化縣", 2], ["高雄縣", 2], ["台南縣", 2],
  ["台中市", 1], ["屏東縣", 1], ["雲林縣", 1], ["台南市", 1], ["苗栗縣", 1], ["南投縣", 1], ["嘉義縣", 1], ["新竹縣", 1], ["宜蘭縣", 1], ["花蓮縣", 1],
];
const LOCAL_V02_EARLY = 20;
// [county, cp], all early, ids local_36 onward in this order.
export const LOCAL_V03_EXTRA = [["高雄縣", 2], ["台北市", 2], ["桃園縣", 3], ["台南市", 3], ["嘉義市", 2]];
export const DECK_SIZES = { early: 75, late: 36, earlyLocal: 25, lateLocal: 16 };

const LOCAL_TEXT = "出牌者在該縣市放 1 顆方塊（需檢定）";
export function localCards() {
  const out = [];
  let i = 0;
  for (const [county, n] of LOCAL_SPEC) {
    for (let k = 0; k < n; k++, i++) {
      out.push({ id: "local_" + i, owner: "local", deck: i < LOCAL_V02_EARLY ? "early" : "late",
        cp: i % 9 < 5 ? 2 : 3, icon: null, name: "地方：" + county, county, text: LOCAL_TEXT });
    }
  }
  for (const [county, cp] of LOCAL_V03_EXTRA) {
    out.push({ id: "local_" + i, owner: "local", deck: "early", cp, icon: null, name: "地方：" + county, county, text: LOCAL_TEXT });
    i++;
  }
  return out;
}

export const REST_CUBES = { 2: 2, 3: 1, 4: 0 };
export const CANDIDATE_CARDS = { chen: { cp: 5, rest: 0 }, soong: { cp: 5, rest: 0 }, lien: { cp: 3, rest: 2 } };
// §5.1, §5.4, §10 (v0.3): deal to 5 on turns 1–5 and to 6 on turns 7–8, play
// 4, keep the rest (1 / 2) face down; nothing is discarded in the normal case.
export const HAND = { dealEarly: 5, dealLate: 6, play: 4, saveEarly: 1, saveLate: 2 };
