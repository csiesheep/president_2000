// The game becomes v0.6 (issue #57): new solo games and new rooms are played on rulebook v0.6 (fill "candidate", the
// owner's 「v0.6 4a」), and the table shows it. Orchestrator's file: a peer may run it and falsify against it, and does not
// edit it.
//
//   node --test tests/v06play.test.js      (or `npm test`)
//
// Owner, 2026-10-16, after the #54 simulations: 「v0.6 4a」; on the simplification: 「7 每一輪開始決定，由少到多呢？上方候選人，
// 也照票數排」. Contract (orchestrator, #57):
//   - S.newSolo(...) starts a v0.6 game with fill "candidate" (st.rules, st.fill); a room's game is the same;
//   - the tutorial is v0.6 too: it walks to the end in both languages, its texts and screens have none of what v0.6 took
//     out, and one step tells who acts first now (fewest votes first);
//   - a game saved before the switch (v0.5: st.rules "v0.5") still opens and plays: every screen renders, every choice
//     has words;
//   - a v0.6 game shows none of what v0.6 took out (Chinese 封鎖, 地方大老, 主動權, 進位, 議題交換, 第一次棄保; English
//     initiative, local boss, round up, swap), and never offers an order, swap or slot-2 reward choice;
//   - a choice that says 「免檢定」 makes no support check and one that says 「檢定約 N%」 makes one (v0.6 has no 地方大老);
//   - the candidates' panels at the top (.pl-card[data-seat]) stand in this turn's order (st.order: votes, fewest first);
//   - when the issue cards are reordered (the log's { t: "momentum", step: "shuffle", issues }), the "just now" lines
//     (S.recent) on the human's next screen say so, every time: one line naming the three issues in their new order.
// Every check reports 尚未實作 until S.newSolo starts a v0.6 game.
import test from "node:test";
import assert from "node:assert/strict";
import { R, section, check, eq, ok, nonEmpty, summary } from "./harness.js";
import * as E from "../public/shared/engine.js";
import * as S from "../public/solo.js";
import * as D from "./driver.js";
import * as RC from "../src/roomcore.js";
import * as T from "../public/tutorial.js";

const READY = (() => { try { const st = S.newSolo({ seat: 0, level: 1, seed: 1 }).st; return st.rules === "v0.6" && st.fill === "candidate"; } catch { return false; } })();
const c57 = (name, fn) => check(name, () => (READY ? fn() : "TODO: S.newSolo 開的還不是 v0.6 candidate（st.rules / st.fill），#57"));
const LANGS = ["zh-Hant", "en"];
const ISSUE_ZH = { cross: "兩岸", clean: "清廉", econ: "經濟民生" };
const FORBID = { "zh-Hant": /封鎖|地方大老|主動權|進位|議題交換|交換相鄰|第一段棄保|第一次棄保/, en: /initiative|local boss|\bboss(es)?\b|rounds? up|\bswap/i };
const GONE = (m) => m.type === "order" || m.type === "swap" || m.type === "noswap" || m.type === "reward" || (m.type === "play" && m.block);
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const panels = (html) => [...html.matchAll(/class="pl-card[^"]*" data-seat="(\d)"/g)].map((m) => Number(m[1]));

function walk(session, lang, seed, each) {
  const Rn = D.rng(seed); let s = S.advance(session);
  for (let n = 0; n < 900 && s.st.phase !== "end"; n++) {
    const ch = S.choices(s, lang);
    if (!ch.length) { s = S.advance(s); if (!S.choices(s, lang).length && s.st.phase !== "end") throw new Error(`卡住：${s.st.phase}`); continue; }
    each(s, ch);
    s = S.advance(S.act(s, ch[Math.floor(Rn() * ch.length)].move));
  }
  return s;
}

section("57 v0.6 上場");
c57("新開的單人是 v0.6 candidate；新開的房間也是", () => {
  for (const seed of [1, 2, 3]) { const st = S.newSolo({ seat: 0, level: 2, seed }).st; if (st.rules !== "v0.6" || st.fill !== "candidate") return `單人 seed ${seed}：${st.rules} ${st.fill}`; }
  let room = RC.newRoom({ code: "ABCD", seed: 11, now: 0 });
  const h = (ev) => { room = RC.handle(room, ev, 0).room; };
  h({ type: "open", conn: "A", name: "Ann", token: null }); h({ type: "msg", conn: "A", data: { t: "sit", seat: 0 } }); h({ type: "msg", conn: "A", data: { t: "start", level: 1 } });
  const r = eq(`${room.st && room.st.rules} ${room.st && room.st.fill}`, "v0.6 candidate", "房間"); if (r !== true) return r;
  return ok(true, "單人 3 個種子與房間都是 v0.6 candidate");
});
c57("切換前存的 v0.5 單人照常能玩：每個畫面都畫得出來、每個選項都有字（中英）", () => {
  let screens = 0;
  for (const lang of LANGS) {
    const s0 = S.newSolo({ seat: 0, level: 1, seed: 5 }); s0.st = E.createGame(5, { rules: "v0.5" });
    const s = walk(s0, lang, 77, (x, ch) => { S.screen(x, lang); screens++; const bad = ch.find((c) => !c.label || !String(c.label).trim()); if (bad) throw new Error(`沒有字的選項：${JSON.stringify(bad.move)}`); });
    if (s.st.phase !== "end") return `${lang}：v0.5 的局沒有走完（${s.st.phase}）`;
  }
  return ok(true, `${screens} 個畫面，中英都走完`);
});
c57("整局 v0.6 的畫面沒有 v0.6 拿掉的規則（中英）；沒有選順序、交換、第二槽的選擇；每個選項都有字", () => {
  let screens = 0;
  for (const lang of LANGS) for (const seed of [61, 62]) {
    walk(S.newSolo({ seat: 0, level: 2, seed }), lang, seed + 100, (s, ch) => {
      const html = S.screen(s, lang); screens++;
      const t = text(html), m = t.match(FORBID[lang]);
      if (m) throw new Error(`${lang} seed ${seed} 第 ${s.st.turn} 回合：「${t.slice(Math.max(0, m.index - 30), m.index + 30)}」`);
      const g = ch.find((c) => GONE(c.move)); if (g) throw new Error(`${lang} seed ${seed}：還有 ${JSON.stringify(g.move)} 的選擇`);
      const bad = ch.find((c) => !c.label || !String(c.label).trim()); if (bad) throw new Error(`${lang}：沒有字的選項 ${JSON.stringify(bad.move)}`);
    });
  }
  const r = nonEmpty(screens, "v0.6 的畫面"); if (r !== true) return r;
  return ok(true, `${screens} 個畫面（中英各兩局）`);
});
// The table guesses from the view whether a placement checks (table.js checkKind / fillNeedsCheck) and writes it on the
// choice: 「 · 免檢定」 or 「 · 檢定約 N%」. On v0.5 an opponent's 地方大老 (4 cubes) makes a same-camp fill check; v0.6 4a has
// no 地方大老, only an opponent's candidate standing there does. Each such choice is made once, on a copy, without the bots
// moving after it: the engine's log says whether the human was checked.
c57("選項上寫的「免檢定／檢定約」跟引擎一致：寫免檢定的不檢定，寫檢定約的會檢定（v0.6 沒有地方大老）", () => {
  let n = 0, free = 0;
  for (const seed of [67, 68]) {
    walk(S.newSolo({ seat: seed % 3, level: 2, seed }), "zh-Hant", seed + 7, (s, ch) => {
      for (const c of ch) {
        const says = / · 免檢定$/.test(c.label) ? "none" : / · 檢定約 \d+%$/.test(c.label) ? "check" : null;
        if (!says) continue;
        const before = s.st.log.length, after = S.act(s, c.move);
        const did = after.st.log.slice(before).some((e) => e.t === "check" && e.seat === s.seat) ? "check" : "none";
        if (did !== says) throw new Error(`seed ${seed} 第 ${s.st.turn} 回合：「${c.label}」，引擎${did === "check" ? "檢定了" : "沒有檢定"}`);
        n++; if (says === "none") free++;
      }
    });
  }
  const r = nonEmpty(n, "寫了檢定字樣的選項"); if (r !== true) return r;
  return ok(true, `${n} 個選項（${free} 個免檢定）都跟引擎一致`);
});
c57("上方候選人板照這一回合的順序排（票少的在前）", () => {
  let n = 0;
  walk(S.newSolo({ seat: 0, level: 2, seed: 63 }), "zh-Hant", 163, (s) => {
    if (s.st.phase !== "action") return;
    const got = panels(S.screen(s, "zh-Hant"));
    if (got.join() !== s.st.order.join()) throw new Error(`第 ${s.st.turn} 回合：候選人板 ${got.join()}，順序 ${s.st.order.join()}`);
    n++;
  });
  const r = nonEmpty(n, "行動階段的畫面"); if (r !== true) return r;
  return ok(true, `${n} 個畫面的候選人板都照順序`);
});
// The tutorial, walked the way a player who follows it does (as tests/tutorial.test.js walks it). On v0.6 its v0.5 step
// "order" (you hold the initiative, pick your place) has no move to make; the turn order is still something to be told.
function tutorial(lang) {
  let s = S.advance(T.newTutorial()); const rec = [];
  for (let n = 0; n < 120; n++) {
    const at = T.step(s, lang);
    rec.push({ id: at.id, kind: at.kind, text: at.text || "", html: S.screen(s, lang) });
    if (at.kind === "done") return { rec, end: "done" };
    if (at.kind === "next") s = T.next(s);
    else if (at.kind === "county") s = T.openCounty(s, at.county);
    else if (at.kind === "move" && at.moves.length) s = S.advance(T.act(s, at.moves[0]));
    else return { rec, end: `第 ${n} 步「${at.id}」是 ${at.kind}，走不下去` };
  }
  return { rec, end: "120 步還沒走完" };
}
const ORDER_RULE = { "zh-Hant": /由少到多|票(數)?(最)?少的(人)?先/, en: /fewest/i };
c57("教學是 v0.6：走得完（中英）；教學的字與畫面沒有 v0.6 拿掉的規則；有一步講這一回合誰先（票少的先）", () => {
  const st = T.newTutorial().st; if (st.rules !== "v0.6" || st.fill !== "candidate") return `教學開的是 ${st.rules} ${st.fill}`;
  let steps = 0;
  for (const lang of LANGS) {
    const w = tutorial(lang); if (w.end !== "done") return `${lang}：${w.end}`;
    for (const r of w.rec) {
      const t = r.text + " " + text(r.html), m = t.match(FORBID[lang]);
      if (m) return `${lang} 教學「${r.id}」：「${t.slice(Math.max(0, m.index - 30), m.index + 30)}」`;
    }
    if (!w.rec.some((r) => ORDER_RULE[lang].test(r.text))) return `${lang}：教學沒有一步講順序是票少的先（${ORDER_RULE[lang]}）`;
    steps += w.rec.length;
  }
  return ok(true, `中英教學共 ${steps} 步走完，沒有拿掉的字，有一步講票少的先`);
});

// The line must give the new order of all three issues: the slot-1 reward line (「第一槽「兩岸」連領先…」) names one issue, and
// 1 time in 3 the same issue lands in slot 1 again after the shuffle, so 「第一槽 + that issue」 alone passes on a table that
// never says a word about the shuffle (the probe with only newSolo switched to v0.6: 4 of 21).
const inOrder = (line, names) => { let at = -1; for (const n of names) { const i = line.indexOf(n, at + 1); if (i < 0) return false; at = i; } return true; };
c57("議題槽重排之後，你看到的下一個畫面「剛剛」有一行照新順序寫出三個議題（每次重排都說）", () => {
  let shuffles = 0, said = 0, miss = null;
  for (const seed of [64, 65, 66]) {
    let seen = 0;
    walk(S.newSolo({ seat: 0, level: 2, seed }), "zh-Hant", seed + 9, (s) => {
      const log = s.st.log.filter((e) => e.t === "momentum" && e.step === "shuffle");
      if (log.length <= seen) return;
      shuffles += log.length - seen; seen = log.length;
      const names = log[log.length - 1].issues.map((k) => ISSUE_ZH[k]), lines = S.recent(s, "zh-Hant");
      if (lines.some((l) => inOrder(l, names))) said++; else if (!miss) miss = `seed ${seed} 第 ${s.st.turn} 回合，新順序 ${names.join("、")}；「剛剛」：${JSON.stringify(lines).slice(0, 200)}`;
    });
  }
  const r = nonEmpty(shuffles, "議題槽重排"); if (r !== true) return r;
  return said === shuffles ? ok(true, `${shuffles} 次重排，每次「剛剛」都照新順序寫出三個議題`) : `${shuffles} 次重排只說了 ${said} 次；第一次沒說：${miss}`;
});

test("v06play", () => {
  const s = summary();
  for (const p of R.pass) console.log(`  ✓ ${p.label}${p.msg ? " — " + p.msg : ""}`);
  for (const t of s.todos) console.log(`  … ${t.label} — ${t.msg}`);
  for (const x of s.failures) console.log(`  ✗ ${x.label} — ${x.msg}`);
  console.log(`  通過 ${s.pass} / 失敗 ${s.fail} / 尚未實作 ${s.todo}`);
  assert.equal(s.fail, 0, s.failures.map((x) => `${x.label}: ${x.msg}`).join("\n"));
});
