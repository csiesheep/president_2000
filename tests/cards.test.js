// The cards in their camp's colour (issue #36), as far as node can see them. Orchestrator's file: a peer may run it
// and falsify against it, and does not edit it. The colours, the missing frame lines and the full-bleed picture are
// measured in a browser (tools/cards36.mjs) and checked by looking.
//
//   node --test tests/cards.test.js      (or `npm test`)
//
// Owner, 2026-10-15: 「重新設計卡牌UI，不要有那麼多線條的框。用陣營顏色當成卡牌的背景色」, then chose 「二版」 (滿版圖, design
// canvas KxzB6DUEdDH45zSVb477NQ). Contract: every event or local card the table draws — each card in the hand (data-sel,
// or data-pick while keeping cards) and the big card face (an element with data-face="<card id>") — carries
// data-camp="chen|soong|lien|ext|local" from the card's owner (a local card is local), and data-cp="<its CP>" on the
// element that shows the CP. Reports 尚未實作 until a hand card has data-camp.
import test from "node:test";
import assert from "node:assert/strict";
import { R, section, check, ok, nonEmpty, summary } from "./harness.js";
import * as D from "./driver.js";
import * as S from "../public/solo.js";
import * as C from "../public/shared/cards.js";

const CARD = Object.fromEntries([...C.EVENTS, ...C.localCards()].map((c) => [c.id, c]));
const campOf = (id) => (CARD[id].owner === "local" ? "local" : CARD[id].owner);
const tags = (html, name) => { const out = []; const re = new RegExp(`<[a-zA-Z][^<>]*?\\s${name}(?:="([^"]*)")?(?=[\\s/>])[^<>]*>`, "g"); let m; while ((m = re.exec(html))) out.push({ tag: m[0], v: m[1], at: m.index }); return out; };
const attr = (tag, name) => { const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`)); return m ? m[1] : null; };

// Hands from solo games: every seat, play decisions and the keep-cards step.
function hands() {
  const out = [];
  for (const [seat, seed] of [[0, 5101], [1, 5102], [2, 5103]]) {
    let s = S.advance(S.newSolo({ seat, level: 2, seed }));
    const R1 = D.rng(seed);
    for (let n = 0; n < 500 && s.st.phase !== "end"; n++) {
      const ch = S.choices(s, "zh-Hant");
      if (!ch.length) break;
      if (n % 3 === 0 || s.st.phase === "save") out.push({ s, where: `seat ${seat} seed ${seed} 第 ${s.st.turn} 回合 ${s.st.phase}` });
      s = S.advance(S.act(s, ch[Math.floor(R1() * ch.length)].move));
    }
  }
  return out;
}
const POOL = hands();
const handCards = (html) => tags(html, "data-sel").concat(tags(html, "data-pick")).filter((t) => CARD[t.v]);
const gate = (fn) => () => {
  const ne = nonEmpty(POOL.length, "有手牌的局面"); if (ne !== true) return ne;
  if (!POOL.some((p) => handCards(S.screen(p.s, "zh-Hant")).some((t) => attr(t.tag, "data-camp")))) return "TODO: 手牌還沒有 data-camp（#36）";
  return fn();
};

section("36 卡牌：陣營色");

check("手牌：每一張事件牌與地方牌都有 data-camp（陳宋連、外力、地方），跟牌的歸屬一致", gate(() => {
  let n = 0; const seen = new Set();
  for (const p of POOL) {
    for (const t of handCards(S.screen(p.s, "zh-Hant"))) {
      const want = campOf(t.v), got = attr(t.tag, "data-camp");
      if (got !== want) return `${p.where}：${CARD[t.v].name} 的 data-camp 是「${got}」，應為 ${want}`;
      seen.add(want); n++;
    }
  }
  const r = nonEmpty(seen.size >= 5 ? 1 : 0, `五種陣營都出現在手牌（只看到 ${[...seen].join("、")}）`); if (r !== true) return r;
  return ok(true, `${n} 張手牌，五種陣營都對`);
}));

check("大張牌面：選一張手牌時的牌面（data-face）有 data-camp，CP 在 data-cp 上", gate(() => {
  let n = 0;
  for (const p of POOL.filter((x, i) => i % 4 === 0)) {
    const html0 = S.screen(p.s, "zh-Hant");
    const pick = handCards(html0).find((t) => tags(html0, "data-sel").some((x) => x.v === t.v));
    if (!pick) continue;
    const html = S.screen(p.s, "zh-Hant", { sel: pick.v });
    const face = tags(html, "data-face");
    if (face.length !== 1 || face[0].v !== pick.v) return `${p.where}：選了 ${pick.v}，data-face 是 ${JSON.stringify(face.map((t) => t.v))}`;
    if (attr(face[0].tag, "data-camp") !== campOf(pick.v)) return `${p.where}：${CARD[pick.v].name} 的牌面 data-camp 是「${attr(face[0].tag, "data-camp")}」`;
    const cp = tags(html.slice(face[0].at), "data-cp")[0];
    if (!cp || Number(cp.v) !== CARD[pick.v].cp) return `${p.where}：牌面的 data-cp 是「${cp && cp.v}」，${CARD[pick.v].name} 是 ${CARD[pick.v].cp} CP`;
    n++;
  }
  const r = nonEmpty(n, "打開過的牌面"); if (r !== true) return r;
  return ok(true, `${n} 個牌面的陣營與 CP 都對`);
}));

test("cards", () => {
  const s = summary();
  for (const p of R.pass) console.log(`  ✓ ${p.label}${p.msg ? " — " + p.msg : ""}`);
  for (const t of s.todos) console.log(`  … ${t.label} — ${t.msg}`);
  for (const x of s.failures) console.log(`  ✗ ${x.label} — ${x.msg}`);
  console.log(`  通過 ${s.pass} / 失敗 ${s.fail} / 尚未實作 ${s.todo}`);
  assert.equal(s.fail, 0, s.failures.map((x) => `${x.label}: ${x.msg}`).join("\n"));
});
