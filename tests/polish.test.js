// The polish pass (issue #30), as far as node can see it. Orchestrator's file: a peer may run it and falsify
// against it, and does not edit it. Whether the hand covers a decision button and whether the top fits a small
// phone are measured in a browser (tools/polish30.mjs); the room's table talk is tests/roomclient.test.js §19.
//
//   node --test tests/polish.test.js      (or `npm test`)
//
// Contract: in English, a count of one takes the singular. Nothing the solo table shows — the visible text
// and the aria-labels of every screen of whole games, from the first decision to the result — reads
// "1 cards", "1 cubes", "1 blocks", "1 checks", "1 votes", "1 seconds" or "1 turns" (owner's polish list:
// "sets aside 1 cards"; the map's own label for Penghu and Kinmen-Matsu says "1 blocks" on every screen).
// Reports 尚未實作 while today's wording is still there (the count says how many places), and turns into a
// failure once #30 lands.
import test from "node:test";
import assert from "node:assert/strict";
import { R, section, check, ok, nonEmpty, summary } from "./harness.js";
import * as D from "./driver.js";
import * as S from "../public/solo.js";
import * as T from "../public/tutorial.js";

const SEAT = ["chen", "soong", "lien"];
const PLURAL_ONE = /(^|[^\d.,])1 (cards|cubes|blocks|checks|votes|seconds|turns)\b/g;
const words = (html) => html.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ") + " " + (html.match(/aria-label="[^"]*"/g) || []).join(" ");

section("30 小修整");

check("英文的「1」接單數：整局英文畫面（字與 aria-label）沒有「1 cards / cubes / blocks / checks / votes / seconds / turns」", () => {
  let screens = 0, ended = 0;
  const found = new Map();
  for (const [seat, seed] of [[0, 3001], [1, 3002], [2, 3003]]) {
    let s = S.advance(S.newSolo({ seat, level: 2, seed }));
    const R1 = D.rng(seed);
    for (let n = 0; n < 600; n++) {
      const html = S.screen(s, "en");
      screens++;
      for (const m of words(html).matchAll(PLURAL_ONE)) {
        const k = m[0].trim();
        if (!found.has(k)) found.set(k, `${SEAT[seat]} seed ${seed} 第 ${s.st.turn} 回合 ${s.st.phase}`);
      }
      if (s.st.phase === "end") { ended++; break; }
      const ch = S.choices(s, "en");
      if (!ch.length) break;
      s = S.advance(S.act(s, ch[Math.floor(R1() * ch.length)].move));
    }
  }
  for (const [x, what] of [[screens, "英文畫面"], [ended, "打到結果的整局"]]) { const r = nonEmpty(x, what); if (r !== true) return r; }
  if (found.size) return `TODO: 英文還有 ${found.size} 種「1 + 複數」：${[...found].map(([k, w]) => `「${k}」（${w}）`).join("、")}（#30）`;
  return ok(true, `${screens} 個英文畫面、${ended} 局打到結果，沒有「1 + 複數」`);
});

// #30 gave the strings a plural form, "{n#block|blocks}"; every page that fills strings has to know it, or the
// braces show. Nothing in braces may reach the screen: whole solo games and the tutorial, both languages.
check("沒有漏填的佔位字：整局單人與整段教學（中英）的字與 aria-label 裡沒有 {…}（含單複數寫法 {n#…|…}）", () => {
  let screens = 0;
  const hole = (html) => { const m = words(html).match(/.{0,12}\{[^{}\s]{1,40}\}.{0,12}/); return m ? m[0] : null; };
  for (const lang of ["en", "zh-Hant"]) {
    for (const [seat, seed] of [[0, 3101], [2, 3102]]) {
      let s = S.advance(S.newSolo({ seat, level: 2, seed }));
      const R1 = D.rng(seed);
      for (let n = 0; n < 600; n++) {
        const h = hole(S.screen(s, lang)); screens++;
        if (h) return `${lang} ${SEAT[seat]} seed ${seed} 第 ${s.st.turn} 回合 ${s.st.phase}：畫面上有「${h}」`;
        if (s.st.phase === "end") break;
        const ch = S.choices(s, lang);
        if (!ch.length) break;
        s = S.advance(S.act(s, ch[Math.floor(R1() * ch.length)].move));
      }
    }
    let t = S.advance(T.newTutorial());
    for (let n = 0; n < 120; n++) {
      const st = T.step(t, lang);
      const h = hole(S.screen(t, lang)) || hole(st.text || ""); screens++;
      if (h) return `${lang} 教學第 ${n} 步「${st.id}」：畫面上有「${h}」`;
      if (st.kind === "done") break;
      if (st.kind === "next") t = T.next(t);
      else if (st.kind === "county") t = T.openCounty(t, st.county);
      else if (st.kind === "move" && st.moves && st.moves.length) t = S.advance(T.act(t, st.moves[0]));
      else break;
    }
  }
  const r = nonEmpty(screens, "畫面"); if (r !== true) return r;
  return ok(true, `${screens} 個畫面（中英整局單人與教學）沒有漏填的佔位字`);
});

test("polish", () => {
  const s = summary();
  for (const p of R.pass) console.log(`  ✓ ${p.label}${p.msg ? " — " + p.msg : ""}`);
  for (const t of s.todos) console.log(`  … ${t.label} — ${t.msg}`);
  for (const x of s.failures) console.log(`  ✗ ${x.label} — ${x.msg}`);
  console.log(`  通過 ${s.pass} / 失敗 ${s.fail} / 尚未實作 ${s.todo}`);
  assert.equal(s.fail, 0, s.failures.map((x) => `${x.label}: ${x.msg}`).join("\n"));
});
