// The issue track as newspaper headlines (issue #65, design 乙 「黑底報眉」), as far as node can see it. Orchestrator's
// file: a peer may run it and falsify against it, and does not edit it. The look and the space it takes on a phone and a
// desk are measured in a browser (tools/issuehl65.mjs).
//
//   node --test tests/issuehl65.test.js      (or `npm test`)
//
// Owner, 2026-10-16/17: 「重新設計 議題欄位，改成頭條，UI 改成像報紙或是電視」, then 「維持原本的欄位空間」, then 「議題頭條
// 採用 丙的排版，但是設計成報紙的樣式」, and of those three (the canvas 「議題頭條」, third row): 「乙」. Contract, on the
// table (screen(session, lang)) whenever the issue track is drawn, Chinese and English:
//   - the three slots stay buttons [data-issue="<issue>"] with data-help="slot", in track order, and carry
//     data-hl-slot="1|2|3"; each names its place [data-hl-label]: 「頭條」「二條」「三條」 in Chinese; in English three
//     different words, none of them "slot";
//   - each carries its reward in its flag [data-hl-reward]: Chinese 「+1 動能、抽背書」, 「抽背書」, 「+1 動能」; English
//     momentum and an endorsement, an endorsement only, momentum only;
//   - each says who leads it [data-hl-status]: Chinese 「{誰}領先」 when one candidate has the most cubes, 「{誰}{誰}平手」
//     (in seat order 陳 宋 連) when two or three share the most, 「無人表態」 when nobody has a cube; English names the
//     leader, names everyone tied, and names nobody when it is empty;
//   - each shows the issue's name [data-hl-name] and its cubes (.b.o0 / .o1 / .o2, one per cube);
//   - the track's label (the help button, data-help="slot") says 「議題頭條」 in Chinese, not "slot" in English;
//   - the slots have their new names everywhere a player reads them: no 「第一槽／第 1 槽…」 in any Chinese string and no
//     "slot 1" / "first slot"… in any English one (the help, the record, the rules page, the tutorial, the advisor), and
//     the help for the slots names 頭條、二條、三條 (in English, the three words on the track).
// Before #65 lands no slot carries data-hl-slot: every row reports 尚未實作.
import test from "node:test";
import assert from "node:assert/strict";
import { R, section, check, ok, nonEmpty, summary } from "./harness.js";
import * as D from "./driver.js";
import * as S from "../public/solo.js";
import { bind } from "../public/table.js";
import zh from "../public/i18n/zh-Hant.js";
import en from "../public/i18n/en.js";

const SHORT_ZH = ["陳", "宋", "連"], SHORT_EN = ["Chen", "Soong", "Lien"];
const LABEL_ZH = ["頭條", "二條", "三條"];
const REWARD_ZH = ["+1 動能、抽背書", "抽背書", "+1 動能"];

// Tables along three solo games, every 9th step (the track moves with every cube placed).
function tables() {
  const out = [];
  for (const [seat, seed] of [[0, 6501], [1, 6502], [2, 6503]]) {
    let s = S.newSolo({ seat, level: 2, seed });
    const R1 = D.rng(seed);
    for (let n = 0; n < 4000 && s.st.phase !== "end"; n++) {
      if (n % 9 === 0) out.push({ s, where: `seat ${seat} seed ${seed} 第 ${s.st.turn} 回合第 ${n} 步` });
      if (S.botsToMove(s).length) s = S.stepBot(s);
      else { const ch = S.choices(s, "zh-Hant"); if (!ch.length) break; s = S.act(s, ch[Math.floor(R1() * ch.length)].move); }
    }
  }
  return out;
}
const POOL = tables();
const LANGS = [["zh-Hant", "中文"], ["en", "英文"]];

const tags = (html, name) => [...html.matchAll(new RegExp(`<[a-zA-Z][^<>]*?\\s${name}(?:="([^"]*)")?(?=[\\s/>])[^<>]*>`, "g"))].map((m) => ({ tag: m[0], v: m[1], at: m.index }));
const attr = (tag, name) => { const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`)); return m ? m[1] : null; };
const decode = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&amp;/g, "&");
// The markup of an element starting at a tag, up to its own closing tag.
function elementAt(html, t) {
  const tn = t.tag.match(/^<([a-zA-Z0-9-]+)/)[1].toLowerCase();
  const re = new RegExp(`<(/?)${tn}(?=[\\s>/])[^<>]*>`, "gi");
  re.lastIndex = t.at + t.tag.length;
  let depth = 1, m;
  while ((m = re.exec(html))) { if (m[1]) depth--; else if (!/\/>$/.test(m[0])) depth++; if (!depth) return html.slice(t.at, m.index + m[0].length); }
  return html.slice(t.at);
}
const element = (html, name) => { const t = tags(html, name)[0]; return t ? elementAt(html, t) : null; };
const text = (h) => (h == null ? null : decode(h.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim());
const squash = (s) => (s == null ? null : s.replace(/\s+/g, ""));
// The three slot buttons of a table, in document order.
const slots = (html) => tags(html, "data-issue").filter((t) => /^<button/i.test(t.tag)).map((t) => ({ tag: t.tag, v: t.v, html: elementAt(html, t) }));
const kind = (c) => { const max = Math.max(...c); if (max === 0) return { k: "none" }; const top = [0, 1, 2].filter((p) => c[p] === max); return top.length === 1 ? { k: "lead", who: top } : { k: "tie", who: top }; };

const gate = (fn) => () => {
  const ne = nonEmpty(POOL.length, "畫著議題軌道的牌桌"); if (ne !== true) return ne;
  if (!POOL.some((p) => tags(S.screen(p.s, "zh-Hant"), "data-hl-slot").length)) return "TODO: 議題欄還沒有報紙頭條（data-hl-slot）——#65 還沒做";
  return fn();
};

section("65 議題頭條 · 黑底報眉（乙）");

check("三條照軌道順序：按鈕 data-issue、data-help=\"slot\"、data-hl-slot 1–3；中文寫「頭條」「二條」「三條」，英文三個不同的字、沒有 slot", gate(() => {
  let n = 0; const enLabels = new Set();
  for (const p of POOL) for (const [lang, name] of LANGS) {
    const html = S.screen(p.s, lang), sl = slots(html), want = p.s.st.issues.map((i) => i.name);
    if (sl.map((s) => s.v).join() !== want.join()) return `${p.where}（${name}）：議題按鈕是 ${sl.map((s) => s.v).join()}，軌道是 ${want.join()}`;
    const labels = [];
    for (const [i, s] of sl.entries()) {
      if (attr(s.tag, "data-help") !== "slot") return `${p.where}（${name}）：第 ${i + 1} 條不是 data-help="slot"`;
      if (attr(s.tag, "data-hl-slot") !== String(i + 1)) return `${p.where}（${name}）：第 ${i + 1} 條的 data-hl-slot 是 ${attr(s.tag, "data-hl-slot")}`;
      const l = text(element(s.html, "data-hl-label"));
      if (l == null) return `${p.where}（${name}）：第 ${i + 1} 條沒有 data-hl-label`;
      labels.push(l);
    }
    if (lang === "zh-Hant" && labels.map(squash).join() !== LABEL_ZH.join()) return `${p.where}：標籤是 ${labels.join("、")}，應為 ${LABEL_ZH.join("、")}`;
    if (lang === "en") {
      if (new Set(labels).size !== 3 || labels.some((l) => !l || /slot/i.test(l))) return `${p.where}（英文）：標籤是 ${labels.join(" / ")}`;
      enLabels.add(labels.join(" / "));
    }
    n++;
  }
  return ok(true, `${n} 個牌桌（兩種語言）三條的順序與標籤都對；英文是「${[...enLabels].join("；")}」`);
}));

check("報眉的獎勵：中文頭條「+1 動能、抽背書」、二條「抽背書」、三條「+1 動能」；英文頭條動能與背書、二條只有背書、三條只有動能", gate(() => {
  let n = 0;
  for (const p of POOL) for (const [lang, name] of LANGS) {
    for (const [i, s] of slots(S.screen(p.s, lang)).entries()) {
      const r = text(element(s.html, "data-hl-reward"));
      if (r == null) return `${p.where}（${name}）：第 ${i + 1} 條沒有 data-hl-reward`;
      if (lang === "zh-Hant") { if (!squash(r).includes(squash(REWARD_ZH[i])) || (i === 1 && /動能/.test(r)) || (i === 2 && /背書/.test(r))) return `${p.where}：第 ${i + 1} 條的獎勵是「${r}」，應為「${REWARD_ZH[i]}」`; }
      else {
        const mo = /momentum/i.test(r), es = /endorse/i.test(r);
        if ([mo && es, es && !mo, mo && !es][i] !== true) return `${p.where}（英文）：第 ${i + 1} 條的獎勵是「${r}」`;
      }
    }
    n++;
  }
  return ok(true, `${n} 個牌桌（兩種語言）三條的獎勵都對`);
}));

check("誰領先：中文「{誰}領先」「{誰}{誰}平手」（陳宋連的順序）「無人表態」；英文寫出領先者、寫出平手的每個人、沒人時不寫名字", gate(() => {
  const seen = { lead: 0, tie: 0, none: 0 };
  for (const p of POOL) for (const [lang, name] of LANGS) {
    const sl = slots(S.screen(p.s, lang));
    for (const [i, s] of sl.entries()) {
      const c = p.s.st.issues[i].cubes, k = kind(c), st = text(element(s.html, "data-hl-status"));
      if (st == null) return `${p.where}（${name}）：第 ${i + 1} 條沒有 data-hl-status`;
      if (lang === "zh-Hant") {
        const want = k.k === "none" ? "無人表態" : k.who.map((q) => SHORT_ZH[q]).join("") + (k.k === "lead" ? "領先" : "平手");
        if (squash(st) !== want) return `${p.where}：第 ${i + 1} 條（方塊 ${c.join("/")}）寫「${st}」，應為「${want}」`;
        seen[k.k]++;
      } else {
        const named = [0, 1, 2].filter((q) => st.includes(SHORT_EN[q]));
        const want = k.k === "none" ? [] : k.who;
        if (!st || named.join() !== want.join()) return `${p.where}（英文）：第 ${i + 1} 條（方塊 ${c.join("/")}）寫「${st}」`;
      }
    }
  }
  for (const k of ["lead", "tie", "none"]) { const r = nonEmpty(seen[k], `「${{ lead: "領先", tie: "平手", none: "無人表態" }[k]}」的議題`); if (r !== true) return r; }
  return ok(true, `領先 ${seen.lead}、平手 ${seen.tie}、無人表態 ${seen.none} 條（中文），英文同一批都對`);
}));

check("議題名稱與方塊：每條有 data-hl-name（議題的名字），方塊照議題上的顆數（.b.o0／o1／o2）", gate(() => {
  let n = 0;
  for (const p of POOL) for (const [lang, name] of LANGS) {
    const x = bind(lang);
    for (const [i, s] of slots(S.screen(p.s, lang)).entries()) {
      const iss = p.s.st.issues[i], nm = text(element(s.html, "data-hl-name"));
      if (squash(nm) !== squash(x.issue(iss.name))) return `${p.where}（${name}）：第 ${i + 1} 條的名字是「${nm}」，應為「${x.issue(iss.name)}」`;
      const got = [0, 1, 2].map((q) => (s.html.match(new RegExp(`class="[^"]*\\bb\\b[^"]*\\bo${q}\\b`, "g")) || []).length);
      if (got.join() !== iss.cubes.join()) return `${p.where}（${name}）：第 ${i + 1} 條的方塊是 ${got.join("/")}，議題上是 ${iss.cubes.join("/")}`;
    }
    n++;
  }
  return ok(true, `${n} 個牌桌的名字與方塊都對`);
}));

check("欄位的標籤：說明按鈕（data-help=\"slot\"，不是三條本身）中文寫「議題頭條」，英文沒有 slot", gate(() => {
  for (const [lang, name] of LANGS) {
    const html = S.screen(POOL[0].s, lang);
    const lab = tags(html, "data-help").filter((t) => t.v === "slot" && !/\sdata-issue=/.test(t.tag)).map((t) => text(elementAt(html, t)));
    if (!lab.length) return `${name}：找不到欄位的說明按鈕`;
    if (lang === "zh-Hant" && !squash(lab[0]).startsWith("議題頭條")) return `中文：欄位標籤是「${lab[0]}」，應為「議題頭條」`;
    if (lang === "en" && /slot/i.test(lab[0])) return `英文：欄位標籤是「${lab[0]}」`;
  }
  return ok(true, "中文「議題頭條」，英文沒有 slot");
}));

check("新名字到處都一樣：中文字串沒有「第一槽／第 1 槽」，英文沒有 slot 1／first slot；三條的說明寫出三個名字", gate(() => {
  const strings = (o, path = "", out = []) => { if (typeof o === "string") out.push([path, o]); else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) strings(v, path ? `${path}.${k}` : k, out); return out; };
  const z = strings(zh), e = strings(en);
  const r = nonEmpty(Math.min(z.length, e.length), "字串"); if (r !== true) return r;
  const badZ = z.filter(([, s]) => /第\s*[一二三123]\s*槽/.test(s)), badE = e.filter(([, s]) => /\bslot\s*[123]\b|\b(first|second|third)\s+slot/i.test(s));
  if (badZ.length) return `中文還有 ${badZ.length} 處舊名：${badZ.slice(0, 4).map(([k, s]) => `${k}「${s.slice(0, 30)}」`).join("；")}`;
  if (badE.length) return `英文還有 ${badE.length} 處舊名：${badE.slice(0, 4).map(([k, s]) => `${k} "${s.slice(0, 40)}"`).join("; ")}`;
  const hz = bind("zh-Hant").tr("help.slot"), he = bind("en").tr("help.slot");
  for (const w of LABEL_ZH) if (!hz.includes(w)) return `中文的議題說明沒有寫出「${w}」：「${hz}」`;
  const enLabels = slots(S.screen(POOL[0].s, "en")).map((s) => text(element(s.html, "data-hl-label")));
  for (const w of enLabels) if (!w || !he.toLowerCase().includes(w.toLowerCase())) return `英文的議題說明沒有寫出「${w}」："${he}"`;
  return ok(true, `中文 ${z.length}、英文 ${e.length} 個字串都沒有舊名；說明寫出三個名字`);
}));

test("issuehl65", () => {
  const s = summary();
  for (const p of R.pass) console.log(`  ✓ ${p.label}${p.msg ? " — " + p.msg : ""}`);
  for (const t of s.todos) console.log(`  … ${t.label} — ${t.msg}`);
  for (const x of s.failures) console.log(`  ✗ ${x.label} — ${x.msg}`);
  console.log(`  通過 ${s.pass} / 失敗 ${s.fail} / 尚未實作 ${s.todo}`);
  assert.equal(s.fail, 0, s.failures.map((x) => `${x.label}: ${x.msg}`).join("\n"));
});
