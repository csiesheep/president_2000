// Line ends: every text file the site serves (public/) and every test and tool ends its lines with LF only. Orchestrator's
// file: a peer may run it, does not edit it.
//
//   node --test tests/lineends.test.js      (or `npm test`)
//
// Added after #70's fourth delivery (b4b03db): public/table.js came back with CRLF on all its 1283 lines, so a change of
// 11 lines showed as 2558, and every other branch touching table.js would have conflicted with all of it.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { R, section, check, ok, nonEmpty, summary } from "./harness.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TEXT = new Set([".js", ".mjs", ".cjs", ".css", ".html", ".json", ".md", ".svg", ".txt", ".webmanifest"]);
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name), st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (TEXT.has(extname(name).toLowerCase())) out.push(p);
  }
  return out;
}
const FILES = ["public", "tests", "tools"].flatMap((d) => walk(join(ROOT, d)));
// known, and left as they are: the artist's prompt list has had CRLF since it was made (it is data, never edited by hand)
const KNOWN = new Set(["public/art/prompts.json"]);
const rel = (p) => p.slice(ROOT.length).split("\\").join("/");

section("行尾");

check("public/、tests/、tools/ 的文字檔都只用 LF 換行（沒有 CR）", () => {
  const ne = nonEmpty(FILES.length, "文字檔"); if (ne !== true) return ne;
  const bad = [];
  let checked = 0;
  for (const p of FILES) {
    if (KNOWN.has(rel(p))) continue;
    checked++;
    const s = readFileSync(p, "latin1"), n = (s.match(/\r/g) || []).length;
    if (n) bad.push(`${rel(p)}（${n} 個 CR）`);
  }
  if (bad.length) return `${bad.length} 個檔案有 CR：${bad.slice(0, 5).join("、")}`;
  return ok(true, `${checked} 個檔案（另有 ${KNOWN.size} 個已知例外）`);
});

test("lineends", () => {
  const s = summary();
  for (const p of R.pass) console.log(`  ✓ ${p.label}${p.msg ? " — " + p.msg : ""}`);
  for (const t of s.todos) console.log(`  … ${t.label} — ${t.msg}`);
  for (const x of s.failures) console.log(`  ✗ ${x.label} — ${x.msg}`);
  console.log(`  通過 ${s.pass} / 失敗 ${s.fail} / 尚未實作 ${s.todo}`);
  assert.equal(s.fail, 0, s.failures.map((x) => `${x.label}: ${x.msg}`).join("\n"));
});
