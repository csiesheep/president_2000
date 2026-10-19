// tools/head104.mjs — what a search engine or a chat app sees of the pages before any script runs (#104). Orchestrator's
// instrument: a peer may run it, does not edit it. Needs a running server of this tree (`wrangler dev`: the Worker serves
// the pages and the sitemap); no browser, a few seconds.
//
//   node tools/head104.mjs http://127.0.0.1:8787/president_2000/
//
// The audit (商業盤點 E, items 3 and 7): no OG, Twitter card, share image or JSON-LD; the server's lang, title and
// description are Chinese for the English page too, no hreflang, the English page's canonical points at the Chinese one;
// the rules page has no description; the sitemap lists two URLs.
// Contract (orchestrator, #104), the HTML as the Worker sends it (no script run), for the four pages
//   zh: /president_2000/  ·  en: /president_2000/?lang=en  ·  zh: /president_2000/rules  ·  en: /president_2000/rules?lang=en
// and for every other query of a page (?play, ?tutorial, ?room=ABCD, with or without &lang=en) as the page it belongs to:
//   - <html lang> is zh-Hant or en; <title> and <meta name="description"> are in the page's language (an en page has no
//     CJK character in them; a zh page has some), the description 20–200 characters;
//   - <link rel="canonical"> is the page's own URL on https://games.csiesheep.com (en: with ?lang=en), the same for every
//     query of that page;
//   - <link rel="alternate" hreflang> for zh-Hant, en and x-default (= zh-Hant) on both languages of a page;
//   - og:type website, og:site_name, og:title, og:description, og:url (= canonical), og:locale (zh_TW / en_US),
//     og:image (an absolute https URL under /president_2000/) with og:image:width 1200 and og:image:height 630;
//     twitter:card summary_large_image; the image itself is served (200) as PNG or JPEG of 1200×630;
//   - the home page (both languages) carries one application/ld+json block that parses, @type VideoGame, with name, url
//     (= canonical) and inLanguage;
//   - sitemap.xml lists the four URLs;
//   - <meta name="robots" content="noindex, nofollow"> stays on every page until the owner says go (a guard: it passes
//     on main and must keep passing).
// Reports 尚未實作 while the pages behave as on main.
const base = (process.argv[2] || "").replace(/\/?$/, "/");
if (!process.argv[2]) { console.log("usage: node tools/head104.mjs <base url ending in /president_2000/>"); process.exit(2); }
const SITE = "https://games.csiesheep.com/president_2000/";
const CJK = /[㐀-鿿豈-﫿]/;
const PAGES = [
  { key: "home zh", path: "", lang: "zh-Hant", canon: SITE, pair: "home" },
  { key: "home en", path: "?lang=en", lang: "en", canon: SITE + "?lang=en", pair: "home" },
  { key: "rules zh", path: "rules", lang: "zh-Hant", canon: SITE + "rules", pair: "rules" },
  { key: "rules en", path: "rules?lang=en", lang: "en", canon: SITE + "rules?lang=en", pair: "rules" },
];
const QUERIES = [["?play", SITE], ["?play&lang=en", SITE + "?lang=en"], ["?tutorial&lang=en", SITE + "?lang=en"], ["?room=ABCD", SITE], ["?lang=en&room=ABCD", SITE + "?lang=en"]];

const attrs = (tag) => { const o = {}; for (const m of tag.matchAll(/([a-zA-Z:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) o[m[1].toLowerCase()] = m[3] ?? m[4]; return o; };
const unesc = (s) => (s || "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
function read(html) {
  const head = (html.match(/<head[\s\S]*?<\/head>/i) || [""])[0];
  const metas = [...head.matchAll(/<meta\b[^>]*>/gi)].map((m) => attrs(m[0])), links = [...head.matchAll(/<link\b[^>]*>/gi)].map((m) => attrs(m[0]));
  const meta = (k) => { const m = metas.find((x) => x.name === k || x.property === k); return m ? unesc(m.content) : null; };
  return {
    lang: (html.match(/<html\b[^>]*\blang\s*=\s*"([^"]*)"/i) || [])[1] || null,
    title: unesc((head.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || "").trim() || null,
    meta, canonical: unesc((links.find((l) => (l.rel || "").toLowerCase() === "canonical") || {}).href) || null,
    alternates: links.filter((l) => (l.rel || "").toLowerCase() === "alternate" && l.hreflang).map((l) => ({ hreflang: l.hreflang, href: unesc(l.href) })),
    ld: [...html.matchAll(/<script\b[^>]*type\s*=\s*"application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]),
  };
}
async function get(path) { const r = await fetch(base + path, { redirect: "manual" }); return { status: r.status, type: r.headers.get("content-type") || "", body: Buffer.from(await r.arrayBuffer()) }; }
function size(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { kind: "png", w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    for (let i = 2; i + 9 < buf.length;) { if (buf[i] !== 0xff) { i++; continue; } const mk = buf[i + 1], len = buf.readUInt16BE(i + 2);
      if (mk >= 0xc0 && mk <= 0xcf && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc) return { kind: "jpeg", w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) }; i += 2 + len; }
    return { kind: "jpeg", w: null, h: null };
  }
  return { kind: "other", w: null, h: null };
}

const M = { pages: {}, queries: {} };
try {
  for (const p of PAGES) { const r = await get(p.path); M.pages[p.key] = { status: r.status, ...read(r.body.toString("utf8")) }; }
  for (const [q, want] of QUERIES) { const r = await get(q); M.queries[q] = { status: r.status, want, ...read(r.body.toString("utf8")) }; }
  const sm = await get("sitemap.xml"); M.sitemap = [...sm.body.toString("utf8").matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => unesc(m[1]));
  // every image the four pages point at (a page may have its own, e.g. one per language)
  M.images = [];
  for (const img of [...new Set(PAGES.map((p) => M.pages[p.key].meta("og:image")).filter(Boolean))]) {
    if (img.startsWith(SITE)) { const r = await get(img.slice(SITE.length)); M.images.push({ url: img, status: r.status, type: r.type, ...size(r.body) }); }
    else M.images.push({ url: img });
  }
} catch (e) { M.err = e.message; }

const rows = [];
const row = (name, fn) => { try { const r = fn(); rows.push(r === true ? { name, ok: true } : typeof r === "string" && r.startsWith("TODO:") ? { name, todo: r.slice(5).trim() } : r && r.pass ? { name, ok: true, msg: r.msg } : { name, ok: false, msg: String(r) }); } catch (e) { rows.push({ name, ok: false, msg: `instrument: ${e.message}` }); } };
const okm = (c, msg) => (c ? { pass: true, msg } : msg);
const P = (k) => M.pages[k];
const pre = () => (M.err ? `儀器中途停下：${M.err}` : PAGES.some((p) => P(p.key).status !== 200) ? `有頁面不是 200：${PAGES.map((p) => `${p.key} ${P(p.key).status}`).join("、")}（instrument）` : null);
row("四頁的 <html lang>、標題、描述是那一頁的語言；描述 20–200 字（規則頁也有描述）", () => {
  const p = pre(); if (p) return p;
  if (P("home en").lang === "zh-Hant" && P("rules en").lang === "zh-Hant") return `TODO: 英文頁送出去還是 lang="zh-Hant"（標題「${P("home en").title}」）`;
  const bad = [];
  for (const x of PAGES) {
    const g = P(x.key), d = g.meta("description");
    if (g.lang !== x.lang) bad.push(`${x.key} lang=${g.lang}`);
    if (!g.title) bad.push(`${x.key} 沒有標題`); else if (x.lang === "en" ? CJK.test(g.title) : !CJK.test(g.title)) bad.push(`${x.key} 標題「${g.title}」不是這一頁的語言`);
    if (!d) bad.push(`${x.key} 沒有描述`); else { if (x.lang === "en" ? CJK.test(d) : !CJK.test(d)) bad.push(`${x.key} 描述不是這一頁的語言`); if (d.length < 20 || d.length > 200) bad.push(`${x.key} 描述 ${d.length} 字`); }
  }
  return okm(!bad.length, bad.join("；") || PAGES.map((x) => `${x.key}「${P(x.key).title}」`).join("、"));
});
row("canonical：每一頁是自己的網址（英文帶 ?lang=en）；?play、?tutorial、?room= 指回它所屬的那一頁", () => {
  const p = pre(); if (p) return p;
  if (P("home en").canonical === SITE && P("rules en").canonical === SITE + "rules") return "TODO: 英文頁的 canonical 還是中文頁";
  const bad = [];
  for (const x of PAGES) if (P(x.key).canonical !== x.canon) bad.push(`${x.key} 是 ${P(x.key).canonical}`);
  for (const [q, g] of Object.entries(M.queries)) if (g.canonical !== g.want) bad.push(`${q} 是 ${g.canonical}（應是 ${g.want}）`);
  return okm(!bad.length, bad.join("；") || `${PAGES.length} 頁與 ${QUERIES.length} 種網址都對`);
});
row("hreflang：每一頁都列出 zh-Hant、en、x-default（= zh-Hant）", () => {
  const p = pre(); if (p) return p;
  if (PAGES.every((x) => !P(x.key).alternates.length)) return "TODO: 沒有任何 hreflang";
  const bad = [];
  for (const x of PAGES) {
    const pairOf = PAGES.filter((y) => y.pair === x.pair), want = { "zh-Hant": pairOf.find((y) => y.lang === "zh-Hant").canon, en: pairOf.find((y) => y.lang === "en").canon, "x-default": pairOf.find((y) => y.lang === "zh-Hant").canon };
    for (const [h, u] of Object.entries(want)) { const a = P(x.key).alternates.find((z) => z.hreflang === h); if (!a || a.href !== u) bad.push(`${x.key} 的 ${h} 是 ${a ? a.href : "（沒有）"}`); }
  }
  return okm(!bad.length, bad.join("；") || "四頁都有三個 hreflang");
});
row("OG 與 Twitter 卡：type、site_name、title、description、url（= canonical）、locale、image 與 1200×630；summary_large_image", () => {
  const p = pre(); if (p) return p;
  if (PAGES.every((x) => !P(x.key).meta("og:title"))) return "TODO: 沒有任何 og: 標籤";
  const bad = [];
  for (const x of PAGES) {
    const g = P(x.key), m = (k) => g.meta(k);
    if (m("og:type") !== "website") bad.push(`${x.key} og:type=${m("og:type")}`);
    for (const k of ["og:site_name", "og:title", "og:description"]) if (!m(k)) bad.push(`${x.key} 沒有 ${k}`);
    if (x.lang === "en" && [m("og:title"), m("og:description")].some((s) => s && CJK.test(s))) bad.push(`${x.key} 的 og 文字不是英文`);
    if (m("og:url") !== x.canon) bad.push(`${x.key} og:url=${m("og:url")}`);
    if (m("og:locale") !== (x.lang === "en" ? "en_US" : "zh_TW")) bad.push(`${x.key} og:locale=${m("og:locale")}`);
    if (!(m("og:image") || "").startsWith(SITE)) bad.push(`${x.key} og:image=${m("og:image")}`);
    if (m("og:image:width") !== "1200" || m("og:image:height") !== "630") bad.push(`${x.key} og:image 寬高 ${m("og:image:width")}×${m("og:image:height")}`);
    if (m("twitter:card") !== "summary_large_image") bad.push(`${x.key} twitter:card=${m("twitter:card")}`);
  }
  return okm(!bad.length, bad.slice(0, 6).join("；") || "四頁都齊");
});
row("分享圖：四頁的 og:image 每一張都回 200，是 1200×630 的 PNG 或 JPEG", () => {
  const p = pre(); if (p) return p;
  if (!M.images.length) return "TODO: 沒有一頁有 og:image";
  const bad = [], seen = [];
  for (const x of M.images) {
    if (!x.status) { bad.push(`og:image 不在 ${SITE} 底下：${x.url}`); continue; }
    const d = `${x.url.slice(SITE.length)}：${x.status}、${x.kind} ${x.w}×${x.h}`;
    if (!(x.status === 200 && ["png", "jpeg"].includes(x.kind) && x.w === 1200 && x.h === 630)) bad.push(d); else seen.push(d);
  }
  return okm(!bad.length, bad.join("；") || seen.join("、"));
});
row("JSON-LD：首頁（中英）各有一段能解析的 VideoGame，name、url（= canonical）、inLanguage", () => {
  const p = pre(); if (p) return p;
  if (!P("home zh").ld.length && !P("home en").ld.length) return "TODO: 首頁沒有 application/ld+json";
  const bad = [];
  for (const k of ["home zh", "home en"]) {
    const g = P(k), want = PAGES.find((x) => x.key === k);
    if (g.ld.length !== 1) { bad.push(`${k} 有 ${g.ld.length} 段`); continue; }
    let o = null; try { o = JSON.parse(g.ld[0]); } catch (e) { bad.push(`${k} 解析不了：${e.message}`); continue; }
    if (o["@type"] !== "VideoGame") bad.push(`${k} @type=${o["@type"]}`);
    if (!o.name) bad.push(`${k} 沒有 name`);
    if (o.url !== want.canon) bad.push(`${k} url=${o.url}`);
    if (o.inLanguage !== want.lang) bad.push(`${k} inLanguage=${o.inLanguage}`);
  }
  return okm(!bad.length, bad.join("；") || "兩段都對");
});
row("sitemap.xml 列出四個網址（中英 × 首頁與規則）", () => {
  const p = pre(); if (p) return p;
  const want = PAGES.map((x) => x.canon), has = want.filter((u) => (M.sitemap || []).includes(u));
  if (has.length === 2 && (M.sitemap || []).length === 2) return `TODO: 只列了 ${M.sitemap.join("、")}`;
  return okm(has.length === 4, `列了 ${(M.sitemap || []).length} 個，四個裡有 ${has.length} 個`);
});
row("noindex 照舊在每一頁（owner 說 go 才拿掉）", () => {
  const p = pre(); if (p) return p;
  const miss = [...PAGES.map((x) => [x.key, P(x.key)]), ...Object.entries(M.queries)].filter(([, g]) => g.meta("robots") !== "noindex, nofollow").map(([k, g]) => `${k}: ${g.meta("robots")}`);
  return okm(!miss.length, miss.length ? `少了：${miss.join("；")}` : `${PAGES.length + QUERIES.length} 個網址都還是 noindex, nofollow`);
});

let bad = 0, pend = 0;
for (const r of rows) { if (r.todo) pend++; else if (!r.ok) bad++; console.log(`${r.todo ? "…" : r.ok ? "✓" : "✗"} ${r.name}${r.todo ? " — " + r.todo : r.msg ? " — " + r.msg : ""}`); }
console.log(`${bad ? "FAIL" : pend ? "TODO" : "PASS"}: ${rows.length - bad - pend} pass, ${bad} fail, ${pend} 尚未實作`);
process.exit(bad ? 1 : 0);
