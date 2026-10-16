// The tutorial (issue #27), as far as node can see it. Orchestrator's file: a peer may run it and
// falsify against it, and does not edit it. Whether the words teach anything and the bubble sits in
// the right place is checked by opening it, not here.
//
//   node --test tests/tutorial.test.js      (or `npm test`)
//
// Contract (owner, 2026-10-15: "Implement a tutorial of the game, try to lead the user run some
// steps"): public/tutorial.js exports, with no DOM at import time,
//   newTutorial() → session                  a solo session (solo.js advance / choices / screen work on it)
//   step(session, lang) → { id, kind, text, target, moves, county }
//       kind "next"   – the player reads and presses next          → next(session)
//       kind "county" – the player taps county `county` on the map  → openCounty(session, county)
//       kind "move"   – the player makes one of `moves` (each legal) → act(session, move), then solo advance
//       kind "done"   – the tutorial is over; the game goes on as a normal solo game
//       target: 'attr="value"' naming the element the bubble points at (e.g. 'data-county="15"')
//   act(session, m) with a move that is not one of the step's moves leaves the session as it was.
// While the tutorial runs, solo screen(session, lang) shows the step: one element data-tutorial="<id>"
// holding the step's text; the target element also carries data-tut-focus; in a move step every
// button carrying data-move (the table's action buttons, the county box's too) whose move is not one
// of the step's moves is disabled. After "done" none of that remains.
// The home page links to ?tutorial. Every check reports 尚未實作 until public/tutorial.js exists.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { R, section, check, eq, ok, nonEmpty, summary } from "./harness.js";
import * as E from "../public/shared/engine.js";
import * as S from "../public/solo.js";

const CJK = /[㐀-鿿豈-﫿]/;
const FILE = new URL("../public/tutorial.js", import.meta.url);
let T = null, IMPORT_ERR = null;
if (existsSync(FILE)) { try { T = await import(FILE.href); } catch (e) { IMPORT_ERR = e; } }
const API = ["newTutorial", "step", "next", "openCounty", "act"];
const c27 = (name, fn) => check(name, () => {
  if (!existsSync(FILE)) return "TODO: public/tutorial.js 還沒有（#27）";
  if (IMPORT_ERR) return `public/tutorial.js 在 node 裡 import 就丟錯（不能在 import 時碰 DOM）：${IMPORT_ERR.message}`;
  const miss = API.filter((k) => typeof T[k] !== "function");
  if (miss.length) return `TODO: public/tutorial.js 還沒有 ${miss.join("、")}（#27）`;
  return fn();
});
const key = (m) => JSON.stringify(m);
const unesc = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const strip = (html) => html.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ");

// Walk the whole tutorial the way a player who follows it would, recording everything.
function walk(lang = "zh-Hant") {
  let s = S.advance(T.newTutorial());
  const rec = [];
  for (let n = 0; n < 120; n++) {
    const st = T.step(s, lang);
    const seat = s.seat;
    const legal = E.legalMoves(s.st, seat);
    const item = { n, id: st.id, kind: st.kind, text: st.text, target: st.target, county: st.county, moves: st.moves, recent: S.recent(s, lang), html: S.screen(s, lang), choices: S.choices(s, lang), legal, s };
    rec.push(item);
    if (st.kind === "done") return { rec, s, end: "done" };
    if (st.kind === "next") s = T.next(s);
    else if (st.kind === "county") s = T.openCounty(s, st.county);
    else if (st.kind === "move") {
      if (!Array.isArray(st.moves) || !st.moves.length) return { rec, s, end: `第 ${n} 步「${st.id}」是 move，卻沒有 moves` };
      const m = st.moves[0], logBefore = s.st.log.length;
      s = T.act(s, m);
      item.did = m;
      item.checked = s.st.log.slice(logBefore).some((e) => e.t === "check");
      s = S.advance(s);
    } else return { rec, s, end: `第 ${n} 步的 kind 是「${st.kind}」` };
  }
  return { rec, s, end: "120 步還沒走完" };
}
const W = T && API.every((k) => typeof T[k] === "function") ? walk("zh-Hant") : null;

section("27 新手教學");

c27("走得完：照教學做，60 步內走到 done；每一步的 kind 合法，move 步給的 moves 都是當下的合法招", () => {
  if (W.end !== "done") return `沒走完：${W.end}`;
  if (W.rec.length > 60) return `走了 ${W.rec.length} 步，超過 60`;
  for (const r of W.rec) {
    if (r.kind !== "move") continue;
    const legal = new Set(r.legal.map(key));
    const bad = r.moves.filter((m) => !legal.has(key(m)));
    if (bad.length) return `第 ${r.n} 步「${r.id}」給的招不合法：${key(bad[0])}`;
  }
  return ok(true, `${W.rec.length} 步走到 done`);
});

// v0.6 (#57) takes the order choice out of the game, and with it the tutorial's "pick your place" move: 5 there (and on
// v0.7, built on v0.6), 6 on v0.5.
c27("真的帶玩家動手：至少 6 個 move 步（v0.6 沒有選順序，5 個），裡面有出牌拿 CP、選競選、先點縣市再在那裡放塊、一次要檢定的動作、結束行動", () => {
  if (W.end !== "done") return `沒走完：${W.end}`;
  const mv = W.rec.filter((r) => r.kind === "move"), min = ["v0.6", "v0.7"].includes(W.s.st.rules) ? 5 : 6; // v0.7 is built on v0.6 (#60)
  if (mv.length < min) return `只有 ${mv.length} 個 move 步（${W.s.st.rules} 要 ${min} 個）`;
  const did = (pred) => mv.find((r) => r.did && pred(r.did, r));
  const need = [
    ["出牌拿 CP（play, mode cp）", (m) => m.type === "play" && m.mode === "cp"],
    ["選競選（action campaign）", (m) => m.type === "action" && m.kind === "campaign"],
    ["一次要檢定的動作", (m, r) => r.checked],
    ["結束行動（done）", (m) => m.type === "done"],
  ];
  for (const [what, pred] of need) if (!did(pred)) return `教學裡沒有「${what}」這一步`;
  const fillAfterCounty = mv.find((r) => r.did && (r.did.type === "fill" || r.did.type === "cross") &&
    W.rec.slice(Math.max(0, r.n - 2), r.n).some((p) => p.kind === "county" && p.county === r.did.county));
  if (!fillAfterCounty) return "沒有「先在地圖上點縣市、下一兩步就在同一個縣市放塊」的段落";
  return ok(true, `${mv.length} 個 move 步，五種動作都有；在地圖上點縣市 ${fillAfterCounty.did.county} 再放塊`);
});

c27("停下來看對手：對手動過之後（recent 有字），教學有一個 next 步讓玩家看", () => {
  if (W.end !== "done") return `沒走完：${W.end}`;
  const r = W.rec.find((x) => x.kind === "next" && x.recent.length);
  if (!r) return "沒有任何一個 next 步發生在對手動過之後";
  return ok(true, `第 ${r.n} 步「${r.id}」，剛剛有 ${r.recent.length} 行`);
});

c27("只能照教學走：move 步裡不在 moves 的合法招，act 之後局面不變；畫面上那些選項按鈕是 disabled", () => {
  if (W.end !== "done") return `沒走完：${W.end}`;
  let tried = 0, disabledSeen = 0;
  for (const r of W.rec.filter((x) => x.kind === "move")) {
    const allowed = new Set(r.moves.map(key));
    const other = r.legal.find((m) => !allowed.has(key(m)));
    if (other) {
      const before = JSON.stringify(r.s.st);
      const after = T.act(r.s, other);
      if (JSON.stringify(after.st) !== before) return `第 ${r.n} 步「${r.id}」允許了教學以外的招 ${key(other)}`;
      tried++;
    }
    for (const t of r.html.matchAll(/<[a-zA-Z][^<>]*?\sdata-move="([^"]*)"[^<>]*>/g)) {
      let m;
      try { m = JSON.parse(unesc(t[1])); } catch { continue; }
      const off = /\sdisabled(?=[\s=/>])|\saria-disabled="true"/.test(t[0]);
      if (allowed.has(key(m)) === off) return `第 ${r.n} 步「${r.id}」的按鈕 ${key(m)} ${off ? "是允許的招卻被鎖住" : "不是教學的招卻沒有鎖住"}`;
      if (off) disabledSeen++;
    }
  }
  const ne = nonEmpty(tried, "有其他合法招可以拿來試的 move 步"); if (ne !== true) return ne;
  const ne2 = nonEmpty(disabledSeen, "畫面上被鎖住的選項按鈕"); if (ne2 !== true) return ne2;
  return ok(true, `${tried} 個 move 步擋下教學以外的招，畫面上鎖住 ${disabledSeen} 個按鈕`);
});

c27("畫面跟著教學：每一步畫面上有一個 data-tutorial=<id>、裡面有那一步的字，目標元素帶 data-tut-focus", () => {
  if (W.end !== "done") return `沒走完：${W.end}`;
  for (const r of W.rec.filter((x) => x.kind !== "done")) {
    const boxes = [...r.html.matchAll(/<[a-zA-Z][^<>]*?\sdata-tutorial="([^"]*)"[^<>]*>/g)];
    if (boxes.length !== 1 || boxes[0][1] !== r.id) return `第 ${r.n} 步「${r.id}」畫面上的 data-tutorial 是 ${JSON.stringify(boxes.map((b) => b[1]))}`;
    const plain = strip(r.html), want = strip(r.text || "").trim();
    if (!want) return `第 ${r.n} 步「${r.id}」沒有字`;
    if (!plain.includes(want.slice(0, 40))) return `第 ${r.n} 步「${r.id}」的字沒有出現在畫面上：「${want.slice(0, 40)}」`;
    if (r.target) {
      const cut = r.target.indexOf("="), name = r.target.slice(0, cut), val = r.target.slice(cut + 1);
      const re = new RegExp(`<[a-zA-Z][^<>]*?\\s${name}=${val.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^<>]*>`, "g");
      const hits = [...r.html.matchAll(re)].filter((t) => /\sdata-tut-focus(?=[\s=/>])/.test(t[0]));
      if (!hits.length) return `第 ${r.n} 步「${r.id}」的目標 ${r.target} 沒有帶 data-tut-focus 的元素`;
    }
  }
  return ok(true, `${W.rec.length - 1} 步的說明框與目標都在畫面上`);
});

c27("教完回到正常的一局：done 之後選項就是 legalMoves、畫面沒有 data-tutorial、沒有被鎖住的選項", () => {
  if (W.end !== "done") return `沒走完：${W.end}`;
  const last = W.rec[W.rec.length - 1];
  const legal = new Set(last.legal.map(key)), got = new Set(last.choices.map((c) => key(c.move)));
  if (legal.size !== got.size || [...legal].some((k) => !got.has(k))) return `done 之後選項跟 legalMoves 不一樣（${got.size} 對 ${legal.size}）`;
  if (/\sdata-tutorial=/.test(last.html)) return "done 之後畫面還有 data-tutorial";
  if (/<[^<>]*\sdata-choice="\d+"[^<>]*\sdisabled(?=[\s=/>])/.test(last.html)) return "done 之後還有被鎖住的選項";
  return ok(true, `done 之後 ${legal.size} 個選項都能按`);
});

c27("中英文：每一步都有中文（有漢字）和英文（沒有漢字）的說明，而且大多不重複", () => {
  if (W.end !== "done") return `沒走完：${W.end}`;
  const en = walk("en");
  if (en.end !== "done") return `英文走不完：${en.end}`;
  if (en.rec.map((r) => r.id).join() !== W.rec.map((r) => r.id).join()) return "中英文走出來的步驟不一樣";
  for (let i = 0; i < W.rec.length - 1; i++) {
    const z = W.rec[i], e = en.rec[i];
    if (!z.text || !CJK.test(z.text)) return `「${z.id}」的中文說明是「${z.text}」`;
    if (!e.text || CJK.test(e.text)) return `「${e.id}」的英文說明是「${e.text}」`;
    if (CJK.test(strip(e.html).replace(/中文/g, ""))) return `「${e.id}」英文畫面有中文：${strip(e.html).match(CJK)[0]}`;
  }
  const texts = W.rec.slice(0, -1).map((r) => r.text);
  const uniq = new Set(texts).size;
  if (uniq < texts.length * 0.8) return `${texts.length} 步裡只有 ${uniq} 種說明`;
  return ok(true, `${texts.length} 步中英說明都有，${uniq} 種不同`);
});

c27("每次都一樣、首頁進得去：走兩次步驟與畫面逐位元組相同；首頁有 ?tutorial 的入口", () => {
  if (W.end !== "done") return `沒走完：${W.end}`;
  const again = walk("zh-Hant");
  for (let i = 0; i < W.rec.length; i++) {
    if (!again.rec[i] || again.rec[i].id !== W.rec[i].id) return `第 ${i} 步不一樣：${W.rec[i].id} 對 ${again.rec[i] && again.rec[i].id}`;
    if (again.rec[i].html !== W.rec[i].html) return `第 ${i} 步「${W.rec[i].id}」兩次的畫面不一樣`;
  }
  // The home page itself (index.html), not the solo setup page that app.js draws: a link there does not
  // count as the way in from the home page (the hole the #27 peer found: app.js's setup link kept it green).
  const homeFile = new URL("../public/index.html", import.meta.url);
  const home = existsSync(homeFile) ? readFileSync(homeFile, "utf8") : "";
  if (!/<a\b[^>]*\shref="\?tutorial(?:&amp;[^"]*)?"[^>]*>/.test(home)) return "首頁 index.html 沒有連到 ?tutorial 的 <a>";
  return ok(true, `${W.rec.length} 步兩次相同；首頁有入口`);
});

test("tutorial", () => {
  const s = summary();
  for (const p of R.pass) console.log(`  ✓ ${p.label}${p.msg ? " — " + p.msg : ""}`);
  for (const t of s.todos) console.log(`  … ${t.label} — ${t.msg}`);
  for (const f of s.failures) console.log(`  ✗ ${f.label} — ${f.msg}`);
  console.log(`  通過 ${s.pass} / 失敗 ${s.fail} / 尚未實作 ${s.todo}`);
  assert.equal(s.fail, 0, s.failures.map((f) => `${f.label}: ${f.msg}`).join("\n"));
});
