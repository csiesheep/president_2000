// tools/icons102.mjs — the share images, the icons and the not-found page (#102). Orchestrator's instrument: a peer may run
// it, does not edit it. Needs a running server of this tree (`wrangler dev`: the 404 is the asset handler's); no browser,
// a few seconds. How the images look is the orchestrator's eye (a contact sheet), not this.
//
//   node tools/icons102.mjs http://127.0.0.1:8787/president_2000/
//
// The audit (商業盤點 E, items 3 and 9): no share image; no apple-touch-icon, no PNG or ICO favicon (only favicon.svg);
// a path that does not exist answers a blank page.
// Contract (orchestrator, #102), as served:
//   - art/share-zh.png and art/share-en.png: PNG, 1200×630, at most 400 KB each (the cards chat apps and search engines
//     show for the Chinese and the English pages; #104's og:image points at them);
//   - favicon.ico (an ICO holding 16×16 and 32×32 at least), apple-touch-icon.png 180×180, icon-192.png 192×192,
//     icon-512.png 512×512, all PNG inside; the home page and the rules page (as served, both languages) link
//     favicon.ico (rel=icon) and apple-touch-icon.png (rel=apple-touch-icon), and keep favicon.svg;
//   - a path under /president_2000/ that does not exist (a page or an asset) answers 404 with an HTML page: lang set,
//     the game's name in both languages, a link back to the home page, <meta name="robots" content="noindex">; the
//     pages and assets that do exist still answer 200.
// Reports 尚未實作 while it all behaves as on main.
const base = (process.argv[2] || "").replace(/\/?$/, "/");
if (!process.argv[2]) { console.log("usage: node tools/icons102.mjs <base url ending in /president_2000/>"); process.exit(2); }
async function get(path) { const r = await fetch(base + path, { redirect: "manual" }); return { status: r.status, type: r.headers.get("content-type") || "", body: Buffer.from(await r.arrayBuffer()) }; }
const png = (b) => (b.length > 24 && b.readUInt32BE(0) === 0x89504e47 ? { w: b.readUInt32BE(16), h: b.readUInt32BE(20) } : null);
function ico(b) {
  if (b.length < 6 || b.readUInt16LE(0) !== 0 || b.readUInt16LE(2) !== 1) return null;
  const n = b.readUInt16LE(4), out = [];
  for (let i = 0; i < n && 6 + i * 16 + 16 <= b.length; i++) { const o = 6 + i * 16; out.push(`${b[o] || 256}x${b[o + 1] || 256}`); }
  return out;
}
const attrs = (tag) => { const o = {}; for (const m of tag.matchAll(/([a-zA-Z:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) o[m[1].toLowerCase()] = m[3] ?? m[4]; return o; };
const linksOf = (html) => [...((html.match(/<head[\s\S]*?<\/head>/i) || [""])[0]).matchAll(/<link\b[^>]*>/gi)].map((m) => attrs(m[0]));

const M = {};
try {
  M.share = {};
  for (const k of ["zh", "en"]) { const r = await get(`art/share-${k}.png`); M.share[k] = { status: r.status, bytes: r.body.length, size: png(r.body) }; }
  M.icons = {};
  for (const [f, w] of [["apple-touch-icon.png", 180], ["icon-192.png", 192], ["icon-512.png", 512]]) { const r = await get(f); M.icons[f] = { status: r.status, size: png(r.body), want: w }; }
  { const r = await get("favicon.ico"); M.ico = { status: r.status, sizes: r.status === 200 ? ico(r.body) : null }; }
  M.heads = {};
  for (const p of ["", "?lang=en", "rules", "rules?lang=en"]) { const r = await get(p); M.heads[p || "(home)"] = { status: r.status, links: linksOf(r.body.toString("utf8")) }; }
  M.missing = {};
  for (const p of ["no-such-page", "art/no-such-image.png", "rules/nothing"]) { const r = await get(p); const t = r.body.toString("utf8"); M.missing[p] = { status: r.status, type: r.type, len: t.length, lang: (t.match(/<html\b[^>]*\blang\s*=\s*"([^"]*)"/i) || [])[1] || null, zh: t.includes("總統的誕生"), en: t.includes("Taiwan Decides"), home: /<a\b[^>]*href\s*=\s*"(\.\/|\/president_2000\/|https:\/\/games\.csiesheep\.com\/president_2000\/)"/i.test(t), noindex: /<meta\b[^>]*name\s*=\s*"robots"[^>]*content\s*=\s*"[^"]*noindex/i.test(t) }; }
  M.exist = {};
  for (const p of ["", "rules", "style.css", "favicon.svg"]) M.exist[p || "(home)"] = (await get(p)).status;
} catch (e) { M.err = e.message; }

const rows = [];
const row = (name, fn) => { try { const r = fn(); rows.push(r === true ? { name, ok: true } : typeof r === "string" && r.startsWith("TODO:") ? { name, todo: r.slice(5).trim() } : r && r.pass ? { name, ok: true, msg: r.msg } : { name, ok: false, msg: String(r) }); } catch (e) { rows.push({ name, ok: false, msg: `instrument: ${e.message}` }); } };
const okm = (c, msg) => (c ? { pass: true, msg } : msg);
const pre = () => (M.err ? `儀器中途停下：${M.err}` : null);
row("分享圖：art/share-zh.png、art/share-en.png 是 1200×630 的 PNG，各 ≤ 400 KB", () => {
  const p = pre(); if (p) return p;
  if (Object.values(M.share).every((x) => x.status !== 200)) return "TODO: 兩張分享圖都還沒有";
  const bad = [], d = [];
  for (const [k, x] of Object.entries(M.share)) { const s = `${k} ${x.status} ${x.size ? `${x.size.w}×${x.size.h}` : "不是 PNG"} ${(x.bytes / 1024).toFixed(0)} KB`; d.push(s); if (!(x.status === 200 && x.size && x.size.w === 1200 && x.size.h === 630 && x.bytes <= 400 * 1024)) bad.push(s); }
  return okm(!bad.length, bad.join("；") || d.join("、"));
});
row("圖示：favicon.ico（含 16 與 32）、apple-touch-icon 180、icon-192、icon-512 都在而且是那個大小", () => {
  const p = pre(); if (p) return p;
  if (M.ico.status !== 200 && Object.values(M.icons).every((x) => x.status !== 200)) return "TODO: 只有 favicon.svg";
  const bad = [];
  if (M.ico.status !== 200 || !M.ico.sizes) bad.push(`favicon.ico ${M.ico.status}${M.ico.status === 200 ? " 不是 ICO" : ""}`);
  else for (const s of ["16x16", "32x32"]) if (!M.ico.sizes.includes(s)) bad.push(`favicon.ico 裡沒有 ${s}（有 ${M.ico.sizes.join("、")}）`);
  for (const [f, x] of Object.entries(M.icons)) if (!(x.status === 200 && x.size && x.size.w === x.want && x.size.h === x.want)) bad.push(`${f} ${x.status} ${x.size ? `${x.size.w}×${x.size.h}` : "不是 PNG"}`);
  return okm(!bad.length, bad.join("；") || `favicon.ico（${M.ico.sizes.join("、")}）與三張 PNG 都對`);
});
row("首頁與規則頁（中英）的 head 連到 favicon.ico 與 apple-touch-icon.png，favicon.svg 照舊", () => {
  const p = pre(); if (p) return p;
  const has = (ls, rel, href) => ls.some((l) => (l.rel || "").toLowerCase().split(/\s+/).includes(rel) && (l.href || "").replace(/^\.\//, "").endsWith(href));
  if (Object.values(M.heads).every((h) => !has(h.links, "apple-touch-icon", "apple-touch-icon.png"))) return "TODO: 頁面還沒有連 apple-touch-icon";
  const bad = [];
  for (const [k, h] of Object.entries(M.heads)) {
    if (h.status !== 200) { bad.push(`${k} ${h.status}`); continue; }
    if (!has(h.links, "icon", "favicon.ico")) bad.push(`${k} 沒有 favicon.ico`);
    if (!has(h.links, "apple-touch-icon", "apple-touch-icon.png")) bad.push(`${k} 沒有 apple-touch-icon`);
    if (!has(h.links, "icon", "favicon.svg")) bad.push(`${k} 沒有 favicon.svg 了`);
  }
  return okm(!bad.length, bad.join("；") || "四頁都連了");
});
row("不存在的路徑（頁面或圖）回 404 的 HTML 頁：有 lang、中英遊戲名、回首頁的連結、noindex；存在的照舊 200", () => {
  const p = pre(); if (p) return p;
  if (Object.values(M.missing).every((x) => x.len < 50 && !x.zh)) return `TODO: 不存在的路徑回的是 ${[...new Set(Object.values(M.missing).map((x) => `${x.status} ${x.len} 字`))].join("、")}`;
  const bad = [];
  for (const [k, x] of Object.entries(M.missing)) {
    const miss = [x.status !== 404 && `狀態 ${x.status}`, !x.type.includes("text/html") && `類型 ${x.type}`, !x.lang && "沒有 lang", !x.zh && "沒有中文名", !x.en && "沒有英文名", !x.home && "沒有回首頁的連結", !x.noindex && "沒有 noindex"].filter(Boolean);
    if (miss.length) bad.push(`${k}：${miss.join("、")}`);
  }
  for (const [k, s] of Object.entries(M.exist)) if (s !== 200) bad.push(`存在的 ${k} 回 ${s}`);
  return okm(!bad.length, bad.join("；") || `${Object.keys(M.missing).length} 個不存在的路徑都是 404 頁，${Object.keys(M.exist).length} 個存在的都 200`);
});

let bad = 0, pend = 0;
for (const r of rows) { if (r.todo) pend++; else if (!r.ok) bad++; console.log(`${r.todo ? "…" : r.ok ? "✓" : "✗"} ${r.name}${r.todo ? " — " + r.todo : r.msg ? " — " + r.msg : ""}`); }
console.log(`${bad ? "FAIL" : pend ? "TODO" : "PASS"}: ${rows.length - bad - pend} pass, ${bad} fail, ${pend} 尚未實作`);
process.exit(bad ? 1 : 0);
