// The home page without 「盒子裡有什麼」 (issue #62). Orchestrator's file: a peer may run it and falsify against it, and does
// not edit it.
//
//   node --test tests/home.test.js      (or `npm test`)
//
// Owner, 2026-10-16: 「Main page 移除盒子裡有什麼 整個 block」; asked whether the two links under it go too, 「只拿掉標題和
// 介紹」. Contract, on public/index.html (the home page as served) and the two string files:
//   - no 「盒子裡有什麼」 title and no box description: no element carrying data-i18n="ui.look.home.boxTitle" or
//     "ui.look.home.box", and neither text in the page;
//   - the two strings are gone from both languages (nobody reads them any more), as #52 did with unused strings;
//   - the two links stay: <a id="rules" href="rules"> (app.js sets its language) with data-i18n="ui.look.home.rules", and
//     the link to https://games.csiesheep.com/ with data-i18n="nav.hub"; both strings still there.
// The removal checks report 尚未實作 while the title is still in the page; the links are checked from the start.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { R, section, check, ok, summary } from "./harness.js";
import zh from "../public/i18n/zh-Hant.js";
import en from "../public/i18n/en.js";

const HOME = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const get = (d, path) => path.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), d);
const TITLE_GONE = !/data-i18n="ui\.look\.home\.boxTitle"/.test(HOME);
const c62 = (name, fn) => check(name, () => (TITLE_GONE ? fn() : "TODO: 首頁還有「盒子裡有什麼」的標題（#62）"));

section("62 首頁");
c62("沒有「盒子裡有什麼」：首頁沒有標題、沒有那段介紹（data-i18n 與文字都沒有）", () => {
  const left = [];
  if (/data-i18n="ui\.look\.home\.box"/.test(HOME)) left.push("data-i18n=\"ui.look.home.box\"");
  for (const t of [get(zh, "ui.look.home.boxTitle"), get(en, "ui.look.home.boxTitle"), "盒子裡有什麼", "70 張事件牌"]) if (t && HOME.includes(t)) left.push(`「${t}」`);
  return left.length ? `首頁還有 ${left.join("、")}` : ok(true, "首頁沒有盒子裡有什麼的標題與介紹");
});
c62("兩個字串拿掉了：ui.look.home.boxTitle、ui.look.home.box 中英都沒有", () => {
  const left = [];
  for (const [lang, d] of [["zh", zh], ["en", en]]) for (const k of ["ui.look.home.boxTitle", "ui.look.home.box"]) if (get(d, k) !== undefined) left.push(`${lang} ${k}`);
  return left.length ? `還有 ${left.join("、")}` : ok(true, "中英都沒有這兩個字串");
});
check("兩個連結還在：規則書（id=\"rules\" href=\"rules\"）與 csiesheep games（games.csiesheep.com），字串也在", () => {
  const rules = /<a\b[^>]*\bid="rules"[^>]*\bhref="rules"[^>]*\bdata-i18n="ui\.look\.home\.rules"[^>]*>/.test(HOME) || /<a\b[^>]*\bhref="rules"[^>]*\bid="rules"[^>]*>/.test(HOME);
  const hub = /<a\b[^>]*\bhref="https:\/\/games\.csiesheep\.com\/"[^>]*\bdata-i18n="nav\.hub"[^>]*>/.test(HOME);
  if (!rules) return "首頁沒有 <a id=\"rules\" href=\"rules\">（翻開規則書）";
  if (!hub) return "首頁沒有連到 https://games.csiesheep.com/ 的 nav.hub 連結";
  for (const [lang, d] of [["zh", zh], ["en", en]]) for (const k of ["ui.look.home.rules", "nav.hub"]) if (!get(d, k)) return `${lang} 沒有 ${k}`;
  return ok(true, "規則書與 csiesheep games 兩個連結都在");
});

test("home", () => {
  const s = summary();
  for (const p of R.pass) console.log(`  ✓ ${p.label}${p.msg ? " — " + p.msg : ""}`);
  for (const t of s.todos) console.log(`  … ${t.label} — ${t.msg}`);
  for (const x of s.failures) console.log(`  ✗ ${x.label} — ${x.msg}`);
  console.log(`  通過 ${s.pass} / 失敗 ${s.fail} / 尚未實作 ${s.todo}`);
  assert.equal(s.fail, 0, s.failures.map((x) => `${x.label}: ${x.msg}`).join("\n"));
});
