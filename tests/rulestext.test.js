// The rules page and the help lines after rulebook v0.4 (issue #35), as far as node can see them. Orchestrator's
// file: a peer may run it and falsify against it, and does not edit it. Whether the prose reads well is checked by
// reading it.
//
//   node --test tests/rulestext.test.js      (or `npm test`)
//
// Owner, 2026-10-15: 「2b + B」 (media is one national box; the media leader gains 1 momentum each turn end), landed
// in the engine as #34. Contract, in both languages:
//   - the rules page (i18n `rules`) no longer describes regional media: no media regions, no regional media lead,
//     no "national media lead" of v0.3, no placing media "in any region", no per-region conversion, no 連 media in
//     北北基 / 中彰投 at the start;
//   - it describes v0.4: the national media box, the media leader, and the media bonus (+1 momentum) in the
//     momentum phase; 連 starts with 2 media;
//   - the momentum help line (ui.solo.help.mom) mentions media;
//   - strings nobody uses since #29–#34 are gone (or used again): see UNUSED.
// Reports 尚未實作 until the Chinese rules page says 媒體領先者 (v0.3 already had 全國媒體優勢).
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { R, section, check, ok, summary } from "./harness.js";
import zh from "../public/i18n/zh-Hant.js";
import en from "../public/i18n/en.js";

const flat = (o, p = "", out = []) => {
  if (typeof o === "string") { out.push([p, o]); return out; }
  if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) flat(v, p ? `${p}.${k}` : k, out);
  return out;
};
const LANGS = [["zh", zh], ["en", en]];
const rulesOf = (d) => flat(d.rules, "rules");
const all = (d) => rulesOf(d).map(([, v]) => v).join("\n");
const FORBID = {
  zh: [/媒體區域/, /區域媒體/, /全國媒體優勢/, /在任一區放/, /每個區域的媒體/, /北北基和中彰投各有/],
  en: [/media regions?\b/i, /regional media/i, /national media lead/i, /media cubes? in any region/i, /media cube in a region/i, /Taipei–Keelung and Taichung/i],
};
const NEED = {
  zh: [[/全國媒體/, "全國媒體"], [/媒體領先者/, "媒體領先者"], [/媒體領先者[^。]{0,24}\+?1 動能|媒體獎勵[^。]{0,30}\+?1 動能/, "媒體領先者 +1 動能（動能結算）"]],
  en: [[/national media/i, "national media"], [/media leader/i, "media leader"], [/media leader[^.]{0,40}\+?1 momentum|media bonus[^.]{0,40}\+?1 momentum/i, "the media leader's +1 momentum"]],
};
// Keys nobody reads after #29 (the end page) and #34 (media without regions). Each must be gone, or used again.
const UNUSED = ["ui.solo.p.fxMedia", "ui.solo.p.fxMediaRemove", "ui.solo.end.kicker", "ui.solo.end.elected", "ui.solo.end.youWon", "ui.solo.end.youLost", "ui.solo.end.unit", "ui.solo.end.emptyLeft", "ui.solo.end.history"];
const get = (d, path) => path.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), d);
const SRC = readdirSync(new URL("../public/", import.meta.url)).filter((f) => f.endsWith(".js")).map((f) => readFileSync(new URL(`../public/${f}`, import.meta.url), "utf8")).join("\n");
const gate = (fn) => () => (/媒體領先者/.test(all(zh)) ? fn() : "TODO: 規則頁還是 v0.3 的區域媒體（#35）");

section("35 規則頁 v0.4");

check("規則頁不再講區域媒體：媒體區域、區域媒體優勢、v0.3 的全國媒體優勢、在任一區放媒體、每區的媒體轉換、連開局在北北基中彰投的媒體都不見了（中英）", gate(() => {
  for (const [lang, d] of LANGS) {
    for (const [k, v] of rulesOf(d)) for (const re of FORBID[lang]) if (re.test(v)) return `${lang} ${k}：還有「${(v.match(re) || [""])[0]}」：${v.slice(0, 80)}`;
  }
  return ok(true, "中英規則頁都沒有區域媒體的說法");
}));

check("規則頁講 v0.4：全國媒體、媒體領先者、動能結算裡媒體領先者 +1 動能（中英）", gate(() => {
  for (const [lang, d] of LANGS) {
    const text = all(d);
    for (const [re, what] of NEED[lang]) if (!re.test(text)) return `${lang} 規則頁找不到「${what}」`;
  }
  return ok(true, "中英都有全國媒體、媒體領先者與 +1 動能");
}));

check("候選人表與開局：連的起始媒體是全國 2（不是北北基、中彰投）", gate(() => {
  for (const [lang, d] of LANGS) {
    const rows = rulesOf(d).filter(([k]) => /table\.rows\.\d+\.\d+$/.test(k));
    const label = rows.find(([, v]) => (lang === "zh" ? /起始媒體/ : /starting media/i).test(v));
    if (!label) return `${lang} 候選人表找不到起始媒體那一列`;
    const row = label[0].replace(/\.\d+$/, "");
    const cells = rows.filter(([k]) => k.startsWith(row + ".") && k !== label[0]).map(([, v]) => v);
    if (cells.some((c) => /北北基|中彰投|Taipei|Taichung/.test(c))) return `${lang} 起始媒體那一列還寫著區域：${cells.join(" / ")}`;
    if (!cells.some((c) => /2/.test(c))) return `${lang} 起始媒體那一列沒有 2：${cells.join(" / ")}`;
  }
  return ok(true, "中英候選人表：連起始媒體 2");
}));

check("動能的說明（ui.solo.help.mom）提到媒體（中英）", gate(() => {
  for (const [lang, d] of LANGS) {
    const v = get(d, "ui.solo.help.mom") || "";
    if (!(lang === "zh" ? /媒體/ : /media/i).test(v)) return `${lang} help.mom 沒提媒體：「${v.slice(0, 80)}」`;
  }
  return ok(true, "中英的動能說明都提到媒體");
}));

check("沒人用的字串拿掉了：#29–#34 之後沒人讀的 key 不在字典裡（或又被用了）", gate(() => {
  const left = [];
  for (const [lang, d] of LANGS) for (const k of UNUSED) {
    if (get(d, k) === undefined) continue;
    const short = k.split(".").slice(-2).join(".");
    if (!SRC.includes(`"${short}`) && !SRC.includes(`'${short}`) && !SRC.includes(`.${k.split(".").pop()}`)) left.push(`${lang} ${k}`);
  }
  return left.length ? `還在、也沒人用：${left.join("、")}` : ok(true, `${UNUSED.length} 個 key 都處理了`);
}));

test("rulestext", () => {
  const s = summary();
  for (const p of R.pass) console.log(`  ✓ ${p.label}${p.msg ? " — " + p.msg : ""}`);
  for (const t of s.todos) console.log(`  … ${t.label} — ${t.msg}`);
  for (const x of s.failures) console.log(`  ✗ ${x.label} — ${x.msg}`);
  console.log(`  通過 ${s.pass} / 失敗 ${s.fail} / 尚未實作 ${s.todo}`);
  assert.equal(s.fail, 0, s.failures.map((x) => `${x.label}: ${x.msg}`).join("\n"));
});
