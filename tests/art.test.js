// The art set (issue #24), as far as node can see it. Orchestrator's file: a peer may run it and
// falsify against it, and does not edit it. Whether a picture is any good, is in the right style,
// has no text and no real person's likeness is checked by eye on contact sheets, not here.
//
//   node --test tests/art.test.js      (or `npm test`)
//
// Contract (owner rulings 2026-10-14, design canvas 69Q4zH2AbWEXV7ikBuMHTd): under public/art/
//   cards/<event id>.webp        every event card, its own picture   600×400
//   local/<county slug>.webp     every county on the board            600×400
//   issues/<issue>.webp          clean / econ / cross                 640×480
//   candidates/<seat>.webp       chen / soong / lien                  480×640
//   end/<seat>.webp              the end page's hero, by winner      900×600   (#32: owner chose the end page
//                                "開票之夜", design canvas R26gizGsymbFUZnLxPoP7V; checked once public/art/end/ exists)
//   prompts.json                 { "<path under public/art/>": { prompt, seed, model } } for every picture
// Each picture ≤ 120 KB, all of them together ≤ 9 MB. No other file in those five folders.
// Every check reports 尚未實作 until public/art/ exists.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { R, section, check, eq, ok, nonEmpty, summary } from "./harness.js";
import * as B from "../public/shared/board.js";
import * as C from "../public/shared/cards.js";

// From the rulebook and the owner's rulings, not from the product: 70 events (§14.3, v0.3),
// 24 board counties (§二, 金門＋連江 as 金馬), three issues, three candidates.
const EVENT_COUNT = 70;
const COUNTY_SLUG = {
  "台北市": "taipei-city", "台北縣": "taipei-county", "基隆市": "keelung", "桃園縣": "taoyuan",
  "新竹縣": "hsinchu-county", "新竹市": "hsinchu-city", "苗栗縣": "miaoli", "台中縣": "taichung-county",
  "台中市": "taichung-city", "彰化縣": "changhua", "南投縣": "nantou", "雲林縣": "yunlin",
  "嘉義縣": "chiayi-county", "嘉義市": "chiayi-city", "台南縣": "tainan-county", "台南市": "tainan-city",
  "高雄市": "kaohsiung-city", "高雄縣": "kaohsiung-county", "屏東縣": "pingtung", "宜蘭縣": "yilan",
  "花蓮縣": "hualien", "台東縣": "taitung", "澎湖縣": "penghu", "金馬": "kinma",
};
const ISSUES = ["clean", "econ", "cross"];
const SEATS = ["chen", "soong", "lien"];
const SIZE = { cards: [600, 400], local: [600, 400], issues: [640, 480], candidates: [480, 640], end: [900, 600] };
const MAX_FILE = 120 * 1024, MAX_TOTAL = 9 * 1024 * 1024;

const ART = new URL("../public/art/", import.meta.url);
const has = existsSync(ART);
const c24 = (name, fn) => check(name, () => (has ? fn() : "TODO: public/art/ 還沒有（#24）"));

// Width and height of a WebP file, from its header: lossy (VP8), lossless (VP8L) or extended (VP8X).
export function webpSize(buf) {
  if (buf.length < 30 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WEBP") return null;
  const kind = buf.toString("ascii", 12, 16);
  if (kind === "VP8 ") {
    if (buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) return null;
    return [buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff];
  }
  if (kind === "VP8L") {
    if (buf[20] !== 0x2f) return null;
    const b = buf.readUInt32LE(21);
    return [(b & 0x3fff) + 1, ((b >> 14) & 0x3fff) + 1];
  }
  if (kind === "VP8X") return [buf.readUIntLE(24, 3) + 1, buf.readUIntLE(27, 3) + 1];
  return null;
}

// Every picture the contract asks for: folder, file name, what it is.
const expected = [];
for (const c of C.EVENTS) expected.push(["cards", `${c.id}.webp`, `事件牌「${c.name}」`]);
for (const [name] of B.COUNTIES) expected.push(["local", `${COUNTY_SLUG[name]}.webp`, `縣市「${name}」`]);
for (const k of ISSUES) expected.push(["issues", `${k}.webp`, `議題 ${k}`]);
for (const k of SEATS) expected.push(["candidates", `${k}.webp`, `候選人 ${k}`]);
// #32: the end page's hero for each winner; required once public/art/end/ exists (尚未實作 before).
const END = SEATS.map((k) => ["end", `${k}.webp`, `結局頁主視覺（${k} 當選）`]);
const hasEnd = existsSync(new URL("end/", ART));
if (hasEnd) expected.push(...END);
const rel = (d, f) => `${d}/${f}`;
const fileOf = (d, f) => new URL(`${d}/${f}`, ART);

section("24 美術素材");

check("常數對照：規則書的 70 張事件牌、24 個縣市都在資料裡，而且每個縣市都有英文檔名", () => {
  const r1 = eq(C.EVENTS.length, EVENT_COUNT, "事件牌張數"); if (r1 !== true) return r1;
  const r2 = eq(B.COUNTIES.length, Object.keys(COUNTY_SLUG).length, "縣市數"); if (r2 !== true) return r2;
  const noSlug = B.COUNTIES.map((c) => c[0]).filter((n) => !COUNTY_SLUG[n]);
  if (noSlug.length) return `這些縣市沒有檔名：${noSlug.join("、")}`;
  const bad = C.EVENTS.map((c) => c.id).filter((id) => !/^[a-z0-9_]+$/.test(id));
  if (bad.length) return `這些牌 id 不能直接當檔名：${bad.join(", ")}`;
  return ok(true, `${C.EVENTS.length} 張事件牌、${B.COUNTIES.length} 個縣市`);
});

c24("每一張圖都在：70 張事件牌各一張、24 個縣市各一張、3 個議題、3 位候選人", () => {
  const ne = nonEmpty(expected.length, "要畫的圖"); if (ne !== true) return ne;
  const missing = expected.filter(([d, f]) => !existsSync(fileOf(d, f))).map(([d, f, what]) => `${rel(d, f)}（${what}）`);
  if (missing.length) return `少了 ${missing.length} 張：${missing.slice(0, 12).join("、")}${missing.length > 12 ? "……" : ""}`;
  return ok(true, `${expected.length} 張都在`);
});

c24("沒有多出來的檔案：四個資料夾裡每一個檔案都是契約裡的一張（拼錯的 id 會在這裡現形）", () => {
  const want = new Set(expected.map(([d, f]) => rel(d, f)));
  const extra = [];
  let seen = 0;
  for (const d of Object.keys(SIZE)) {
    const dir = new URL(`${d}/`, ART);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) { seen++; if (!want.has(rel(d, f))) extra.push(rel(d, f)); }
  }
  const ne = nonEmpty(seen, "public/art/ 底下四個資料夾裡的檔案"); if (ne !== true) return ne;
  if (extra.length) return `多出 ${extra.length} 個不在契約裡的檔案：${extra.join("、")}`;
  return ok(true, `${seen} 個檔案都在契約裡`);
});

c24("格式與尺寸：每一張都是 WebP，事件牌與縣市 600×400、議題 640×480、候選人 480×640", () => {
  const bad = [];
  let n = 0;
  for (const [d, f] of expected) {
    const u = fileOf(d, f);
    if (!existsSync(u)) continue;
    n++;
    const sz = webpSize(readFileSync(u));
    if (!sz) { bad.push(`${rel(d, f)} 不是 WebP`); continue; }
    const [w, h] = SIZE[d];
    if (sz[0] !== w || sz[1] !== h) bad.push(`${rel(d, f)} 是 ${sz[0]}×${sz[1]}，應為 ${w}×${h}`);
  }
  const ne = nonEmpty(n, "存在的圖"); if (ne !== true) return ne;
  if (bad.length) return bad.slice(0, 12).join("；") + (bad.length > 12 ? `……共 ${bad.length} 張` : "");
  return ok(true, `${n} 張格式與尺寸都對`);
});

c24("檔案大小：每張 ≤ 120 KB，全部加起來 ≤ 9 MB（手機要載得動）", () => {
  let total = 0, n = 0, biggest = ["", 0];
  const over = [];
  for (const [d, f] of expected) {
    const u = fileOf(d, f);
    if (!existsSync(u)) continue;
    const s = statSync(u).size; n++; total += s;
    if (s > biggest[1]) biggest = [rel(d, f), s];
    if (s > MAX_FILE) over.push(`${rel(d, f)} ${(s / 1024).toFixed(0)} KB`);
  }
  const ne = nonEmpty(n, "存在的圖"); if (ne !== true) return ne;
  if (over.length) return `超過 120 KB：${over.join("、")}`;
  if (total > MAX_TOTAL) return `全部 ${(total / 1048576).toFixed(2)} MB，超過 9 MB`;
  return ok(true, `${n} 張共 ${(total / 1048576).toFixed(2)} MB，最大 ${biggest[0]} ${(biggest[1] / 1024).toFixed(0)} KB`);
});

c24("來歷：prompts.json 對每一張圖都記了 prompt、seed、model，而且沒有記到不存在的圖", () => {
  const pj = new URL("prompts.json", ART);
  if (!existsSync(pj)) return "public/art/prompts.json 不存在";
  let P;
  try { P = JSON.parse(readFileSync(pj, "utf8")); } catch (e) { return `prompts.json 不是合法 JSON：${e.message}`; }
  const ne = nonEmpty(Object.keys(P).length, "prompts.json 的項目"); if (ne !== true) return ne;
  const problems = [];
  for (const [d, f] of expected) {
    const k = rel(d, f), e = P[k];
    if (!e) { problems.push(`${k} 沒有記錄`); continue; }
    if (typeof e.prompt !== "string" || e.prompt.trim().length < 20) problems.push(`${k} 的 prompt 太短或沒有`);
    if (!Number.isInteger(e.seed)) problems.push(`${k} 的 seed 不是整數`);
    if (typeof e.model !== "string" || !e.model.trim()) problems.push(`${k} 沒有 model`);
  }
  const want = new Set(expected.concat(END).map(([d, f]) => rel(d, f)));
  for (const k of Object.keys(P)) {
    if (!want.has(k)) problems.push(`記錄了契約以外的 ${k}`);
    else if (!existsSync(new URL(k, ART))) problems.push(`記錄了不存在的 ${k}`);
  }
  if (problems.length) return problems.slice(0, 12).join("；") + (problems.length > 12 ? `……共 ${problems.length} 項` : "");
  return ok(true, `${expected.length} 張都有來歷`);
});

check("結局頁主視覺：public/art/end/ 有 chen、soong、lien 三張，900×600 WebP、各 ≤ 120 KB，prompts.json 有來歷（#32）", () => {
  if (!hasEnd) return "TODO: public/art/end/ 還沒有（#32）";
  const miss = END.filter(([d, f]) => !existsSync(fileOf(d, f))).map(([d, f]) => rel(d, f));
  if (miss.length) return `少了 ${miss.join("、")}`;
  const sizes = END.map(([d, f]) => { const b = readFileSync(fileOf(d, f)); return [rel(d, f), webpSize(b), b.length]; });
  for (const [k, sz, n] of sizes) { if (!sz || sz[0] !== 900 || sz[1] !== 600) return `${k} 是 ${sz ? sz.join("×") : "非 WebP"}，應為 900×600`; if (n > MAX_FILE) return `${k} ${(n / 1024).toFixed(0)} KB，超過 120 KB`; }
  return ok(true, `三張都在：${sizes.map(([k, , n]) => `${k} ${(n / 1024).toFixed(0)} KB`).join("、")}`);
});

test("art", () => {
  const s = summary();
  for (const p of R.pass) console.log(`  ✓ ${p.label}${p.msg ? " — " + p.msg : ""}`);
  for (const t of s.todos) console.log(`  … ${t.label} — ${t.msg}`);
  for (const f of s.failures) console.log(`  ✗ ${f.label} — ${f.msg}`);
  console.log(`  通過 ${s.pass} / 失敗 ${s.fail} / 尚未實作 ${s.todo}`);
  assert.equal(s.fail, 0, s.failures.map((f) => `${f.label}: ${f.msg}`).join("\n"));
});
