// The game page laid out again (issue #66, design 甲 「疊層收緊」), as far as node can see it. Orchestrator's file: a peer
// may run it and falsify against it, and does not edit it. Whether the whole map is on one screen, how far the hand is
// lowered and what a tap does are measured in a browser (tools/gamepage66.mjs).
//
//   node --test tests/gamepage66.test.js      (or `npm test`)
//
// Owner, 2026-10-17: 「重新設計一下遊戲頁，目標是不 scroll 就能看到完整地圖；去除 剛剛 panel；去除 第1/4次出牌；手牌位置降低
// 一半，點了才升高，並且出現使用，及可以使用的動作；對手的動作直接 highlight 在地圖上，或是議題頭條上；紀錄變成上方按鈕，
// 可縮放；地圖下方，移除北北基，桃竹苗 等」, and of three designs (the canvas 「遊戲頁重排 · 不捲動看全圖」): 「甲」.
// Contract, screen(session, lang, opts) of a solo game, Chinese and English:
//   - no 「剛剛」 block ([data-now] / .t-now) and no region list (.tw-reg) or cube legend (.tw-leg) under the map;
//   - the record is a button in the top row: [data-feed-toggle] inside the <header class="t-top">, with
//     data-new="<n>" = the number of the rivals' entries in session.rec (seat set, not the human's, not "say");
//     the record itself (.t-feed, when there is anything to record) carries data-open="1" when opts.feedOpen is true,
//     data-open="0" otherwise;
//   - the decision is a sheet, [data-sheet], drawn only when there is something to decide beyond picking a card: a
//     card is selected (opts.sel, a card in hand or in the pile the phase draws from), or the human has a choice that
//     is not a card pick (a card pick: play / reveal / canvass with a card, or the candidate card — so the order, the
//     momentum choices, keeping cards, a play that is pending, the debate's award, election day's placements all open
//     the sheet), or the candidate card waits for its confirmation (opts.confirm), or exactly one card can be picked
//     and nothing else (the table opens that card by itself, as today). While the human only has to pick a card and
//     none is selected there is no [data-sheet] and the words 「第 n / 4 次出牌」 (p.play) are not on the page;
//   - with a card selected the sheet carries data-card="<id>" and holds every .opt[data-move] whose move.card is
//     that card (as sheetHTML does today);
//   - the hand footer carries data-hand="up" when a card is selected, "down" otherwise, and data-pick="1" exactly
//     when the human may play a card now (a choice whose move has a card);
//   - the rivals' moves are on the map: for every county the rivals' entries in session.rec touched with a cube
//     (fill / cross / grey / steal / remove, ok) or moved to, the county keeps data-changed and the page has one
//     [data-act-chip][data-county="<k>"] with data-who="<seat key>" (the rival with the most such entries there, the
//     earlier seat on a tie) and data-n="<that count>"; for every issue a rival's entry touched (k "issue") there is
//     one [data-act-chip][data-issue="<issue>"][data-who]; and a one-line toast [data-act-toast] exists exactly when
//     the rivals have entries in rec (it holds the record's words; what it says is the table's).
// Since #66 landed (a90a346), a header without the record button is a failure (it reported 尚未實作 before).
import test from "node:test";
import assert from "node:assert/strict";
import { R, section, check, ok, nonEmpty, summary } from "./harness.js";
import * as D from "./driver.js";
import * as S from "../public/solo.js";
import { bind } from "../public/table.js";

const KEYS = ["chen", "soong", "lien"];
const CUBE = new Set(["fill", "cross", "grey", "steal", "remove"]);

// Solo games stepped one move at a time; every 5th state, every state where the human has a card play pending, and
// every state right after the rivals moved (rec not empty, human to act) is kept.
function states() {
  const out = [];
  for (const [seat, seed] of [[0, 6601], [1, 6602], [2, 6603]]) {
    let s = S.newSolo({ seat, level: 2, seed });
    const R1 = D.rng(seed);
    const keep = (why, n) => out.push({ s, where: `seat ${seat} seed ${seed} 第 ${s.st.turn} 回合第 ${n} 步（${why}）` });
    for (let n = 0; n < 3000 && s.st.phase !== "end"; n++) {
      const bots = S.botsToMove(s).length > 0, pend = !!s.st.pending, ch = bots ? [] : S.choices(s, "zh-Hant");
      if (n % 5 === 0) keep(bots ? "對手" : "我", n);
      else if (!bots && pend) keep("牌出到一半", n);
      else if (!bots && (s.rec || []).some((e) => e.seat != null && e.seat !== seat) && ch.some((c) => c.move.card)) keep("對手剛動過", n);
      if (bots) s = S.stepBot(s);
      else { if (!ch.length) break; s = S.act(s, ch[Math.floor(R1() * ch.length)].move); }
    }
  }
  return out;
}
const POOL = states();
const LANGS = [["zh-Hant", "中文"], ["en", "英文"]];

const tags = (html, name) => [...html.matchAll(new RegExp(`<[a-zA-Z][^<>]*?\\s${name}(?:="([^"]*)")?(?=[\\s/>])[^<>]*>`, "g"))].map((m) => ({ tag: m[0], v: m[1], at: m.index }));
const attr = (tag, name) => { const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`)); return m ? m[1] : null; };
function elementAt(html, t) {
  const tn = t.tag.match(/^<([a-zA-Z0-9-]+)/)[1].toLowerCase();
  const re = new RegExp(`<(/?)${tn}(?=[\\s>/])[^<>]*>`, "gi");
  re.lastIndex = t.at + t.tag.length;
  let depth = 1, m;
  while ((m = re.exec(html))) { if (m[1]) depth--; else if (!/\/>$/.test(m[0])) depth++; if (!depth) return html.slice(t.at, m.index + m[0].length); }
  return html.slice(t.at);
}
const element = (html, name) => { const t = tags(html, name)[0]; return t ? elementAt(html, t) : null; };
const squash = (s) => s.replace(/\s+/g, "");
const me = (p) => p.s.seat;
const rivalsRec = (p) => (p.s.rec || []).filter((e) => e.seat != null && e.seat !== me(p) && e.k !== "say");
// The pile a tap picks from (the hand, or the debate / election pile), as sourceCards does — written here from the rules.
const pile = (v) => { const a = v.phase === "debate" ? v.savedDebate[v.seat] : v.phase === "election" ? v.savedElection[v.seat] : v.hands[v.seat]; return Array.isArray(a) ? a : []; };
const view = (p) => JSON.parse(JSON.stringify(S.screenView ? S.screenView(p.s) : null)) || null;

const gate = (fn) => () => {
  const ne = nonEmpty(POOL.length, "牌桌的狀態"); if (ne !== true) return ne;
  if (!POOL.some((p) => tags(S.screen(p.s, "zh-Hant"), "data-feed-toggle").length)) return "上方沒有紀錄按鈕（data-feed-toggle）了（#66 已上線，這是退步，不是尚未實作）";
  return fn();
};

section("66 遊戲頁重排（甲）");

check("沒有「剛剛」，地圖下面沒有區域清單與方塊圖例", gate(() => {
  let n = 0;
  for (const p of POOL) for (const [lang, name] of LANGS) {
    const html = S.screen(p.s, lang);
    if (tags(html, "data-now").length || /class="t-now/.test(html)) return `${p.where}（${name}）：還有「剛剛」`;
    if (/class="tw-reg/.test(html)) return `${p.where}（${name}）：地圖下面還有區域清單（tw-reg）`;
    if (/tw-leg/.test(html)) return `${p.where}（${name}）：地圖下面還有方塊圖例（tw-leg）`;
    n++;
  }
  return ok(true, `${n} 個畫面都沒有`);
}));

check("紀錄是上方的按鈕：header 裡有 data-feed-toggle，data-new 是對手在 rec 裡的筆數；紀錄本體 data-open 照 opts.feedOpen", gate(() => {
  let n = 0, withNew = 0, withFeed = 0;
  for (const p of POOL) for (const [lang, name] of LANGS) {
    for (const open of [false, true]) {
      const html = S.screen(p.s, lang, open ? { feedOpen: true } : {});
      const head = element(html, "class=\"t-top") || element(html, "class=\"t-top\"");
      const hd = head || (html.match(/<header[\s\S]*?<\/header>/) || [""])[0];
      const tg = tags(hd, "data-feed-toggle");
      if (tg.length !== 1) return `${p.where}（${name}）：header 裡有 ${tg.length} 個 data-feed-toggle`;
      const want = rivalsRec(p).length;
      if (attr(tg[0].tag, "data-new") !== String(want)) return `${p.where}（${name}）：data-new 是 ${attr(tg[0].tag, "data-new")}，rec 裡對手的筆數是 ${want}`;
      if (want) withNew++;
      const feed = tags(html, "data-open").filter((t) => /class="t-feed/.test(t.tag));
      if ((p.s.feed || []).length) {
        if (feed.length !== 1) return `${p.where}（${name}）：有紀錄卻沒有 .t-feed[data-open]`;
        if (feed[0].v !== (open ? "1" : "0")) return `${p.where}（${name}，feedOpen=${open}）：data-open 是 ${feed[0].v}`;
        withFeed++;
      }
    }
    n++;
  }
  const r = nonEmpty(withNew, "對手動過的畫面"); if (r !== true) return r;
  const r2 = nonEmpty(withFeed, "有紀錄的畫面"); if (r2 !== true) return r2;
  return ok(true, `${n} 個狀態（兩種語言、開與關）；${withNew} 次 data-new > 0，${withFeed} 次有紀錄`);
}));

check("只在要決定時才有面板：選牌中沒有 data-sheet、沒有「第 n / 4 次出牌」；選了牌、牌出到一半、非行動階段的決定、候選人牌確認時有", gate(() => {
  const seen = { none: 0, sel: 0, pending: 0, phase: 0, confirm: 0 };
  for (const p of POOL) for (const [lang, name] of LANGS) {
    // (the human's choices come from the rules alone: in the save and debate phases all three act at once, so there are
    // choices while the rivals are still to move)
    const x = bind(lang), ch = S.choices(p.s, lang), v = p.s.st;
    const cards = pile({ phase: v.phase, seat: me(p), savedDebate: v.savedDebate, savedElection: v.savedElection, hands: v.hands });
    const html = S.screen(p.s, lang), sheet = tags(html, "data-sheet");
    // A card pick: playing, revealing (the debate) or canvassing with (election day) a card, or the candidate card.
    const isPick = (c) => c.move.type === "candidate" || (!!c.move.card && ["play", "reveal", "canvass"].includes(c.move.type));
    // Only one card can be picked and nothing else: the table opens that card's sheet by itself (as it does today).
    const pickCards = [...new Set(ch.filter((c) => isPick(c) && c.move.card).map((c) => c.move.card))];
    const auto = ch.length > 0 && ch.every(isPick) && pickCards.length === 1 && !ch.some((c) => c.move.type === "candidate");
    const want = ch.length > 0 && (ch.some((c) => !isPick(c)) || auto);
    if (!!sheet.length !== want) return `${p.where}（${name}）：沒選牌時 data-sheet ${sheet.length ? "有" : "沒有"}，應${want ? "有" : "沒有"}（phase ${v.phase}，pending ${v.pending ? v.pending.stage : "無"}，${ch.length} 個選項）`;
    if (!want && ch.length && html.includes(x.tr("p.play", { n: Math.min(v.step + 1, 4) }))) return `${p.where}（${name}）：選牌中還寫著「${x.tr("p.play", { n: Math.min(v.step + 1, 4) })}」`;
    if (want) seen[v.phase !== "action" ? "phase" : "pending"]++; else if (ch.length) seen.none++;
    // a card selected: the sheet is that card's, with its plays
    // (keeping cards is picked with data-pick, not a selection: the save panel ignores opts.sel while there is a choice of sets)
    const card = v.phase === "save" && ch.length > 1 ? null : cards.find((id) => ch.some((c) => c.move.card === id)) || cards[0];
    if (card) {
      const h2 = S.screen(p.s, lang, { sel: card }), sh = tags(h2, "data-sheet");
      if (sh.length !== 1 || attr(sh[0].tag, "data-card") !== card) return `${p.where}（${name}）：選了「${x.card(card)}」卻沒有 data-sheet[data-card]（${sh.length} 個，data-card ${sh.length ? attr(sh[0].tag, "data-card") : "-"}）`;
      const body = elementAt(h2, sh[0]), plays = ch.filter((c) => c.move.card === card);
      for (const c of plays) if (!body.includes(`data-move="${JSON.stringify(c.move).replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"`)) return `${p.where}（${name}）：面板裡少了「${c.label}」`;
      seen.sel++;
    }
    const cand = ch.find((c) => c.move.type === "candidate");
    if (cand) {
      const h3 = S.screen(p.s, lang, { confirm: JSON.stringify(cand.move) });
      if (!tags(h3, "data-sheet").length) return `${p.where}（${name}）：候選人牌等確認時沒有 data-sheet`;
      seen.confirm++;
    }
  }
  for (const k of Object.keys(seen)) { const r = nonEmpty(seen[k], { none: "選牌中", sel: "選了牌", pending: "牌出到一半", phase: "非行動階段的決定", confirm: "候選人牌確認" }[k]); if (r !== true) return r; }
  return ok(true, `選牌中 ${seen.none}、選了牌 ${seen.sel}、出到一半 ${seen.pending}、其他階段 ${seen.phase}、候選人牌 ${seen.confirm} 都對`);
}));

check("手牌：data-hand 選了牌是 up、否則 down；可以出牌時 data-pick=\"1\"", gate(() => {
  let up = 0, down = 0, pick = 0;
  for (const p of POOL) for (const [lang, name] of LANGS) {
    const ch = S.choices(p.s, lang), v = p.s.st;
    const cards = pile({ phase: v.phase, seat: me(p), savedDebate: v.savedDebate, savedElection: v.savedElection, hands: v.hands });
    const canPick = ch.some((c) => c.move.card);
    const h1 = S.screen(p.s, lang), hand = tags(h1, "data-hand").filter((t) => /t-hand/.test(t.tag));
    if (hand.length !== 1) return `${p.where}（${name}）：${hand.length} 個 .t-hand[data-hand]`;
    // (#69: keeping cards with a choice of sets raises the tray by itself; that rule is tests/labels69.test.js's)
    if (hand[0].v !== "down" && !(v.phase === "save" && ch.length > 1)) return `${p.where}（${name}）：沒選牌時 data-hand 是 ${hand[0].v}`;
    if ((attr(hand[0].tag, "data-pick") === "1") !== canPick) return `${p.where}（${name}）：data-pick ${attr(hand[0].tag, "data-pick")}，${canPick ? "可以" : "不能"}出牌`;
    down++; if (canPick) pick++;
    if (cards[0]) {
      const h2 = S.screen(p.s, lang, { sel: cards[0] }), hd = tags(h2, "data-hand").filter((t) => /t-hand/.test(t.tag));
      if (!hd.length || hd[0].v !== "up") return `${p.where}（${name}）：選了牌 data-hand 是 ${hd.length ? hd[0].v : "沒有"}`;
      up++;
    }
  }
  const r = nonEmpty(pick, "可以出牌的畫面"); if (r !== true) return r;
  return ok(true, `down ${down}、up ${up}、可出牌 ${pick}`);
}));

check("對手的動作在地圖與頭條上：每個被動到的縣市一個 data-act-chip（誰、幾顆）而且縣市 data-changed；動到的議題一個 chip；有對手動作才有 data-act-toast", gate(() => {
  let chips = 0, issueChips = 0, toasts = 0, quiet = 0;
  for (const p of POOL) for (const [lang, name] of LANGS) {
    const html = S.screen(p.s, lang), rec = rivalsRec(p);
    const per = new Map(), issues = new Map();
    for (const e of rec) {
      if (CUBE.has(e.k) && e.county != null && e.ok) { if (!per.has(e.county)) per.set(e.county, [0, 0, 0]); per.get(e.county)[e.seat]++; }
      else if (e.k === "move" && e.to != null) { if (!per.has(e.to)) per.set(e.to, [0, 0, 0]); }
      else if (e.k === "issue" && e.issue != null) { if (!issues.has(e.issue)) issues.set(e.issue, [0, 0, 0]); issues.get(e.issue)[e.seat]++; }
    }
    const got = tags(html, "data-act-chip");
    for (const [k, cnt] of per) {
      const c = got.filter((t) => attr(t.tag, "data-county") === String(k));
      if (c.length !== 1) return `${p.where}（${name}）：縣市 ${k} 有 ${c.length} 個 chip`;
      const max = Math.max(...cnt), who = cnt.indexOf(max);
      if (max > 0 && (attr(c[0].tag, "data-who") !== KEYS[who] || attr(c[0].tag, "data-n") !== String(max))) return `${p.where}（${name}）：縣市 ${k} 的 chip 是 ${attr(c[0].tag, "data-who")} ${attr(c[0].tag, "data-n")}，應為 ${KEYS[who]} ${max}`;
      const g = tags(html, "data-county").find((t) => t.v === String(k) && /tw-c/.test(t.tag));
      if (!g || !/\sdata-changed(?=[\s>])/.test(g.tag)) return `${p.where}（${name}）：縣市 ${k} 沒有 data-changed`;
      chips++;
    }
    for (const [iss, cnt] of issues) {
      const c = got.filter((t) => attr(t.tag, "data-issue") === iss);
      if (c.length !== 1) return `${p.where}（${name}）：議題 ${iss} 有 ${c.length} 個 chip`;
      if (attr(c[0].tag, "data-who") !== KEYS[cnt.indexOf(Math.max(...cnt))]) return `${p.where}（${name}）：議題 ${iss} 的 chip 是 ${attr(c[0].tag, "data-who")}`;
      issueChips++;
    }
    const extra = got.filter((t) => (attr(t.tag, "data-county") != null && !per.has(Number(attr(t.tag, "data-county")))) || (attr(t.tag, "data-issue") != null && !issues.has(attr(t.tag, "data-issue"))));
    if (extra.length) return `${p.where}（${name}）：多了 ${extra.length} 個沒人動過的 chip（${extra.map((t) => attr(t.tag, "data-county") ?? attr(t.tag, "data-issue")).join(",")}）`;
    const toast = tags(html, "data-act-toast");
    if (!!toast.length !== rec.length > 0) return `${p.where}（${name}）：rec 裡對手 ${rec.length} 筆，data-act-toast ${toast.length ? "有" : "沒有"}`;
    if (rec.length) toasts++; else quiet++;
  }
  for (const [n, w] of [[chips, "縣市 chip"], [issueChips, "議題 chip"], [toasts, "有對手動作的畫面"], [quiet, "沒有對手動作的畫面"]]) { const r = nonEmpty(n, w); if (r !== true) return r; }
  return ok(true, `縣市 chip ${chips}、議題 chip ${issueChips}、toast ${toasts}、安靜 ${quiet} 都對`);
}));

test("gamepage66", () => {
  const s = summary();
  for (const p of R.pass) console.log(`  ✓ ${p.label}${p.msg ? " — " + p.msg : ""}`);
  for (const t of s.todos) console.log(`  … ${t.label} — ${t.msg}`);
  for (const x of s.failures) console.log(`  ✗ ${x.label} — ${x.msg}`);
  console.log(`  通過 ${s.pass} / 失敗 ${s.fail} / 尚未實作 ${s.todo}`);
  assert.equal(s.fail, 0, s.failures.map((x) => `${x.label}: ${x.msg}`).join("\n"));
  void view;
});
