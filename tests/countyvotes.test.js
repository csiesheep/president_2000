// A county's size in votes, not blocks (issue #46). Orchestrator's file: a peer may run it and falsify against it,
// and does not edit it.
//
//   node --test tests/countyvotes.test.js      (or `npm test`)
//
// Owner, 2026-10-15: 「每個縣市中 n塊 -> 改成 n0萬票」. A block is 10萬 votes (the candidate panels already say so).
// Contract: the county box's title reads "<county> · <n>0萬票" — in English "<county> · <n/10, one decimal>M votes"
// (10 blocks → 1.0M votes) — and the county's label on the map (its aria-label) carries the same words in place of
// "<n> 塊". Phone and desktop boxes alike. Since #46 landed, a title in blocks is a failure.
import test from "node:test";
import assert from "node:assert/strict";
import { R, section, check, ok, summary } from "./harness.js";
import * as S from "../public/solo.js";
import { COUNTIES } from "../public/shared/board.js";

const s = S.advance(S.newSolo({ seat: 0, level: 2, seed: 3700 }));
const n = (k) => s.st.counties[k].blocks.length;
const zh = (k) => `${n(k)}0萬票`, en = (k) => `${(n(k) / 10).toFixed(1)}M votes`;
const title = (html, k) => { const i = html.search(new RegExp(`<div[^<>]*\\sdata-popover="${k}"`)); if (i < 0) return null; const m = html.slice(i).match(/<div class="pop-h">([\s\S]*?)<\/div>/); return m ? m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : null; };
const labels = (html) => [...html.matchAll(/data-county="(\d+)"[^<>]*?aria-label="([^"]*)"|aria-label="([^"]*)"[^<>]*?data-county="(\d+)"/g)].map((m) => ({ k: Number(m[1] ?? m[4]), label: m[2] ?? m[3] }));
const gate = (fn) => () => {
  const t = title(S.screen(s, "zh-Hant", { county: 16, narrow: true }), 16);
  if (t === null) return "縣市框的標題找不到（工具）";
  if (!/萬票/.test(t)) return "縣市框的標題又寫回塊數了（#46 已上線，這是退步，不是尚未實作）";
  return fn();
};

section("46 縣市的大小寫成票數");

check("縣市框的標題：「<縣市> · <n>0萬票」，英文「<n/10>M votes」；不再寫塊數（24 個縣市，手機與桌機）", gate(() => {
  let c = 0;
  for (const narrow of [true, false]) for (let k = 0; k < COUNTIES.length; k++) {
    const z = title(S.screen(s, "zh-Hant", { county: k, narrow }), k), e = title(S.screen(s, "en", { county: k, narrow }), k);
    if (!z || !z.includes(zh(k)) || /\d\s*塊/.test(z)) return `${COUNTIES[k][0]}（${narrow ? "手機" : "桌機"}）：標題是「${z}」，應有「${zh(k)}」、沒有塊數`;
    if (!e || !e.includes(en(k)) || /\bblocks?\b/i.test(e)) return `${COUNTIES[k][0]}（${narrow ? "手機" : "桌機"}，英文）：標題是「${e}」，應有「${en(k)}」`;
    c++;
  }
  return ok(true, `${c} 個標題，中英文都對`);
}));

check("地圖上每個縣市的標籤（aria-label）也寫票數，不寫塊數", gate(() => {
  for (const lang of ["zh-Hant", "en"]) {
    const ls = labels(S.screen(s, lang)), seen = new Set();
    for (const { k, label } of ls) {
      const want = lang === "en" ? en(k) : zh(k);
      if (!label.includes(want)) return `${COUNTIES[k][0]}（${lang}）：標籤是「${label}」，應有「${want}」`;
      if (lang === "en" ? /\b\d+ blocks?\b/.test(label) : /\d+ 塊/.test(label)) return `${COUNTIES[k][0]}（${lang}）：標籤還寫塊數「${label}」`;
      seen.add(k);
    }
    if (seen.size < COUNTIES.length) return `${lang}：只找到 ${seen.size} 個縣市標籤（工具）`;
  }
  return ok(true, "24 個縣市、中英文的標籤都寫票數");
}));

test("countyvotes", () => {
  const r = summary();
  for (const p of R.pass) console.log(`  ✓ ${p.label}${p.msg ? " — " + p.msg : ""}`);
  for (const t of r.todos) console.log(`  … ${t.label} — ${t.msg}`);
  for (const x of r.failures) console.log(`  ✗ ${x.label} — ${x.msg}`);
  console.log(`  通過 ${r.pass} / 失敗 ${r.fail} / 尚未實作 ${r.todo}`);
  assert.equal(r.fail, 0, r.failures.map((x) => `${x.label}: ${x.msg}`).join("\n"));
});
