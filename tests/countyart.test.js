// The county box shows the county's picture across its top (issue #41, P1 ⑨). Orchestrator's file: a peer may run it
// and falsify against it, and does not edit it. Size, fit and tappable buttons are measured in a browser
// (tools/county41.mjs).
//
//   node --test tests/countyart.test.js      (or `npm test`)
//
// Owner, 2026-10-15, approving the P1 designs. Contract: when county k is open ([data-popover="k"]), the box holds one
// <img data-county-pic="<slug>" src="art/local/<slug>.webp">, the local-card picture of that county; no such picture
// when no county is open. Phone and desktop boxes alike. Reports 尚未實作 until a box has data-county-pic.
import test from "node:test";
import assert from "node:assert/strict";
import { R, section, check, ok, summary } from "./harness.js";
import * as S from "../public/solo.js";
import { COUNTIES } from "../public/shared/board.js";
import { existsSync } from "node:fs";

// Written here from the county names, not read from the page's own table.
const SLUG = { "台北市": "taipei-city", "台北縣": "taipei-county", "基隆市": "keelung", "桃園縣": "taoyuan", "新竹縣": "hsinchu-county", "新竹市": "hsinchu-city", "苗栗縣": "miaoli", "台中縣": "taichung-county", "台中市": "taichung-city", "彰化縣": "changhua", "南投縣": "nantou", "雲林縣": "yunlin", "嘉義縣": "chiayi-county", "嘉義市": "chiayi-city", "台南縣": "tainan-county", "台南市": "tainan-city", "高雄市": "kaohsiung-city", "高雄縣": "kaohsiung-county", "屏東縣": "pingtung", "宜蘭縣": "yilan", "花蓮縣": "hualien", "台東縣": "taitung", "澎湖縣": "penghu", "金馬": "kinma" };
const s = S.advance(S.newSolo({ seat: 0, level: 2, seed: 3700 }));
const pics = (html) => [...html.matchAll(/<img[^<>]*\sdata-county-pic="([^"]*)"[^<>]*>/g)].map((m) => ({ slug: m[1], tag: m[0], at: m.index }));
const box = (html, k) => { const i = html.search(new RegExp(`<div[^<>]*\\sdata-popover="${k}"`)); return i < 0 ? null : html.slice(i); };
const gate = (fn) => () => {
  if (!COUNTIES.every((c) => SLUG[c[0]] && existsSync(new URL(`../public/art/local/${SLUG[c[0]]}.webp`, import.meta.url)))) return "表裡的縣市或插圖檔對不上 COUNTIES（工具）";
  if (!COUNTIES.some((c, k) => pics(S.screen(s, "zh-Hant", { county: k, narrow: true })).length)) return "TODO: 縣市框還沒有 data-county-pic（#41）";
  return fn();
};

section("41 縣市框插圖");

check("24 個縣市，手機與桌機的框：打開時框裡有一張 data-county-pic，是那個縣市的 art/local/<slug>.webp", gate(() => {
  let n = 0;
  for (const narrow of [true, false]) {
    for (let k = 0; k < COUNTIES.length; k++) {
      const html = S.screen(s, "zh-Hant", { county: k, narrow }), want = SLUG[COUNTIES[k][0]], p = pics(html), b = box(html, k);
      if (!b) return `${COUNTIES[k][0]}（${narrow ? "手機" : "桌機"}）：框沒有打開（[data-popover="${k}"]）`;
      if (p.length !== 1) return `${COUNTIES[k][0]}（${narrow ? "手機" : "桌機"}）：畫面上有 ${p.length} 張 data-county-pic`;
      if (p[0].slug !== want || !new RegExp(`\\ssrc="[^"]*art/local/${want}\\.webp"`).test(p[0].tag)) return `${COUNTIES[k][0]}：圖是 ${p[0].tag.slice(0, 140)}，應為 ${want}`;
      if (p[0].at < html.length - b.length) return `${COUNTIES[k][0]}：圖不在框裡`;
      n++;
    }
  }
  return ok(true, `${n} 個框，圖都對`);
}));

check("沒有打開縣市時，畫面上沒有 data-county-pic", gate(() => {
  for (const narrow of [true, false]) { const p = pics(S.screen(s, "zh-Hant", { narrow })); if (p.length) return `${narrow ? "手機" : "桌機"}：沒打開縣市也有 ${p.length} 張`; }
  return ok(true, "手機與桌機都沒有");
}));

test("countyart", () => {
  const r = summary();
  for (const p of R.pass) console.log(`  ✓ ${p.label}${p.msg ? " — " + p.msg : ""}`);
  for (const t of r.todos) console.log(`  … ${t.label} — ${t.msg}`);
  for (const x of r.failures) console.log(`  ✗ ${x.label} — ${x.msg}`);
  console.log(`  通過 ${r.pass} / 失敗 ${r.fail} / 尚未實作 ${r.todo}`);
  assert.equal(r.fail, 0, r.failures.map((x) => `${x.label}: ${x.msg}`).join("\n"));
});
