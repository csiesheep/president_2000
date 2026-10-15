// The Taiwan map (#25): taiwanMap(view, lang, opts) → an SVG string, the printed board. A pure function of one
// seat's view; it never touches the DOM and uses no clock or randomness, so one view always draws the same bytes.
//
//   opts.changed   county indexes that changed just now (data-changed, a red dashed paper)
//   opts.selected  the county whose box is open (data-selected, a pale yellow paper)
//   opts.narrow    true on a phone: every county is a small colour bar instead of a full paper
//   opts.overlay   html placed inside the map's box (the county box, drawn by table.js)
//
// What a test or a page can read off the string: data-county (+ data-changed / data-selected) on one element
// per county, data-slot + data-of on every vote block, data-pawn + data-of on every candidate, and
// data-region + data-media + data-endorse on every media region (the key under the map).
//
// The geometry is hand-drawn from rough coordinates (the owner did not approve downloading county borders):
// a coastline, one Voronoi cell per seed point for the counties of the main island, and the seven cities
// pinned out at sea on dotted leader lines on the desktop board.
import en from "./i18n/en.js";
import zh from "./i18n/zh-Hant.js";
import { COUNTIES, REGIONS, SEATS } from "./shared/board.js";

const f1 = (n) => Math.round(n * 10) / 10;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? vars[k] : "{" + k + "}"));

const COS = 0.9164;
const INK = "#2b2118";
const RED = "#a8322a";
const PAPER = "#fbf6e9";
const SEAT_COL = ["#2f7d46", "#e0731c", "#2456a6"]; // 陳 宋 連
const NO = [5, 1, 2]; // the ballot numbers on the 1999 flags
const SHOW_ORDER = [1, 2, 0];
const TINT = ["#e6d3b3", "#dfe2c2", "#ead0c6", "#f0e2b2", "#dcc9ad", "#cfe0d3", "#e0dccd"];
export const REGION_TINT = TINT;

// ---------------------------------------------------------------- the hand-drawn geometry

const COAST = [
  [121.537, 25.298], [121.64, 25.23], [121.69, 25.21], [121.74, 25.15], [121.83, 25.14], [121.92, 25.13], [122.0, 25.01],
  [121.84, 24.86], [121.82, 24.75], [121.87, 24.59], [121.8, 24.45], [121.76, 24.3], [121.68, 24.17], [121.62, 23.98],
  [121.56, 23.8], [121.52, 23.6], [121.5, 23.48], [121.45, 23.32], [121.38, 23.1], [121.3, 22.97], [121.16, 22.76],
  [121.0, 22.6], [120.9, 22.33], [120.88, 22.2], [120.88, 22.05], [120.85, 21.9], [120.79, 21.95], [120.73, 21.92],
  [120.7, 22.07], [120.65, 22.26], [120.59, 22.37], [120.45, 22.46], [120.38, 22.5], [120.27, 22.6], [120.25, 22.75],
  [120.18, 22.9], [120.15, 23.0], [120.08, 23.15], [120.11, 23.27], [120.15, 23.38], [120.14, 23.46], [120.15, 23.58],
  [120.18, 23.7], [120.25, 23.79], [120.3, 23.92], [120.4, 24.06], [120.45, 24.13], [120.52, 24.27], [120.58, 24.37],
  [120.63, 24.44], [120.67, 24.5], [120.76, 24.62], [120.84, 24.7], [120.92, 24.85], [120.98, 24.92], [121.08, 25.04],
  [121.17, 25.1], [121.32, 25.14], [121.41, 25.18], [121.48, 25.26],
];
const PENGHU = [
  [[119.56, 23.66], [119.62, 23.64], [119.66, 23.58], [119.62, 23.53], [119.57, 23.55], [119.54, 23.6]],
  [[119.5, 23.6], [119.53, 23.57], [119.5, 23.54], [119.47, 23.57]],
  [[119.43, 23.37], [119.47, 23.36], [119.45, 23.33]],
];
// One Voronoi seed per bit of land; the seeds of a county share its name.
const SEEDS = {
  "台北縣": [[121.45, 25.2], [121.6, 25.12], [121.5, 24.97], [121.65, 24.88], [121.82, 25.03], [121.58, 25.02]],
  "宜蘭縣": [[121.75, 24.72], [121.62, 24.55], [121.55, 24.42]],
  "桃園縣": [[121.2, 25.0], [121.28, 24.8]],
  "新竹縣": [[121.05, 24.8], [121.22, 24.6]],
  "苗栗縣": [[120.85, 24.55], [121.0, 24.45]],
  "台中縣": [[120.65, 24.32], [120.85, 24.23], [121.15, 24.25], [121.38, 24.25]],
  "彰化縣": [[120.45, 24.02], [120.5, 23.88]],
  "南投縣": [[120.78, 23.95], [121.0, 23.88], [121.05, 23.62], [120.85, 23.7]],
  "雲林縣": [[120.32, 23.72], [120.55, 23.68]],
  "嘉義縣": [[120.28, 23.45], [120.52, 23.45], [120.72, 23.42]],
  "台南縣": [[120.22, 23.22], [120.42, 23.18], [120.52, 23.08]],
  "高雄縣": [[120.38, 22.82], [120.6, 22.98], [120.78, 23.2], [120.88, 23.05]],
  "屏東縣": [[120.55, 22.6], [120.66, 22.4], [120.75, 22.15], [120.8, 21.98], [120.75, 22.7]],
  "花蓮縣": [[121.55, 24.05], [121.45, 23.75], [121.38, 23.45], [121.3, 24.12], [121.3, 23.85]],
  "台東縣": [[121.28, 23.2], [121.08, 22.82], [120.93, 22.45], [121.12, 23.05]],
};
// Where the seven cities really are (the red dots on the desktop board).
const CITY = { "台北市": [121.55, 25.05], "基隆市": [121.73, 25.12], "新竹市": [120.97, 24.8], "台中市": [120.68, 24.15], "嘉義市": [120.45, 23.48], "台南市": [120.2, 22.99], "高雄市": [120.3, 22.63] };
// Where a county's paper sits on the desktop board (lon, lat).
const ANCHOR = { "台北縣": [121.78, 24.95], "宜蘭縣": [121.66, 24.6], "桃園縣": [121.2, 24.9], "新竹縣": [121.17, 24.67], "苗栗縣": [120.93, 24.47], "台中縣": [121.08, 24.25], "彰化縣": [120.5, 23.97], "南投縣": [120.97, 23.78], "雲林縣": [120.42, 23.69], "嘉義縣": [120.65, 23.42], "台南縣": [120.4, 23.16], "高雄縣": [120.68, 22.93], "屏東縣": [120.66, 22.45], "花蓮縣": [121.4, 23.88], "台東縣": [121.12, 22.98], "澎湖縣": [119.45, 23.82] };
// The cities' papers out at sea (desktop), in lon/lat.
const CALL = { "台北市": [122.3, 25.2], "基隆市": [122.38, 24.93], "新竹市": [120.42, 24.95], "台中市": [120.1, 24.3], "嘉義市": [119.95, 23.38], "台南市": [119.85, 23.0], "高雄市": [119.95, 22.62] };
// A county's bar on the phone board (lon, lat). Nudged by hand so no two 30 × 30 touch areas overlap.
const BAR = {
  "台北市": [121.38, 25.2], "基隆市": [121.86, 25.2], "台北縣": [121.72, 24.93], "桃園縣": [121.09, 24.96], "新竹市": [120.78, 24.9], "新竹縣": [121.2, 24.69],
  "宜蘭縣": [121.7, 24.62], "苗栗縣": [120.9, 24.45], "台中市": [120.55, 24.2], "台中縣": [121.2, 24.22], "彰化縣": [120.4, 23.93], "南投縣": [120.97, 23.9],
  "雲林縣": [120.42, 23.66], "嘉義市": [120.28, 23.38], "嘉義縣": [120.72, 23.6], "台南市": [120.18, 23.1], "台南縣": [120.58, 23.14], "高雄市": [120.28, 22.75],
  "高雄縣": [120.82, 22.87], "屏東縣": [120.62, 22.4], "花蓮縣": [121.4, 23.85], "台東縣": [121.14, 23.1], "澎湖縣": [119.58, 23.66],
};

function clipHalf(poly, a, b, c, label) {
  const out = [];
  const g = (p) => a * p.x + b * p.y - c;
  for (let i = 0; i < poly.length; i++) {
    const p0 = poly[i], q = poly[(i + 1) % poly.length];
    const fp = g(p0), fq = g(q), ip = fp <= 0, iq = fq <= 0;
    const cut = () => { const t = fp / (fp - fq); return { x: p0.x + t * (q.x - p0.x), y: p0.y + t * (q.y - p0.y) }; };
    if (ip && iq) out.push({ ...p0 });
    else if (ip && !iq) { out.push({ ...p0 }); out.push({ ...cut(), l: label }); }
    else if (!ip && iq) out.push({ ...cut(), l: p0.l });
  }
  return out;
}

const MODES = {
  desk: { k: 161, x0: 149, y0: -10, w: 776, h: 566 },
  phone: { k: 117, x0: -2, y0: 0, w: 368, h: 418 },
};

function geo({ k, x0, y0 }) {
  const lon0 = 119.3, lat0 = 25.45;
  const P = (lon, lat) => [(lon - lon0) * COS * k + x0, (lat0 - lat) * k + y0];
  const pathOf = (pts) => "M" + pts.map((p) => f1(p.x ?? p[0]) + " " + f1(p.y ?? p[1])).join("L") + "Z";
  const seedList = [];
  for (const [name, pts] of Object.entries(SEEDS)) for (const [a, b] of pts) { const [x, y] = P(a, b); seedList.push({ x, y, name }); }
  const box = [{ x: -5000, y: -5000, l: "box" }, { x: 9000, y: -5000, l: "box" }, { x: 9000, y: 9000, l: "box" }, { x: -5000, y: 9000, l: "box" }];
  const cells = seedList.map((s, i) => {
    let poly = box.map((p) => ({ ...p }));
    seedList.forEach((t, j) => { if (i !== j) poly = clipHalf(poly, t.x - s.x, t.y - s.y, (t.x * t.x + t.y * t.y - s.x * s.x - s.y * s.y) / 2, j); });
    return poly;
  });
  const regionOf = (name) => COUNTIES.find((c) => c[0] === name)[1];
  const borders = (same) => {
    let d = "";
    cells.forEach((poly, i) => poly.forEach((p, q) => {
      const n = poly[(q + 1) % poly.length];
      if (p.l === "box" || p.l === undefined) return;
      if (!same(seedList[i].name, seedList[p.l].name)) d += `M${f1(p.x)} ${f1(p.y)}L${f1(n.x)} ${f1(n.y)}`;
    }));
    return d;
  };
  const fills = cells.map((poly, i) => { const c = TINT[regionOf(seedList[i].name)]; return `<path d="${pathOf(poly)}" fill="${c}" stroke="${c}" stroke-width="1"/>`; }).join("");
  return {
    P, fills, coast: pathOf(COAST.map(([a, b]) => P(a, b))), penghu: PENGHU.map((p) => pathOf(p.map(([a, b]) => P(a, b)))).join(""),
    county: borders((a, b) => a === b), region: borders((a, b) => regionOf(a) === regionOf(b)),
  };
}

// ---------------------------------------------------------------- words

const dict = (lang) => (lang === "en" ? en : zh);
const cand = (d, p) => d.ui.solo.cand[SEATS[p]];
const nameOf = (d, lang, k) => (lang === "en" ? d.counties[COUNTIES[k][0]] : COUNTIES[k][0]);
const shortOf = (d, k) => d.ui.solo.map.short[COUNTIES[k][0]];
// The width a label needs: a Chinese character is one em wide, a Latin one a bit over half.
const textW = (s, font) => [...s].reduce((w, ch) => w + (ch.charCodeAt(0) > 255 ? font : font * 0.6), 0);
const slotOf = (b) => (b.o >= 0 ? SEATS[b.o] : b.t === "G" ? "green" : b.t === "B" ? "blue" : "grey");
const ORDER = { chen: 0, soong: 1, lien: 2, green: 3, blue: 4, grey: 5 };
const sortedSlots = (blocks) => blocks.map(slotOf).sort((a, b) => ORDER[a] - ORDER[b]);

function slotRect(kind, k, x, y, sz) {
  const a = `data-slot="${kind}" data-of="${k}"`;
  const i = SEATS.indexOf(kind);
  if (i >= 0) return `<rect ${a} x="${f1(x)}" y="${f1(y)}" width="${sz}" height="${sz}" rx="1.2" fill="${SEAT_COL[0 + i]}"/>`;
  const st = kind === "green" ? `fill="#e3efe2" stroke="${SEAT_COL[0]}" stroke-width="1.2"` : kind === "blue" ? `fill="#e1e8f4" stroke="${SEAT_COL[2]}" stroke-width="1.2"` : `fill="#f6efdd" stroke="#8a7658" stroke-width=".9" stroke-dasharray="1.6 1.2"`;
  return `<rect ${a} x="${f1(x + 0.6)}" y="${f1(y + 0.6)}" width="${f1(sz - 1.2)}" height="${f1(sz - 1.2)}" rx="1.2" ${st}/>`;
}

// The pawns standing in county k: a round marker in the candidate's colour with the flag number, hung off
// the top-right corner of the paper.
function pawns(v, k, d, right, top) {
  let s = "", n = 0;
  for (let p = 0; p < 3; p++) {
    if (v.pos[p] !== k) continue;
    const cx = right - 4 - n * 9.5, cy = top;
    s += `<g data-pawn="${SEATS[p]}" data-of="${k}" aria-hidden="true"><circle cx="${f1(cx)}" cy="${f1(cy)}" r="4.6" fill="${SEAT_COL[p]}" stroke="${PAPER}" stroke-width="1.3"/>` +
      `<text x="${f1(cx)}" y="${f1(cy + 2.1)}" text-anchor="middle" font-size="6" font-weight="900" fill="#fff" font-family="'Noto Sans TC', sans-serif">${NO[p]}</text></g>`;
    n++;
  }
  return s;
}

function labelOf(v, k, d, lang) {
  const tr = (p, vars) => fill(p, vars);
  const M = d.ui.solo.map, blocks = v.counties[k].blocks;
  const own = SHOW_ORDER.map((p) => [p, blocks.filter((b) => b.o === p).length]).filter(([, n]) => n > 0).map(([p, n]) => `${cand(d, p).short} ${n}`);
  const here = [0, 1, 2].filter((p) => v.pos[p] === k).map((p) => tr(M.here, { who: cand(d, p).name }));
  return [nameOf(d, lang, k), tr(M.blocks, { n: blocks.length }), ...own, ...here].join(" · ");
}

// The county's wrapper: one focusable element carrying the flags. `inner` is its paper.
function county(v, k, d, lang, o, inner) {
  const chg = (o.changed || []).includes(k), sel = o.selected === k;
  return `<g class="tw-c" data-county="${k}" tabindex="0" role="button" aria-label="${esc(labelOf(v, k, d, lang))}"${chg ? " data-changed" : ""}${sel ? " data-selected" : ""}>${inner}</g>`;
}

// ---------------------------------------------------------------- the two papers

// Desktop: the name and the grid of blocks on a paper centred on (cx, cy). Returns { svg, box }.
function paper(v, k, d, lang, o, cx, cy, { cols, bold = false }) {
  const sz = 6.5, gap = 1.5, font = 10;
  const sl = sortedSlots(v.counties[k].blocks), c = Math.min(sl.length, cols), rows = Math.ceil(sl.length / c);
  const label = shortOf(d, k), gw = c * sz + (c - 1) * gap;
  const w = Math.max(gw, textW(label, font) + 2) + 8, h = font + 6 + rows * (sz + gap) + 3;
  const x0 = cx - w / 2, y0 = cy - h / 2;
  let s = `<rect class="tw-hit" x="${f1(cx - Math.max(w, 30) / 2)}" y="${f1(cy - Math.max(h, 30) / 2)}" width="${f1(Math.max(w, 30))}" height="${f1(Math.max(h, 30))}" fill="transparent"/>`;
  s += `<rect class="tw-paper" x="${f1(x0)}" y="${f1(y0)}" width="${f1(w)}" height="${f1(h)}" rx="2.5" fill="${PAPER}" stroke="${INK}" stroke-width="${bold ? 1.3 : 0.9}" filter="url(#tw-sh)"/>`;
  s += `<text x="${f1(x0 + 4)}" y="${f1(y0 + font + 1.5)}" font-family="'Noto Serif TC', serif" font-size="${font}" font-weight="900" fill="${INK}">${esc(label)}</text>`;
  sl.forEach((kind, i) => { s += slotRect(kind, k, x0 + 4 + (i % c) * (sz + gap), y0 + font + 4 + Math.floor(i / c) * (sz + gap), sz); });
  s += pawns(v, k, d, x0 + w + 1, y0 - 1);
  s += `<rect class="tw-ring" x="${f1(x0 - 2)}" y="${f1(y0 - 2)}" width="${f1(w + 4)}" height="${f1(h + 4)}" rx="4" fill="none"/>`;
  return { svg: county(v, k, d, lang, o, s), box: { cx, cy, w, h } };
}

// Phone: the name over a thin bar split in the proportion of the blocks.
function bar(v, k, d, lang, o, cx, cy) {
  const w = 30, sl = sortedSlots(v.counties[k].blocks), n = sl.length;
  const seg = { chen: SEAT_COL[0], soong: SEAT_COL[1], lien: SEAT_COL[2], green: "#bcd9c3", blue: "#bccbe6", grey: "#e2d9c3" };
  const label = shortOf(d, k), font = 7.5, bw = Math.max(w, textW(label, font) + 2) + 4;
  let s = `<rect class="tw-hit" x="${f1(cx - 15.5)}" y="${f1(cy - 16)}" width="31" height="31" fill="transparent"/>`;
  s += `<rect class="tw-paper" x="${f1(cx - bw / 2)}" y="${f1(cy - 11)}" width="${f1(bw)}" height="20" rx="2.5" fill="${PAPER}" stroke="${INK}" stroke-width=".8"/>`;
  s += `<text x="${f1(cx)}" y="${f1(cy - 2.5)}" text-anchor="middle" font-family="'Noto Serif TC', serif" font-size="${font}" font-weight="900" fill="${INK}">${esc(label)}</text>`;
  let x = cx - w / 2;
  for (const kind of sl) { const ww = w / n; s += `<rect data-slot="${kind}" data-of="${k}" x="${f1(x)}" y="${f1(cy + 1)}" width="${f1(Math.max(ww - 0.6, 0.6))}" height="5" fill="${seg[kind]}"/>`; x += ww; }
  s += pawns(v, k, d, cx + bw / 2 + 1, cy - 12);
  s += `<rect class="tw-ring" x="${f1(cx - bw / 2 - 2)}" y="${f1(cy - 13)}" width="${f1(bw + 4)}" height="24" rx="4" fill="none"/>`;
  return { svg: county(v, k, d, lang, o, s), box: { cx, cy: cy - 1, w: bw, h: 20 } };
}

// ---------------------------------------------------------------- layout, memoised per board size

const memo = {};
function layout(mode) {
  if (memo[mode]) return memo[mode];
  const m = MODES[mode], g = geo(m);
  const at = (lon, lat) => g.P(lon, lat);
  const out = { m, g, spots: [] }; // spots[k] = { cx, cy, cols, bold, lead: [x, y] | null }
  COUNTIES.forEach(([name], k) => {
    if (mode === "phone") {
      const [x, y] = name === "金馬" ? [35, 25] : at(...BAR[name]);
      out.spots[k] = { cx: x, cy: y };
    } else if (CALL[name]) {
      const [x, y] = at(...CALL[name]), [px, py] = at(...CITY[name]);
      out.spots[k] = { cx: x, cy: y, cols: name === "台北市" ? 10 : 6, bold: true, lead: [px, py] };
    } else if (name === "金馬") {
      out.spots[k] = { cx: 56, cy: 44, cols: 5 };
    } else {
      const [x, y] = at(...ANCHOR[name]);
      out.spots[k] = { cx: x, cy: y, cols: name === "台北縣" ? 8 : 5 };
    }
  });
  return (memo[mode] = out);
}

// Where the county box sits, as fractions of the board and the CSS that puts it there. Used by table.js.
export function popPlace(k, narrow) {
  const { m, spots } = layout(narrow ? "phone" : "desk"), s = spots[k];
  const fx = s.cx / m.w, fy = s.cy / m.h, pc = (n) => f1(n * 100);
  const style = (rule) => `--ax:${f1(fx * 1000) / 1000};${rule}`;
  if (narrow) {
    const down = fy < 0.55;
    return { cls: `pop-n ${down ? "dn" : "up"}`, style: style(down ? `top:${pc((s.cy + 20) / m.h)}%` : `bottom:${pc(1 - (s.cy - 22) / m.h)}%`) };
  }
  const right = fx < 0.47, down = fy < 0.5;
  const horiz = right ? `left:calc(${pc(fx)}% + 54px)` : `right:calc(${pc(1 - fx)}% + 54px)`;
  const vert = down ? `top:calc(${pc(fy)}% - 28px)` : `bottom:calc(${pc(1 - fy)}% - 28px)`;
  return { cls: `pop-d ${right ? "rt" : "lf"} ${down ? "dn" : "up"}`, style: style(horiz + ";" + vert) };
}

// ---------------------------------------------------------------- the map

export function taiwanMap(view, lang, opts = {}) {
  const v = view, d = dict(lang), o = opts, M = d.ui.solo.map;
  const mode = o.narrow ? "phone" : "desk";
  const L = layout(mode), { m, g } = L;
  const INK_LINE = INK;
  let svg = `<svg class="tw tw-${mode}" viewBox="0 0 ${m.w} ${m.h}" role="group" aria-label="${esc(M.board)}" font-family="'Noto Sans TC', sans-serif">` +
    `<defs><filter id="tw-sh" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="1" stdDeviation=".8" flood-color="#3c2410" flood-opacity=".35"/></filter>` +
    `<pattern id="tw-wv" width="40" height="18" patternUnits="userSpaceOnUse"><path d="M2 12q4-5 9 0t9 0" fill="none" stroke="#9fb3b0" stroke-width=".9" opacity=".5"/></pattern>` +
    `<clipPath id="tw-cl"><path d="${g.coast}"/></clipPath></defs>` +
    `<rect width="${m.w}" height="${m.h}" fill="url(#tw-wv)"/>` +
    `<g clip-path="url(#tw-cl)">${g.fills}</g>` +
    `<g clip-path="url(#tw-cl)"><path d="${g.county}" stroke="${INK_LINE}" stroke-width=".7" fill="none" stroke-dasharray="2.5 1.8"/><path d="${g.region}" stroke="${INK_LINE}" stroke-width="1.5" fill="none"/></g>` +
    `<path d="${g.coast}" fill="none" stroke="${INK_LINE}" stroke-width="1.9"/><path d="${g.penghu}" fill="${TINT[6]}" stroke="${INK_LINE}" stroke-width="1.2"/>`;
  if (mode === "desk") {
    for (const s of L.spots) if (s && s.lead) {
      svg += `<path d="M${f1(s.lead[0])} ${f1(s.lead[1])}L${f1(s.cx)} ${f1(s.cy)}" stroke="${INK}" stroke-width="1" stroke-dasharray="1 2.5" stroke-linecap="round"/>` +
        `<circle cx="${f1(s.lead[0])}" cy="${f1(s.lead[1])}" r="3.2" fill="${RED}" stroke="${PAPER}" stroke-width="1"/>`;
    }
    svg += `<g><rect x="8" y="8" width="96" height="58" fill="rgba(251,246,233,.75)" stroke="${INK}" stroke-dasharray="3 2"/><text x="13" y="20" font-size="8.5" fill="#6a5a48">${esc(M.islands)}</text></g>`;
  } else {
    svg += `<rect x="6" y="6" width="58" height="34" fill="rgba(251,246,233,.75)" stroke="${INK}" stroke-dasharray="3 2"/>`;
  }
  let boxes = "";
  COUNTIES.forEach((_, k) => {
    const s = L.spots[k];
    boxes += (mode === "phone" ? bar(v, k, d, lang, o, s.cx, s.cy) : paper(v, k, d, lang, o, s.cx, s.cy, s)).svg;
  });
  svg += boxes + `</svg>`;

  const keyList = REGIONS.map((_, r) => {
    const med = v.media[r], endorse = v.endorse[r];
    const medTxt = SHOW_ORDER.filter((p) => med[p] > 0).map((p) => `${cand(d, p).short} ${med[p]}`).join(" · ");
    const parts = [medTxt ? `${M.media} ${medTxt}` : "", endorse >= 0 ? `${M.endorse} ${cand(d, endorse).short}` : ""].filter(Boolean).join(" · ");
    const name = lang === "en" ? d.regions[REGIONS[r]] : REGIONS[r];
    return `<li data-region="${r}" data-media="${med.join(",")}" data-endorse="${endorse}"><i class="sw" style="background:${TINT[r]}"></i><b>${esc(name)}</b>${parts ? `<span>${esc(parts)}</span>` : ""}</li>`;
  }).join("");
  const sq = (cls) => `<i class="lb ${cls}"></i>`;
  const legend = `<p class="legend tw-leg"><span>${sq("chen")}${sq("soong")}${sq("lien")} ${esc(M.legendCubes)}</span><span>${sq("green")}${sq("blue")} ${esc(M.legendEmpty)}</span><span>${sq("grey")} ${esc(M.legendGrey)}</span><span><i class="lb pw"></i>${esc(M.legendPawn)}</span></p>`;
  return `<section class="t-map" aria-label="${esc(M.board)}"><h3 class="t-h">${esc(M.board)}</h3><p class="ct tw-hint">${esc(M.hint)}</p>` +
    `<div class="tw-box">${svg}${o.overlay || ""}</div><ul class="tw-reg">${keyList}</ul>${legend}</section>`;
}
