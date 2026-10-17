// The buttons' words, the endorsement key, the sheet that opens by itself and three small things, after the UX audit
// (issue #69), as far as node can see it. Orchestrator's file: a peer may run it and falsify against it, and does not
// edit it. The key over the map and the candidate strip that closes are measured in a browser (tools/labels69.mjs).
//
//   node --test tests/labels69.test.js      (or `npm test`)
//
// Owner, 2026-10-17, on the audit: 「好，都修，先給我看建議修改後的圖，再開工」; on the canvas 「UX 巡檢 · 建議修改」 (rows 3,
// 5, 6–8): 「Go」. Contract, screen(session, lang, opts) of a solo game, Chinese and English:
//   - every option button (.opt[data-move]) in the sheet — as it stands, with a card selected, with the move list open —
//     and in a county's box has its action on the first line and the cost, the chance or the kind of block in a <small>:
//     the words outside <small> (the head) hold no 「%」, no bracket 「（」「(」 and, in Chinese, no 「檢定」; a choice whose
//     label carries the chance (「檢定約 N%」, 「免檢定」; in English the 「N%」) shows it inside the <small>; a button that
//     plays, reveals or canvasses a card does not repeat the card's name in its head (the face is right beside it);
//   - while a region's endorsement is held and the issue totals are drawn ([data-issue-lead]), the key
//     ([data-endorse-legend]) is drawn once, inside the totals (no longer a float of its own over 台北市);
//   - the sheet that opens by itself (exactly one card to pick and nothing else) starts with a line (.pr) that says what
//     is going on — in Chinese, the debate: 「只剩這一張留牌：面朝下打出，三人都選好才一起翻開。」, election day:
//     「只剩這一張留牌：在牌上的縣市催票，做 3 次檢定。」, an action: 「只剩這一張牌能打：選一種打法。」;
//   - the candidate card's 「sure?」 (opts.confirm) closes the county's box: no [data-popover] is drawn with it;
//   - keeping cards with a choice of sets raises the tray (.t-hand[data-hand="up"]), says beside the handle
//     「點牌面選要留的牌」 and, before any pick, 「還沒選牌 · 點下面的牌來選，再點一次取消」;
//   - after a draw (opts.undo "off") there is no undo button but a line [data-undo-off]: 「這步抽過檢定 · 不能悔」.
import test from "node:test";
import assert from "node:assert/strict";
import { R, section, check, ok, nonEmpty, summary } from "./harness.js";
import * as D from "./driver.js";
import * as S from "../public/solo.js";
import { bind } from "../public/table.js";

const AUTO = { debate: "只剩這一張留牌：面朝下打出，三人都選好才一起翻開。", election: "只剩這一張留牌：在牌上的縣市催票，做 3 次檢定。", action: "只剩這一張牌能打：選一種打法。" };
const SAVE_HINT = "點牌面選要留的牌", SAVE_NONE = "還沒選牌 · 點下面的牌來選，再點一次取消", UNDO_OFF = "這步抽過檢定 · 不能悔";

function states() {
  const out = [];
  for (let i = 0; i < 12; i++) {
    const seat = i % 3, seed = 6901 + i;
    let s = S.newSolo({ seat, level: 2, seed });
    const R1 = D.rng(seed);
    let a = 0;
    for (let n = 0; n < 4000 && s.st.phase !== "end"; n++) {
      const bots = S.botsToMove(s).length > 0, ch = S.choices(s, "zh-Hant");
      const where = `seat ${seat} seed ${seed} 第 ${s.st.turn} 回合第 ${n} 步`;
      if (ch.length && (autoCard(ch) || s.st.phase === "save" || ch.some((c) => c.move.type === "candidate") || a++ % 7 === 0)) out.push({ s, where });
      if (bots && (!ch.length || R1() < 0.5)) s = S.stepBot(s);
      else { if (!ch.length) break; s = S.act(s, ch[Math.floor(R1() * ch.length)].move); }
    }
  }
  return out;
}
const isPick = (c) => c.move.type === "candidate" || (!!c.move.card && ["play", "reveal", "canvass"].includes(c.move.type));
// exactly one card to pick and nothing else: the table opens that card by itself
const autoCard = (ch) => { const cards = [...new Set(ch.filter((c) => isPick(c) && c.move.card).map((c) => c.move.card))]; return ch.length > 0 && ch.every(isPick) && cards.length === 1 && !ch.some((c) => c.move.type === "candidate") ? cards[0] : null; };
const POOL = states();
const LANGS = [["zh-Hant", "中文"], ["en", "英文"]];

const tags = (html, name) => [...html.matchAll(new RegExp(`<[a-zA-Z][^<>]*?\\s${name}(?:="([^"]*)")?(?=[\\s/>])[^<>]*>`, "g"))].map((m) => ({ tag: m[0], v: m[1], at: m.index }));
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
const first = (html, name) => { const t = tags(html, name)[0]; return t ? elementAt(html, t) : ""; };
// the option buttons in a piece of HTML: { move, head, small }
function buttons(html) {
  return tags(html, "data-move").filter((t) => /^<button/.test(t.tag) && /class="[^"]*\bopt\b/.test(t.tag) && t.v).map((t) => {
    const el = elementAt(html, t);
    const inner = el.replace(/^<button[^>]*>/, "").replace(/<\/button>$/, "");
    const small = [...inner.matchAll(/<small[^>]*>([\s\S]*?)<\/small>/g)].map((m) => text(m[1])).join(" ");
    const head = text(inner.replace(/<small[^>]*>[\s\S]*?<\/small>/g, " ").replace(/<i class="star-adv"[^>]*>[\s\S]*?<\/i>/g, ""));
    let move = null; try { move = JSON.parse(unesc(t.v)); } catch { /* not a move */ }
    return { move, head, small };
  }).filter((b) => b.move);
}
// the pile a tap picks from (the hand, or the debate / election pile), written from the rules; st is the full state, so the seat comes along
const pile = (st, seat) => { const a = st.phase === "debate" ? st.savedDebate[seat] : st.phase === "election" ? st.savedElection[seat] : st.hands[seat]; return Array.isArray(a) ? a : []; };
// the first element carrying class `cls` (among others)
const byClass = (html, cls) => { const m = html.match(new RegExp(`<[a-zA-Z][a-zA-Z0-9]*\\s[^<>]*?class="(?:[^"]*\\s)?${cls}(?:\\s[^"]*)?"[^<>]*>`)); return m ? elementAt(html, { tag: m[0], at: m.index }) : ""; };

const GATE = POOL.some((p) => buttons(first(S.screen(p.s, "zh-Hant"), "data-sheet")).some((b) => b.small)) ||
  POOL.some((p) => tags(S.screen(p.s, "zh-Hant", { undo: "off" }), "data-undo-off").length);
const gate = (fn) => () => {
  const ne = nonEmpty(POOL.length, "牌桌的狀態"); if (ne !== true) return ne;
  if (!GATE) return "TODO: 面板的按鈕還沒有第二行（<small>），也還沒有 data-undo-off";
  return fn();
};

section("69 按鈕的字、背書圖例、自己打開的面板、三件小事（UX 巡檢 3、5、7、8）");

check("每個選項按鈕第一行只寫動作：沒有「%」、括號、「檢定」，機率在 <small>；出牌、翻牌、催票的按鈕不重複牌名", gate(() => {
  const n = { sheet: 0, sel: 0, moves: 0, pop: 0 }; let withOdds = 0, cardBtns = 0;
  for (const p of POOL) for (const [lang, name] of LANGS) {
    const x = bind(lang), ch = S.choices(p.s, lang), byMove = new Map(ch.map((c) => [JSON.stringify(c.move), c]));
    const views = [["sheet", S.screen(p.s, lang)]];
    for (const id of pile(p.s.st, p.s.seat).slice(0, 2)) views.push(["sel", S.screen(p.s, lang, { sel: id })]);
    if (ch.some((c) => c.move.type === "move")) views.push(["moves", S.screen(p.s, lang, { moves: true })]);
    const ks = [...new Set(ch.flatMap((c) => [c.move.county, c.move.to]).filter((k) => typeof k === "number"))].slice(0, 3);
    for (const k of ks) views.push(["pop", S.screen(p.s, lang, { county: k })]);
    for (const [kind, html] of views) {
      const scope = kind === "pop" ? first(html, "data-popover") : first(html, "data-sheet");
      for (const b of buttons(scope)) {
        const c = byMove.get(JSON.stringify(b.move)), label = c ? c.label : "";
        const bad = /%/.test(b.head) ? "「%」" : /[（(]/.test(b.head) ? "括號" : lang === "zh-Hant" && /檢定/.test(b.head) ? "「檢定」" : null;
        if (bad) return `${p.where}（${name}，${kind}）：按鈕第一行有${bad}：「${b.head}」${b.small ? `（小字「${b.small}」）` : ""}`;
        const odds = lang === "zh-Hant" ? (label.match(/檢定約 \d+%|免檢定/) || [])[0] : (label.match(/\d+%/) || [])[0];
        if (odds) { if (!b.small.includes(odds)) return `${p.where}（${name}，${kind}）：「${label}」的「${odds}」不在小字裡（第一行「${b.head}」，小字「${b.small}」）`; withOdds++; }
        if (b.move.card && ["play", "reveal", "canvass"].includes(b.move.type)) {
          const cn = x.card(b.move.card);
          if (cn && b.head.includes(cn)) return `${p.where}（${name}，${kind}）：按鈕第一行重複牌名「${cn}」：「${b.head}」`;
          cardBtns++;
        }
        n[kind]++;
      }
    }
  }
  for (const k of Object.keys(n)) { const r = nonEmpty(n[k], `${k} 的按鈕`); if (r !== true) return r; }
  const r = nonEmpty(withOdds, "寫著機率的選項"); if (r !== true) return r;
  return ok(true, `面板 ${n.sheet}、選了牌 ${n.sel}、移動清單 ${n.moves}、縣市框 ${n.pop} 個按鈕；${withOdds} 個機率在小字、${cardBtns} 個牌的按鈕不重複牌名`);
}));

check("背書圖例在議題總數裡面，只有一個（不再自己浮在地圖右上角）", gate(() => {
  let n = 0;
  for (const p of POOL) for (const [lang, name] of LANGS) {
    const v = p.s.st;
    if (v.phase === "end" || !v.endorse.some((h) => h >= 0)) continue;
    const html = S.screen(p.s, lang), lead = tags(html, "data-issue-lead");
    if (!lead.length) continue;
    const keys = tags(html, "data-endorse-legend");
    if (keys.length !== 1) return `${p.where}（${name}）：有 ${keys.length} 個 data-endorse-legend`;
    if (!tags(elementAt(html, lead[0]), "data-endorse-legend").length) return `${p.where}（${name}）：圖例不在 [data-issue-lead] 裡`;
    n++;
  }
  const r = nonEmpty(n, "有人持有背書而且畫著議題總數的畫面"); if (r !== true) return r;
  return ok(true, `${n} 個畫面的圖例都在議題總數裡`);
}));

check("自己打開的面板第一行說現在在做什麼（政見發表會、投票日、行動各一句）", gate(() => {
  const seen = { debate: 0, election: 0, action: 0 };
  for (const p of POOL) for (const [lang, name] of LANGS) {
    const ch = S.choices(p.s, lang), card = autoCard(ch);
    if (!card) continue;
    const ph = p.s.st.phase, sheet = first(S.screen(p.s, lang), "data-sheet");
    if (!sheet) return `${p.where}（${name}）：只剩一張牌，面板卻沒有自己打開`;
    const pr = byClass(sheet, "pr");
    const said = text(pr);
    if (!said) return `${p.where}（${name}，${ph}）：自己打開的面板沒有 .pr 那一句`;
    if (lang === "zh-Hant" && AUTO[ph] && said !== AUTO[ph]) return `${p.where}（中文，${ph}）：寫「${said}」，應為「${AUTO[ph]}」`;
    if (lang === "zh-Hant") seen[ph] = (seen[ph] || 0) + 1;
  }
  for (const k of ["debate", "election"]) { const r = nonEmpty(seen[k], `自己打開的面板（${k}）`); if (r !== true) return r; }
  return ok(true, `政見發表會 ${seen.debate}、投票日 ${seen.election}、行動 ${seen.action}（行動很少見：碰到才量）`);
}));

check("候選人牌問「確定嗎」的時候，縣市框關起來（同時帶 county 與 confirm 也不畫 data-popover）", gate(() => {
  let n = 0;
  for (const p of POOL) for (const [lang, name] of LANGS) {
    const cand = S.choices(p.s, lang).find((c) => c.move.type === "candidate");
    if (!cand) continue;
    const html = S.screen(p.s, lang, { county: p.s.st.pos[p.s.seat], confirm: JSON.stringify(cand.move) });
    if (tags(html, "data-popover").length) return `${p.where}（${name}）：問「確定嗎」時縣市框還開著`;
    if (!tags(html, "data-sheet").length) return `${p.where}（${name}）：問「確定嗎」時沒有面板`;
    n++;
  }
  const r = nonEmpty(n, "可以用候選人牌的畫面"); if (r !== true) return r;
  return ok(true, `${n} 個畫面只剩「確定嗎」`);
}));

check("留牌（有得選）時托盤拉起，把手旁寫「點牌面選要留的牌」，還沒選時面板寫「還沒選牌 · 點下面的牌來選，再點一次取消」", gate(() => {
  let n = 0;
  for (const p of POOL) for (const [lang, name] of LANGS) {
    const ch = S.choices(p.s, lang);
    if (p.s.st.phase !== "save" || ch.length < 2) continue;
    const html = S.screen(p.s, lang), hand = tags(html, "data-hand").find((t) => /t-hand/.test(t.tag));
    if (!hand || hand.v !== "up") return `${p.where}（${name}）：留牌時托盤是 ${hand ? hand.v : "沒有"}`;
    if (lang === "zh-Hant") {
      const hh = text(byClass(html, "hh"));
      if (!hh.includes(SAVE_HINT)) return `${p.where}：把手旁沒有「${SAVE_HINT}」（${hh.slice(0, 60)}）`;
      const sheet = text(first(html, "data-sheet"));
      if (!sheet.includes(SAVE_NONE)) return `${p.where}：面板沒有「${SAVE_NONE}」（${sheet.slice(0, 60)}）`;
    }
    n++;
  }
  const r = nonEmpty(n, "有得選的留牌畫面"); if (r !== true) return r;
  return ok(true, `${n} 個留牌畫面`);
}));

check("抽過檢定之後沒有悔一步的按鈕，只有一行小字（data-undo-off：「這步抽過檢定 · 不能悔」）；可以悔時按鈕照舊", gate(() => {
  let n = 0;
  for (const p of POOL.slice(0, 40)) for (const [lang, name] of LANGS) {
    const off = S.screen(p.s, lang, { undo: "off" });
    if (tags(off, "data-undo").some((t) => /^<button/.test(t.tag))) return `${p.where}（${name}）：抽過檢定還有悔一步的按鈕`;
    const e = tags(off, "data-undo-off");
    if (e.length !== 1) return `${p.where}（${name}）：有 ${e.length} 個 data-undo-off`;
    if (lang === "zh-Hant" && text(elementAt(off, e[0])) !== UNDO_OFF) return `${p.where}：寫「${text(elementAt(off, e[0]))}」，應為「${UNDO_OFF}」`;
    const on = S.screen(p.s, lang, { undo: "on" });
    if (!tags(on, "data-undo").some((t) => /^<button/.test(t.tag) && !/\sdisabled/.test(t.tag))) return `${p.where}（${name}）：可以悔時沒有悔一步的按鈕`;
    n++;
  }
  const r = nonEmpty(n, "畫面"); if (r !== true) return r;
  return ok(true, `${n} 個畫面`);
}));

test("labels69", () => {
  const s = summary();
  for (const p of R.pass) console.log(`  ✓ ${p.label}${p.msg ? " — " + p.msg : ""}`);
  for (const t of s.todos) console.log(`  … ${t.label} — ${t.msg}`);
  for (const x of s.failures) console.log(`  ✗ ${x.label} — ${x.msg}`);
  console.log(`  通過 ${s.pass} / 失敗 ${s.fail} / 尚未實作 ${s.todo}`);
  assert.equal(s.fail, 0, s.failures.map((x) => `${x.label}: ${x.msg}`).join("\n"));
});
