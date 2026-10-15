// tools/balance34.mjs — after a rules change, is the game still a three-way race? (#34)
// Orchestrator's instrument: a peer may run it, does not edit it. Runs the bot-vs-bot simulator (tests/sim.js).
//
//   node tools/balance34.mjs
//
// 600 games, all three seats at level 3 (操盤手), seeds 1…600, no rotation, and checks (orchestrator's bands, set
// for #34 from main before it, rulebook v0.3: win 陳 36.0 / 宋 35.7 / 連 28.3 %, margin 3.5, turnout 86.3 %):
//   - every candidate wins between 25 % and 42 % of the games (nobody runs away, nobody is left behind);
//   - the average margin is at most 6 blocks, the average turnout between 80 % and 92 %;
//   - every game ends (the simulator's own errors fail the run).
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SIM = fileURLToPath(new URL("../tests/sim.js", import.meta.url));
const BASE = { win: [36.0, 35.7, 28.3], margin: 3.5, turnout: 86.3 };
let out;
try { out = execFileSync(process.execPath, [SIM, "600", "levels=3,3,3", "seed=1", "rotate=0", "quiet=1"], { encoding: "utf8", maxBuffer: 64 << 20 }); }
catch (e) { console.log(`FAIL: the simulator stopped: ${(e.stderr || e.message || "").toString().split("\n").slice(0, 4).join(" ")}`); process.exit(1); }
const last = out.trim().split("\n").filter((l) => l.startsWith("{")).pop();
if (!last) { console.log("FAIL: no result line from the simulator (instrument)"); process.exit(1); }
const r = JSON.parse(last);
const rows = [];
const rule = (ok, what) => rows.push({ ok, what });
const N = ["陳", "宋", "連"];
rule(r.games === 600, `600 games played (${r.games})`);
for (let p = 0; p < 3; p++) rule(r.win[p] >= 25 && r.win[p] <= 42, `${N[p]} wins ${r.win[p]}% (25–42; v0.3 ${BASE.win[p]}%)`);
rule(r.margin <= 6, `average margin ${r.margin} blocks (≤ 6; v0.3 ${BASE.margin})`);
rule(r.turnout >= 80 && r.turnout <= 92, `average turnout ${r.turnout}% (80–92; v0.3 ${BASE.turnout}%)`);
let bad = 0;
for (const x of rows) { if (!x.ok) bad++; console.log(`${x.ok ? "✓" : "✗"} ${x.what}`); }
console.log(`(votes ${r.votes.join("/")}, decisions per game ${r.decisions}, ${r.wallSeconds}s)`);
console.log(bad ? `FAIL: ${bad} of ${rows.length}` : `PASS: ${rows.length} checks`);
process.exit(bad ? 1 : 0);
