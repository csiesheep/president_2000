// The compact table (issue #29), as far as node can see it. Orchestrator's file: a peer may run it and
// falsify against it, and does not edit it. How high the top is on a phone, the menu, the pictures as
// button backgrounds and whether anything is clipped are measured in a browser (tools/compact29.mjs) and
// checked by looking.
//
//   node --test tests/compact.test.js      (or `npm test`)
//
// Owner, 2026-10-15 (design canvas WQA4hG46qh5FBqXCWGfBjh, "定稿" board): candidates of version one,
// issues of version two, the map of version one; "讓各個顏色方塊一樣大，所以票數多的城市框會比較大";
// the candidates stand on the map as round pictures in their county, the county's frame does not change
// colour; the candidate's big number reads as votes, "33" with a small "0萬票" (1 cube = 10萬票, rules).
//
// Contract. taiwanMap(view, lang, opts), on the phone (opts.narrow) and on the desk alike:
//   - county k's frame is a <rect data-paper="k"> with x, y, width and height in the map's viewBox units
//     (no transform on the map's county drawing);
//   - every vote block (data-slot, data-of=k) is a square <rect> inside its county's frame; the cubes of
//     the three candidates are all one size, the empty blocks one size at most 1.5 smaller, and on the phone
//     a cube is at least 6 units;
//   - no two frames overlap, and every frame is inside the viewBox;
//   - each candidate (data-pawn="chen|soong|lien", data-of=k, a <g> with no <g> inside it) is a picture:
//     an <image> whose href ends in art/candidates/<seat>.webp, at least 20 × 20 units, and the ballot number
//     (陳 5, 宋 1, 連 2) as text; the viewer's own candidate (view.seat) carries data-me and the word 你 /
//     You, no other does; whatever a candidate draws (circles, rects, the picture) stays off every other
//     county's frame and inside the viewBox, also when two or three candidates stand in one county; two in
//     one county are at least 8 units apart;
//   - a candidate standing in a county does not change that county's frame: its stroke, stroke-width and
//     fill are the same as with nobody there.
// tableHTML(view, choices, lang): the three candidate panels (data-seat="1", "2", "0" in that order, the
// last one closed by </section>) each show
//   - the votes: in zh the cubes on the board n followed by 0萬票 (33 → "33" + "0萬票"), 0票 when n = 0;
//     in en n/10 with one decimal followed by M votes (33 → "3.3M votes"), 0 votes when n = 0
//     (whitespace between the pieces does not matter);
//   - 動能 / Momentum and the momentum number (as text or in an aria-label);
//   - hand · kept and bag as today (shown on a tap on the phone; they stay in the table).
// The map checks report 尚未實作 until the map draws a data-paper; the standee checks until a data-pawn holds
// an <image>; the panel checks until a zh panel says 萬票.
import test from "node:test";
import assert from "node:assert/strict";
import { R, section, check, ok, nonEmpty, summary } from "./harness.js";
import * as E from "../public/shared/engine.js";
import * as B from "../public/shared/board.js";
import * as D from "./driver.js";
import * as S from "../public/solo.js";
import { taiwanMap } from "../public/map.js";
import { tableHTML } from "../public/table.js";
import zh from "../public/i18n/zh-Hant.js";
import en from "../public/i18n/en.js";

const SEAT = ["chen", "soong", "lien"];
const NO = [5, 1, 2];
const SEAT_ORDER = [1, 2, 0];
const TOL = 0.5;

// ---------------------------------------------------------------- reading the SVG string
function tags(html, name) {
  const out = [];
  const re = new RegExp(`<[a-zA-Z][^<>]*?\\s${name}(?:="([^"]*)")?(?=[\\s/>])[^<>]*>`, "g");
  let m;
  while ((m = re.exec(html))) out.push({ tag: m[0], v: m[1], at: m.index });
  return out;
}
const attr = (tag, name) => { const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`)); return m ? m[1] : null; };
const num = (tag, name) => { const s = attr(tag, name); return s == null ? NaN : Number(s); };
const rectOf = (tag) => ({ x: num(tag, "x"), y: num(tag, "y"), w: num(tag, "width"), h: num(tag, "height") });
const okRect = (r) => [r.x, r.y, r.w, r.h].every(Number.isFinite);
const overlap = (a, b) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > TOL && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > TOL;
const inside = (a, b) => a.x >= b.x - TOL && a.y >= b.y - TOL && a.x + a.w <= b.x + b.w + TOL && a.y + a.h <= b.y + b.h + TOL;
const f = (r) => `(${r.x.toFixed(1)}, ${r.y.toFixed(1)}, ${r.w.toFixed(1)}×${r.h.toFixed(1)})`;
const name = (k) => B.COUNTIES[k][0];
function viewBox(svg) {
  const m = svg.match(/<svg[^>]*\sviewBox="([^"]+)"/);
  if (!m) return null;
  const [x, y, w, h] = m[1].trim().split(/[\s,]+/).map(Number);
  return { x, y, w, h };
}
// One candidate's markup: from its <g data-pawn> to the first </g> (the contract says no <g> inside).
function pawnBody(html, t) {
  const end = html.indexOf("</g>", t.at);
  return end < 0 ? "" : html.slice(t.at, end);
}
// The box of everything a candidate draws: circles, rects, images.
function pawnBox(body) {
  const boxes = [];
  for (const c of body.match(/<circle[^>]*>/g) || []) {
    const cx = num(c, "cx"), cy = num(c, "cy"), r = num(c, "r");
    if ([cx, cy, r].every(Number.isFinite)) boxes.push({ x: cx - r, y: cy - r, w: 2 * r, h: 2 * r });
  }
  for (const t of (body.match(/<rect[^>]*>/g) || []).concat(body.match(/<image[^>]*>/g) || [])) {
    const r = rectOf(t);
    if (okRect(r)) boxes.push(r);
  }
  if (!boxes.length) return null;
  const x = Math.min(...boxes.map((b) => b.x)), y = Math.min(...boxes.map((b) => b.y));
  return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y };
}
const imageOf = (body) => { const m = body.match(/<image[^>]*>/); return m ? m[0] : null; };
const hrefOf = (tag) => attr(tag, "href") || attr(tag, "xlink:href") || "";
const textOf = (body) => (body.match(/<text[^>]*>([^<]*)<\/text>/g) || []).map((t) => t.replace(/<[^>]*>/g, "")).join(" ");
const centre = (r) => [r.x + r.w / 2, r.y + r.h / 2];

// The ring of a candidate: its largest circle.
function ringOf(body) {
  let best = null;
  for (const c of body.match(/<circle[^>]*>/g) || []) { const r = num(c, "r"); if (Number.isFinite(r) && (!best || r > best.r)) best = { cx: num(c, "cx"), cy: num(c, "cy"), r }; }
  return best;
}
// #31: the picture is an HTML <img data-pawn-pic="<seat>"> laid over the map (iPhone Safari blanks an SVG <image>
// for a moment whenever the map is redrawn), placed with left / top / width / height in % of the viewBox.
// Before #31 it was an SVG <image> inside the candidate's <g>. pic = { kind, href, box (viewBox units), tag }.
function picOf(html, body, seat, vb) {
  const im = imageOf(body);
  if (im) return { kind: "svg", href: hrefOf(im), box: rectOf(im), tag: im };
  const t = tags(html, "data-pawn-pic").find((x) => x.v === seat);
  if (!t || !vb) return null;
  const st = attr(t.tag, "style") || "", pc = (k) => { const m = st.match(new RegExp(`(?:^|;)\\s*${k}\\s*:\\s*([\\d.]+)%`)); return m ? Number(m[1]) : NaN; };
  return { kind: "html", href: attr(t.tag, "src") || "", box: { x: vb.x + (pc("left") * vb.w) / 100, y: vb.y + (pc("top") * vb.h) / 100, w: (pc("width") * vb.w) / 100, h: (pc("height") * vb.h) / 100 }, tag: t.tag, ofAttr: attr(t.tag, "data-of") };
}
const union = (a, b) => (!a ? b : !b || !okRect(b) ? a : { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.max(a.x + a.w, b.x + b.w) - Math.min(a.x, b.x), h: Math.max(a.y + a.h, b.y + b.h) - Math.min(a.y, b.y) });

function mapParts(v, lang, narrow) {
  const html = taiwanMap(v, lang, { narrow });
  const svg = (html.match(/<svg[\s\S]*?<\/svg>/) || [""])[0], vb = viewBox(svg);
  const papers = {};
  for (const t of tags(svg, "data-paper")) papers[Number(t.v)] = rectOf(t.tag);
  const slots = tags(svg, "data-slot").map((t) => ({ kind: t.v, k: Number(attr(t.tag, "data-of")), r: rectOf(t.tag), tag: t.tag }));
  const pawns = tags(svg, "data-pawn").map((t) => {
    const body = pawnBody(svg, t), pic = picOf(html, body, t.v, vb);
    return { seat: t.v, k: Number(attr(t.tag, "data-of")), tag: t.tag, body, box: union(pawnBox(body), pic && pic.box), pic, img: pic && pic.tag, ring: ringOf(body) };
  });
  return { html, svg, vb, papers, slots, pawns, paperTags: Object.fromEntries(tags(svg, "data-paper").map((t) => [Number(t.v), t.tag])) };
}
const MODES = [["phone", true], ["desk", false]];

// ---------------------------------------------------------------- positions
function positions() {
  const out = [];
  for (const [seat, seed] of [[0, 911], [1, 912], [2, 913]]) {
    for (const lang of ["zh-Hant", "en"]) {
      let s = S.advance(S.newSolo({ seat, level: 2, seed }));
      const R1 = D.rng(seed * 5 + seat);
      for (let n = 0; n < 400 && s.st.phase !== "end"; n++) {
        const ch = S.choices(s, lang);
        if (!ch.length) break;
        if (n % 4 === 0) out.push({ v: E.view(s.st, seat), ch, lang, where: `${SEAT[seat]} seed ${seed} 第 ${s.st.turn} 回合 ${s.st.phase} 第 ${n} 個決定（${lang}）` });
        s = S.advance(S.act(s, ch[Math.floor(R1() * ch.length)].move));
      }
    }
  }
  return out;
}
const POOL = positions();
// All three candidates in one county, for every county, and two of them in one county; the viewer is each seat.
function crowded() {
  const out = [], base = E.view(E.createGame(7), 0);
  for (let k = 0; k < 24; k++) {
    for (const [pos, seat] of [[[k, k, k], 0], [[k, k, (k + 5) % 24], 1], [[(k + 9) % 24, k, k], 2]]) {
      const v = JSON.parse(JSON.stringify(base));
      v.pos = pos; v.seat = seat;
      out.push({ v, where: `${pos.map((p) => name(p)).join("/")}，視角 ${SEAT[seat]}` });
    }
  }
  return out;
}
const CROWD = crowded();

// ---------------------------------------------------------------- gates
const P0 = POOL[0];
const mapGate = (fn) => () => {
  for (const [mode, narrow] of MODES) if (!Object.keys(mapParts(P0.v, P0.lang, narrow).papers).length) return `TODO: ${mode} 地圖還沒有 data-paper（#29）`;
  return fn();
};
const pawnGate = (fn) => () => {
  for (const [mode, narrow] of MODES) if (!mapParts(P0.v, P0.lang, narrow).pawns.some((p) => p.pic)) return `TODO: ${mode} 地圖的候選人還沒有圖（#29）`;
  return fn();
};
const panelOf = (html, p) => {
  const a = html.indexOf(`data-seat="${p}"`);
  if (a < 0) return null;
  const nexts = SEAT_ORDER.map((q) => html.indexOf(`data-seat="${q}"`, a + 5)).filter((i) => i > a);
  const end = nexts.length ? Math.min(...nexts) : html.indexOf("</section>", a);
  return html.slice(a, end < 0 ? undefined : end);
};
const plain = (s) => s.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, "");
const labels = (s) => (s.match(/aria-label="[^"]*"/g) || []).join(" ");
const panelGate = (fn) => () => {
  const p = POOL.find((x) => x.lang === "zh-Hant");
  const html = tableHTML(p.v, p.ch, p.lang, {});
  if (![0, 1, 2].some((s) => /萬票/.test(plain(panelOf(html, s) || "")))) return "TODO: 候選人板還沒有寫票數（萬票）（#29）";
  return fn();
};
const cubes = (v, p) => v.counties.reduce((s, c) => s + c.blocks.filter((b) => b.o === p).length, 0);
const voteText = (n, lang) => (lang === "en" ? (n ? `${(n / 10).toFixed(1)}Mvotes` : "0votes") : (n ? `${n}0萬票` : "0票"));

section("29 精簡牌桌");

check("每縣一個框：手機與桌機的地圖，24 個縣市各有一個 data-paper 的 rect，座標可讀，都在 viewBox 裡", mapGate(() => {
  for (const [mode, narrow] of MODES) {
    const m = mapParts(P0.v, P0.lang, narrow);
    if (!m.vb) return `${mode}：讀不到 svg 的 viewBox`;
    const ks = Object.keys(m.papers).map(Number).sort((a, b) => a - b);
    if (JSON.stringify(ks) !== JSON.stringify([...Array(24).keys()])) return `${mode}：data-paper 是 ${JSON.stringify(ks)}，應為 0…23 各一個`;
    for (const k of ks) {
      const r = m.papers[k];
      if (!okRect(r)) return `${mode}：${name(k)} 的框讀不到 x / y / width / height：${m.paperTags[k]}`;
      if (!inside(r, m.vb)) return `${mode}：${name(k)} 的框 ${f(r)} 超出 viewBox ${f(m.vb)}`;
    }
  }
  return ok(true, "手機、桌機各 24 個框，都在 viewBox 裡");
}));

check("方塊一樣大：每一塊票都是正方形；陳宋連的方塊全部同一個大小，空塊同一個大小、最多小 1.5；手機上一顆方塊至少 6", mapGate(() => {
  const sizes = { phone: [], desk: [] };
  for (const [mode, narrow] of MODES) {
    for (const p of POOL.slice(0, 12)) {
      const m = mapParts(p.v, p.lang, narrow);
      const ne = nonEmpty(m.slots.length, `${mode} 的票塊`); if (ne !== true) return ne;
      const cube = new Set(), empty = new Set();
      for (const s of m.slots) {
        if (!okRect(s.r)) return `${mode} ${p.where}：${name(s.k)} 有一塊票讀不到大小：${s.tag}`;
        if (Math.abs(s.r.w - s.r.h) > 0.01) return `${mode} ${p.where}：${name(s.k)} 有一塊 ${s.kind} 是 ${s.r.w}×${s.r.h}，不是正方形`;
        (SEAT.includes(s.kind) ? cube : empty).add(s.r.w);
      }
      const ne2 = nonEmpty(cube.size, `${mode} 盤上的方塊`); if (ne2 !== true) return ne2;
      if (cube.size !== 1) return `${mode} ${p.where}：方塊有 ${cube.size} 種大小 ${JSON.stringify([...cube])}`;
      const c = [...cube][0];
      for (const e of empty) if (e > c + 0.01 || e < c - 1.5 - 0.01) return `${mode} ${p.where}：方塊 ${c}，空塊 ${e}（要在 ${c - 1.5}…${c} 之間）`;
      if (narrow && c < 6) return `phone ${p.where}：方塊只有 ${c}，至少要 6`;
      sizes[mode].push(c);
    }
  }
  return ok(true, `方塊大小：手機 ${[...new Set(sizes.phone)].join("/")}、桌機 ${[...new Set(sizes.desk)].join("/")}（各 12 個局面）`);
}));

check("框裝得下自己的票：每一塊票都在它那個縣市的框裡（所以票塊多的框比較大）", mapGate(() => {
  let n = 0, big = null;
  for (const [mode, narrow] of MODES) {
    for (const p of POOL.slice(0, 12)) {
      const m = mapParts(p.v, p.lang, narrow);
      for (const s of m.slots) {
        const box = m.papers[s.k];
        if (!box) return `${mode}：${name(s.k)} 沒有框`;
        if (!inside(s.r, box)) return `${mode} ${p.where}：${name(s.k)} 有一塊票 ${f(s.r)} 在框 ${f(box)} 外面`;
        n++;
      }
      if (narrow && !big) big = [m.papers[1], m.papers[22]];
    }
  }
  return ok(true, `${n} 塊票都在自己的框裡${big ? `；手機上台北縣的框 ${f(big[0])}、澎湖 ${f(big[1])}` : ""}`);
}));

check("框不重疊：任兩個縣市的框都不重疊（手機與桌機）", mapGate(() => {
  for (const [mode, narrow] of MODES) {
    const m = mapParts(P0.v, P0.lang, narrow);
    for (let a = 0; a < 24; a++) for (let b = a + 1; b < 24; b++) {
      if (overlap(m.papers[a], m.papers[b])) return `${mode}：${name(a)} ${f(m.papers[a])} 跟 ${name(b)} ${f(m.papers[b])} 重疊`;
    }
  }
  return ok(true, "手機、桌機各 276 對框都不重疊");
}));

check("候選人是一張圖：三個 data-pawn 各有一張 art/candidates/<seat>.webp 的圖（至少 20×20，圓心對準候選人的色環），還有號次 陳 5、宋 1、連 2", pawnGate(() => {
  let n = 0;
  for (const [mode, narrow] of MODES) {
    for (const p of POOL.slice(0, 12).concat(CROWD.filter((x, i) => i % 7 === 0).map((c) => ({ ...c, lang: "zh-Hant" })))) {
      const m = mapParts(p.v, p.lang, narrow);
      if (m.pawns.length !== 3) return `${mode} ${p.where}：有 ${m.pawns.length} 個 data-pawn`;
      for (const pw of m.pawns) {
        const s = SEAT.indexOf(pw.seat);
        if (/<g[\s>]/.test(pw.body.slice(1))) return `${mode}：${pw.seat} 的 <g data-pawn> 裡面還有 <g>（契約：裡面沒有 <g>）`;
        if (!pw.pic) return `${mode} ${p.where}：${pw.seat} 沒有圖`;
        if (!pw.pic.href.endsWith(`art/candidates/${pw.seat}.webp`)) return `${mode}：${pw.seat} 的圖是「${pw.pic.href}」`;
        const r = pw.pic.box;
        if (!okRect(r) || r.w < 20 || r.h < 20) return `${mode}：${pw.seat} 的圖是 ${okRect(r) ? r.w.toFixed(1) + "×" + r.h.toFixed(1) : "讀不到大小：" + pw.pic.tag}，至少 20×20`;
        if (!pw.ring) return `${mode}：${pw.seat} 沒有色環（<circle>）`;
        const [cx, cy] = centre(r);
        if (Math.hypot(cx - pw.ring.cx, cy - pw.ring.cy) > 1) return `${mode} ${p.where}：${pw.seat} 的圖中心 (${cx.toFixed(1)}, ${cy.toFixed(1)}) 沒對準色環 (${pw.ring.cx}, ${pw.ring.cy})`;
        if (!new RegExp(`(^|\\D)${NO[s]}(\\D|$)`).test(textOf(pw.body))) return `${mode}：${pw.seat} 的文字是「${textOf(pw.body)}」，沒有號次 ${NO[s]}`;
        n++;
      }
    }
  }
  return ok(true, `${n} 個候選人都有圖與號次，圖對準色環`);
}));

// #31, owner 2026-10-15 on iPhone Safari: 「遊戲中，地圖上候選人圈圈會一直閃動」— 圓圈裡的圖消失又出現. An SVG <image>
// carried into a redrawn map blanks there; an HTML <img> kept across redraws does not (#28).
check("候選人圖不在 SVG 裡：地圖沒有任何 <image>；每位候選人一張 <img data-pawn-pic=\"<seat>\" data-of=\"<縣>\">，在地圖框裡、svg 之外（#31）", pawnGate(() => {
  let n = 0, old = 0;
  for (const [mode, narrow] of MODES) {
    for (const p of POOL.slice(0, 8)) {
      const m = mapParts(p.v, p.lang, narrow);
      if (/<image[\s>]/.test(m.svg)) { old++; continue; }
      for (const pw of m.pawns) {
        if (!pw.pic || pw.pic.kind !== "html") return `${mode} ${p.where}：${pw.seat} 沒有 <img data-pawn-pic>`;
        if (Number(pw.pic.ofAttr) !== pw.k) return `${mode} ${p.where}：${pw.seat} 的 <img> data-of 是「${pw.pic.ofAttr}」，人在 ${pw.k}`;
        if (!/<img\s/.test(pw.pic.tag)) return `${mode}：${pw.seat} 的 data-pawn-pic 不是 <img>：${pw.pic.tag}`;
        n++;
      }
      if (tags(m.html, "data-pawn-pic").length !== 3) return `${mode} ${p.where}：有 ${tags(m.html, "data-pawn-pic").length} 張 data-pawn-pic`;
    }
  }
  if (old) return `地圖的候選人圖又變回 SVG <image>（${old} 個地圖），iPhone Safari 重畫時會閃（#31 已做好）`;
  return ok(true, `${n} 位候選人都是 <img data-pawn-pic>，地圖裡沒有 <image>`);
}));

check("你是哪一位：視角那位候選人有 data-me 與「你」/「You」，另外兩位沒有", pawnGate(() => {
  let n = 0;
  for (const [mode, narrow] of MODES) {
    for (const p of POOL.filter((x, i) => i % 5 === 0)) {
      const m = mapParts(p.v, p.lang, narrow);
      for (const pw of m.pawns) {
        const me = SEAT.indexOf(pw.seat) === p.v.seat, has = /\sdata-me(?=[\s=>])/.test(pw.tag);
        if (me !== has) return `${mode} ${p.where}：${pw.seat} ${me ? "是你卻沒有" : "不是你卻有"} data-me`;
        const word = p.lang === "en" ? "You" : "你";
        if (me && !textOf(pw.body).includes(word)) return `${mode} ${p.where}：你的候選人沒有寫「${word}」，文字是「${textOf(pw.body)}」`;
        if (!me && textOf(pw.body).includes(word)) return `${mode} ${p.where}：${pw.seat} 不是你，卻寫了「${word}」`;
        n++;
      }
    }
  }
  return ok(true, `${n} 個候選人，你的那一位有標記`);
}));

check("候選人不蓋到別的縣市：一位、兩位、三位站在同一縣時，候選人畫的東西都不碰別縣的框、都在 viewBox 裡；同一縣的兩位至少相隔 8", pawnGate(() => {
  let n = 0;
  for (const [mode, narrow] of MODES) {
    for (const c of CROWD.concat(POOL.slice(0, 6))) {
      const m = mapParts(c.v, "zh-Hant", narrow);
      for (const pw of m.pawns) {
        if (!pw.box) return `${mode} ${c.where}：${pw.seat} 讀不到畫了什麼`;
        if (!inside(pw.box, m.vb)) return `${mode} ${c.where}：${pw.seat} ${f(pw.box)} 超出 viewBox`;
        for (let k = 0; k < 24; k++) if (k !== pw.k && overlap(pw.box, m.papers[k])) return `${mode} ${c.where}：站在${name(pw.k)}的 ${pw.seat} ${f(pw.box)} 蓋到${name(k)}的框 ${f(m.papers[k])}`;
        n++;
      }
      for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) {
        const A = m.pawns[a], Bp = m.pawns[b];
        if (A.k !== Bp.k || !A.ring || !Bp.ring) continue;
        const [ax, ay] = [A.ring.cx, A.ring.cy], [bx, by] = [Bp.ring.cx, Bp.ring.cy];
        if (Math.hypot(ax - bx, ay - by) < 8) return `${mode} ${c.where}：${A.seat} 和 ${Bp.seat} 在${name(A.k)}疊在一起（相隔 ${Math.hypot(ax - bx, ay - by).toFixed(1)}）`;
      }
    }
  }
  return ok(true, `${n} 次候選人位置（含 24 縣各擠三位、擠兩位），都沒蓋到別縣`);
}));

check("候選人在的縣市，框不變色：框的 stroke、stroke-width、fill 跟沒有人在的時候一樣", pawnGate(() => {
  let n = 0;
  for (const [mode, narrow] of MODES) {
    for (const c of CROWD.filter((x, i) => i % 3 === 0)) {
      const k = c.v.pos[1];
      const away = JSON.parse(JSON.stringify(c.v)); away.pos = [(k + 1) % 24, (k + 2) % 24, (k + 3) % 24];
      const a = mapParts(c.v, "zh-Hant", narrow).paperTags[k], b = mapParts(away, "zh-Hant", narrow).paperTags[k];
      for (const at of ["stroke", "stroke-width", "fill"]) {
        if (attr(a, at) !== attr(b, at)) return `${mode}：${name(k)} 有候選人時框的 ${at} 是「${attr(a, at)}」，沒人時是「${attr(b, at)}」`;
      }
      n++;
    }
  }
  return ok(true, `${n} 個縣市，有沒有候選人框都一樣`);
}));

check("票數：候選人板寫盤上方塊換成的票，中文 n 接 0萬票（33 → 330萬票、0 → 0票），英文 n/10 接 M votes（3.3M votes、0 votes）", panelGate(() => {
  let n = 0;
  const zero = (() => { const v = E.view(E.createGame(7), 0); for (const c of v.counties) for (const b of c.blocks) if (b.o === 1) b.o = -1; return v; })();
  const cases = POOL.filter((x, i) => i % 3 === 0).map((p) => ({ v: p.v, ch: p.ch, lang: p.lang, where: p.where }))
    .concat(["zh-Hant", "en"].map((lang) => ({ v: zero, ch: [], lang, where: `宋盤上 0 顆（${lang}）` })));
  for (const c of cases) {
    const html = tableHTML(c.v, c.ch, c.lang, {});
    for (const p of [0, 1, 2]) {
      const seg = panelOf(html, p);
      if (!seg) return `${c.where}：找不到 data-seat="${p}" 的候選人板`;
      const want = voteText(cubes(c.v, p), c.lang), got = plain(seg);
      // The number must start there: "00票" or "1330萬票" holds "0票" / "330萬票" but is not it (FE found the hole, #29).
      const at = new RegExp(`(^|[^0-9.])${want.replace(/\./g, "\\.")}`);
      if (!at.test(got)) return `${c.where}：${SEAT[p]} 盤上 ${cubes(c.v, p)} 顆，板上應有「${want}」（前面不接數字），實際文字是「${got.slice(0, 80)}」`;
      if (cubes(c.v, p) === 0 && /00萬票|0\.0Mvotes/.test(got)) return `${c.where}：0 顆寫成了「${got.slice(0, 60)}」`;
      n++;
    }
  }
  return ok(true, `${n} 塊候選人板的票數都對（含 0 顆）`);
}));

check("動能、手牌、袋子還在：每塊候選人板有 動能/Momentum 與動能數，手牌 · 已留、袋中的字跟現在一樣", panelGate(() => {
  let n = 0;
  for (const p of POOL.filter((x, i) => i % 3 === 0)) {
    const html = tableHTML(p.v, p.ch, p.lang, {});
    const L = (p.lang === "en" ? en : zh).ui.look.board;
    for (const s of [0, 1, 2]) {
      const seg = panelOf(html, s) || "";
      const hay = seg.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ") + " " + labels(seg);
      if (!new RegExp(`${L.mom}\\s*${p.v.mom[s]}(\\D|$)`).test(hay)) return `${p.where}：${SEAT[s]} 板上找不到「${L.mom} ${p.v.mom[s]}」`;
      const inHand = Array.isArray(p.v.hands[s]) ? p.v.hands[s].length : p.v.hands[s];
      const keptA = p.v.turn <= 5 ? p.v.savedDebate[s] : p.v.savedElection[s], kept = Array.isArray(keptA) ? keptA.length : keptA;
      const hand = L.hand.replace("{n}", inHand).replace("{k}", kept), bag = L.bag.replace("{n}", p.v.bag[s]);
      if (!hay.includes(hand)) return `${p.where}：${SEAT[s]} 板上找不到「${hand}」`;
      if (!hay.includes(bag)) return `${p.where}：${SEAT[s]} 板上找不到「${bag}」`;
      n++;
    }
  }
  return ok(true, `${n} 塊候選人板都有動能、手牌、袋子`);
}));

test("compact", () => {
  const s = summary();
  for (const p of R.pass) console.log(`  ✓ ${p.label}${p.msg ? " — " + p.msg : ""}`);
  for (const t of s.todos) console.log(`  … ${t.label} — ${t.msg}`);
  for (const x of s.failures) console.log(`  ✗ ${x.label} — ${x.msg}`);
  console.log(`  通過 ${s.pass} / 失敗 ${s.fail} / 尚未實作 ${s.todo}`);
  assert.equal(s.fail, 0, s.failures.map((x) => `${x.label}: ${x.msg}`).join("\n"));
});
