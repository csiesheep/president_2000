// tests/sim.js — bot-vs-bot balance (M2, #10). BE's file; not part of `npm test`.
//
//   node tests/sim.js <games> [levels=3,3,3] [seed=1] [rotate=1] [workers=N] [quiet=1] [rules=v0.4|v0.5]
//
// Game i (0-based) uses seed + i. levels[s] plays seat s (1 樁腳, 2 總幹事, 3 操盤手).
// rotate=1: the first level in `levels` is the hero and the other two its
// opponents; the hero sits 陳 for the first third of the games, 宋 for the
// second and 連 for the last (#10 §三.3: "主角輪流坐三個位子各 100 局").
// Prints each seat's win rate, average blocks, average margin and turnout
// (blocks on the board ÷ 154), the spread and the outliers; the last line is
// JSON. rules= picks the rule set (#49: v0.5 is the draft that folds ads and media into the issues; default v0.4);
// the report also shows where each seat's CP went (競選/廣告/議題). Games run in child processes (workers, default: CPUs − 1, at most 8);
// a chunk whose process dies is run again once, then the whole run fails.
import { fork } from "node:child_process";
import os from "node:os";
import { fileURLToPath } from "node:url";
import * as E from "../public/shared/engine.js";
import * as B from "../public/shared/bots.js";
import { localCards, EVENTS } from "../public/shared/cards.js";

const SELF = fileURLToPath(import.meta.url);
const NAMES = ["陳", "宋", "連"];
const BLOCKS = 154;
const CP = Object.fromEntries([...EVENTS, ...localCards()].map((c) => [c.id, c.cp]));

// The move-choosing RNG (mulberry32), separate from the engine's.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// One game. Returns a plain record (it crosses a process boundary).
export function playGame(seed, levels, rules) {
  let st = E.createGame(seed, rules ? { rules } : {});
  const R = rng(seed * 977 + 13);
  let ms = 0, decisions = 0, debateCP = null;
  const why = {};
  const cp = [0, 1, 2].map(() => ({ campaign: 0, ads: 0, issue: 0 }));
  for (let n = 0; n < 20000 && st.phase !== "end"; n++) {
    if (st.turn === 6 && !debateCP) debateCP = st.savedDebate.map((pile) => pile.map((id) => CP[id]));
    const seat = E.mustAct(st)[0];
    if (seat == null) throw new Error(`seed ${seed}: nobody to act in ${st.phase}`);
    const t0 = performance.now();
    const out = B.chooseMove(st, seat, levels[seat], R);
    ms += performance.now() - t0; decisions++;
    if (out.move.type === "action" && st.pending) cp[seat][out.move.kind] += st.pending.cp;
    why[out.why.key] = (why[out.why.key] || 0) + 1;
    st = E.apply(st, seat, out.move);
  }
  if (st.phase !== "end") throw new Error(`seed ${seed}: did not end`);
  const r = st.result;
  const sorted = r.votes.slice().sort((a, b) => b - a);
  const played = (id) => st.log.some((e) => e.t === "effect" && e.card === id);
  return {
    seed, levels, winner: r.winner, votes: r.votes, leads: r.leads,
    margin: sorted[0] - sorted[1], onBoard: r.votes[0] + r.votes[1] + r.votes[2],
    ms, decisions, debateCP: debateCP || [[], [], []], why, cp,
    lead: [0, 1, 2].map((p) => st.log.filter((e) => e.t === "momentum" && (e.step === "media" || e.step === "lead") && e.seat === p).length),
    xingpiao: played("yang_exposes"), shouyi: played("lee_authorized"), fanfu: played("shifting_story"),
  };
}

function levelsFor(i, n, base, rotate) {
  if (!rotate) return base.slice();
  const third = Math.ceil(n / 3);
  const seat = Math.min(2, Math.floor(i / third));
  const out = [base[1], base[2]];
  out.splice(seat, 0, base[0]);
  return out;
}

function parseArgs(argv) {
  const o = { games: parseInt(argv[0] || "100", 10), levels: [3, 3, 3], seed: 1, rotate: false, workers: Math.min(8, Math.max(1, os.cpus().length - 1)), quiet: false, rules: null };
  for (const a of argv.slice(1)) {
    const [k, v] = a.split("=");
    if (k === "levels") o.levels = v.split(",").map(Number);
    else if (k === "seed") o.seed = parseInt(v, 10);
    else if (k === "rotate") o.rotate = v === "1" || v === "true";
    else if (k === "workers") o.workers = Math.max(1, parseInt(v, 10));
    else if (k === "quiet") o.quiet = v === "1" || v === "true";
    else if (k === "rules") o.rules = v;
    else throw new Error("sim: unknown option " + a);
  }
  if (!(o.games > 0)) throw new Error("sim: games must be a positive number");
  if (o.levels.length !== 3 || o.levels.some((x) => ![1, 2, 3].includes(x))) throw new Error("sim: levels must be three of 1/2/3");
  return o;
}

function runChunk(list) { return list.map(([seed, levels, rules]) => playGame(seed, levels, rules)); }

function runInChild(list) {
  return new Promise((resolve, reject) => {
    const child = fork(SELF, ["--child"], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
    let err = "", done = false;
    child.stderr.on("data", (d) => { err += d; });
    child.on("message", (m) => { done = true; resolve(m); child.kill(); });
    child.on("exit", (code) => { if (!done) reject(new Error(`worker exited ${code}: ${err.slice(-500)}`)); });
    child.send(list);
  });
}

async function runAll(o) {
  const jobs = [];
  for (let i = 0; i < o.games; i++) jobs.push([o.seed + i, levelsFor(i, o.games, o.levels, o.rotate), o.rules]);
  if (o.workers <= 1 || o.games < 8) return runChunk(jobs);
  const size = Math.max(1, Math.ceil(jobs.length / (o.workers * 4)));
  const chunks = [];
  for (let i = 0; i < jobs.length; i += size) chunks.push(jobs.slice(i, i + size));
  const results = new Array(chunks.length);
  let next = 0;
  const worker = async () => {
    while (next < chunks.length) {
      const c = next++;
      try { results[c] = await runInChild(chunks[c]); }
      catch (e) { process.stderr.write(`chunk ${c} failed, retrying: ${e.message}\n`); results[c] = await runInChild(chunks[c]); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(o.workers, chunks.length) }, worker));
  return results.flat();
}

const pct = (x, n) => Math.round((1000 * x) / n) / 10;
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const sd = (xs) => { const m = avg(xs); return Math.sqrt(avg(xs.map((x) => (x - m) ** 2))); };
const r1 = (x) => Math.round(x * 10) / 10;
const quant = (xs, q) => { const s = xs.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };

function summarize(o, games) {
  const n = games.length;
  const wins = [0, 0, 0];
  for (const g of games) wins[g.winner]++;
  const votes = [0, 1, 2].map((p) => games.map((g) => g.votes[p]));
  const margins = games.map((g) => g.margin);
  const turnout = games.map((g) => g.onBoard / BLOCKS);
  const ms = games.map((g) => g.ms);
  const dcp = [0, 1, 2].map((p) => games.flatMap((g) => g.debateCP[p]));
  const out = {
    games: n, levels: o.levels.join(","), seed: o.seed, rotate: o.rotate, rules: o.rules || "v0.4",
    win: wins.map((w) => pct(w, n)),
    votes: votes.map((v) => r1(avg(v))),
    votesSd: votes.map((v) => r1(sd(v))),
    margin: r1(avg(margins)), marginP90: quant(margins, 0.9), marginMax: Math.max(...margins),
    turnout: r1(100 * avg(turnout)), turnoutMin: r1(100 * Math.min(...turnout)), turnoutMax: r1(100 * Math.max(...turnout)),
    xingpiao: pct(games.filter((g) => g.xingpiao).length, n), shouyi: pct(games.filter((g) => g.shouyi).length, n), fanfu: pct(games.filter((g) => g.fanfu).length, n),
    debateCP: dcp.map((xs) => Math.round(avg(xs) * 100) / 100),
    msPerGame: Math.round(avg(ms)), msMax: Math.round(Math.max(...ms)), decisions: Math.round(avg(games.map((g) => g.decisions))),
    // each seat's CP by action kind, in % of its CP (競選/廣告/議題), and the leader's +1 per game
    cp: [0, 1, 2].map((p) => { const c = { campaign: 0, ads: 0, issue: 0 }; for (const g of games) for (const k in c) c[k] += g.cp[p][k]; const all = c.campaign + c.ads + c.issue || 1; return [c.campaign, c.ads, c.issue].map((x) => r1(100 * x / all)); }),
    lead: [0, 1, 2].map((p) => Math.round(100 * avg(games.map((g) => g.lead[p]))) / 100),
  };
  if (o.rotate) {
    // the hero is the first level; per seat it sat in
    const heroWins = [0, 0, 0], heroGames = [0, 0, 0];
    const third = Math.ceil(n / 3);
    games.forEach((g, i) => { const s = Math.min(2, Math.floor(i / third)); heroGames[s]++; if (g.winner === s) heroWins[s]++; });
    out.hero = { level: o.levels[0], win: pct(heroWins.reduce((a, b) => a + b, 0), n), bySeat: [0, 1, 2].map((s) => `${heroWins[s]}/${heroGames[s]}`) };
  }
  return out;
}

function report(o, games, s) {
  const lines = [];
  lines.push(`${s.games} 局  rules=${s.rules}  levels=${s.levels}${o.rotate ? "（主角輪流坐）" : ""}  seed=${s.seed}…${s.seed + s.games - 1}`);
  for (let p = 0; p < 3; p++) lines.push(`  ${NAMES[p]}  勝率 ${s.win[p].toFixed(1)}%  平均方塊 ${s.votes[p].toFixed(1)}（σ ${s.votesSd[p]}）`);
  lines.push(`  勝差 平均 ${s.margin}  P90 ${s.marginP90}  最大 ${s.marginMax}`);
  lines.push(`  投票率 平均 ${s.turnout}%  最低 ${s.turnoutMin}%  最高 ${s.turnoutMax}%`);
  lines.push(`  興票案 ${s.xingpiao}%  授意說 ${s.shouyi}%  說法反覆 ${s.fanfu}%`);
  lines.push(`  政見發表會堆平均 CP ${s.debateCP.join(" / ")}`);
  lines.push(`  chooseMove 每局 ${s.msPerGame} ms（最多 ${s.msMax}）、${s.decisions} 個決定`);
  lines.push(`  CP 競選/廣告/議題 %  ${s.cp.map((c, p) => `${NAMES[p]} ${c.join("/")}`).join("  ")}；領先者 +1 每局 ${s.lead.join(" / ")}`);
  if (s.hero) lines.push(`  主角（等級 ${s.hero.level}）勝率 ${s.hero.win}%  坐陳 ${s.hero.bySeat[0]}、坐宋 ${s.hero.bySeat[1]}、坐連 ${s.hero.bySeat[2]}`);
  // outliers: the widest margins and the lowest turnout
  const wide = games.slice().sort((a, b) => b.margin - a.margin).slice(0, 3).map((g) => `seed ${g.seed} ${g.votes.join("/")}`);
  const low = games.slice().sort((a, b) => a.onBoard - b.onBoard).slice(0, 3).map((g) => `seed ${g.seed} ${g.onBoard}`);
  lines.push(`  離群：勝差最大 ${wide.join("；")}  盤上最少 ${low.join("；")}`);
  return lines.join("\n");
}

if (process.argv[2] === "--child") {
  process.on("message", (list) => { process.send(runChunk(list)); });
} else if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const o = parseArgs(process.argv.slice(2));
  const t0 = Date.now();
  const games = await runAll(o);
  games.sort((a, b) => a.seed - b.seed);
  const s = summarize(o, games);
  s.wallSeconds = Math.round((Date.now() - t0) / 1000);
  if (!o.quiet) console.log(report(o, games, s));
  console.log(JSON.stringify(s));
}
