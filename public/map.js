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
// data-region + data-endorse on every region and one data-media-national="<陳>,<宋>,<連>" line (the key under the
// map; rulebook v0.4, #34: media is one national box).
//
// The geometry is hand-drawn from rough coordinates (the owner did not approve downloading county borders):
// a coastline, one Voronoi cell per seed point for the counties of the main island, and the seven cities
// pinned out at sea on dotted leader lines on the desktop board.
import en from "./i18n/en.js";
import zh from "./i18n/zh-Hant.js";
import { COUNTIES, REGIONS, SEATS } from "./shared/board.js";

const f1 = (n) => Math.round(n * 10) / 10;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const fill = (s, vars = {}) => s.replace(/\{(\w+)(?:#([^|}]*)\|([^}]*))?\}/g, (m, k, one, many) => (!(k in vars) ? m : one === undefined ? vars[k] : Number(vars[k]) === 1 ? one : many)); // "{n#block|blocks}": the singular at 1 (#30)

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
// The seven cities' papers out at sea on the phone board (lon, lat): where the layout starts from. The paper is
// then pushed off whatever it would touch (see place). The desktop has CALL above.
const SEA = { "台北市": [120.95, 25.55], "基隆市": [122.05, 25.5], "新竹市": [120.45, 24.95], "台中市": [120.08, 24.3], "嘉義市": [119.82, 23.62], "台南市": [119.75, 23.05], "高雄市": [119.85, 22.55] };

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
  desk: { k: 161, x0: 149, y0: -10, w: 776, h: 566, lon0: 119.3, lat0: 25.45 },
  phone: { k: 132, x0: 0, y0: 0, w: 370, h: 530, lon0: 119.32, lat0: 25.72 },
};

function geo({ k, x0, y0, lon0, lat0 }) {
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


// ---------------------------------------------------------------- the paper of one county (#29)
// Every county is one paper: its name over a grid of blocks. All the blocks on the board are the same size
// (the cubes of the three candidates are all one size, the empty ones a hair smaller), so a county with
// more blocks has a bigger paper. Position is a pure function of (screen size, language): see relax().

const GEOM = { desk: { sz: 6.5, gap: 1.5, font: 10 }, phone: { sz: 7, gap: 1.5, font: 9 } };
const colsPhone = (n) => Math.max(1, Math.min(7, Math.ceil(Math.sqrt(n * 1.5))));
const colsDesk = (name) => (name === "台北市" ? 10 : name === "台北縣" ? 8 : CALL[name] ? 6 : 5);
const blocksIn = (k) => COUNTIES[k][2] + COUNTIES[k][3] + COUNTIES[k][4];

function slotRect(kind, k, x, y, sz) {
  const a = `data-slot="${kind}" data-of="${k}"`;
  const i = SEATS.indexOf(kind);
  if (i >= 0) return `<rect ${a} x="${f1(x)}" y="${f1(y)}" width="${sz}" height="${sz}" rx="1.2" fill="${SEAT_COL[i]}"/>`;
  const st = kind === "green" ? `fill="#e3efe2" stroke="${SEAT_COL[0]}" stroke-width="1.2"` : kind === "blue" ? `fill="#e1e8f4" stroke="${SEAT_COL[2]}" stroke-width="1.2"` : `fill="#f6efdd" stroke="#8a7658" stroke-width=".9" stroke-dasharray="1.6 1.2"`;
  return `<rect ${a} x="${f1(x + 0.6)}" y="${f1(y + 0.6)}" width="${f1(sz - 1.2)}" height="${f1(sz - 1.2)}" rx="1.2" ${st}/>`;
}

// ---- the candidates standing on the map: a round picture on the paper's top-right corner, lapping over its top edge
const R = 11; // the picture's radius; the ring is 2.6 more
const STEP = 16; // two or three on one county stand in a row going left, each one 16 from the last
const youW = (d) => Math.max(16, Math.ceil(textW(d.ui.solo.map.you, 9) + 6)); // the width of the red "你" / "You" tag on the left of your own candidate
// Everything the candidates of one county can ever draw (worst case: all three, you among them), as a box measured
// from the paper's top-right corner (right, top): x from -(49 + tag) to +13.4, y from -14.2 to +15.8.
const zoneOf = (right, top, yw) => { const l = right - 49 - yw; return { x: l, y: top - 14.2, w: right + 13.4 - l, h: 30 }; };

// The candidates in county k, right to left. Yours is the last, so its tag is on the far left and nothing covers it.
function standing(v, k) {
  const here = SHOW_ORDER.filter((p) => v.pos[p] === k && p !== v.seat);
  if (v.pos[v.seat] === k) here.push(v.seat);
  return here;
}
// pawns() returns { svg, pics }: the ring, number and tag stay in the SVG; the round picture is an HTML <img> laid over the
// map (#31), placed in % of the viewBox so the string alone decides where it is. A candidate that walks to another county
// is the same <img> with another style (drawing.js matches it by data-pawn-pic), never a new one.
// What of the SVG must stay in front of a picture (an HTML <img> is above the whole svg): the picture's own number disc,
// and, when a candidate stands to its left, that one's ring (its own picture comes later in the html and covers it) and
// number disc. Each hole is a circle in the picture's own 0..22 box; the mask cuts them out so the svg shows through.
function mask(holes) {
  const S = 2 * R;
  const g = holes.map(([x, y, r]) => {
    const far = Math.max(Math.hypot(x, y), Math.hypot(S - x, y), Math.hypot(x, S - y), Math.hypot(S - x, S - y)), a = (r / far) * 100;
    return `radial-gradient(circle farthest-corner at ${f1((x / S) * 100)}% ${f1((y / S) * 100)}%,transparent ${f1(a)}%,#000 ${f1(a + 0.8)}%)`;
  }).join(",");
  return `-webkit-mask-image:${g};mask-image:${g}`;
}
function pawns(v, k, d, right, top, m) {
  let s = "", pics = "";
  const here = standing(v, k);
  here.forEach((p, j) => {
    const cx = right - 1 - STEP * j, cy = top, me = p === v.seat;
    const bx = cx + R * 0.78, by = cy + R * 0.72;
    s += `<g data-pawn="${SEATS[p]}" data-of="${k}"${me ? " data-me" : ""} aria-hidden="true">` +
      `<ellipse cx="${f1(cx + 1)}" cy="${f1(cy + R + 2)}" rx="${f1(R * 0.9)}" ry="2.6" fill="rgba(43,33,24,.35)"/>` +
      `<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${R + 2.6}" fill="${SEAT_COL[p]}" stroke="${PAPER}" stroke-width="1.4"/>` +
      `<circle cx="${f1(bx)}" cy="${f1(by)}" r="5.6" fill="${SEAT_COL[p]}" stroke="${PAPER}" stroke-width="1.2"/>` +
      `<text x="${f1(bx)}" y="${f1(by + 3.1)}" text-anchor="middle" font-size="8.5" font-weight="900" fill="#fff" font-family="'Noto Serif TC', serif">${NO[p]}</text>`;
    if (me) {
      const w = youW(d), tx = cx - R - 5 - w;
      s += `<rect x="${f1(tx)}" y="${f1(cy - 14)}" width="${w}" height="13" rx="2.5" fill="${RED}"/>` +
        `<text x="${f1(tx + w / 2)}" y="${f1(cy - 4.2)}" text-anchor="middle" font-size="9" font-weight="900" fill="#fbf6e9" font-family="'Noto Sans TC', sans-serif">${esc(d.ui.solo.map.you)}</text>`;
    }
    s += `</g>`;
    const bd = [R + R * 0.78, R + R * 0.72, 6.2], holes = [bd];
    if (j + 1 < here.length) holes.push([R - STEP, R, R + 3.3], [bd[0] - STEP, bd[1], 6.2]);
    const pc = (n, of) => Math.round((n / of) * 100000) / 1000;
    pics += `<img data-pawn-pic="${SEATS[p]}" data-of="${k}" src="art/candidates/${SEATS[p]}.webp" alt="" draggable="false" style="${mask(holes)};left:${pc(cx - R, m.w)}%;top:${pc(cy - R, m.h)}%;width:${pc(2 * R, m.w)}%;height:${pc(2 * R, m.h)}%">`;
  });
  return { svg: s, pics };
}

function labelOf(v, k, d, lang) {
  const tr = (p, vars) => fill(p, vars);
  const M = d.ui.solo.map, blocks = v.counties[k].blocks;
  const own = SHOW_ORDER.map((p) => [p, blocks.filter((b) => b.o === p).length]).filter(([, n]) => n > 0).map(([p, n]) => `${cand(d, p).short} ${n}`);
  const here = [0, 1, 2].filter((p) => v.pos[p] === k).map((p) => tr(M.here, { who: cand(d, p).name }));
  return [nameOf(d, lang, k), tr(M.blocks, { n: blocks.length }), ...own, ...here].join(" · ");
}

// The county's wrapper: one focusable element carrying the flags. `inner` is its paper and its candidates.
function county(v, k, d, lang, o, inner) {
  const chg = (o.changed || []).includes(k), sel = o.selected === k;
  return `<g class="tw-c" data-county="${k}" tabindex="0" role="button" aria-label="${esc(labelOf(v, k, d, lang))}"${chg ? " data-changed" : ""}${sel ? " data-selected" : ""}>${inner}</g>`;
}

function paper(v, k, d, lang, o, mode, s, m, pics) {
  const { sz, gap, font } = GEOM[mode];
  const sl = sortedSlots(v.counties[k].blocks), c = Math.max(1, Math.min(sl.length, s.cols));
  const label = shortOf(d, k), x0 = s.cx - s.w / 2, y0 = s.cy - s.h / 2;
  const hw = Math.max(s.w, 30), hh = Math.max(s.h, 30);
  let t = `<rect class="tw-hit" x="${f1(s.cx - hw / 2)}" y="${f1(s.cy - hh / 2)}" width="${f1(hw)}" height="${f1(hh)}" fill="transparent"/>`;
  t += `<rect class="tw-paper" data-paper="${k}" x="${f1(x0)}" y="${f1(y0)}" width="${f1(s.w)}" height="${f1(s.h)}" rx="2.5" fill="${PAPER}" stroke="${INK}" stroke-width="${s.bold ? 1.3 : 0.9}" filter="url(#tw-sh)"/>`;
  t += `<text x="${f1(x0 + 4)}" y="${f1(y0 + font + 1)}" font-family="'Noto Serif TC', serif" font-size="${font}" font-weight="900" fill="${INK}">${esc(label)}</text>`;
  sl.forEach((kind, i) => { t += slotRect(kind, k, x0 + 4 + (i % c) * (sz + gap), y0 + font + 4 + Math.floor(i / c) * (sz + gap), sz); });
  const pw = pawns(v, k, d, x0 + s.w, y0, m);
  t += pw.svg; pics.push(pw.pics);
  t += `<rect class="tw-ring" x="${f1(x0 - 2)}" y="${f1(y0 - 2)}" width="${f1(s.w + 4)}" height="${f1(s.h + 4)}" rx="4" fill="none"/>`;
  return county(v, k, d, lang, o, t);
}

// ---------------------------------------------------------------- layout, memoised per board size and language

// The size of county k's paper: the label and the grid of blocks, every block the same size.
function paperSize(k, mode, d) {
  const { sz, gap, font } = GEOM[mode], n = blocksIn(k), name = COUNTIES[k][0];
  const cols = Math.max(1, Math.min(n, mode === "phone" ? colsPhone(n) : colsDesk(name))), rows = Math.ceil(n / cols);
  const gw = cols * sz + (cols - 1) * gap, lw = textW(shortOf(d, k), font);
  // The label keeps 11 clear on its right: that is where the candidates stand.
  return { cols, w: Math.max(gw, lw + 11) + 8, h: font + 4 + rows * (sz + gap) - gap + 4 };
}

// Push the papers apart until no paper touches another and no candidate (wherever up to three of them stand on
// a county) can touch another county's paper. Each paper starts at its place on the map and is pulled back
// towards it; the last rounds only push. Fixed iteration order and no randomness: one input, one layout.
function relax(items, W, H, yw) {

  const bounds = (a) => { // where the centre may be so that the paper and its candidates stay inside the board
    const lo = Math.min(-a.w / 2, a.w / 2 - 49 - yw), hi = Math.max(a.w / 2, a.w / 2 + 13.4);
    return { x0: 2 - lo, x1: W - 2 - hi, y0: 2 + a.h / 2 + 14.2, y1: H - 2 - Math.max(a.h / 2, 15.8 - a.h / 2) };
  };
  const clamp = (a) => { const b = bounds(a); a.x = Math.max(b.x0, Math.min(b.x1, a.x)); a.y = Math.max(b.y0, Math.min(b.y1, a.y)); };
  const paperOf = (a) => ({ x: a.x - a.w / 2, y: a.y - a.h / 2, w: a.w, h: a.h });
  const zoneOfItem = (a) => zoneOf(a.x + a.w / 2, a.y - a.h / 2, yw);
  const push = (ra, a, rb, b, pad) => {
    const ox = (ra.w + rb.w) / 2 + pad - Math.abs(rb.x + rb.w / 2 - ra.x - ra.w / 2), oy = (ra.h + rb.h) / 2 + pad - Math.abs(rb.y + rb.h / 2 - ra.y - ra.h / 2);
    if (ox <= 0 || oy <= 0) return false;
    const wa = a.pin ? 0 : b.pin ? 1 : 0.5, wb = 1 - wa;
    if (ox < oy) { const sx = rb.x + rb.w / 2 >= ra.x + ra.w / 2 ? 1 : -1; a.x -= sx * ox * wa; b.x += sx * ox * wb; }
    else { const sy = rb.y + rb.h / 2 >= ra.y + ra.h / 2 ? 1 : -1; a.y -= sy * oy * wa; b.y += sy * oy * wb; }
    return true;
  };
  for (const a of items) if (a.pin) clamp(a);
  for (let it = 0; it < 2400; it++) {
    let moved = false;
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j];
      if (push(paperOf(a), a, paperOf(b), b, 3)) moved = true;
      if (push(zoneOfItem(a), a, paperOf(b), b, 2)) moved = true;
      if (push(zoneOfItem(b), b, paperOf(a), a, 2)) moved = true;
    }
    const pull = it < 1600 ? 0.03 : 0;
    for (const a of items) { if (a.pin) continue; a.x += (a.tx - a.x) * pull; a.y += (a.ty - a.y) * pull; clamp(a); }
    if (!moved && it > 1600) break;
  }
}

const memo = {};
function layout(mode, lang) {
  const key = mode + "|" + lang;
  if (memo[key]) return memo[key];
  const m = MODES[mode], g = geo(m), d = dict(lang), at = (lon, lat) => g.P(lon, lat);
  const items = COUNTIES.map(([name], k) => {
    const z = paperSize(k, mode, d);
    let tx, ty, lead = null, pin = false;
    if (name === "金馬") { [tx, ty] = mode === "phone" ? [30, 36] : [56, 44]; pin = true; }
    else if (mode === "phone") {
      [tx, ty] = SEA[name] ? at(...SEA[name]) : name === "澎湖縣" ? at(119.5, 23.95) : at(...(CITY[name] || ANCHOR[name]));
      lead = at(...(CITY[name] || ANCHOR[name]));
    } else if (CALL[name]) { [tx, ty] = at(...CALL[name]); lead = at(...CITY[name]); }
    else [tx, ty] = at(...ANCHOR[name]);
    return { k, name, ...z, x: tx, y: ty, tx, ty, pin, lead, city: !!CITY[name], bold: !!CITY[name] };
  });
  relax(items, m.w, m.h, youW(d));
  const spots = items.map((a) => {
    // a county that was pushed off its place gets a dotted line back to it (a city always has one, with a red dot)
    const far = a.lead && Math.hypot(a.x - a.lead[0], a.y - a.lead[1]) > Math.min(a.w, a.h) / 2 + 3;
    return { cx: f1(a.x), cy: f1(a.y), w: f1(a.w), h: f1(a.h), cols: a.cols, bold: a.bold, lead: far && (mode === "phone" || a.city) ? a.lead : null, dot: a.city };
  });
  return (memo[key] = { m, g, spots });
}

// Where the county box sits, as fractions of the board and the CSS that puts it there. Used by table.js.
export function popPlace(k, narrow, lang = "zh-Hant") {
  const { m, spots } = layout(narrow ? "phone" : "desk", lang), s = spots[k];
  const fx = s.cx / m.w, fy = s.cy / m.h, pc = (n) => f1(n * 100);
  const style = (rule) => `--ax:${f1(fx * 1000) / 1000};${rule}`;
  if (narrow) {
    const down = fy < 0.55;
    return { cls: `pop-n ${down ? "dn" : "up"}`, style: style(down ? `top:${pc((s.cy + s.h / 2 + 8) / m.h)}%` : `bottom:${pc(1 - (s.cy - s.h / 2 - 17) / m.h)}%`) };
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
  const L = layout(mode, lang), { m, g } = L;
  let svg = `<svg class="tw tw-${mode}" viewBox="0 0 ${m.w} ${m.h}" role="group" aria-label="${esc(M.board)}" font-family="'Noto Sans TC', sans-serif">` +
    `<defs><filter id="tw-sh" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="1" stdDeviation=".8" flood-color="#3c2410" flood-opacity=".35"/></filter>` +
    `<pattern id="tw-wv" width="40" height="18" patternUnits="userSpaceOnUse"><path d="M2 12q4-5 9 0t9 0" fill="none" stroke="#9fb3b0" stroke-width=".9" opacity=".5"/></pattern>` +
    `<clipPath id="tw-cl"><path d="${g.coast}"/></clipPath></defs>` +
    `<rect width="${m.w}" height="${m.h}" fill="url(#tw-wv)"/>` +
    `<g clip-path="url(#tw-cl)">${g.fills}</g>` +
    `<g clip-path="url(#tw-cl)"><path d="${g.county}" stroke="${INK}" stroke-width=".7" fill="none" stroke-dasharray="2.5 1.8"/><path d="${g.region}" stroke="${INK}" stroke-width="1.5" fill="none"/></g>` +
    `<path d="${g.coast}" fill="none" stroke="${INK}" stroke-width="1.9"/><path d="${g.penghu}" fill="${TINT[6]}" stroke="${INK}" stroke-width="1.2"/>`;
  for (const s of L.spots) if (s && s.lead) {
    svg += `<path d="M${f1(s.lead[0])} ${f1(s.lead[1])}L${f1(s.cx)} ${f1(s.cy)}" stroke="${INK}" stroke-width="1" stroke-dasharray="1 2.5" stroke-linecap="round"/>` +
      (s.dot ? `<circle cx="${f1(s.lead[0])}" cy="${f1(s.lead[1])}" r="3.2" fill="${RED}" stroke="${PAPER}" stroke-width="1"/>` : "");
  }
  const km = L.spots[COUNTIES.findIndex((c) => c[0] === "金馬")];
  if (mode === "desk") svg += `<g><rect x="8" y="8" width="96" height="58" fill="rgba(251,246,233,.75)" stroke="${INK}" stroke-dasharray="3 2"/><text x="13" y="20" font-size="8.5" fill="#6a5a48">${esc(M.islands)}</text></g>`;
  else svg += `<g><rect x="${f1(Math.max(3, km.cx - km.w / 2 - 6))}" y="${f1(Math.max(3, km.cy - km.h / 2 - 18))}" width="${f1(km.w + 12)}" height="${f1(km.h + 24)}" fill="rgba(251,246,233,.75)" stroke="${INK}" stroke-dasharray="3 2"/></g>`;
  let boxes = "";
  const pics = [];
  COUNTIES.forEach((_, k) => { boxes += paper(v, k, d, lang, o, mode, L.spots[k], m, pics); });
  svg += boxes + `</svg>`;

  const keyList = REGIONS.map((_, r) => {
    const endorse = v.endorse[r];
    const parts = endorse >= 0 ? `${M.endorse} ${cand(d, endorse).short}` : "";
    const name = lang === "en" ? d.regions[REGIONS[r]] : REGIONS[r];
    return `<li data-region="${r}" data-endorse="${endorse}"><i class="sw" style="background:${TINT[r]}"></i><b>${esc(name)}</b>${parts ? `<span>${esc(parts)}</span>` : ""}</li>`;
  }).join("");
  // The national media box, all three always shown, 陳 宋 連 (#34): "全國媒體 陳 0 · 宋 0 · 連 2".
  const med = v.media;
  const media = `<p class="ct tw-media" data-media-national="${med.join(",")}"><b>${esc(M.national)}</b> ${esc([0, 1, 2].map((p) => `${cand(d, p).short} ${med[p]}`).join(" · "))}</p>`;
  const sq = (cls) => `<i class="lb ${cls}"></i>`;
  const legend = `<p class="legend tw-leg"><span>${sq("chen")}${sq("soong")}${sq("lien")} ${esc(M.legendCubes)}</span><span>${sq("green")}${sq("blue")} ${esc(M.legendEmpty)}</span><span>${sq("grey")} ${esc(M.legendGrey)}</span><span><i class="lb pw"></i>${esc(M.legendPawn)}</span></p>`;
  return `<section class="t-map" aria-label="${esc(M.board)}"><h3 class="t-h">${esc(M.board)}</h3><p class="ct tw-hint">${esc(M.hint)}</p>` +
    `<div class="tw-box">${svg}${pics.join("")}${o.overlay || ""}</div><ul class="tw-reg">${keyList}</ul>${media}${legend}</section>`;
}
