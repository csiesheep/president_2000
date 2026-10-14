// The board as data: 25 counties (金門+連江 merged as 金馬), 154 vote blocks,
// seven media regions, the opening position. Numbers follow the rulebook
// (vault: Projects/president_2000/president_2000 - rulebook.md, v0.2, §3–4).
// Phase 0: written by the kickoff session, not independently verified.

export const CHEN = 0, SOONG = 1, LIEN = 2;
export const SEATS = ["chen", "soong", "lien"];
export const CAMP = ["G", "B", "B"]; // 陳 green camp; 宋、連 blue camp

export const REGIONS = ["北北基", "桃竹苗", "中彰投", "雲嘉南", "高屏", "宜花東", "離島"];
// Region adjacency for candidate movement (1 CP per boundary crossed; 宋 flat 1).
export const REGION_EDGES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [4, 5], [3, 6], [4, 6]];

// name, region, green floating blocks, blue floating blocks, grey (non-voter)
// blocks, opening cubes [陳, 宋, 連]. Opening cubes sit on blocks of their own
// camp, so the empty floating blocks are G - 陳 and B - 宋 - 連.
export const COUNTIES = [
  ["台北市", 0, 6, 10, 3, [4, 5, 2]],
  ["台北縣", 0, 7, 13, 4, [4, 4, 3]],
  ["基隆市", 0, 1, 1, 1, [1, 1, 0]],
  ["桃園縣", 1, 2, 7, 2, [1, 3, 1]],
  ["新竹縣", 1, 0, 2, 1, [0, 1, 1]],
  ["新竹市", 1, 0, 2, 0, [0, 1, 0]],
  ["苗栗縣", 1, 0, 3, 1, [0, 1, 1]],
  ["台中縣", 2, 2, 6, 2, [1, 2, 1]],
  ["台中市", 2, 1, 4, 1, [1, 1, 1]],
  ["彰化縣", 2, 2, 5, 2, [1, 2, 1]],
  ["南投縣", 2, 1, 2, 1, [1, 1, 1]],
  ["雲林縣", 3, 1, 3, 1, [1, 1, 1]],
  ["嘉義縣", 3, 1, 2, 1, [1, 1, 1]],
  ["嘉義市", 3, 1, 0, 1, [1, 0, 0]],
  ["台南縣", 3, 2, 4, 2, [1, 1, 1]],
  ["台南市", 3, 1, 3, 1, [1, 1, 1]],
  ["高雄市", 4, 4, 5, 1, [2, 2, 1]],
  ["高雄縣", 4, 3, 4, 2, [2, 1, 1]],
  ["屏東縣", 4, 2, 3, 1, [1, 1, 1]],
  ["宜蘭縣", 5, 1, 1, 1, [1, 1, 0]],
  ["花蓮縣", 5, 0, 2, 1, [0, 1, 1]],
  ["台東縣", 5, 0, 1, 1, [0, 1, 0]],
  ["澎湖縣", 6, 0, 1, 0, [0, 1, 0]],
  ["金馬",   6, 0, 1, 0, [0, 1, 0]],
];

export const START_COUNTY = { chen: "台南縣", soong: "南投縣", lien: "台北市" };
export const START_MOMENTUM = [3, 2, 1];
export const START_MEDIA = [[0, 0, 1], [0, 0, 0], [0, 0, 1], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
export const BAG_SEED = 12;
export const BOSS_THRESHOLD = 4; // 樁腳主: 4 cubes; counties under 4 blocks never have one
export const ISSUES = ["cross", "clean", "econ"]; // 兩岸 / 清廉 / 經濟民生
export const TURNS = 9;

export function blocksOf(c) { return c[2] + c[3] + c[4]; }
export function countyIndex(name) { return COUNTIES.findIndex((c) => c[0] === name); }
