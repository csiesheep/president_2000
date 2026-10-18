// The beginner level (新手, bots level 0, #83) reaches the player: the solo setup and the room's host offer it, and the
// bots know where the people sit (issue #87). Orchestrator's file: a peer may run it and falsify against it, and does
// not edit it. The browser half (first visit defaults to 新手, a pick is remembered) and the win rates in real solo
// sessions are tools/novice87.mjs.
//
//   node --test tests/novice87.test.js      (or `npm test`)
//
// Owner, 2026-10-18: 「請打磨此遊戲，直到其具有商業價值」, 「先免費網頁上線」. Orchestrator's #83/#87: a level a new
// player can beat, offered first. Contract:
//   - rooms: the host's lobby offers four levels, 新手 first: buttons data-level="0".."3", each with words; its start
//     action with level 0 is accepted (room.level 0) and the bots then move with no error;
//   - solo: S.newSolo({ seat, level: 0, seed }) plays to the end with the bots at level 0, every choice with words, both
//     languages; the setup's words for level 0 exist (bots[0], ui.solo.setup.levelNote[0]) in both languages and say
//     nothing of momentum or of the bots deciding a trigger (triggers are automatic since v0.8).
// 尚未實作 until the room core accepts level 0.
import test from "node:test";
import assert from "node:assert/strict";
import { R, section, check, eq, ok, nonEmpty, summary } from "./harness.js";
import * as RC from "../src/roomcore.js";
import * as C from "../public/roomclient.js";
import * as S from "../public/solo.js";
import * as D from "./driver.js";
import zh from "../public/i18n/zh-Hant.js";
import en from "../public/i18n/en.js";

const text = (html) => html.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
function table(seed = 5) {
  const w = { room: RC.newRoom({ code: "WXYZ", seed, now: 0 }), now: 0, clients: {}, errs: [] };
  w.do = (ev) => {
    w.now += 100;
    const r = RC.handle(w.room, ev, w.now);
    w.room = r.room;
    for (const o of r.out) { if (o.msg && o.msg.t === "error") w.errs.push(o.msg.code || o.msg.error || "error"); if (w.clients[o.to]) w.clients[o.to] = C.receive(w.clients[o.to], o.msg); }
    return r.out;
  };
  w.join = (conn, name) => { w.clients[conn] = C.newClient(); w.do({ type: "open", conn, name, token: null }); };
  w.click = (conn, data) => w.do({ type: "msg", conn, data });
  return w;
}
const READY = (() => { try { const w = table(); w.join("A", "Ann"); w.click("A", { t: "sit", seat: 0 }); w.click("A", { t: "start", level: 0 }); return w.room.started && w.room.level === 0; } catch { return false; } })();
const c87 = (name, fn) => check(name, () => (READY ? fn() : "TODO: 房間還不收 level 0（#87）"));

section("87 新手難度接到玩家手上");

c87("房間：房主的難度有四級、新手在最前面而且有字；選新手開局，房間是 level 0，電腦接著動不出錯", () => {
  for (const lang of ["zh-Hant", "en"]) {
    const w = table(); w.join("A", "Ann"); w.click("A", { t: "sit", seat: 0 });
    const html = C.screen(w.clients.A, lang, { level: 0 });
    const lv = [...html.matchAll(/data-level="(\d)"[^>]*>([^<]*)</g)].map((m) => [m[1], m[2].trim()]);
    if (lv.map((x) => x[0]).join(",") !== "0,1,2,3") return `${lang} 房主的難度按鈕是「${lv.map((x) => x[0]).join(",")}」（應為 0,1,2,3）`;
    if (lv.some((x) => !x[1])) return `${lang} 有沒有字的難度按鈕：${JSON.stringify(lv)}`;
    if (!/data-level="0"[^>]*aria-pressed="true"/.test(html)) return `${lang} 選了新手（level 0），按鈕卻沒有亮`;
    const starts = C.actions(w.clients.A, lang).filter((a) => a.data && a.data.t === "start").map((a) => a.data.level).sort().join(",");
    if (starts !== "0,1,2,3") return `${lang} 房主的開局選項是 ${starts}（應為 0,1,2,3）`;
    w.click("A", { t: "start", level: 0 });
    if (!(w.room.started && w.room.level === 0)) return `${lang} 選新手開局之後 room.level 是 ${w.room.level}`;
  }
  return ok(true, "中英：四級、新手在前、有字、亮起；開局 level 0");
});

c87("單人：新手（level 0）整局走得完，每個選項都有字（中英）；新手的說明有字、不提動能也不說電腦會不會觸發", () => {
  let screens = 0;
  for (const lang of ["zh-Hant", "en"]) for (const seat of [0, 1, 2]) {
    const Rn = D.rng(870 + seat); let s = S.advance(S.newSolo({ seat, level: 0, seed: 870 + seat }));
    if (s.level !== 0) return `S.newSolo({ level: 0 }) 的 session.level 是 ${s.level}`;
    for (let n = 0; n < 900 && s.st.phase !== "end"; n++) {
      const ch = S.choices(s, lang);
      if (!ch.length) { s = S.advance(s); continue; }
      if (ch.some((c) => !c.label || !String(c.label).trim())) return `${lang} seat ${seat}：有沒有字的選項`;
      s = S.advance(S.act(s, ch[Math.floor(Rn() * ch.length)].move)); screens++;
    }
    if (s.st.phase !== "end") return `${lang} seat ${seat}：新手的局沒走完（${s.st.phase}）`;
  }
  for (const [lang, d] of [["zh", zh], ["en", en]]) {
    const name = d.bots && d.bots[0], note = d.ui && d.ui.solo && d.ui.solo.setup && d.ui.solo.setup.levelNote && d.ui.solo.setup.levelNote[0];
    if (!name || !String(name).trim()) return `${lang}：bots[0]（新手的名字）沒有字`;
    if (!note || !String(note).trim()) return `${lang}：ui.solo.setup.levelNote[0]（新手的說明）沒有字`;
    const bad = lang === "zh" ? /動能|觸發/ : /momentum|trigger/i;
    for (let k = 0; k <= 3; k++) { const v = d.ui.solo.setup.levelNote[k] || ""; if (bad.test(v)) return `${lang} levelNote[${k}] 還提到動能或觸發：「${v}」`; }
  }
  const r = nonEmpty(screens, "新手局的決定"); if (r !== true) return r;
  return ok(true, `中英三個座位各一局走完（${screens} 個決定）；新手的名字與說明有字，四級的說明都不提動能與觸發`);
});

test("novice87", () => {
  const s = summary();
  for (const p of R.pass) console.log(`  ✓ ${p.label}${p.msg ? " — " + p.msg : ""}`);
  for (const t of s.todos) console.log(`  … ${t.label} — ${t.msg}`);
  for (const x of s.failures) console.log(`  ✗ ${x.label} — ${x.msg}`);
  console.log(`  通過 ${s.pass} / 失敗 ${s.fail} / 尚未實作 ${s.todo}`);
  assert.equal(s.fail, 0, s.failures.map((x) => `${x.label}: ${x.msg}`).join("\n"));
});
