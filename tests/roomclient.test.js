// The room page (M4), as far as node can see it: a client that turns server messages into a
// screen and into the messages a click sends. Driven here against the real room core
// (src/roomcore.js), so the two sides are checked together. Orchestrator's file: a peer may run
// it and falsify against it, and does not edit it. The WebSocket and the DOM are checked by
// opening two browsers, not here.
//
//   node --test tests/roomclient.test.js      (or `npm test`)
//
// Contract (issue #15): public/roomclient.js exports, with no DOM at import time
//   newClient() → client                         a plain JSON object
//   receive(client, msg) → client                one server message: hello | room | state | error
//   actions(client, lang) → [{ label, data }]    what can be clicked now; data is the message to send:
//                                                { t: "sit", seat } | { t: "start", level } | { t: "move", move }
//   screen(client, lang) → string                the HTML of the room page now
//   client.token: the token from the last hello (the page keeps it for reconnecting).
// Every check reports 尚未實作 until public/roomclient.js exists.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { R, section, check, eq, ok, nonEmpty, summary } from "./harness.js";
import * as E from "../public/shared/engine.js";
import * as RC from "../src/roomcore.js";
import zh from "../public/i18n/zh-Hant.js";
import en from "../public/i18n/en.js";
import * as D from "./driver.js";
import * as BOTS from "../public/shared/bots.js";

const CJK = /[㐀-鿿豈-﫿]/;
const FILE = new URL("../public/roomclient.js", import.meta.url);
let C = null, IMPORT_ERR = null;
if (existsSync(FILE)) { try { C = await import(FILE.href); } catch (e) { IMPORT_ERR = e; } }
const API = ["newClient", "receive", "actions", "screen"];
const c15 = (name, fn) => check(name, () => {
  if (!existsSync(FILE)) return "TODO: public/roomclient.js 還沒有（#15）";
  if (IMPORT_ERR) return `public/roomclient.js 在 node 裡 import 就丟錯（不能在 import 時碰 DOM）：${IMPORT_ERR.message}`;
  const miss = API.filter((k) => typeof C[k] !== "function");
  if (miss.length) return `TODO: public/roomclient.js 還沒有 ${miss.join("、")}（#15）`;
  return fn();
});
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const key = (m) => JSON.stringify(m);
const text = (html) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]*>/g, " ")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&amp;/g, "&")
  .replace(/\s+/g, " ");
const NAME = { "zh-Hant": ["陳水扁", "宋楚瑜", "連戰"], en: ["Chen Shui-bian", "James Soong", "Lien Chan"] };

// The room core plus clients: every message the core sends goes through receive().
function table(seed = 5) {
  const w = { room: RC.newRoom({ code: "WXYZ", seed, now: 0 }), now: 0, clients: {} };
  w.do = (ev) => {
    w.now += 100;
    const r = RC.handle(w.room, ev, w.now);
    w.room = r.room;
    for (const o of r.out) if (w.clients[o.to]) w.clients[o.to] = C.receive(w.clients[o.to], o.msg);
    return r.out;
  };
  w.join = (conn, name, token = null) => { w.clients[conn] = C.newClient(); w.do({ type: "open", conn, name, token }); };
  w.click = (conn, data) => w.do({ type: "msg", conn, data });
  return w;
}

section("15 房間頁");
c15("大廳：空位才有「入座」；入座後房主才有「開局」（三個等級），別人沒有；token 記在 client 上", () => {
  const w = table();
  w.join("A", "Ann"); w.join("B", "Bo");
  const sits = (conn) => C.actions(w.clients[conn], "zh-Hant").filter((a) => a.data && a.data.t === "sit").map((a) => a.data.seat).sort().join(",");
  let r = eq(sits("A"), "0,1,2", "A 一開始能坐的位子"); if (r !== true) return r;
  w.click("A", { t: "sit", seat: 1 });
  r = eq(sits("B"), "0,2", "A 坐 1 之後，B 能坐的位子"); if (r !== true) return r;
  w.click("B", { t: "sit", seat: 2 });
  const starts = (conn) => C.actions(w.clients[conn], "zh-Hant").filter((a) => a.data && a.data.t === "start").map((a) => a.data.level).sort().join(",");
  r = eq(starts("A"), "1,2,3", "房主 A 的開局選項（bot 等級）"); if (r !== true) return r;
  r = eq(starts("B"), "", "不是房主的 B 的開局選項"); if (r !== true) return r;
  const tok = w.clients.A.token;
  r = eq(typeof tok === "string" && tok.length >= 8, true, "client.token 是 hello 給的 token"); if (r !== true) return r;
  const seen = text(C.screen(w.clients.B, "zh-Hant"));
  if (!seen.includes("WXYZ")) return "大廳畫面沒有房間代碼 WXYZ";
  if (!seen.includes("Ann") || !seen.includes("Bo")) return "大廳畫面沒有兩位玩家的名字";
  return ok(true, "空位、房主、token、代碼、名字都對");
});
c15("一局打到結束（兩個人、一個 bot，經過真的 roomcore）：輪到你時，「走一步」的選項就是 state.legal；不是你時沒有；每個選項有字", () => {
  const w = table(7);
  w.join("A", "Ann"); w.join("B", "Bo");
  w.click("A", { t: "sit", seat: 0 }); w.click("B", { t: "sit", seat: 1 });
  w.click("A", { t: "start", level: 1 });
  const R1 = D.rng(3);
  let decisions = 0;
  for (let n = 0; n < 5000 && w.room.st.phase !== "end"; n++) {
    let acted = false;
    for (const [conn, seat] of [["A", 0], ["B", 1]]) {
      const legal = E.mustAct(w.room.st).includes(seat) ? E.legalMoves(w.room.st, seat) : [];
      const acts = C.actions(w.clients[conn], "zh-Hant").filter((a) => a.data && a.data.t === "move");
      const a = new Set(legal.map(key)), b = new Set(acts.map((x) => key(x.data.move)));
      if (acts.length !== legal.length || legal.some((m) => !b.has(key(m))) || acts.some((x) => !a.has(key(x.data.move))))
        return `第 ${w.room.st.turn} 回合 ${w.room.st.phase} seat ${seat}：選項 ${acts.length} 個、legal ${legal.length} 個，不一樣`;
      const bad = acts.find((x) => typeof x.label !== "string" || !x.label.trim());
      if (bad) return `seat ${seat} 有選項沒有字：${JSON.stringify(bad.data)}`;
      if (!acts.length) continue;
      w.click(conn, acts[Math.floor(R1() * acts.length)].data); decisions++; acted = true; break;
    }
    if (!acted) return `第 ${w.room.st.turn} 回合 ${w.room.st.phase}：兩個人都沒有選項，要動的是 ${JSON.stringify(E.mustAct(w.room.st))}`;
  }
  let r = eq(w.room.st.phase, "end", "結束"); if (r !== true) return r;
  const res = w.room.st.result;
  for (const [conn, lang] of [["A", "zh-Hant"], ["B", "en"]]) {
    const seen = text(C.screen(w.clients[conn], lang));
    if (!seen.includes(NAME[lang][res.winner])) return `${lang} 結束畫面沒有當選人 ${NAME[lang][res.winner]}`;
    const miss = res.votes.filter((v) => !new RegExp(`(^|\\D)${v}(\\D|$)`).test(seen));
    if (miss.length) return `${lang} 結束畫面少了票數 ${miss.join("、")}`;
  }
  return ok(true, `${decisions} 個人類的決定；${res.votes.join("/")}，${NAME["zh-Hant"][res.winner]}當選`);
});
c15("錯誤：伺服器回 error 時，畫面上寫出 errors 裡那個碼的說明（中英）", () => {
  const w = table();
  w.join("A", "Ann"); w.join("B", "Bo");
  w.click("A", { t: "sit", seat: 0 });
  w.click("B", { t: "sit", seat: 0 });            // seat_taken
  const errs = [["zh-Hant", zh], ["en", en]];
  for (const [lang, t] of errs) {
    if (!t.errors || !t.errors.seat_taken) return `${lang} 沒有 errors.seat_taken（#14 還沒 land？）`;
    const seen = text(C.screen(w.clients.B, lang));
    if (!seen.includes(t.errors.seat_taken)) return `${lang} 畫面沒有 seat_taken 的說明「${t.errors.seat_taken}」`;
  }
  w.click("B", { t: "start", level: 1 });          // not_host (B is not seated yet either: either message is fine)
  const last = w.clients.B;
  const seen = text(C.screen(last, "zh-Hant"));
  if (!["not_host", "not_seated"].some((k) => zh.errors[k] && seen.includes(zh.errors[k]))) return "B 按開局後，畫面沒有 not_host 或 not_seated 的說明";
  return ok(true, "seat_taken 中英、開局被拒");
});
c15("英文：大廳、對局中、結束的英文畫面與選項都沒有中文字（語言切換鈕的「中文」除外）", () => {
  const w = table(9);
  w.join("A", "Ann"); w.join("B", "Bo");
  const cjk = (conn, where) => {
    const t = text(C.screen(w.clients[conn], "en")).replace(/中文/g, "") + " | " + C.actions(w.clients[conn], "en").map((a) => a.label).join(" | ");
    const m = t.match(new RegExp(`.{0,12}${CJK.source}.{0,12}`));
    return m ? `${where}：${JSON.stringify(m[0])}` : null;
  };
  let bad = cjk("A", "大廳"); if (bad) return bad;
  w.click("A", { t: "sit", seat: 2 }); w.click("B", { t: "sit", seat: 0 }); w.click("A", { t: "start", level: 2 });
  const R1 = D.rng(8);
  let n = 0;
  for (; n < 5000 && w.room.st.phase !== "end"; n++) {
    for (const conn of ["A", "B"]) { bad = cjk(conn, `第 ${w.room.st.turn} 回合 ${w.room.st.phase}`); if (bad) return bad; }
    const conn = ["A", "B"].find((c) => C.actions(w.clients[c], "en").some((a) => a.data && a.data.t === "move"));
    if (!conn) return "沒有人有選項";
    const acts = C.actions(w.clients[conn], "en").filter((a) => a.data && a.data.t === "move");
    w.click(conn, acts[Math.floor(R1() * acts.length)].data);
  }
  bad = cjk("A", "結束"); if (bad) return bad;
  return ok(true, `${n} 步的英文畫面`);
});

// ---- 軍師（#18）. roomclient.js also exports setAdvisor(client, on) → client; receive() keeps it.
// With it on and the seat to act, actions() marks exactly one move advised: true, the move
// bots.advise(view, legal) picks from what the server sent, and screen() shows the reason
// (talk[why.key], placeholders filled; not for only_move). Not your turn, or off: nothing marked.
const ADV = !!(C && typeof C.setAdvisor === "function");
const c18 = (name, fn) => c15(name, () => (ADV ? fn() : "TODO: roomclient.js 還沒有 setAdvisor（#18）"));
const literal = (tpl) => String(tpl).split(/\{\w+\}/).map((x) => x.trim()).filter((x) => x.length >= 2).sort((a, b) => b.length - a.length)[0] || "";
section("18 軍師（房間）");
c18("房間裡 A 開軍師、B 不開：輪到 A 時剛好一個「走一步」標 advised，就是 bots.advise(view, legal) 那一步，畫面有理由；沒輪到 A 時、還有 B，都沒有標", () => {
  const w = table(17);
  w.join("A", "Ann"); w.join("B", "Bo");
  w.click("A", { t: "sit", seat: 0 }); w.click("B", { t: "sit", seat: 1 });
  w.clients.A = C.setAdvisor(w.clients.A, true);
  w.click("A", { t: "start", level: 1 });
  const R1 = D.rng(5);
  let mine = 0, reasons = 0;
  for (let n = 0; n < 5000 && w.room.st.phase !== "end"; n++) {
    const movesOf = (conn) => C.actions(w.clients[conn], "zh-Hant").filter((x) => x.data && x.data.t === "move");
    const a = movesOf("A"), b = movesOf("B");
    if (b.some((x) => x.advised)) return "B 沒開軍師，卻有選項標 advised";
    const markedA = a.filter((x) => x.advised);
    const where = `第 ${w.room.st.turn} 回合 ${w.room.st.phase}`;
    if (!a.length && markedA.length) return `${where}：沒輪到 A，卻有標 advised`;
    if (a.length) {
      const want = BOTS.advise(E.view(w.room.st, 0), E.legalMoves(w.room.st, 0));
      if (markedA.length !== 1) return `${where}：A 標 advised 的選項有 ${markedA.length} 個`;
      if (!same(markedA[0].data.move, want.move)) return `${where}：A 標的是 ${JSON.stringify(markedA[0].data.move)}，軍師選的是 ${JSON.stringify(want.move)}`;
      if (want.why.key !== "only_move") {
        const seen = text(C.screen(w.clients.A, "zh-Hant")), lit = literal(zh.talk[want.why.key]);
        if (lit && !seen.includes(lit)) return `${where}：A 的畫面沒有軍師的理由（${want.why.key}：「${lit}」）`;
        reasons++;
      }
      mine++;
    }
    const conn = a.length ? "A" : b.length ? "B" : null;
    if (!conn) return `${where}：兩個人都沒有選項`;
    const acts = conn === "A" ? a : b;
    w.click(conn, acts[Math.floor(R1() * acts.length)].data);
  }
  const r = nonEmpty(reasons, "A 有理由的決定"); if (r !== true) return r;
  return ok(true, `A 的 ${mine} 個決定都標對，${reasons} 句理由；B 沒有標`);
});

test("roomclient", () => {
  const s = summary();
  for (const p of R.pass) console.log(`  ✓ ${p.label}${p.msg ? " — " + p.msg : ""}`);
  for (const t of s.todos) console.log(`  … ${t.label} — ${t.msg}`);
  for (const f of s.failures) console.log(`  ✗ ${f.label} — ${f.msg}`);
  console.log(`  通過 ${s.pass} / 失敗 ${s.fail} / 尚未實作 ${s.todo}`);
  assert.equal(s.fail, 0, s.failures.map((f) => `${f.label}: ${f.msg}`).join("\n"));
});
