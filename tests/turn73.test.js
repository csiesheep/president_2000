// Whose turn it is (issue #73, the canvas 「輪到誰」's 甲 聚光燈 + 乙 交棒卡), as far as node can see it. Orchestrator's
// file: a peer may run it and falsify against it, and does not edit it. When the handoff card pops out, how long it
// stays, that the rivals wait for it and that a tap closes it are measured in a browser (tools/turn73.mjs).
//
//   node --test tests/turn73.test.js      (or `npm test`)
//
// Owner, 2026-10-17: 「遊戲中，請明確顯示輪到哪一個候選人，或是輪到每個候選人時，有一個pop out panel。設計三個版本」, then of
// the three: 「輪到誰 用 甲加乙」.
// The seat whose turn it is: the one seat the game waits for, E.mustAct with exactly one seat (in the action phase that
// is the actor, or whoever answers a card's choice at that moment, #4 裁決 4); none when it waits for more than one
// (keeping cards and the debate are played by all three at once) or the game is over. Contract, screen(session, lang,
// opts) of a solo game, Chinese and English, the desk and the phone map (opts.narrow):
//   - 甲: that seat's board (<article class="pl …">) carries data-turn and holds a tag [data-turn-tag] that reads, in
//     Chinese, 「輪到你」 when it is the human's seat and 「<short> 行動中」 otherwise (陳 / 宋 / 連); no other board carries
//     data-turn; that seat's pawn on the map (<g data-pawn="<key>">) carries data-turn and no other pawn does; with no
//     such seat, no board and no pawn carries data-turn;
//   - 乙: screen(…, { handoff: <seat> }) draws one card [data-handoff="<key>"] that says, in Chinese, 「輪到你」 for the
//     human's seat and 「輪到 <full name>」 otherwise, 「第 <turn> 回合」, and the three candidates in the turn's order
//     ([data-order="<key>"], three of them, in v.order); without opts.handoff no [data-handoff] is drawn.
import test from "node:test";
import assert from "node:assert/strict";
import { R, section, check, ok, nonEmpty, summary } from "./harness.js";
import * as D from "./driver.js";
import * as S from "../public/solo.js";
import * as E from "../public/shared/engine.js";

const KEYS = ["chen", "soong", "lien"], SHORT = ["陳", "宋", "連"], FULL = ["陳水扁", "宋楚瑜", "連戰"];
const turnSeat = (st) => { if (st.phase === "end") return null; const m = E.mustAct(st); return m.length === 1 ? m[0] : null; };

function states() {
  const out = [];
  for (let i = 0; i < 6; i++) {
    const seat = i % 3, seed = 7301 + i;
    let s = S.newSolo({ seat, level: 2, seed });
    const R1 = D.rng(seed);
    for (let n = 0; n < 4000 && s.st.phase !== "end"; n++) {
      if (n % 4 === 0) out.push({ s, where: `seat ${seat} seed ${seed} 第 ${s.st.turn} 回合第 ${n} 步（${s.st.phase}）` });
      const bots = S.botsToMove(s).length > 0, ch = S.choices(s, "zh-Hant");
      if (bots && (!ch.length || R1() < 0.5)) s = S.stepBot(s);
      else { if (!ch.length) break; s = S.act(s, ch[Math.floor(R1() * ch.length)].move); }
    }
  }
  return out;
}
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
const text = (html) => html.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const boards = (html) => [...html.matchAll(/<article class="pl s(\d)[^"]*"[^>]*>/g)].map((m) => ({ tag: m[0], seat: Number(m[1]), at: m.index }));
const order = (st) => (Array.isArray(st.order) && st.order.length === 3 ? st.order : [0, 1, 2]);

const GATE = POOL.some((p) => boards(S.screen(p.s, "zh-Hant")).some((b) => has(b.tag, "data-turn")));
const gate = (fn) => () => {
  const ne = nonEmpty(POOL.length, "牌桌的狀態"); if (ne !== true) return ne;
  if (!GATE) return "TODO: 候選人板還沒有 data-turn（輪到誰）";
  return fn();
};

section("73 輪到誰（甲 聚光燈 + 乙 交棒卡）");

check("甲：輪到的那一位的候選人板帶 data-turn 與標籤（輪到你／X 行動中），他的圓標也帶 data-turn；沒有單一的人時都不帶", gate(() => {
  const seen = { mine: 0, rival: 0, none: 0 };
  for (const p of POOL) for (const [lang, name] of LANGS) for (const [mo, mname] of MAPS) {
    const st = p.s.st, a = turnSeat(st), html = S.screen(p.s, lang, mo);
    if (st.phase === "end") continue;
    const on = boards(html).filter((b) => has(b.tag, "data-turn"));
    const pawns = tags(html, "data-pawn").filter((t) => /^<g/.test(t.tag) && has(t.tag, "data-turn"));
    if (a == null) {
      if (on.length || pawns.length) return `${p.where}（${name}，${mname}）：沒有單一的人在行動，卻有 ${on.length} 張板、${pawns.length} 個圓標帶 data-turn`;
      seen.none++; continue;
    }
    if (on.length !== 1 || on[0].seat !== a) return `${p.where}（${name}，${mname}）：輪到 ${KEYS[a]}，帶 data-turn 的板是 [${on.map((b) => KEYS[b.seat])}]`;
    const tg = tags(elementAt(html, on[0]), "data-turn-tag");
    if (tg.length !== 1) return `${p.where}（${name}，${mname}）：輪到的板有 ${tg.length} 個 data-turn-tag`;
    if (lang === "zh-Hant") {
      const want = a === p.s.seat ? "輪到你" : `${SHORT[a]} 行動中`, said = text(elementAt(elementAt(html, on[0]), tg[0]));
      if (said !== want) return `${p.where}（中文，${mname}）：標籤寫「${said}」，應為「${want}」`;
    }
    if (pawns.length !== 1 || attr(pawns[0].tag, "data-pawn") !== KEYS[a]) return `${p.where}（${name}，${mname}）：輪到 ${KEYS[a]}，帶 data-turn 的圓標是 [${pawns.map((t) => attr(t.tag, "data-pawn"))}]`;
    seen[a === p.s.seat ? "mine" : "rival"]++;
  }
  for (const [k, w] of [["mine", "輪到自己"], ["rival", "輪到對手"], ["none", "三人同時（留牌、政見發表會）"]]) { const r = nonEmpty(seen[k], w); if (r !== true) return r; }
  return ok(true, `輪到自己 ${seen.mine}、輪到對手 ${seen.rival}、沒有單一的人 ${seen.none} 個畫面都對`);
}));

check("乙：帶 handoff 時畫一張交棒卡（輪到你／輪到 全名、第 N 回合、三位照這回合的順序）；不帶時沒有", gate(() => {
  let n = 0;
  for (const p of POOL.filter((_, i) => i % 3 === 0)) for (const [lang, name] of LANGS) {
    const st = p.s.st;
    if (st.phase === "end") continue;
    if (tags(S.screen(p.s, lang), "data-handoff").length) return `${p.where}（${name}）：沒有帶 handoff 卻畫了交棒卡`;
    for (const a of [0, 1, 2]) {
      const html = S.screen(p.s, lang, { handoff: a }), c = tags(html, "data-handoff");
      if (c.length !== 1 || c[0].v !== KEYS[a]) return `${p.where}（${name}）：handoff ${KEYS[a]}，畫了 ${c.length} 張（${c.map((t) => t.v)}）`;
      const body = elementAt(html, c[0]), words = text(body);
      if (lang === "zh-Hant") {
        const want = a === p.s.seat ? "輪到你" : `輪到 ${FULL[a]}`;
        if (!words.includes(want)) return `${p.where}（中文）：交棒卡沒有「${want}」（${words.slice(0, 50)}）`;
        if (!words.includes(`第 ${st.turn} 回合`)) return `${p.where}（中文）：交棒卡沒有「第 ${st.turn} 回合」`;
      }
      const ord = tags(body, "data-order").map((t) => t.v);
      if (JSON.stringify(ord) !== JSON.stringify(order(st).map((q) => KEYS[q]))) return `${p.where}（${name}）：交棒卡的順序是 [${ord}]，這回合是 [${order(st).map((q) => KEYS[q])}]`;
      n++;
    }
  }
  const r = nonEmpty(n, "交棒卡"); if (r !== true) return r;
  return ok(true, `${n} 張交棒卡都對，沒帶 handoff 時都沒有`);
}));

test("turn73", () => {
  const s = summary();
  for (const p of R.pass) console.log(`  ✓ ${p.label}${p.msg ? " — " + p.msg : ""}`);
  for (const t of s.todos) console.log(`  … ${t.label} — ${t.msg}`);
  for (const x of s.failures) console.log(`  ✗ ${x.label} — ${x.msg}`);
  console.log(`  通過 ${s.pass} / 失敗 ${s.fail} / 尚未實作 ${s.todo}`);
  assert.equal(s.fail, 0, s.failures.map((x) => `${x.label}: ${x.msg}`).join("\n"));
});
