// M0 placeholder: language switch only. Every string lives in i18n/.
import en from "./i18n/en.js";
import zh from "./i18n/zh-Hant.js";
const lang = new URLSearchParams(location.search).get("lang") === "en" ? en : zh;
document.documentElement.lang = lang.lang;
for (const el of document.querySelectorAll("[data-i18n]")) {
  const key = el.dataset.i18n;
  const v = key in lang ? lang[key] : lang.nav[key];
  if (typeof v === "string") el.textContent = v;
}
