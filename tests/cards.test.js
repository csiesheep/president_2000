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
// element that shows the CP. Since #36 landed, a hand without data-camp is a failure (it reported 尚未實作 before).
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
  if (!POOL.some((p) => handCards(S.screen(p.s, "zh-Hant")).some((t) => attr(t.tag, "data-camp")))) return "手牌又沒有 data-camp 了（#36 已上線，這是退步，不是尚未實作）";
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

// Owner, 2026-10-15: 「候選人牌也改版」 — the candidate card in the same look as #36 (version two). Contract: the candidate card
// at the end of the hand carries data-cand="<seat key>" and data-camp="<seat key>", data-cp="<its CP>" on the element that
// shows the CP, and the seat's picture art/candidates/<seat key>.webp; once used it carries data-used and is disabled.
// Since #37 landed, a candidate card without data-cand is a failure (it reported 尚未實作 before).
section("37 候選人牌：陣營色");

const SEAT_KEYS = ["chen", "soong", "lien"];
const CAND_CP = { chen: 5, soong: 5, lien: 3 }; // rulebook §6.3 table: 陳 5 CP, 宋 5 CP, 連 3 CP (and 2 rest)
const candEl = (html) => { const i = html.search(/<button[^<>]*class="[^"]*\bcandc\b/); if (i < 0) return null; return html.slice(i, html.indexOf("</button>", i) + 9); };
// Each seat at its first decision, before and after it uses the candidate card.
const CAND = SEAT_KEYS.map((key, seat) => {
  const s = S.advance(S.newSolo({ seat, level: 2, seed: 3700 + seat }));
  const c = S.choices(s, "zh-Hant").find((x) => x.move.type === "candidate");
  return { key, seat, s, used: c ? S.act(s, c.move) : null };
});
const candGate = (fn) => () => {
  const ne = nonEmpty(CAND.filter((c) => c.used && candEl(S.screen(c.s, "zh-Hant"))).length, "畫得出候選人牌、而且能用的開局"); if (ne !== true) return ne;
  if (!CAND.some((c) => /\sdata-cand="/.test(candEl(S.screen(c.s, "zh-Hant"))))) return "候選人牌又沒有 data-cand 了（#37 已上線，這是退步，不是尚未實作）";
  return fn();
};

check("候選人牌：三個座位都有 data-cand 與 data-camp（該座位）、data-cp（陳 5、宋 5、連 3），圖是 art/candidates/<座位>.webp", candGate(() => {
  for (const c of CAND) {
    const el = candEl(S.screen(c.s, "zh-Hant")), open = el.slice(0, el.indexOf(">") + 1);
    if (attr(open, "data-cand") !== c.key || attr(open, "data-camp") !== c.key) return `${c.key}：候選人牌是 data-cand「${attr(open, "data-cand")}」data-camp「${attr(open, "data-camp")}」`;
    const cp = tags(el, "data-cp")[0];
    if (!cp || Number(cp.v) !== CAND_CP[c.key]) return `${c.key}：候選人牌的 data-cp 是「${cp && cp.v}」，應為 ${CAND_CP[c.key]}`;
    if (!new RegExp(`<img[^<>]*\\ssrc="[^"]*art/candidates/${c.key}\\.webp"`).test(el)) return `${c.key}：候選人牌裡沒有 art/candidates/${c.key}.webp 的圖`;
  }
  return ok(true, "陳、宋、連三張候選人牌的陣營、CP 與圖都對");
}));

check("候選人牌：能用時照舊要再問一次（data-move candidate + data-confirm），寫「整局一次」；用過後是 data-used、disabled，寫「已用」", candGate(() => {
  const L = { seal: "整局一次", used: "已用" };
  for (const c of CAND) {
    const before = candEl(S.screen(c.s, "zh-Hant")), b0 = before.slice(0, before.indexOf(">") + 1);
    const mv = attr(b0, "data-move");
    if (!mv || JSON.parse(mv.replace(/&quot;/g, '"')).type !== "candidate" || attr(b0, "data-confirm") !== "1") return `${c.key}：能用的候選人牌沒有 data-move candidate 與 data-confirm="1"（${b0.slice(0, 160)}）`;
    if (/\sdata-used[\s=>]/.test(b0) || /\sdisabled[\s=>]/.test(b0)) return `${c.key}：還沒用的候選人牌就標成用過或 disabled`;
    if (!before.includes(L.seal)) return `${c.key}：還沒用的候選人牌沒有寫「${L.seal}」`;
    const after = candEl(S.screen(c.used, "zh-Hant"));
    if (!after) return `${c.key}：用過之後（${c.used.st.pending && c.used.st.pending.stage} 步）候選人牌不見了`;
    const a0 = after.slice(0, after.indexOf(">") + 1);
    if (!/\sdata-used[\s=>]/.test(a0) || !/\sdisabled[\s=>]/.test(a0) || /\sdata-move=/.test(a0)) return `${c.key}：用過的候選人牌是 ${a0.slice(0, 160)}，應有 data-used、disabled、沒有 data-move`;
    if (!after.includes(L.used) || after.includes(L.seal)) return `${c.key}：用過的候選人牌要寫「${L.used}」、不再寫「${L.seal}」`;
  }
  return ok(true, "三個座位：能用時再問一次、用過後標成已用");
}));

test("cards", () => {
  const s = summary();
  for (const p of R.pass) console.log(`  ✓ ${p.label}${p.msg ? " — " + p.msg : ""}`);
  for (const t of s.todos) console.log(`  … ${t.label} — ${t.msg}`);
  for (const x of s.failures) console.log(`  ✗ ${x.label} — ${x.msg}`);
  console.log(`  通過 ${s.pass} / 失敗 ${s.fail} / 尚未實作 ${s.todo}`);
  assert.equal(s.fail, 0, s.failures.map((x) => `${x.label}: ${x.msg}`).join("\n"));
});
