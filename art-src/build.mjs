// art-src/build.mjs: remakes public/art/share-zh.png, public/art/share-en.png (1200x630) and the icons
// (public/favicon.ico, apple-touch-icon.png, icon-192.png, icon-512.png) from public/favicon.svg and the game's own map.
//
//   node art-src/build.mjs            (needs Chrome; set CHROME=<path to chrome.exe> if it is not in the usual place)
//
// The share pictures are one HTML page per language (written to a temp folder) screenshotted by headless Chrome at
// 1200x630. The island is the game's own printed-board map (public/map.js, the same hand-drawn coast and county
// shapes), cut down to the land only: no county boxes, no text, no pictures of people. The fonts are the ones the
// site's masthead uses (Noto Serif TC Black, installed locally or from Google Fonts). Edit the TEXT table below to
// change the words, then run the script again. Nothing here is loaded by the game at run time.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createGame, view } from "../public/shared/engine.js";
import { taiwanMap } from "../public/map.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pub = path.join(root, "public");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "p2000art-"));
const CHROME = process.env.CHROME || ["C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find((p) => fs.existsSync(p));
if (!CHROME) throw new Error("no Chrome: set CHROME");

function shot(html, w, h, out, transparent = false) {
  const f = path.join(tmp, path.basename(out) + ".html");
  fs.writeFileSync(f, html);
  const r = spawnSync(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1", `--window-size=${w},${h}`, ...(transparent ? ["--default-background-color=00000000"] : []), `--screenshot=${out}`, pathToFileURL(f).href], { encoding: "utf8" });
  if (!fs.existsSync(out)) throw new Error("screenshot failed: " + r.stderr);
  const b = fs.readFileSync(out); // headless can hand back a taller or shorter picture than asked for: check
  const gw = b.readUInt32BE(16), gh = b.readUInt32BE(20);
  if (gw !== w || gh !== h) throw new Error(`${out}: asked ${w}x${h}, got ${gw}x${gh}`);
}

// ---------------------------------------------------------------- the island, land only
const html0 = taiwanMap(view(createGame(12), 1), "zh-Hant", { narrow: false });
let svg = html0.match(/<svg class="tw[\s\S]*<\/svg>/)[0];
const cut = svg.indexOf('stroke-dasharray="1 2.5"'); // the first leader line: everything after is boxes, chips, text
svg = svg.slice(0, svg.lastIndexOf("<path", cut)) + "</svg>";
svg = svg.replace(/^<svg[^>]*>/, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="196 0 380 566" width="380" height="566">').replace(/<rect width="776" height="566" fill="url\(#tw-wv\)"\/>/, "").replace(/ filter="url\(#tw-sh\)"/g, "");

const TEXT = {
  zh: {
    lang: "zh-Hant", paper: "選戰日報", tag: "CAMPAIGN DAILY", big: "2000", name: "總統的誕生", l1: "三人卡牌選戰", l2: "改編自台灣總統大選", nameSize: 96, bigSize: 118,
  },
  en: {
    lang: "en", paper: "Campaign Daily", tag: "選戰日報", big: "2000:", name: "Taiwan Decides", l1: "A card campaign for three", l2: "Taiwan's 2000 election", nameSize: 76, bigSize: 118,
  },
};
const CAMP = ["#2f7d46", "#e0731c", "#2456a6"];
const cube = (c, x, y, r, s = 54) => `<i style="left:${x}px;top:${y}px;width:${s}px;height:${s}px;background:${c};transform:rotate(${r}deg)"></i>`;

function sharePage(t) {
  return `<!doctype html><html lang="${t.lang}"><meta charset="utf-8"><style>
*{box-sizing:border-box}html,body{margin:0;width:1200px;height:630px;overflow:hidden}
body{position:relative;font-family:"Noto Serif TC","Songti TC","PMingLiU",serif;font-weight:900;color:#2b2118;
 background:repeating-linear-gradient(92deg,rgba(0,0,0,.05) 0 2px,rgba(255,255,255,.02) 2px 9px,rgba(0,0,0,.03) 9px 11px),linear-gradient(180deg,#6d4527,#5b3a22 50%,#6a4426)}
.paper{position:absolute;left:42px;top:34px;width:722px;height:566px;background:#fbf6e9;border-radius:8px;transform:rotate(-1.2deg);box-shadow:0 18px 34px rgba(0,0,0,.5),inset 0 0 0 1px #c8b892;padding:26px 36px}
.paper:before{content:"";position:absolute;inset:10px;border:2px solid #2b2118;border-radius:4px}
.mast{position:relative;text-align:center;border-bottom:4px double #2b2118;padding-bottom:6px}
.mast b{display:block;font-size:${t.lang === "en" ? 74 : 84}px;line-height:1.1;letter-spacing:${t.lang === "en" ? 2 : 10}px}
.mast span{display:block;font-size:30px;letter-spacing:${t.lang === "en" ? 2 : 9}px;color:#a8322a;line-height:1.3;margin-bottom:4px}
.big{margin:10px 0 0;font-size:${t.bigSize}px;line-height:1;letter-spacing:2px}
.name{font-size:${t.nameSize}px;line-height:1.1;margin-top:2px;white-space:nowrap;letter-spacing:${t.lang === "en" ? 0 : 3}px}
.l{margin-top:14px;font-size:48px;line-height:1.3;color:#5a4a3a;white-space:nowrap}
.l2{white-space:nowrap;font-size:48px;line-height:1.3;color:#a8322a}
.board{position:absolute;left:792px;top:22px;width:372px;height:590px;background:#efe6d2;border-radius:6px;transform:rotate(1.6deg);box-shadow:0 18px 34px rgba(0,0,0,.5),inset 0 0 0 1px #c8b892;overflow:hidden}
.board:before{content:"";position:absolute;inset:8px;border:2px solid #2b2118;border-radius:3px;z-index:3;pointer-events:none}
.sea{position:absolute;inset:0;background:#c9d6cf}
.board svg{position:absolute;left:-4px;top:12px}
.board i{position:absolute;display:block;border-radius:5px;box-shadow:0 4px 0 rgba(0,0,0,.28),inset 0 0 0 3px rgba(255,255,255,.22);z-index:4}
.col{position:absolute;display:flex;gap:6px}
</style><body>
<div class="paper"><div class="mast"><b>${t.paper}</b><span>${t.tag}</span></div>
<div class="big">${t.big}</div><div class="name">${t.name}</div>
<div class="l">${t.l1}</div><div class="l2">${t.l2}</div></div>
<div class="board"><div class="sea"></div>${svg}
${cube(CAMP[0], 266, 66, -8, 54)}${cube(CAMP[0], 235, 133, 6, 46)}${cube(CAMP[0], 241, 381, 5, 54)}${cube(CAMP[1], 106, 206, 7, 54)}${cube(CAMP[1], 140, 480, -5, 46)}${cube(CAMP[1], 165, 225, 9, 46)}${cube(CAMP[2], 211, 256, -6, 54)}${cube(CAMP[2], 106, 346, 9, 54)}${cube(CAMP[2], 170, 415, -4, 46)}${cube(CAMP[1], 185, 325, 4, 46)}
</div></body></html>`;
}

for (const k of ["zh", "en"]) shot(sharePage(TEXT[k]), 1200, 630, path.join(pub, "art", `share-${k}.png`));

// ---------------------------------------------------------------- the icons: public/favicon.svg, drawn as it is
const fav = fs.readFileSync(path.join(pub, "favicon.svg"), "utf8");
const icon = (s, svgText) => `<!doctype html><html><meta charset="utf-8"><style>html,body{margin:0;width:${s}px;height:${s}px;overflow:hidden;background:transparent}svg{display:block;width:${s}px;height:${s}px}</style><body>${svgText}</body></html>`;
const sizes = { 16: 16, 32: 32, 48: 48, 192: 192, 512: 512, 180: 180 };
const pngs = {};
for (const s of Object.keys(sizes)) {
  const out = path.join(tmp, `i${s}.png`);
  // The home-screen icon (180) is drawn square: iOS rounds it itself and paints transparent corners black.
  shot(icon(Number(s), s === "180" ? fav.replace(' rx="4"', "") : fav), Number(s), Number(s), out, s !== "180");
  pngs[s] = fs.readFileSync(out);
}
fs.writeFileSync(path.join(pub, "apple-touch-icon.png"), pngs[180]);
fs.writeFileSync(path.join(pub, "icon-192.png"), pngs[192]);
fs.writeFileSync(path.join(pub, "icon-512.png"), pngs[512]);
// favicon.ico: an ICO directory, then the PNGs themselves (16, 32, 48)
const parts = [16, 32, 48].map((s) => pngs[s]);
const head = Buffer.alloc(6 + 16 * parts.length);
head.writeUInt16LE(1, 2); head.writeUInt16LE(parts.length, 4);
let off = head.length;
[16, 32, 48].forEach((s, i) => { const o = 6 + i * 16; head[o] = s; head[o + 1] = s; head.writeUInt16LE(1, o + 4); head.writeUInt16LE(32, o + 6); head.writeUInt32LE(parts[i].length, o + 8); head.writeUInt32LE(off, o + 12); off += parts[i].length; });
fs.writeFileSync(path.join(pub, "favicon.ico"), Buffer.concat([head, ...parts]));
fs.rmSync(tmp, { recursive: true, force: true });
console.log("done");
