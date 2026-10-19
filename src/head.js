// What a search engine or a chat app reads of a page before any script runs (#104). The static pages carry a Chinese
// head; the Worker rewrites it per page and language (src/index.js, HTMLRewriter), so the English page is English on
// the wire: lang, title, description, canonical, hreflang, Open Graph, the Twitter card and, on the home page, JSON-LD.
// The words live in public/i18n (`title`, `meta.home.*`, `meta.rules.*`); nothing here is prose.
// <meta name="robots"> is left alone: it stays until the owner says go.
import en from "../public/i18n/en.js";
import zh from "../public/i18n/zh-Hant.js";

export const SITE = "https://games.csiesheep.com/president_2000/";
const DICT = { en, "zh-Hant": zh };
const LOCALE = { en: "en_US", "zh-Hant": "zh_TW" };
const IMAGE = { en: "art/share-en.png", "zh-Hant": "art/share-zh.png" }; // 1200×630, #102

// The page a path (after the /president_2000 prefix) belongs to, or null for anything that is not one of the two pages.
export function pageOf(sub) {
  if (sub === "/" || sub === "/index.html") return "home";
  if (sub === "/rules" || sub === "/rules/" || sub === "/rules.html") return "rules";
  return null;
}

// The same reading as the pages themselves (public/app.js, public/rules.js): English only for ?lang=en.
export const langOf = (params) => (params.get("lang") === "en" ? "en" : "zh-Hant");

// The page's own address: every other query (?play, ?tutorial, ?room=…) belongs to the page it is on.
export const canonicalOf = (page, lang) => SITE + (page === "rules" ? "rules" : "") + (lang === "en" ? "?lang=en" : "");

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// lang, title and the tags that go at the end of <head>.
export function headFor(page, lang) {
  const t = DICT[lang], m = t.meta[page], url = canonicalOf(page, lang), zhUrl = canonicalOf(page, "zh-Hant");
  const name = (k, v) => `<meta name="${k}" content="${esc(v)}">`;
  const prop = (k, v) => `<meta property="${k}" content="${esc(v)}">`;
  const link = (rel, href, extra = "") => `<link rel="${rel}"${extra} href="${esc(href)}">`;
  const tags = [
    name("description", m.description),
    link("canonical", url),
    link("alternate", zhUrl, ' hreflang="zh-Hant"'),
    link("alternate", canonicalOf(page, "en"), ' hreflang="en"'),
    link("alternate", zhUrl, ' hreflang="x-default"'),
    prop("og:type", "website"),
    prop("og:site_name", t.title),
    prop("og:title", m.title),
    prop("og:description", m.description),
    prop("og:url", url),
    prop("og:locale", LOCALE[lang]),
    prop("og:image", SITE + IMAGE[lang]),
    prop("og:image:width", "1200"),
    prop("og:image:height", "630"),
    name("twitter:card", "summary_large_image"),
  ];
  if (page === "home") {
    const ld = {
      "@context": "https://schema.org",
      "@type": "VideoGame",
      name: t.title,
      url,
      inLanguage: lang,
      description: m.description,
      image: SITE + IMAGE[lang],
      gamePlatform: "Web browser",
      playMode: ["SinglePlayer", "MultiPlayer"],
      isAccessibleForFree: true,
    };
    // "<" never closes the script block early: JSON reads \u003c as the same character.
    tags.push(`<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>`);
  }
  return { lang, title: m.title, tags: tags.join("\n") + "\n" };
}

// Both languages of both pages (#104).
export const SITEMAP_XML = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...["home", "rules"].flatMap((p) => ["zh-Hant", "en"].map((l) => `  <url><loc>${esc(canonicalOf(p, l))}</loc></url>`)),
  "</urlset>",
  "",
].join("\n");

// The page response, rewritten. The two tags the static head already has (description, canonical) are dropped and
// written again at the end of <head>, after the boot script and style (#88), which are not touched.
export function rewriteHead(response, page, lang) {
  const h = headFor(page, lang);
  const out = new HTMLRewriter()
    .on("html", { element: (el) => { el.setAttribute("lang", h.lang); } })
    .on("head > title", { element: (el) => { el.setInnerContent(h.title); } })
    .on('head > meta[name="description"]', { element: (el) => { el.remove(); } })
    .on('head > link[rel="canonical"]', { element: (el) => { el.remove(); } })
    .on("head", { element: (el) => { el.onEndTag((end) => { end.before(h.tags, { html: true }); }); } })
    .transform(response);
  // One stored page, two languages, and a head that changes with the Worker: the asset's validators do not describe
  // this body.
  const headers = new Headers(out.headers);
  for (const k of ["etag", "last-modified", "content-length"]) headers.delete(k);
  return new Response(out.body, { status: out.status, statusText: out.statusText, headers });
}
