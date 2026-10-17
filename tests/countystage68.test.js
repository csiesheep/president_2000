// The county stages after the UX audit (issue #68), as far as node can see it. Orchestrator's file: a peer may run it and
// falsify against it, and does not edit it. Whether the lit boxes can be tapped, whether the bar's words are cut and what
// a real tap on a county chip does are measured in a browser (tools/countystage68.mjs).
//
//   node --test tests/countystage68.test.js      (or `npm test`)
//
// Owner, 2026-10-17, on the audit (vault 「president_2000 - UX 巡檢 2026-10-17」): 「好，都修，先給我看建議修改後的圖，再開工」;
// on the canvas 「UX 巡檢 · 建議修改」 (rows 1, 2, 4): 「Go」.
// Contract, screen(session, lang, opts) of a solo game, Chinese and English, the desk map and the phone map (opts.narrow):
//   - a placement is a choice whose move carries a county number (fill, cross, steal, remove, grey, convert …; a walk to
//     another county is { type: "move", to } and is not one). The counties the human may place in now are lit: the
//     county's <g class="tw-c" data-county="k"> carries data-can, and no other county does; with no placement, none;
//   - while there is a placement the decision is a bar: the sheet [data-sheet] holds one [data-open-county="k"] for each
//     lit county and for no other county, and no placement button (.opt[data-move] whose move has a county) — those live
//     in the county's box; every other choice of that step (the end of the action, a walk via the move list, an issue,
//     the national media …) stays in the sheet or, for a walk, in the box of the county walked to;
//   - every placement stays reachable: screen(…, { county: k }) draws [data-popover="k"] with every placement in k and
//     every walk to k;
//   - a county's box with nothing to do says why, in an element [data-pop-empty="<why>"]:
//       wait — the human has no choice (the rivals are moving): 「對手行動中，等一下就輪到你。先看看他們在哪裡放了方塊。」
//       pick — in the action phase the human only picks a card: 「先點下面的手牌，選要用幾 CP，再回來這裡放方塊。」
//       here — other counties are lit: 「這張牌這回合放不到這裡。可以放的縣市在地圖上亮著。」, and at the policy forum's award
//              (no card): 「這一步放不到這裡。可以放的縣市在地圖上亮著。」
//     (in English: some words, not the old 「Nothing to do in this county right now.」);
//   - on election day the line after a canvass still carries the chance of each check (「每次檢定約 N%」).
import test from "node:test";
import assert from "node:assert/strict";
import { R, section, check, ok, nonEmpty, summary } from "./harness.js";
import * as D from "./driver.js";
import * as S from "../public/solo.js";

const WAIT = "對手行動中，等一下就輪到你。先看看他們在哪裡放了方塊。";
const PICK = "先點下面的手牌，選要用幾 CP，再回來這裡放方塊。";
const HERE_CARD = "這張牌這回合放不到這裡。可以放的縣市在地圖上亮著。";
const HERE_AWARD = "這一步放不到這裡。可以放的縣市在地圖上亮著。";
const OLD_EN = "Nothing to do in this county right now.";

// Solo games stepped one move at a time (the rivals and the human in random order while both may act): every state with a
// placement is kept, every 4th other state where the human decides, every 9th state where the human waits.
function states() {
  const out = [];
  for (const [seat, seed] of [[0, 6801], [1, 6802], [2, 6803], [0, 6804], [1, 6805], [2, 6806]]) {
    let s = S.newSolo({ seat, level: 2, seed });
    const R1 = D.rng(seed);
    let a = 0, b = 0;
    for (let n = 0; n < 4000 && s.st.phase !== "end"; n++) {
      const bots = S.botsToMove(s).length > 0, ch = S.choices(s, "zh-Hant");
      const where = `seat ${seat} seed ${seed} 第 ${s.st.turn} 回合第 ${n} 步`;
      if (ch.some(isPlace)) out.push({ s, where });
      else if (ch.length && a++ % 4 === 0) out.push({ s, where });
      else if (!ch.length && b++ % 9 === 0) out.push({ s, where });
      if (bots && (!ch.length || R1() < 0.5)) s = S.stepBot(s);
      else { if (!ch.length) break; s = S.act(s, ch[Math.floor(R1() * ch.length)].move); }
    }
  }
  return out;
}
const isPlace = (c) => typeof c.move.county === "number";
const isWalk = (c) => c.move.type === "move";
const isPick = (c) => c.move.type === "candidate" || (!!c.move.card && ["play", "reveal", "canvass"].includes(c.move.type));
const POOL = states();
const LANGS = [["zh-Hant", "中文"], ["en", "英文"]];
const MAPS = [[{}, "桌面地圖"], [{ narrow: true }, "手機地圖"]];

const tags = (html, name) => [...html.matchAll(new RegExp(`<[a-zA-Z][^<>]*?\\s${name}(?:="([^"]*)")?(?=[\\s/>])[^<>]*>`, "g"))].map((m) => ({ tag: m[0], v: m[1], at: m.index }));
const attr = (tag, name) => { const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`)); return m ? m[1] : null; };
const has = (tag, name) => new RegExp(`\\s${name}(?:="[^"]*")?(?=[\\s/>])`).test(tag);
function elementAt(html, t) {
  const tn = t.tag.match(/^<([a-zA-Z0-9-]+)/)[1].toLowerCase();
  const re = new RegExp(`<(/?)${tn}(?=[\\s>/])[^<>]*>`, "gi");
  re.lastIndex = t.at + t.tag.length;
  let depth = 1, m;
  while ((m = re.exec(html))) { if (m[1]) depth--; else if (!/\/>$/.test(m[0])) depth++; if (!depth) return html.slice(t.at, m.index + m[0].length); }
  return html.slice(t.at);
}
const unesc = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const text = (html) => unesc(html.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
// The moves of the .opt[data-move] buttons in a piece of HTML, as JSON strings.
const movesIn = (html) => tags(html, "data-move").filter((t) => t.v).map((t) => { try { return JSON.stringify(JSON.parse(unesc(t.v))); } catch { return null; } }).filter(Boolean);
const sheetOf = (html) => { const t = tags(html, "data-sheet")[0]; return t ? elementAt(html, t) : ""; };
const litIn = (html) => tags(html, "data-county").filter((t) => /class="tw-c/.test(t.tag) && has(t.tag, "data-can")).map((t) => Number(t.v));
const can = (p) => [...new Set(S.choices(p.s, "zh-Hant").filter(isPlace).map((c) => c.move.county))].sort((a, b) => a - b);
const v = (p) => p.s.st;
const award = (p) => v(p).phase === "debate" && !!(v(p).debate && v(p).debate.award);

const LIT_ANY = POOL.some((p) => litIn(S.screen(p.s, "zh-Hant")).length);
const gate = (fn) => () => {
  const ne = nonEmpty(POOL.length, "牌桌的狀態"); if (ne !== true) return ne;
  if (!LIT_ANY) return "TODO: 地圖上還沒有亮起的縣市（.tw-c 沒有 data-can）";
  return fn();
};

section("68 縣市階段（UX 巡檢 1、2、4）");

check("可以放方塊的縣市亮起（data-can），別的縣市不亮；沒有可放的時候一個都不亮", gate(() => {
  const kinds = new Map();
  let n = 0, none = 0;
  for (const p of POOL) for (const [lang, name] of LANGS) for (const [mo, mname] of MAPS) {
    const want = can(p), got = [...new Set(litIn(S.screen(p.s, lang, mo)))].sort((a, b) => a - b);
    if (JSON.stringify(want) !== JSON.stringify(got)) return `${p.where}（${name}，${mname}）：亮起 [${got}]，可以放的是 [${want}]`;
    if (want.length) { const st = v(p).phase === "action" ? v(p).pending && v(p).pending.stage : award(p) ? "award" : v(p).phase; kinds.set(st, (kinds.get(st) || 0) + 1); n++; } else none++;
  }
  for (const k of ["campaign", "local", "effect", "award", "election"]) { const r = nonEmpty(kinds.get(k) || 0, `「${k}」階段可以放方塊的畫面`); if (r !== true) return r; }
  return ok(true, `${n} 個可以放的畫面（${[...kinds].map(([k, c]) => `${k} ${c}`).join("、")}）亮對，${none} 個不能放的畫面都不亮`);
}));

check("要放方塊時的橫條：每個亮起的縣市一個 [data-open-county]，沒有放方塊的按鈕；其他選項（結束、議題、移動…）還在", gate(() => {
  let n = 0, others = 0;
  for (const p of POOL) for (const [lang, name] of LANGS) {
    const ch = S.choices(p.s, lang), want = can(p);
    if (!want.length) continue;
    const html = S.screen(p.s, lang), sheet = sheetOf(html);
    if (!sheet) return `${p.where}（${name}）：可以放方塊卻沒有 data-sheet`;
    const chips = tags(sheet, "data-open-county").map((t) => Number(t.v)).sort((a, b) => a - b);
    if (JSON.stringify(chips) !== JSON.stringify(want)) return `${p.where}（${name}）：橫條的縣市是 [${chips}]，可以放的是 [${want}]`;
    const inSheet = new Set(movesIn(sheet)), place = ch.filter(isPlace).filter((c) => inSheet.has(JSON.stringify(c.move)));
    if (place.length) return `${p.where}（${name}）：橫條裡還有 ${place.length} 個放方塊的按鈕（例：「${place[0].label}」）`;
    // every other choice: in the sheet; a walk: in the sheet's move list (opts.moves) or in the box of the county walked to
    const opened = new Set(movesIn(sheetOf(S.screen(p.s, lang, { moves: true }))));
    for (const c of ch.filter((c) => !isPlace(c))) {
      const key = JSON.stringify(c.move);
      if (inSheet.has(key) || opened.has(key)) { others++; continue; }
      if (isWalk(c) && new Set(movesIn(S.screen(p.s, lang, { county: c.move.to }))).has(key)) { others++; continue; }
      return `${p.where}（${name}）：「${c.label}」既不在橫條，也不在移動清單或縣市框裡`;
    }
    n++;
  }
  const r = nonEmpty(n, "要放方塊的畫面"); if (r !== true) return r;
  return ok(true, `${n} 個畫面的橫條只有縣市名字；${others} 個其他選項都還按得到`);
}));

check("每個放方塊的選項都在那個縣市的框裡（screen 帶 county: k）", gate(() => {
  let n = 0, walks = 0;
  for (const p of POOL) for (const [lang, name] of LANGS) {
    const ch = S.choices(p.s, lang);
    for (const k of can(p)) {
      const html = S.screen(p.s, lang, { county: k }), pop = tags(html, "data-popover").find((t) => t.v === String(k));
      if (!pop) return `${p.where}（${name}）：縣市 ${k} 的框沒有畫出來`;
      const inPop = new Set(movesIn(elementAt(html, pop)));
      for (const c of ch.filter((c) => isPlace(c) && c.move.county === k)) { if (!inPop.has(JSON.stringify(c.move))) return `${p.where}（${name}）：縣市 ${k} 的框裡少了「${c.label}」`; n++; }
      for (const c of ch.filter((c) => isWalk(c) && c.move.to === k)) { if (!inPop.has(JSON.stringify(c.move))) return `${p.where}（${name}）：縣市 ${k} 的框裡少了「${c.label}」`; walks++; }
    }
  }
  const r = nonEmpty(n, "放方塊的選項"); if (r !== true) return r;
  return ok(true, `${n} 個放方塊、${walks} 個移到這裡的選項都在框裡`);
}));

check("縣市框沒事可做時說為什麼（data-pop-empty：wait / pick / here，中文照設計稿的字）", gate(() => {
  const seen = { wait: 0, pick: 0, here: 0, award: 0 }, en = { wait: new Set(), pick: new Set(), here: new Set() };
  for (const p of POOL) {
    const chZ = S.choices(p.s, "zh-Hant"), lit = can(p);
    let why = null, want = null;
    if (!chZ.length) { why = "wait"; want = WAIT; }
    else if (lit.length) { why = "here"; want = award(p) ? HERE_AWARD : HERE_CARD; }
    else if (v(p).phase === "action" && chZ.every(isPick)) { why = "pick"; want = PICK; }
    if (!why) continue;
    // a county where the human can do nothing at all (no placement, no walk to it)
    const busy = new Set(chZ.flatMap((c) => [c.move.county, c.move.to]).filter((k) => typeof k === "number"));
    const k = [...Array(v(p).counties.length).keys()].find((j) => !busy.has(j));
    if (k == null) continue;
    for (const [lang, name] of LANGS) {
      const html = S.screen(p.s, lang, { county: k }), pop = tags(html, "data-popover").find((t) => t.v === String(k));
      if (!pop) return `${p.where}（${name}）：縣市 ${k} 的框沒有畫出來`;
      const body = elementAt(html, pop), e = tags(body, "data-pop-empty");
      if (e.length !== 1) return `${p.where}（${name}）：縣市 ${k} 的框（${why}）有 ${e.length} 個 data-pop-empty${/Nothing to do|沒有可以做的事/.test(text(body)) ? "，還是寫「沒有可以做的事」" : ""}`;
      if (e[0].v !== why) return `${p.where}（${name}）：data-pop-empty 是「${e[0].v}」，應為「${why}」`;
      const said = text(elementAt(body, e[0]));
      if (lang === "zh-Hant" && said !== want) return `${p.where}（中文，${why}）：寫「${said}」，應為「${want}」`;
      if (lang === "en") { if (!said || said === OLD_EN) return `${p.where}（英文，${why}）：寫「${said}」`; en[why].add(said); }
    }
    seen[why === "here" && award(p) ? "award" : why]++;
  }
  for (const [k, w] of [["wait", "對手行動中"], ["pick", "選牌中"], ["here", "別的縣市亮著（牌）"], ["award", "別的縣市亮著（政見發表會得獎）"]]) { const r = nonEmpty(seen[k], `框裡沒事可做的畫面：${w}`); if (r !== true) return r; }
  if (en.wait.size && en.pick.size && [...en.wait].some((t) => en.pick.has(t))) return `英文的 wait 跟 pick 是同一句：${[...en.wait][0]}`;
  return ok(true, `對手行動中 ${seen.wait}、選牌中 ${seen.pick}、牌放不到 ${seen.here}、得獎放不到 ${seen.award}，中文字照稿，英文各有一句`);
}));

check("投票日催票成功之後，橫條上還寫著每次檢定的機率（「每次檢定約 N%」）", gate(() => {
  let n = 0;
  for (const p of POOL) {
    // (the human's own canvass: election.choose is set for whoever canvasses, so the human's placements decide)
    if (!(v(p).phase === "election" && can(p).length)) continue;
    const sheet = sheetOf(S.screen(p.s, "zh-Hant"));
    if (!/每次檢定約 \d+%/.test(text(sheet))) return `${p.where}：催票成功之後的橫條沒有「每次檢定約 N%」（${text(sheet).slice(0, 60)}）`;
    n++;
  }
  const r = nonEmpty(n, "催票成功之後的畫面"); if (r !== true) return r;
  return ok(true, `${n} 個畫面都寫著`);
}));

test("countystage68", () => {
  const s = summary();
  for (const p of R.pass) console.log(`  ✓ ${p.label}${p.msg ? " — " + p.msg : ""}`);
  for (const t of s.todos) console.log(`  … ${t.label} — ${t.msg}`);
  for (const x of s.failures) console.log(`  ✗ ${x.label} — ${x.msg}`);
  console.log(`  通過 ${s.pass} / 失敗 ${s.fail} / 尚未實作 ${s.todo}`);
  assert.equal(s.fail, 0, s.failures.map((x) => `${x.label}: ${x.msg}`).join("\n"));
});
